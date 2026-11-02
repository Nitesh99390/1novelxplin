// SQLite storage (built-in node:sqlite, no native deps).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  first_name    TEXT,
  last_name     TEXT,
  username      TEXT,
  language_code TEXT,
  started_bot   INTEGER NOT NULL DEFAULT 0,
  pending_input TEXT,                 -- JSON: what the bot waits for (custom price/days)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id              INTEGER PRIMARY KEY, -- telegram chat id
  slug            TEXT NOT NULL UNIQUE, -- public id used in links / mini app
  type            TEXT NOT NULL,        -- group | supergroup | channel
  title           TEXT NOT NULL,
  username        TEXT,
  description     TEXT,
  photo_file_id   TEXT,
  member_count    INTEGER,
  owner_id        INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'setup', -- setup | active | no_rights | removed
  can_invite      INTEGER NOT NULL DEFAULT 0,
  can_restrict    INTEGER NOT NULL DEFAULT 0,
  sales_enabled   INTEGER NOT NULL DEFAULT 1,
  listed          INTEGER NOT NULL DEFAULT 1,  -- visible in mini app Explore
  owner_notified  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_owner ON chats(owner_id);

CREATE TABLE IF NOT EXISTS plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  title      TEXT,
  days       INTEGER NOT NULL,
  stars      INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_chat ON plans(chat_id);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,         -- invoice payload
  user_id    INTEGER NOT NULL,
  chat_id    INTEGER NOT NULL,
  plan_id    INTEGER NOT NULL,
  days       INTEGER NOT NULL,
  stars      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | paid | refunded
  charge_id  TEXT UNIQUE,
  membership_id INTEGER,
  created_at INTEGER NOT NULL,
  paid_at    INTEGER
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_chat ON orders(chat_id, status);

CREATE TABLE IF NOT EXISTS memberships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  chat_id         INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  plan_id         INTEGER,
  days            INTEGER NOT NULL,     -- total days bought (renewals add up)
  status          TEXT NOT NULL,        -- paid (waiting to join) | active | expired | removed
  invite_link     TEXT,
  link_expires_at INTEGER,
  paid_at         INTEGER NOT NULL,
  joined_at       INTEGER,              -- countdown starts here
  expires_at      INTEGER,
  reminded        INTEGER NOT NULL DEFAULT 0,
  in_chat         INTEGER NOT NULL DEFAULT 0,
  ended_at        INTEGER,
  end_reason      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mem_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS mem_chat ON memberships(chat_id, status);
CREATE INDEX IF NOT EXISTS mem_status ON memberships(status, expires_at);
CREATE INDEX IF NOT EXISTS mem_link ON memberships(invite_link);
`;

export async function openDb(path) {
  const { DatabaseSync } = await import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return wrap(db);
}

// Small helper layer: cached prepared statements + transactions.
function wrap(db) {
  const cache = new Map();
  const st = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    raw: db,
    get: (sql, ...a) => st(sql).get(...a),
    all: (sql, ...a) => st(sql).all(...a),
    run: (sql, ...a) => st(sql).run(...a),
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close: () => db.close(),
  };
}
