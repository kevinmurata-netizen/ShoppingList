import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client/web";

const schema = `
  CREATE TABLE IF NOT EXISTS lists (
    token TEXT PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, title_revision TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, list_token TEXT NOT NULL REFERENCES lists(token) ON DELETE CASCADE,
    name TEXT NOT NULL, store TEXT NOT NULL, quantity INTEGER NOT NULL, note TEXT NOT NULL,
    bought INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, bought_at INTEGER,
    field_versions TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS items_list ON items(list_token);
  CREATE TABLE IF NOT EXISTS usual_items (
    list_token TEXT NOT NULL REFERENCES lists(token) ON DELETE CASCADE,
    name_key TEXT NOT NULL, store TEXT NOT NULL, name TEXT NOT NULL,
    quantity INTEGER NOT NULL, note TEXT NOT NULL, last_bought INTEGER NOT NULL,
    PRIMARY KEY (list_token, name_key, store)
  );
  CREATE INDEX IF NOT EXISTS usuals_recent ON usual_items(list_token, last_bought DESC);
  CREATE TABLE IF NOT EXISTS favorite_items (
    list_token TEXT NOT NULL REFERENCES lists(token) ON DELETE CASCADE,
    name_key TEXT NOT NULL, store TEXT NOT NULL, name TEXT NOT NULL,
    quantity INTEGER NOT NULL, note TEXT NOT NULL, pinned INTEGER NOT NULL,
    pinned_at INTEGER NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY (list_token, name_key, store)
  );
  CREATE TABLE IF NOT EXISTS sync_receipts (
    list_token TEXT NOT NULL REFERENCES lists(token) ON DELETE CASCADE,
    operation_id TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (list_token, operation_id)
  );
`;
const migrations = [
  ["lists", "title_revision", "TEXT NOT NULL DEFAULT ''"],
  ["items", "field_versions", "TEXT NOT NULL DEFAULT '{}'"],
];
const listQuery = "SELECT * FROM lists WHERE token = ?";
const itemsQuery =
  "SELECT * FROM items WHERE list_token = ? ORDER BY created_at, id";
const usualsQuery =
  "SELECT * FROM usual_items WHERE list_token = ? ORDER BY last_bought DESC, name_key, store LIMIT 200";
const favoritesQuery =
  "SELECT * FROM favorite_items WHERE list_token = ? ORDER BY pinned_at DESC, name_key, store";

// Exported so the same application tests can exercise a real libSQL client.
export async function createLibsqlStorage(client) {
  try {
    await client.executeMultiple(schema);
    for (const [table, column, definition] of migrations) {
      const info = await client.execute(`PRAGMA table_info(${table})`);
      if (!info.rows.some((row) => row.name === column))
        await client.execute(
          `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
        );
    }
  } catch (error) {
    client.close();
    throw error;
  }
  return {
    prepare(sql) {
      return {
        async get(...args) {
          return (await client.execute({ sql, args })).rows[0];
        },
        async all(...args) {
          return (await client.execute({ sql, args })).rows;
        },
        async run(...args) {
          const result = await client.execute({ sql, args });
          return { changes: result.rowsAffected };
        },
      };
    },
    async readList(token) {
      const [list, items, usuals, favorites] = await client.batch(
        [
          { sql: listQuery, args: [token] },
          { sql: itemsQuery, args: [token] },
          { sql: usualsQuery, args: [token] },
          { sql: favoritesQuery, args: [token] },
        ],
        "read",
      );
      return {
        list: list.rows[0],
        items: items.rows,
        usuals: usuals.rows,
        favorites: favorites.rows,
      };
    },
    async batchWrite(statements) {
      return (await client.batch(statements, "write")).map((result) => ({
        changes: result.rowsAffected,
      }));
    },
    close() {
      client.close();
    },
  };
}

export async function openStorage({
  dbPath,
  databaseUrl,
  authToken,
  requireRemote = false,
}) {
  if (databaseUrl || authToken) {
    if (!databaseUrl || !authToken?.trim())
      throw new Error("Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
    let url;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error(
        "TURSO_DATABASE_URL must be the database URL from Turso.",
      );
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      !["libsql:", "https:"].includes(url.protocol) &&
      !(local && url.protocol === "http:")
    ) {
      throw new Error(
        "The remote database requires libsql:// or https:// with TLS verification.",
      );
    }
    if (url.username || url.password || url.search || url.hash)
      throw new Error(
        "Use a plain database URL; put its token only in TURSO_AUTH_TOKEN.",
      );
    const client = createClient({
      url: databaseUrl,
      authToken,
      intMode: "number",
    });
    return createLibsqlStorage(client);
  }
  if (requireRemote)
    throw new Error(
      "This deployment requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Local storage is disabled to protect lists from temporary disks.",
    );
  if (dbPath !== ":memory:")
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    db.exec(schema);
    for (const [table, column, definition] of migrations) {
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((row) => row.name === column)
      )
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    prepare: (sql) => db.prepare(sql),
    readList(token) {
      return {
        list: db.prepare(listQuery).get(token),
        items: db.prepare(itemsQuery).all(token),
        usuals: db.prepare(usualsQuery).all(token),
        favorites: db.prepare(favoritesQuery).all(token),
      };
    },
    batchWrite(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, args }) =>
          db.prepare(sql).run(...args),
        );
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
