import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import {
  angleDifference,
  clamp,
  COIN_VALUE,
  DEFAULT_MAX_PLAYERS,
  distance,
  KILL_REWARD,
  normalizeAngle,
  normalizeVector,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  publicLeaderboard,
  publicPlayer,
  randomSpawn,
  RESPAWN_MS,
  ROOM_IDS,
  SHOP_ITEMS,
  SHOT_COOLDOWN_MS,
  SHOT_DAMAGE,
  SHOT_RANGE,
  WORLD
} from "./game.js";
import { addCoins, createDatabase, getOrCreateProfile, getProfile, purchaseItem, recordMatchStats, setSkin } from "./db.js";

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = clamp(Number(process.env.ROOM_MAX_PLAYERS || DEFAULT_MAX_PLAYERS), 1, DEFAULT_MAX_PLAYERS);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const db = createDatabase(process.env.DATABASE_PATH || "data/pixel-arena.sqlite");

const app = express();
const httpServer = http.createServer(app);
const allowedOrigins = CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin no permitido por CLIENT_ORIGIN"));
    },
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin no permitido por CLIENT_ORIGIN"));
  }
}));
app.use(express.json({ limit: "32kb" }));

const rooms = new Map();

function safeText(value, maxLength) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, maxLength);
}

function roomSnapshot(room) {
  return {
    roomId: room.id,
    players: [...room.players.values()].map(publicPlayer),
    coins: [...room.coins.values()],
    bounds: WORLD
  };
}

function shopSnapshot(profile) {
  return SHOP_ITEMS.map((item) => ({ ...item, unlocked: profile?.unlocked.includes(item.id) || false }));
}

class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.coins = new Map();
    this.nextCoinId = 1;
    for (let index = 0; index < 24; index += 1) this.spawnCoin();
  }

  spawnCoin() {
    const spawn = randomSpawn();
    const coin = { id: `${this.id}-${this.nextCoinId++}`, x: spawn.x, y: spawn.y, value: COIN_VALUE };
    this.coins.set(coin.id, coin);
    return coin;
  }
}

for (const roomId of ROOM_IDS) rooms.set(roomId, new Room(roomId));

function getRoom(roomId) {
  return rooms.get(ROOM_IDS.includes(roomId) ? roomId : ROOM_IDS[0]);
}

function roomCounts() {
  return [...rooms.values()].map((room) => ({ id: room.id, players: room.players.size, maxPlayers: MAX_PLAYERS }));
}

function emitRoomState(room) {
  io.to(room.id).emit("game:state", { ...roomSnapshot(room), leaderboard: publicLeaderboard(room.players.values()) });
  io.to(room.id).emit("leaderboard", publicLeaderboard(room.players.values()));
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  const player = room?.players.get(socket.id);
  if (room && player) {
    room.players.delete(socket.id);
    socket.leave(roomId);
    io.to(roomId).emit("chat:message", { username: "SERVER", text: `${player.username} abandonó la sala.` });
    emitRoomState(room);
  }
  socket.data.roomId = null;
  socket.data.player = null;
}

app.get("/health", (_request, response) => response.json({ ok: true, service: "pixel-arena-server", version: "0.1.0" }));
app.get("/api/rooms", (_request, response) => response.json({ rooms: roomCounts() }));
app.get("/api/shop", (_request, response) => response.json({ items: SHOP_ITEMS }));

