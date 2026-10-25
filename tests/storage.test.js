import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { createLibsqlStorage, openStorage } from "../server/storage.js";

test("free-host deployments fail closed when remote database configuration is missing or insecure", async () => {
  const cases = [
    { requireRemote: true },
    { databaseUrl: "libsql://example.turso.io" },
    { authToken: "test-only" },
    { databaseUrl: "http://example.turso.io", authToken: "test-only" },
    { databaseUrl: "libsql://example.turso.io?tls=0", authToken: "test-only" },
    {
      databaseUrl: "libsql://user:password@example.turso.io",
      authToken: "test-only",
    },
  ];
  for (const options of cases)
    await assert.rejects(openStorage({ dbPath: ":memory:", ...options }));
});

for (const backend of ["sqlite", "libsql"]) {
  test(`${backend} rolls back an entire write batch when a statement fails`, async () => {
    const db =
      backend === "sqlite"
        ? await openStorage({ dbPath: ":memory:" })
        : await createLibsqlStorage(createClient({ url: "file::memory:" }));
    try {
      await assert.rejects(async () =>
        db.batchWrite([
          {
            sql: "INSERT INTO lists (token, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            args: ["rollback-test", "Should roll back", 1, 1],
          },
          { sql: "INSERT INTO nonexistent_table VALUES (?)", args: ["fail"] },
        ]),
      );
      assert.equal(
        await db
          .prepare("SELECT * FROM lists WHERE token = ?")
          .get("rollback-test"),
        undefined,
      );
    } finally {
      await db.close();
    }
  });
}
