export const WORLD = Object.freeze({ width: 1800, height: 1200 });
export const DEFAULT_MAX_PLAYERS = 20;
export const ROOM_IDS = Object.freeze(["alpha", "bravo"]);
export const PLAYER_SPEED = 210;
export const PLAYER_MAX_HP = 100;
export const RESPAWN_MS = 5000;
export const SHOT_COOLDOWN_MS = 260;
export const SHOT_RANGE = 470;
export const SHOT_DAMAGE = 34;
export const COIN_VALUE = 5;
export const KILL_REWARD = 10;

export const SHOP_ITEMS = Object.freeze([
  { id: "rookie", name: "Rookie Cyan", price: 0, color: "#55e6ff", description: "El uniforme estándar de la arena." },
  { id: "neon-violet", name: "Neon Violet", price: 35, color: "#9d7bff", description: "Brilla como una señal perdida en la noche." },
  { id: "hot-pink", name: "Hot Pink", price: 60, color: "#ff5ba8", description: "Alta visibilidad. Cero discreción." },
  { id: "lime-runner", name: "Lime Runner", price: 90, color: "#b7ff72", description: "Para quienes convierten cada esquina en una carrera." },
  { id: "solar-gold", name: "Solar Gold", price: 140, color: "#ffe66e", description: "El color de una racha imparable." }
]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeVector(dx = 0, dy = 0) {
  const x = Number.isFinite(Number(dx)) ? Number(dx) : 0;
  const y = Number.isFinite(Number(dy)) ? Number(dy) : 0;
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / Math.max(1, length), y: y / Math.max(1, length) };
}

export function normalizeAngle(angle = 0) {
  const value = Number.isFinite(Number(angle)) ? Number(angle) : 0;
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function angleDifference(a, b) {
  return Math.abs(normalizeAngle(a - b));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function randomSpawn(random = Math.random) {
  return {
    x: Math.round(120 + random() * (WORLD.width - 240)),
    y: Math.round(120 + random() * (WORLD.height - 240))
  };
}

export function publicPlayer(player) {
  return {
    id: player.socketId,
    username: player.username,
    x: Math.round(player.x),
    y: Math.round(player.y),
    angle: player.angle,
    hp: player.hp,
    maxHp: player.maxHp,
    coins: player.coins,
    kills: player.kills,
    deaths: player.deaths,
    skinId: player.skinId,
    color: player.color,
    respawnAt: player.respawnAt || 0
  };
}

export function publicLeaderboard(players) {
  return [...players]
    .sort((a, b) => b.kills - a.kills || b.coins - a.coins || a.deaths - b.deaths || a.username.localeCompare(b.username))
    .map((player) => ({ id: player.socketId, username: player.username, kills: player.kills, deaths: player.deaths, coins: player.coins }));
}

