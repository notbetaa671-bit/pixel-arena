import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SHOP_ITEMS } from "./game.js";

export function createDatabase(databasePath) {
  const resolvedPath = path.resolve(databasePath || "data/pixel-arena.sqlite");
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      coins INTEGER NOT NULL DEFAULT 0,
      total_kills INTEGER NOT NULL DEFAULT 0,
      total_deaths INTEGER NOT NULL DEFAULT 0,
      skin_id TEXT NOT NULL DEFAULT 'rookie',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      purchased_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, item_id)
    );
  `);
  return db;
}

function profileId(username) {
  return crypto.createHash("sha256").update(username.trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function getOrCreateProfile(db, username) {
  const now = Date.now();
  const id = profileId(username);
  db.prepare(`
    INSERT INTO players (id, username, created_at, updated_at)
    VALUES (@id, @username, @now, @now)
    ON CONFLICT(username) DO UPDATE SET updated_at = @now
  `).run({ id, username: username.trim(), now });
  return getProfile(db, id);
}

export function getProfile(db, id) {
  const profile = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
  if (!profile) return null;
  const purchased = db.prepare("SELECT item_id FROM purchases WHERE player_id = ?").all(id).map((row) => row.item_id);
  const unlocked = [...new Set(["rookie", ...purchased])];
  return {
    id: profile.id,
    username: profile.username,
    coins: profile.coins,
    totalKills: profile.total_kills,
    totalDeaths: profile.total_deaths,
    skinId: profile.skin_id,
    unlocked
  };
}

export function addCoins(db, id, amount) {
  db.prepare("UPDATE players SET coins = MAX(0, coins + ?), updated_at = ? WHERE id = ?").run(amount, Date.now(), id);
  return getProfile(db, id);
}

export function recordMatchStats(db, id, { kills = 0, deaths = 0 } = {}) {
  db.prepare("UPDATE players SET total_kills = total_kills + ?, total_deaths = total_deaths + ?, updated_at = ? WHERE id = ?").run(kills, deaths, Date.now(), id);
  return getProfile(db, id);
}

export function purchaseItem(db, id, itemId) {
  const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: false, error: "Desbloqueable no encontrado." };
  const profile = getProfile(db, id);
  if (!profile) return { ok: false, error: "Perfil no encontrado." };
  if (profile.unlocked.includes(item.id)) return { ok: false, error: "Ya tienes este desbloqueable." };
  if (profile.coins < item.price) return { ok: false, error: "No tienes suficientes monedas." };
  const transaction = db.transaction(() => {
    db.prepare("UPDATE players SET coins = coins - ?, skin_id = ?, updated_at = ? WHERE id = ?").run(item.price, item.id, Date.now(), id);
    db.prepare("INSERT INTO purchases (player_id, item_id, purchased_at) VALUES (?, ?, ?)").run(id, item.id, Date.now());
  });
  transaction();
  return { ok: true, profile: getProfile(db, id) };
}

export function setSkin(db, id, skinId) {
  const profile = getProfile(db, id);
  if (!profile?.unlocked.includes(skinId)) return { ok: false, error: "Skin no desbloqueada." };
  db.prepare("UPDATE players SET skin_id = ?, updated_at = ? WHERE id = ?").run(skinId, Date.now(), id);
  return { ok: true, profile: getProfile(db, id) };
}

