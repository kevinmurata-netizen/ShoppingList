import express from "express";
import helmet from "helmet";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorage } from "./storage.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORES = new Set(["Costco", "Walmart", "Target", "Safeway", "Other"]);
const tokenPattern = /^[A-Za-z0-9_-]{32}$/;

class InputError extends Error {}
function text(value, field, max, optional = false) {
  if (typeof value !== "string") throw new InputError(`${field} must be text.`);
  const cleaned = value.trim();
  if ((!optional && !cleaned) || cleaned.length > max)
    throw new InputError(
      `${field} must be ${optional ? "at most" : "between 1 and"} ${max} characters.`,
    );
  return cleaned;
}
function itemFields(body, partial = false) {
  const result = {};
  if (!partial || "name" in body)
    result.name = text(body.name, "Item name", 100);
  if (!partial || "store" in body) {
    result.store = body.store ?? "Costco";
    if (!STORES.has(result.store))
      throw new InputError("Choose a supported store.");
  }
  if (!partial || "quantity" in body) {
    result.quantity = body.quantity ?? 1;
    if (
      !Number.isInteger(result.quantity) ||
      result.quantity < 1 ||
      result.quantity > 99
    )
      throw new InputError("Quantity must be between 1 and 99.");
  }
  if (!partial || "note" in body)
    result.note = text(body.note ?? "", "Note", 200, true);
  if ("bought" in body) {
    if (typeof body.bought !== "boolean")
      throw new InputError("Bought must be true or false.");
    result.bought = body.bought;
  }
  return result;
}

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
  app.use(express.json({ limit: "8kb" }));

  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  async function snapshot(token) {
    const { list, items } = await db.readList(token);
    if (!list) return null;
    return {
      title: list.title,
      version: list.version,
      createdAt: list.created_at,
      updatedAt: list.updated_at,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        store: item.store,
        quantity: item.quantity,
        note: item.note,
        bought: Boolean(item.bought),
        createdAt: item.created_at,
        boughtAt: item.bought_at,
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
  async function persist(token, sql, args) {
    const results = await db.batchWrite([
      { sql, args },
      {
        sql: "UPDATE lists SET version = version + 1, updated_at = ? WHERE token = ?",
        args: [Date.now(), token],
      },
    ]);
    return results[0];
  }
  async function publish(token, res) {
    const data = await snapshot(token);
    const message = JSON.stringify(data);
    for (const client of sockets.clients) {
      if (client.listToken === token && client.readyState === WebSocket.OPEN)
        client.send(message);
    }
    res.json(data);
  }
  app.get("/api/health", async (_req, res) => {
    await db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
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
      return res
        .status(404)
        .json({
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
        "UPDATE lists SET title = ? WHERE token = ?",
        [title, req.params.token],
      );
      await publish(req.params.token, res);
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
        return res
          .status(409)
          .json({
            error:
              "This list is full. Clear some bought items before adding more.",
          });
      await persist(
        req.params.token,
        "INSERT INTO items (id, list_token, name, store, quantity, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          randomUUID(),
          req.params.token,
          item.name,
          item.store,
          item.quantity,
          item.note,
          Date.now(),
        ],
      );
      res.status(201);
      await publish(req.params.token, res);
    }),
  );
  app.delete(
    "/api/lists/:token/completed",
    mutation(async (req, res) => {
      await persist(
        req.params.token,
        "DELETE FROM items WHERE list_token = ? AND bought = 1",
        [req.params.token],
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
      await persist(
        req.params.token,
        "UPDATE items SET name = ?, store = ?, quantity = ?, note = ?, bought = ?, bought_at = ? WHERE id = ? AND list_token = ?",
        [
          item.name,
          item.store,
          item.quantity,
          item.note,
          Number(item.bought),
          boughtAt,
          req.params.id,
          req.params.token,
        ],
      );
      await publish(req.params.token, res);
    }),
  );
  app.delete(
    "/api/lists/:token/items/:id",
    mutation(async (req, res) => {
      const result = await persist(
        req.params.token,
        "DELETE FROM items WHERE id = ? AND list_token = ?",
        [req.params.id, req.params.token],
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
