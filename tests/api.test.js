import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createApplication } from "../server/index.js";
import { createLibsqlStorage } from "../server/storage.js";
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";

const httpTestUrl = process.env.TEST_LIBSQL_HTTP_URL;
if (httpTestUrl) {
  const url = new URL(httpTestUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  ) {
    throw new Error(
      "Network integration tests require a dedicated local libSQL server, not a family database.",
    );
  }
}
for (const backend of ["sqlite", "libsql", ...(httpTestUrl ? ["http"] : [])]) {
  describe(backend, () => {
    async function fixture(t, dbPath = ":memory:") {
      const storage =
        backend === "libsql"
          ? await createLibsqlStorage(
              createClient({
                url:
                  dbPath === ":memory:"
                    ? "file::memory:"
                    : pathToFileURL(dbPath).href,
                intMode: "number",
              }),
            )
          : undefined;
      const application = await createApplication({
        dbPath,
        storage,
        databaseUrl: backend === "http" ? httpTestUrl : "",
        authToken: backend === "http" ? "local-test-only" : "",
        requireRemote: backend === "http",
      });
      await new Promise((resolve) =>
        application.server.listen(0, "127.0.0.1", resolve),
      );
      t?.after(() => application.close());
      const base = `http://127.0.0.1:${application.server.address().port}`;
      async function api(path, method = "GET", body, headers = {}) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, data: await response.json() };
      }
      const create = async (title = "Our family list") =>
        (await api("/api/lists", "POST", { title })).data;
      return { application, base, api, create };
    }

    test("create, add store-specific items, edit, buy, restore, clear, and rename a family list", async (t) => {
      const { api, create } = await fixture(t);
      const list = await create();
      assert.match(list.token, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(list.items.length, 0);
      const path = `/api/lists/${list.token}`;
      let result = await api(`${path}/items`, "POST", {
        name: "  Paper towels  ",
        store: "Costco",
        quantity: 2,
        note: "The big pack",
      });
      assert.equal(result.status, 201);
      let item = result.data.items[0];
      assert.equal(item.name, "Paper towels");
      assert.equal(item.quantity, 2);
      assert.equal(item.note, "The big pack");
      assert.equal(item.store, "Costco");
      result = await api(`${path}/items/${item.id}`, "PATCH", {
        name: "Kitchen towels",
        store: "Target",
        bought: true,
      });
      assert.equal(result.data.items[0].bought, true);
      assert.ok(result.data.items[0].boughtAt);
      assert.equal(
        result.data.items[0].quantity,
        2,
        "partial edits retain fields",
      );
      await api(`${path}/items/${item.id}`, "PATCH", { bought: false });
      result = await api(`${path}/completed`, "DELETE");
      assert.equal(
        result.data.items.length,
        1,
        "clearing bought preserves needed items",
      );
      await api(`${path}/items/${item.id}`, "PATCH", { bought: true });
      result = await api(`${path}/completed`, "DELETE");
      assert.equal(result.data.items.length, 0);
      result = await api(path, "PATCH", { title: "The Murata shopping list" });
      assert.equal(result.data.title, "The Murata shopping list");
      assert.ok(result.data.version > list.version);
    });

    test("validates input, isolates private links, and blocks cross-site writes", async (t) => {
      const { api, create } = await fixture(t);
      const one = await create("One");
      const two = await create("Two");
      const path = `/api/lists/${one.token}`;
      for (const body of [
        { name: "" },
        { name: "Milk", store: "Unknown" },
        { name: "Milk", quantity: 0 },
        { name: "Milk", quantity: 1.5 },
        { name: "x".repeat(101) },
        { name: "Milk", note: "x".repeat(201) },
      ]) {
        assert.equal((await api(`${path}/items`, "POST", body)).status, 400);
      }
      assert.equal((await api("/api/lists/not-a-list")).status, 404);
      const added = await api(`${path}/items`, "POST", { name: "Milk" });
      const id = added.data.items[0].id;
      assert.equal(
        (
          await api(`/api/lists/${two.token}/items/${id}`, "PATCH", {
            bought: true,
          })
        ).status,
        404,
      );
      assert.equal(
        (await api(`/api/lists/${two.token}/items/${id}`, "DELETE")).status,
        404,
      );
      assert.equal(
        (await api(`${path}/items/${id}`, "PATCH", { bought: "yes" })).status,
        400,
      );
      assert.equal(
        (
          await api(
            `${path}/items`,
            "POST",
            { name: "Eggs" },
            { Origin: "https://unrelated.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await api(
            `${path}/items`,
            "POST",
            { name: "Eggs" },
            { "Sec-Fetch-Site": "cross-site" },
          )
        ).status,
        403,
      );
      assert.equal((await api(path)).data.items[0].bought, false);
      assert.equal((await api(`/api/lists/${two.token}`)).data.items.length, 0);
      assert.equal((await api(`${path}/items/${id}`, "DELETE")).status, 200);
      assert.equal((await api(path)).data.items.length, 0);
    });

    test("two connected family members receive live changes, and reconnect gets the latest list", async (t) => {
      const { base, api, create } = await fixture(t);
      const { token } = await create();
      const url = `${base.replace("http:", "ws:")}/live/${token}`;
      const alice = new WebSocket(url);
      const bob = new WebSocket(url);
      t.after(() => {
        alice.terminate();
        bob.terminate();
      });
      const [initialAlice, initialBob] = await Promise.all([
        once(alice, "message"),
        once(bob, "message"),
      ]);
      assert.equal(JSON.parse(initialAlice[0]).items.length, 0);
      assert.equal(JSON.parse(initialBob[0]).items.length, 0);
      const aliceUpdate = once(alice, "message");
      const bobUpdate = once(bob, "message");
      await api(`/api/lists/${token}/items`, "POST", {
        name: "Coffee",
        store: "Safeway",
      });
      const [a, b] = await Promise.all([aliceUpdate, bobUpdate]);
      assert.equal(JSON.parse(a[0]).items[0].name, "Coffee");
      assert.deepEqual(JSON.parse(a[0]), JSON.parse(b[0]));
      bob.close();
      await once(bob, "close");
      const item = JSON.parse(a[0]).items[0];
      await api(`/api/lists/${token}/items/${item.id}`, "PATCH", {
        bought: true,
      });
      const reconnected = new WebSocket(url);
      t.after(() => reconnected.terminate());
      const [latest] = await once(reconnected, "message");
      assert.equal(JSON.parse(latest).items[0].bought, true);
    });

    test("simultaneous family updates are preserved and persisted after a server restart", async () => {
      const directory = await mkdtemp(join(tmpdir(), "family-cart-test-"));
      const dbPath = join(directory, "shopping.sqlite");
      let current;
      try {
        current = await fixture(null, dbPath);
        const { token } = await current.create("Our weekend run");
        await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            current.api(`/api/lists/${token}/items`, "POST", {
              name: `Item ${i}`,
              store: i % 2 ? "Walmart" : "Costco",
            }),
          ),
        );
        let result = await current.api(`/api/lists/${token}`);
        assert.equal(result.data.items.length, 8);
        const id = result.data.items[0].id;
        await Promise.all([
          current.api(`/api/lists/${token}/items/${id}`, "PATCH", {
            bought: true,
          }),
          current.api(`/api/lists/${token}/items/${id}`, "PATCH", {
            note: "Remember this one",
          }),
        ]);
        await current.application.close();
        current = null;
        current = await fixture(null, dbPath);
        result = await current.api(`/api/lists/${token}`);
        assert.equal(result.data.title, "Our weekend run");
        assert.equal(result.data.items.length, 8);
        const persisted = result.data.items.find((item) => item.id === id);
        assert.equal(persisted.bought, true);
        assert.equal(persisted.note, "Remember this one");
      } finally {
        if (current) await current.application.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
}
