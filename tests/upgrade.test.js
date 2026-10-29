import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";
import { createLibsqlStorage } from "../server/storage.js";
import { join } from "node:path";
import { makeOperation } from "../shared/operations.js";
import { createApplication } from "../server/index.js";

for (const backend of ["sqlite", "libsql"])
  test(`existing ${backend} family databases keep links, purchases, favorites and pending changes after an upgrade`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "family-cart-upgrade-"));
    const dbPath = join(directory, "existing.sqlite");
    const token = "a".repeat(32);
    const old = new DatabaseSync(dbPath);
    old.exec(`
    CREATE TABLE lists (token TEXT PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE favorite_items (list_token TEXT NOT NULL, name_key TEXT NOT NULL, store TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL, note TEXT NOT NULL, pinned INTEGER NOT NULL, pinned_at INTEGER NOT NULL, revision TEXT NOT NULL, PRIMARY KEY (list_token, name_key, store));
    CREATE TABLE items (id TEXT PRIMARY KEY, list_token TEXT NOT NULL, name TEXT NOT NULL, store TEXT NOT NULL, quantity INTEGER NOT NULL, note TEXT NOT NULL, bought INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, bought_at INTEGER);
  `);
    old
      .prepare("INSERT INTO lists VALUES (?, ?, ?, ?, ?)")
      .run(token, "Our existing family", 12, 1, 2);
    old
      .prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("previous-trip", token, "Spam", "Costco", 3, "Less sodium", 1, 1, 2);
    old
      .prepare("INSERT INTO favorite_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(token, "rice", "Costco", "Rice", 2, "Jasmine", 1, 1, "old-pin");
    old.close();
    const storage = () =>
      backend === "libsql"
        ? createLibsqlStorage(createClient({ url: pathToFileURL(dbPath).href }))
        : undefined;
    let application;
    try {
      application = await createApplication({
        dbPath,
        storage: await storage(),
        databaseUrl: "",
        authToken: "",
        requireRemote: false,
      });
      await new Promise((resolve) =>
        application.server.listen(0, "127.0.0.1", resolve),
      );
      const url = `http://127.0.0.1:${application.server.address().port}/api/lists/${token}`;
      let data = await (await fetch(url)).json();
      assert.equal(data.title, "Our existing family");
      assert.equal(data.version, 12);
      assert.equal(data.items[0].note, "Less sodium");
      assert.equal(data.items[0].category, "");
      assert.deepEqual(data.categoryOrders, {});
      assert.equal(data.favoriteStates[0].name, "Rice");
      assert.equal(data.favoriteStates[0].note, "Jasmine");
      assert.equal(data.favoriteStates[0].category, "");
      data = await (
        await fetch(`${url}/pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ name: "spam", store: "Costco" }] }),
        })
      ).json();
      assert.equal(data.pickResult.restored, 1);
      assert.equal(data.items[0].quantity, 3);
      assert.equal(data.items[0].note, "Less sodium");
      assert.equal(data.items[0].bought, false);
      await application.close();
      application = null;
      application = await createApplication({
        dbPath,
        storage: await storage(),
        databaseUrl: "",
        authToken: "",
        requireRemote: false,
      });
      await new Promise((resolve) =>
        application.server.listen(0, "127.0.0.1", resolve),
      );
      data = await (
        await fetch(
          `http://127.0.0.1:${application.server.address().port}/api/lists/${token}`,
        )
      ).json();
      assert.equal(data.usuals[0].name, "Spam");
      assert.equal(data.usuals[0].quantity, 3);
      assert.equal(data.usuals[0].category, "");
      const pendingDelete = makeOperation(
        "delete",
        { itemId: data.items[0].id },
        data,
      );
      delete pendingDelete.before.category; // Saved by the version before categories existed.
      const response = await fetch(
        `http://127.0.0.1:${application.server.address().port}/api/lists/${token}/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: pendingDelete }),
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).items.length, 0);
    } finally {
      if (application) await application.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
