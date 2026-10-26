import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../server/index.js";

test("an existing family database upgrades without losing its list, and legacy purchases can be reused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "family-cart-upgrade-"));
  const dbPath = join(directory, "existing.sqlite");
  const token = "a".repeat(32);
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE lists (token TEXT PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, list_token TEXT NOT NULL, name TEXT NOT NULL, store TEXT NOT NULL, quantity INTEGER NOT NULL, note TEXT NOT NULL, bought INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, bought_at INTEGER);
  `);
  old
    .prepare("INSERT INTO lists VALUES (?, ?, ?, ?, ?)")
    .run(token, "Our existing family", 12, 1, 2);
  old
    .prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("previous-trip", token, "Spam", "Costco", 3, "Less sodium", 1, 1, 2);
  old.close();
  let application;
  try {
    application = await createApplication({
      dbPath,
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
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
