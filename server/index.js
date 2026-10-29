import express from "express";
import helmet from "helmet";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorage } from "./storage.js";
import { InputError, text, itemFields } from "./validation.js";
import { ITEM_FIELDS, stamped } from "../shared/operations.js";
import { planSync } from "./sync.js";
import { normalizeName, itemKey } from "../shared/items.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokenPattern = /^[A-Za-z0-9_-]{32}$/;

export async function createApplication({
  dbPath = process.env.DATA_PATH || resolve(root, ".data/family-cart.sqlite"),
  databaseUrl = process.env.TURSO_DATABASE_URL,
  authToken = process.env.TURSO_AUTH_TOKEN,
  requireRemote = process.env.REQUIRE_REMOTE_DATABASE === "true",
  storage,
} = {}) {
  const db =
    storage ||
    (await openStorage({ dbPath, databaseUrl, authToken, requireRemote }));
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      referrerPolicy: { policy: "no-referrer" },
      contentSecurityPolicy: {
        directives: {
          // Safari doesn't consistently map 'self' to WebSocket schemes.
          "connect-src": [
            "'self'",
            (req) => `ws://${req.get("host")}`,
            (req) => `wss://${req.get("host")}`,
          ],
          "upgrade-insecure-requests":
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use((_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    // Shared links are bearer credentials. Do not allow another website to make changes.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      let allowed = !origin;
      if (origin) {
        try {
          const parsed = new URL(origin);
          allowed =
            parsed.host === req.get("host") ||
            (process.env.NODE_ENV !== "production" &&
              ["http://localhost:5173", "http://127.0.0.1:5173"].includes(
                origin,
              ));
        } catch {
          allowed = false;
        }
      }
      if (!allowed || req.get("sec-fetch-site") === "cross-site")
        return res
          .status(403)
          .json({ error: "Open your family list to make changes." });
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));

  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  async function snapshot(token) {
    const { list, items, usuals, favorites } = await db.readList(token);
    if (!list) return null;
    return {
      title: list.title,
      titleRevision: list.title_revision || "",
      favoriteStates: favorites.map((item) => ({
        name: item.name,
        store: item.store,
        quantity: item.quantity,
        note: item.note,
        pinned: Boolean(item.pinned),
        revision: item.revision,
        pinnedAt: item.pinned_at,
      })),
      version: list.version,
      createdAt: list.created_at,
      updatedAt: list.updated_at,
      usuals: usuals.map((item) => ({
        name: item.name,
        store: item.store,
        quantity: item.quantity,
        note: item.note,
        lastBought: item.last_bought,
      })),
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        store: item.store,
        quantity: item.quantity,
        note: item.note,
        bought: Boolean(item.bought),
        createdAt: item.created_at,
        boughtAt: item.bought_at,
        fieldVersions: JSON.parse(item.field_versions || "{}"),
      })),
    };
  }
  // One instance owns the live connections. Serialize each list's writes so
  // overlapping asynchronous edits preserve changes to independent fields.
  const writes = new Map();
  function mutation(handler) {
    return async (req, res, next) => {
      const token = req.params.token;
      const previous = writes.get(token) || Promise.resolve();
      let release;
      const gate = new Promise((resolveGate) => {
        release = resolveGate;
      });
      writes.set(token, gate);
      await previous;
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      } finally {
        release();
        if (writes.get(token) === gate) writes.delete(token);
      }
    };
  }
  function remember(token, item, boughtAt = item.bought_at || Date.now()) {
    return {
      sql: `INSERT INTO usual_items (list_token, name_key, store, name, quantity, note, last_bought)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(list_token, name_key, store) DO UPDATE SET
          name = excluded.name, quantity = excluded.quantity, note = excluded.note, last_bought = excluded.last_bought`,
      args: [
        token,
        normalizeName(item.name),
        item.store,
        item.name,
        item.quantity,
        item.note,
        boughtAt,
      ],
    };
  }
  async function persistMany(token, statements) {
    const results = await db.batchWrite([
      ...statements,
      {
        sql: `DELETE FROM usual_items WHERE list_token = ? AND (name_key, store) NOT IN
          (SELECT name_key, store FROM usual_items WHERE list_token = ? ORDER BY last_bought DESC, name_key, store LIMIT 200)`,
        args: [token, token],
      },
      {
        sql: "UPDATE lists SET version = version + 1, updated_at = ? WHERE token = ?",
        args: [Date.now(), token],
      },
    ]);
    return results[0];
  }
  async function persist(token, sql, args, extra = []) {
    return persistMany(token, [{ sql, args }, ...extra]);
  }
  async function publish(token, res, extra = {}) {
    const data = await snapshot(token);
    const message = JSON.stringify(data);
    for (const client of sockets.clients) {
      if (client.listToken === token && client.readyState === WebSocket.OPEN)
        client.send(message);
    }
    res.json({ ...data, ...extra });
  }
  app.get("/api/health", async (_req, res) => {
    await db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  });
  app.get("/api/manifest", (req, res) => {
    const token =
      typeof req.query.list === "string" && tokenPattern.test(req.query.list)
        ? req.query.list
        : null;
    const built = resolve(root, "dist/manifest.webmanifest");
    const manifest = JSON.parse(
      readFileSync(
        existsSync(built)
          ? built
          : resolve(root, "public/manifest.webmanifest"),
        "utf8",
      ),
    );
    res
      .type("application/manifest+json")
      .json({ ...manifest, start_url: token ? `/l/${token}` : "/" });
  });

  // Bound accidental creation loops without storing IP addresses on disk.
  const creations = new Map();
  app.post("/api/lists", async (req, res) => {
    const now = Date.now();
    for (const [key, value] of creations)
      if (value.reset < now) creations.delete(key);
    const key = req.socket.remoteAddress;
    const allowance = creations.get(key) ?? {
      count: 0,
      reset: now + 60 * 60 * 1000,
    };
    if (allowance.count >= 30)
      return res
        .status(429)
        .json({ error: "Too many new lists. Please try again in an hour." });
    const title = text(req.body?.title ?? "Our family list", "List name", 60);
    const token = randomBytes(24).toString("base64url");
    // Reserve the allowance before the first await.
    allowance.count++;
    creations.set(key, allowance);
    await db
      .prepare(
        "INSERT INTO lists (token, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(token, title, now, now);
    res.status(201).json({ token, ...(await snapshot(token)) });
  });
  app.use("/api/lists/:token", async (req, res, next) => {
    if (
      !tokenPattern.test(req.params.token) ||
      !(await db
        .prepare("SELECT 1 FROM lists WHERE token = ?")
        .get(req.params.token))
    ) {
      return res.status(404).json({
        error:
          "This list could not be found. Check the full link with your family.",
      });
    }
    next();
  });
  app.get("/api/lists/:token", async (req, res) =>
    res.json(await snapshot(req.params.token)),
  );
  app.patch(
    "/api/lists/:token",
    mutation(async (req, res) => {
      const title = text(req.body?.title, "List name", 60);
      await persist(
        req.params.token,
        "UPDATE lists SET title = ?, title_revision = ? WHERE token = ?",
        [title, randomUUID(), req.params.token],
      );
      await publish(req.params.token, res);
    }),
  );
  app.post(
    "/api/lists/:token/sync",
    mutation(async (req, res) => {
      const op = req.body?.operation;
      if (!op || typeof op.id !== "string" || !/^[0-9a-f-]{36}$/i.test(op.id))
        throw new InputError("This saved change is invalid.");
      const receipt = await db
        .prepare(
          "SELECT result FROM sync_receipts WHERE list_token = ? AND operation_id = ?",
        )
        .get(req.params.token, op.id);
      if (receipt)
        return res.json({
          ...(await snapshot(req.params.token)),
          syncResult: JSON.parse(receipt.result),
        });
      const current = await snapshot(req.params.token);
      const plan = planSync(op, current, req.params.token, remember);
      if (plan.conflict)
        return res.status(409).json({
          error: plan.conflict.message,
          snapshot: current,
          conflict: plan.conflict,
        });
      await persistMany(req.params.token, [
        ...plan.statements,
        {
          sql: "INSERT INTO sync_receipts (list_token, operation_id, result, created_at) VALUES (?, ?, ?, ?)",
          args: [
            req.params.token,
            op.id,
            JSON.stringify(plan.result),
            Date.now(),
          ],
        },
      ]);
      await publish(req.params.token, res, { syncResult: plan.result });
    }),
  );
  app.post(
    "/api/lists/:token/pick",
    mutation(async (req, res) => {
      if (
        !Array.isArray(req.body?.items) ||
        req.body.items.length < 1 ||
        req.body.items.length > 100
      ) {
        throw new InputError("Choose between 1 and 100 items to add.");
      }
      const picks = new Map();
      for (const entry of req.body.items) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          throw new InputError("Choose valid items from the catalog.");
        const item = itemFields(entry);
        if (!picks.has(itemKey(item))) picks.set(itemKey(item), item);
      }
      const current = await db
        .prepare(
          "SELECT * FROM items WHERE list_token = ? ORDER BY bought_at DESC, created_at DESC",
        )
        .all(req.params.token);
      const needed = new Set(
        current.filter((item) => !item.bought).map(itemKey),
      );
      const bought = new Map();
      for (const item of current.filter((item) => item.bought))
        if (!bought.has(itemKey(item))) bought.set(itemKey(item), item);
      const statements = [];
      const result = { added: 0, restored: 0, alreadyNeeded: 0 };
      for (const [key, item] of picks) {
        if (needed.has(key)) {
          result.alreadyNeeded++;
          continue;
        }
        const previous = bought.get(key);
        if (previous) {
          statements.push(remember(req.params.token, previous));
          statements.push({
            sql: "UPDATE items SET bought = 0, bought_at = NULL, field_versions = ? WHERE id = ? AND list_token = ?",
            args: [
              JSON.stringify(
                stamped(
                  JSON.parse(previous.field_versions || "{}"),
                  ["bought"],
                  randomUUID(),
                ),
              ),
              previous.id,
              req.params.token,
            ],
          });
          result.restored++;
        } else {
          statements.push({
            sql: "INSERT INTO items (id, list_token, name, store, quantity, note, created_at, field_versions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            args: [
              randomUUID(),
              req.params.token,
              item.name,
              item.store,
              item.quantity,
              item.note,
              Date.now(),
              JSON.stringify(stamped({}, ITEM_FIELDS, randomUUID())),
            ],
          });
          result.added++;
        }
      }
      if (current.length + result.added > 500)
        return res.status(409).json({
          error:
            "This list is full. Clear some bought items before adding more.",
        });
      if (statements.length) await persistMany(req.params.token, statements);
      await publish(req.params.token, res, { pickResult: result });
    }),
  );
  app.post(
    "/api/lists/:token/items",
    mutation(async (req, res) => {
      const item = itemFields(req.body ?? {});
      const { count } = await db
        .prepare("SELECT COUNT(*) AS count FROM items WHERE list_token = ?")
        .get(req.params.token);
      if (count >= 500)
        return res.status(409).json({
          error:
            "This list is full. Clear some bought items before adding more.",
        });
      await persist(
        req.params.token,
        "INSERT INTO items (id, list_token, name, store, quantity, note, created_at, field_versions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          randomUUID(),
          req.params.token,
          item.name,
          item.store,
          item.quantity,
          item.note,
          Date.now(),
          JSON.stringify(stamped({}, ITEM_FIELDS, randomUUID())),
        ],
      );
      res.status(201);
      await publish(req.params.token, res);
    }),
  );
  app.delete(
    "/api/lists/:token/completed",
    mutation(async (req, res) => {
      const bought = await db
        .prepare("SELECT * FROM items WHERE list_token = ? AND bought = 1")
        .all(req.params.token);
      await persist(
        req.params.token,
        "DELETE FROM items WHERE list_token = ? AND bought = 1",
        [req.params.token],
        bought.map((item) => remember(req.params.token, item)),
      );
      await publish(req.params.token, res);
    }),
  );
  app.patch(
    "/api/lists/:token/items/:id",
    mutation(async (req, res) => {
      const current = await db
        .prepare("SELECT * FROM items WHERE id = ? AND list_token = ?")
        .get(req.params.id, req.params.token);
      if (!current)
        return res
          .status(404)
          .json({ error: "This item was removed. Your list will refresh." });
      const changes = itemFields(req.body ?? {}, true);
      const item = { ...current, ...changes };
      const boughtAt =
        "bought" in changes
          ? changes.bought
            ? Date.now()
            : null
          : current.bought_at;
      const history = item.bought
        ? [remember(req.params.token, item, boughtAt)]
        : current.bought
          ? [remember(req.params.token, current)]
          : [];
      if (current.bought && item.bought && itemKey(current) !== itemKey(item)) {
        history.unshift({
          sql: "DELETE FROM usual_items WHERE list_token = ? AND name_key = ? AND store = ?",
          args: [req.params.token, normalizeName(current.name), current.store],
        });
      }
      await persist(
        req.params.token,
        "UPDATE items SET name = ?, store = ?, quantity = ?, note = ?, bought = ?, bought_at = ?, field_versions = ? WHERE id = ? AND list_token = ?",
        [
          item.name,
          item.store,
          item.quantity,
          item.note,
          Number(item.bought),
          boughtAt,
          JSON.stringify(
            stamped(
              JSON.parse(current.field_versions || "{}"),
              Object.keys(changes).filter((field) =>
                field === "bought"
                  ? Boolean(current.bought) !== item.bought
                  : current[field] !== item[field],
              ),
              randomUUID(),
            ),
          ),
          req.params.id,
          req.params.token,
        ],
        history,
      );
      await publish(req.params.token, res);
    }),
  );
  app.delete(
    "/api/lists/:token/items/:id",
    mutation(async (req, res) => {
      const current = await db
        .prepare("SELECT * FROM items WHERE id = ? AND list_token = ?")
        .get(req.params.id, req.params.token);
      if (!current)
        return res
          .status(404)
          .json({ error: "This item was already removed." });
      const result = await persist(
        req.params.token,
        "DELETE FROM items WHERE id = ? AND list_token = ?",
        [req.params.id, req.params.token],
        current.bought ? [remember(req.params.token, current)] : [],
      );
      if (!result.changes)
        return res
          .status(404)
          .json({ error: "This item was already removed." });
      await publish(req.params.token, res);
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "That action was not found." }),
  );

  const dist = resolve(root, "dist");
  app.use(express.static(dist, { index: false, maxAge: 0 }));
  app.get(["/", "/l/:token"], (_req, res) => {
    if (!existsSync(resolve(dist, "index.html")))
      return res
        .status(503)
        .send(
          "Run npm run dev for development, or npm run build before npm start.",
        );
    res.set("Cache-Control", "no-cache").sendFile(resolve(dist, "index.html"));
  });
  app.use((err, _req, res, _next) => {
    if (err instanceof InputError)
      return res.status(400).json({ error: err.message });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "That entry is too long." });
    if (err instanceof SyntaxError)
      return res.status(400).json({ error: "Please send a valid entry." });
    console.error("Request failed:", err.code || err.name);
    res.status(500).json({
      error: "Something went wrong saving your list. Please try again.",
    });
  });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const token = pathname.startsWith("/live/") ? pathname.slice(6) : "";
      const origin = req.headers.origin;
      let originAllowed = !origin;
      try {
        if (origin)
          originAllowed =
            new URL(origin).host === req.headers.host ||
            (process.env.NODE_ENV !== "production" &&
              ["http://localhost:5173", "http://127.0.0.1:5173"].includes(
                origin,
              ));
      } catch {
        originAllowed = false;
      }
      if (
        !originAllowed ||
        !tokenPattern.test(token) ||
        !(await db.prepare("SELECT 1 FROM lists WHERE token = ?").get(token))
      ) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
      sockets.handleUpgrade(req, socket, head, (ws) => {
        ws.listToken = token;
        ws.alive = true;
        ws.on("pong", () => {
          ws.alive = true;
        });
        ws.on("error", () => {});
        snapshot(token)
          .then((initial) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify(initial));
          })
          .catch(() => ws.close(1011, "List unavailable; reconnect to retry."));
      });
    } catch {
      if (!socket.destroyed) {
        socket.write(
          "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
        );
        socket.destroy();
      }
    }
  });
  const heartbeat = setInterval(() => {
    for (const client of sockets.clients) {
      if (!client.alive) {
        client.terminate();
        continue;
      }
      client.alive = false;
      client.ping();
    }
  }, 25_000);
  heartbeat.unref();
  return {
    app,
    server,
    async close() {
      clearInterval(heartbeat);
      for (const client of sockets.clients) client.terminate();
      await new Promise((resolveClose) => sockets.close(resolveClose));
      if (server.listening)
        await new Promise((resolveClose, reject) =>
          server.close((err) => (err ? reject(err) : resolveClose())),
        );
      await db.close();
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let application;
  try {
    application = await createApplication();
  } catch (error) {
    console.error(
      "Storage startup failed. Check database configuration and connectivity.",
      error.code || error.name,
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT || 3000);
  application.server.listen(port, "0.0.0.0", () =>
    console.log(`Family Cart is listening on port ${port}`),
  );
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await application.close();
      process.exit(0);
    });
}
