import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { createApplication } from "../server/index.js";
import { createLibsqlStorage } from "../server/storage.js";
import { makeOperation, projectList } from "../shared/operations.js";

const httpTestUrl = process.env.TEST_LIBSQL_HTTP_URL;
if (
  httpTestUrl &&
  (new URL(httpTestUrl).protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(new URL(httpTestUrl).hostname))
)
  throw new Error("Use a dedicated local database for network tests.");
for (const backend of ["sqlite", "libsql", ...(httpTestUrl ? ["http"] : [])])
  describe(`sync ${backend}`, () => {
    async function fixture(t, path = ":memory:") {
      const storage =
        backend === "libsql"
          ? await createLibsqlStorage(
              createClient({
                url:
                  path === ":memory:"
                    ? "file::memory:"
                    : pathToFileURL(path).href,
              }),
            )
          : undefined;
      const app = await createApplication({
        storage,
        dbPath: path,
        databaseUrl: backend === "http" ? httpTestUrl : "",
        authToken: backend === "http" ? "local-test-only" : "",
        requireRemote: backend === "http",
      });
      await new Promise((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      t?.after(() => app.close());
      const base = `http://127.0.0.1:${app.server.address().port}`;
      const api = async (path, method = "GET", body) => {
        const response = await fetch(base + path, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, data: await response.json() };
      };
      const list = (await api("/api/lists", "POST", {})).data;
      const url = `/api/lists/${list.token}`;
      return {
        app,
        api,
        list,
        url,
        send: (operation) => api(url + "/sync", "POST", { operation }),
      };
    }

    test("pins are family-shared, isolated by list, and idempotent across retries", async (t) => {
      const { api, list, url, send } = await fixture(t);
      const pin = makeOperation(
        "favorite",
        {
          item: { name: "Milk", store: "Costco", quantity: 2, note: "Whole" },
          pinned: true,
        },
        list,
      );
      let saved = await send(pin);
      assert.equal(saved.status, 200);
      assert.equal(saved.data.favoriteStates[0].pinned, true);
      assert.equal(saved.data.favoriteStates[0].quantity, 2);
      const version = saved.data.version;
      saved = await send(pin);
      assert.equal(
        saved.data.version,
        version,
        "a lost response can be retried without applying twice",
      );
      const another = (await api("/api/lists", "POST", {})).data;
      assert.equal(
        (await api(`/api/lists/${another.token}`)).data.favoriteStates.length,
        0,
      );
      saved = await send(
        makeOperation(
          "favorite",
          { item: pin.item, pinned: false },
          saved.data,
        ),
      );
      assert.equal(saved.data.favoriteStates[0].pinned, false);
      assert.equal(
        (await api(url)).data.items.length,
        0,
        "pinning doesn't add an item to buy",
      );
    });

    test("offline purchase status merges with unrelated family edits and retries do not overwrite later updates", async (t) => {
      const { api, list, url, send } = await fixture(t);
      const added = await send(
        makeOperation("pick", { items: [{ name: "Coffee" }] }, list),
      );
      const item = added.data.items[0];
      const bought = makeOperation(
        "patch",
        { itemId: item.id, changes: { bought: true } },
        added.data,
      );
      await api(`${url}/items/${item.id}`, "PATCH", { note: "Decaf" });
      let saved = await send(bought);
      assert.equal(saved.status, 200);
      assert.equal(saved.data.items[0].bought, true);
      assert.equal(saved.data.items[0].note, "Decaf");
      await api(`${url}/items/${item.id}`, "PATCH", { bought: false });
      saved = await send(bought);
      assert.equal(
        saved.data.items[0].bought,
        false,
        "an already-acknowledged offline operation must not run again",
      );
    });

    test("same-field conflicts require consent and detect changes even when a value was changed back", async (t) => {
      const { api, list, url, send } = await fixture(t);
      const added = (
        await send(makeOperation("pick", { items: [{ name: "Milk" }] }, list))
      ).data;
      const item = added.items[0];
      const note = makeOperation(
        "patch",
        { itemId: item.id, changes: { note: "Brand A" } },
        added,
      );
      await api(`${url}/items/${item.id}`, "PATCH", { note: "Brand B" });
      let result = await send(note);
      assert.equal(result.status, 409);
      assert.equal(result.data.snapshot.items[0].note, "Brand B");
      assert.equal(result.data.conflict.fields[0].field, "note");
      note.before.note = result.data.snapshot.items[0].fieldVersions.note;
      result = await send(note);
      assert.equal(result.status, 200);
      assert.equal(result.data.items[0].note, "Brand A");
      const bought = makeOperation(
        "patch",
        { itemId: item.id, changes: { bought: true } },
        result.data,
      );
      await api(`${url}/items/${item.id}`, "PATCH", { bought: true });
      await api(`${url}/items/${item.id}`, "PATCH", { bought: false });
      assert.equal(
        (await send(bought)).status,
        409,
        "a newer explicit family uncheck must be reviewed",
      );
    });

    test("offline changes never recreate an item removed by another family member", async (t) => {
      const { api, list, url, send } = await fixture(t);
      const added = (
        await send(makeOperation("pick", { items: [{ name: "Apples" }] }, list))
      ).data;
      const operation = makeOperation(
        "patch",
        { itemId: added.items[0].id, changes: { bought: true } },
        added,
      );
      await api(`${url}/items/${added.items[0].id}`, "DELETE");
      const result = await send(operation);
      assert.equal(result.status, 409);
      assert.equal(result.data.conflict.canRetry, false);
      assert.equal(result.data.snapshot.items.length, 0);
    });

    test("simultaneous additions return stable aliases for later offline edits", async (t) => {
      const { api, list, url, send } = await fixture(t);
      const operation = makeOperation(
        "pick",
        { items: [{ name: "Milk" }] },
        list,
      );
      const projected = projectList(list, [operation]);
      const edit = makeOperation(
        "patch",
        { itemId: projected.items[0].id, changes: { bought: true } },
        projected,
      );
      const family = await api(`${url}/items`, "POST", {
        name: "Milk",
        quantity: 2,
        note: "Organic",
      });
      const result = await send(operation);
      assert.equal(result.data.items.length, 1);
      const alias = result.data.syncResult.aliases[0];
      assert.equal(alias.localId, edit.itemId);
      assert.equal(alias.itemId, family.data.items[0].id);
      edit.itemId = alias.itemId;
      edit.before.bought = alias.fieldVersions.bought;
      const saved = await send(edit);
      assert.equal(saved.data.items[0].bought, true);
      assert.equal(saved.data.items[0].quantity, 2);
      assert.equal(saved.data.items[0].note, "Organic");
    });

    test("clearing purchases offline targets only the bought items that phone saw", async (t) => {
      const { api, list, url, send } = await fixture(t);
      let current = (
        await send(
          makeOperation(
            "pick",
            { items: [{ name: "Apples" }, { name: "Milk" }] },
            list,
          ),
        )
      ).data;
      const [apples, milk] = current.items;
      current = (
        await api(`${url}/items/${apples.id}`, "PATCH", { bought: true })
      ).data;
      const clear = makeOperation("clear", {}, current);
      await api(`${url}/items/${milk.id}`, "PATCH", { bought: true });
      const result = await send(clear);
      assert.equal(result.status, 200);
      assert.equal(result.data.items.length, 1);
      assert.equal(result.data.items[0].id, milk.id);
      assert.equal(result.data.items[0].bought, true);
    });

    test("sync receipts and favorites survive a restart", async () => {
      const directory = await mkdtemp(join(tmpdir(), "family-cart-sync-"));
      const path = join(directory, "shopping.sqlite");
      let current;
      try {
        current = await fixture(null, path);
        const operation = makeOperation(
          "favorite",
          { item: { name: "Rice" }, pinned: true },
          current.list,
        );
        const saved = (await current.send(operation)).data;
        const token = current.list.token;
        await current.app.close();
        current = null;
        const storage =
          backend === "libsql"
            ? await createLibsqlStorage(
                createClient({ url: pathToFileURL(path).href }),
              )
            : undefined;
        const app = await createApplication({
          storage,
          dbPath: path,
          databaseUrl: backend === "http" ? httpTestUrl : "",
          authToken: backend === "http" ? "local-test-only" : "",
          requireRemote: backend === "http",
        });
        current = { app };
        await new Promise((resolve) =>
          app.server.listen(0, "127.0.0.1", resolve),
        );
        const response = await fetch(
          `http://127.0.0.1:${app.server.address().port}/api/lists/${token}/sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operation }),
          },
        );
        const replay = await response.json();
        assert.equal(replay.version, saved.version);
        assert.equal(replay.favoriteStates[0].pinned, true);
      } finally {
        if (current) await current.app.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