io.on("connection", (socket) => {
  socket.on("join:game", (payload, acknowledge = () => {}) => {
    const username = safeText(payload?.username, 16);
    const room = getRoom(safeText(payload?.roomId, 20).toLowerCase());
    if (username.length < 2) return acknowledge({ ok: false, error: "El nombre debe tener al menos 2 caracteres." });
    if (room.players.size >= MAX_PLAYERS) return acknowledge({ ok: false, error: "Esta sala está llena. Prueba la otra." });
    if ([...room.players.values()].some((player) => player.username.toLowerCase() === username.toLowerCase())) {
      return acknowledge({ ok: false, error: "Ese nombre ya está en uso en esta sala." });
    }
    leaveRoom(socket);
    const profile = getOrCreateProfile(db, username);
    const selectedSkin = SHOP_ITEMS.find((item) => item.id === profile.skinId && profile.unlocked.includes(item.id)) || SHOP_ITEMS[0];
    const spawn = randomSpawn();
    const player = {
      socketId: socket.id,
      profileId: profile.id,
      username: profile.username,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      coins: profile.coins,
      kills: 0,
      deaths: 0,
      skinId: selectedSkin.id,
      color: selectedSkin.color,
      respawnAt: 0,
      input: { x: 0, y: 0 },
      lastShotAt: 0,
      lastChatAt: 0
    };
    room.players.set(socket.id, player);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.player = player;
    acknowledge({ ok: true, roomId: room.id });
    socket.emit("room:state", { ...roomSnapshot(room), selfId: socket.id, profile, shop: shopSnapshot(profile) });
    socket.emit("chat:message", { username: "SERVER", text: `Canal ${room.id.toUpperCase()} conectado. Buena suerte.` });
    socket.to(room.id).emit("chat:message", { username: "SERVER", text: `${player.username} entró a la sala.` });
    emitRoomState(room);
  });

  socket.on("input", (payload = {}) => {
    const player = socket.data.player;
    if (!player || player.respawnAt) return;
    const vector = normalizeVector(payload.dx, payload.dy);
    player.input = vector;
    player.angle = normalizeAngle(payload.angle);
  });

  socket.on("combat:shoot", (payload = {}) => {
    const player = socket.data.player;
    const room = rooms.get(socket.data.roomId);
    if (!player || !room || player.respawnAt) return;
    const now = Date.now();
    if (now - player.lastShotAt < SHOT_COOLDOWN_MS) return;
    player.lastShotAt = now;
    player.angle = normalizeAngle(payload.angle);
    const targetPoint = { x: player.x + Math.cos(player.angle) * SHOT_RANGE, y: player.y + Math.sin(player.angle) * SHOT_RANGE };
    let target = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of room.players.values()) {
      if (candidate.socketId === player.socketId || candidate.respawnAt) continue;
      const range = distance(player, candidate);
      if (range > SHOT_RANGE || angleDifference(player.angle, Math.atan2(candidate.y - player.y, candidate.x - player.x)) > 0.16) continue;
      if (range < nearest) {
        nearest = range;
        target = candidate;
      }
    }
    const hitPoint = target ? { x: target.x, y: target.y } : targetPoint;
    io.to(room.id).emit("combat:shot", { shooterId: player.socketId, from: { x: player.x, y: player.y }, to: hitPoint, hit: Boolean(target) });
    if (!target) return;
    target.hp = Math.max(0, target.hp - SHOT_DAMAGE);
    io.to(room.id).emit("combat:hit", { shooterId: player.socketId, targetId: target.socketId, damage: SHOT_DAMAGE, hp: target.hp });
    if (target.hp > 0) return;
    player.kills += 1;
    player.coins += KILL_REWARD;
    target.deaths += 1;
    target.respawnAt = now + RESPAWN_MS;
    recordMatchStats(db, player.profileId, { kills: 1 });
    recordMatchStats(db, target.profileId, { deaths: 1 });
    addCoins(db, player.profileId, KILL_REWARD);
    io.to(room.id).emit("combat:kill", { killerId: player.socketId, targetId: target.socketId, respawnAt: target.respawnAt });
    io.to(room.id).emit("chat:message", { username: "SERVER", text: `${player.username} eliminó a ${target.username}.` });
    emitRoomState(room);
  });

  socket.on("coin:collect", (payload = {}, acknowledge = () => {}) => {
    const player = socket.data.player;
    const room = rooms.get(socket.data.roomId);
    const coin = room?.coins.get(safeText(payload.coinId, 60));
    if (!player || !room || !coin || player.respawnAt || distance(player, coin) > 55) return acknowledge({ ok: false, error: "Moneda fuera de alcance." });
    room.coins.delete(coin.id);
    player.coins += coin.value;
    addCoins(db, player.profileId, coin.value);
    acknowledge({ ok: true, coins: player.coins });
    io.to(room.id).emit("coin:collected", { playerId: player.socketId, coinId: coin.id, value: coin.value });
    setTimeout(() => {
      if (rooms.has(room.id) && room.coins.size < 24) {
        room.spawnCoin();
        emitRoomState(room);
      }
    }, 7000);
  });

  socket.on("shop:buy", (payload = {}, acknowledge = () => {}) => {
    const player = socket.data.player;
    if (!player) return acknowledge({ ok: false, error: "Debes entrar a una sala primero." });
    const result = purchaseItem(db, player.profileId, safeText(payload.itemId, 40));
    if (!result.ok) return acknowledge(result);
    const item = SHOP_ITEMS.find((candidate) => candidate.id === result.profile.skinId) || SHOP_ITEMS[0];
    player.coins = result.profile.coins;
    player.skinId = item.id;
    player.color = item.color;
    acknowledge({ ok: true, profile: result.profile, shop: shopSnapshot(result.profile) });
    emitRoomState(rooms.get(socket.data.roomId));
  });

  socket.on("shop:equip", (payload = {}, acknowledge = () => {}) => {
    const player = socket.data.player;
    if (!player) return acknowledge({ ok: false, error: "Debes entrar a una sala primero." });
    const result = setSkin(db, player.profileId, safeText(payload.itemId, 40));
    if (!result.ok) return acknowledge(result);
    const item = SHOP_ITEMS.find((candidate) => candidate.id === result.profile.skinId) || SHOP_ITEMS[0];
    player.skinId = item.id;
    player.color = item.color;
    acknowledge({ ok: true, profile: result.profile, shop: shopSnapshot(result.profile) });
    emitRoomState(rooms.get(socket.data.roomId));
  });

  socket.on("chat:send", (payload = {}, acknowledge = () => {}) => {
    const player = socket.data.player;
    const room = rooms.get(socket.data.roomId);
    if (!player || !room) return acknowledge({ ok: false, error: "Debes entrar a una sala primero." });
    const now = Date.now();
    if (now - player.lastChatAt < 700) return acknowledge({ ok: false, error: "Espera un momento antes de enviar otro mensaje." });
    const text = safeText(payload.text, 160);
    if (!text) return acknowledge({ ok: false, error: "El mensaje está vacío." });
    player.lastChatAt = now;
    io.to(room.id).emit("chat:message", { username: player.username, text, at: now });
    acknowledge({ ok: true });
  });

  socket.on("leave:game", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let changed = false;
    for (const player of room.players.values()) {
      if (player.respawnAt) {
        if (now < player.respawnAt) continue;
        const spawn = randomSpawn();
        player.x = spawn.x;
        player.y = spawn.y;
        player.hp = PLAYER_MAX_HP;
        player.respawnAt = 0;
        player.input = { x: 0, y: 0 };
        io.to(room.id).emit("server:notice", `${player.username} ha reaparecido.`);
        changed = true;
        continue;
      }
      const nextX = clamp(player.x + player.input.x * PLAYER_SPEED * 0.05, 45, WORLD.width - 45);
      const nextY = clamp(player.y + player.input.y * PLAYER_SPEED * 0.05, 45, WORLD.height - 45);
      if (nextX !== player.x || nextY !== player.y) changed = true;
      player.x = nextX;
      player.y = nextY;
      for (const coin of room.coins.values()) {
        if (distance(player, coin) <= 34) {
          room.coins.delete(coin.id);
          player.coins += coin.value;
          addCoins(db, player.profileId, coin.value);
          io.to(room.id).emit("coin:collected", { playerId: player.socketId, coinId: coin.id, value: coin.value });
          setTimeout(() => {
            if (rooms.has(room.id) && room.coins.size < 24) {
              room.spawnCoin();
              emitRoomState(room);
            }
          }, 7000);
          changed = true;
          break;
        }
      }
    }
    if (changed || room.players.size > 0) emitRoomState(room);
  }
}, 50);

httpServer.listen(PORT, () => {
  console.log(`PIXEL ARENA server listening on port ${PORT}`);
  console.log(`Allowed client origin: ${CLIENT_ORIGIN}`);
});

