/* global Phaser, io */

const config = window.PIXEL_ARENA_CONFIG || {};
const queryServer = new URLSearchParams(window.location.search).get("server");
const SERVER_URL = queryServer || config.serverUrl || window.location.origin;
const WORLD = { width: 1800, height: 1200 };
const MAX_PLAYERS = 20;

const dom = {
  connectionPanel: document.getElementById("connection-panel"),
  connectionStatus: document.getElementById("connection-status"),
  joinForm: document.getElementById("join-form"),
  username: document.getElementById("username"),
  roomSelect: document.getElementById("room-select"),
  joinButton: document.getElementById("join-button"),
  hud: document.getElementById("hud"),
  hpValue: document.getElementById("hp-value"),
  hpBar: document.getElementById("hp-bar"),
  coinValue: document.getElementById("coin-value"),
  killValue: document.getElementById("kill-value"),
  roomLabel: document.getElementById("room-label"),
  playerCount: document.getElementById("player-count"),
  leaderboardList: document.getElementById("leaderboard-list"),
  chatMessages: document.getElementById("chat-messages"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  shopButton: document.getElementById("shop-button"),
  leaveButton: document.getElementById("leave-button"),
  shopModal: document.getElementById("shop-modal"),
  closeShop: document.getElementById("close-shop"),
  shopBalance: document.getElementById("shop-balance"),
  shopItems: document.getElementById("shop-items"),
  respawnBanner: document.getElementById("respawn-banner"),
  toast: document.getElementById("toast")
};

const socket = io(SERVER_URL, { transports: ["websocket", "polling"], autoConnect: true });
let arenaScene;
let joined = false;
let currentProfile = null;
let currentRoom = null;
let toastTimer;

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 2600);
}

function setConnectionStatus(message, error = false) {
  dom.connectionStatus.textContent = message;
  dom.connectionStatus.classList.toggle("error", error);
}

function setJoinedState(value) {
  joined = value;
  dom.connectionPanel.classList.toggle("hidden", value);
  dom.hud.classList.toggle("hidden", !value);
  if (!value) {
    dom.shopModal.classList.add("hidden");
    dom.respawnBanner.classList.add("hidden");
  }
}

function renderHud() {
  const self = arenaScene?.players?.get(socket.id);
  if (!self) return;
  const hp = Math.max(0, Math.round(self.hp));
  dom.hpValue.textContent = String(hp);
  dom.hpBar.style.width = `${hp}%`;
  dom.coinValue.textContent = String(self.coins ?? currentProfile?.coins ?? 0);
  dom.killValue.textContent = String(self.kills ?? 0);
  dom.playerCount.textContent = `${arenaScene.players.size}/${MAX_PLAYERS}`;
  if (currentProfile) currentProfile.coins = self.coins ?? currentProfile.coins;
  dom.shopBalance.textContent = String(currentProfile?.coins ?? self.coins ?? 0);
}

function renderLeaderboard(entries = []) {
  dom.leaderboardList.replaceChildren();
  for (const [index, entry] of entries.slice(0, 10).entries()) {
    const row = document.createElement("li");
    if (entry.id === socket.id) row.classList.add("me");
    const rank = document.createElement("span");
    rank.className = "leader-rank";
    rank.textContent = `${index + 1}.`;
    const name = document.createElement("span");
    name.textContent = entry.username;
    const score = document.createElement("span");
    score.className = "leader-score";
    score.textContent = `${entry.kills}K / ${entry.coins}¢`;
    row.append(rank, name, score);
    dom.leaderboardList.append(row);
  }
}

function addChatMessage(message) {
  const row = document.createElement("div");
  row.className = "chat-message";
  const sender = document.createElement("strong");
  sender.textContent = `${message.username}: `;
  const body = document.createElement("span");
  body.textContent = message.text;
  row.append(sender, body);
  dom.chatMessages.append(row);
  while (dom.chatMessages.children.length > 45) dom.chatMessages.firstElementChild.remove();
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function renderShop(items = []) {
  dom.shopItems.replaceChildren();
  dom.shopBalance.textContent = String(currentProfile?.coins ?? 0);
  for (const item of items) {
    const card = document.createElement("article");
    card.className = `shop-item${item.unlocked ? " unlocked" : ""}`;
    const head = document.createElement("div");
    head.className = "shop-item-head";
    const swatch = document.createElement("span");
    swatch.className = "skin-swatch";
    swatch.style.background = item.color;
    const title = document.createElement("h3");
    title.textContent = item.name;
    head.append(swatch, title);
    const description = document.createElement("p");
    description.textContent = item.description;
    const price = document.createElement("div");
    price.className = "shop-price";
    price.textContent = item.price === 0 ? "GRATIS" : `${item.price} MONEDAS`;
    const button = document.createElement("button");
    button.type = "button";
    const equipped = currentProfile?.skinId === item.id;
    button.disabled = equipped;
    button.textContent = equipped ? "EQUIPADO" : item.unlocked ? "EQUIPAR" : "COMPRAR";
    button.addEventListener("click", () => {
      const action = item.unlocked ? "shop:equip" : "shop:buy";
      socket.emit(action, { itemId: item.id }, (result) => {
        if (!result?.ok) return showToast(result?.error || "No se pudo completar la compra.");
        currentProfile = result.profile;
        renderShop(result.shop);
        showToast(item.unlocked ? `${item.name} equipado.` : `${item.name} desbloqueado.`);
      });
    });
    card.append(head, description, price, button);
    dom.shopItems.append(card);
  }
}

class ArenaScene extends Phaser.Scene {
  constructor() {
    super("ArenaScene");
    this.players = new Map();
    this.coins = new Map();
    this.lastInputAt = 0;
    this.lastShotAt = 0;
    this.keys = null;
  }

  create() {
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBackgroundColor("#070a14");
    this.drawArena();
    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE");
    this.input.on("pointerdown", () => this.tryShoot());
    this.input.keyboard.on("keydown-SPACE", () => this.tryShoot());
    this.input.on("pointermove", () => this.updateAim());
    this.effects = this.add.graphics().setDepth(20);
    arenaScene = this;
  }

  drawArena() {
    const bg = this.add.graphics().setDepth(-10);
    bg.fillStyle(0x090f20, 1).fillRect(0, 0, WORLD.width, WORLD.height);
    bg.lineStyle(1, 0x17274a, 0.55);
    for (let x = 0; x <= WORLD.width; x += 48) bg.lineBetween(x, 0, x, WORLD.height);
    for (let y = 0; y <= WORLD.height; y += 48) bg.lineBetween(0, y, WORLD.width, y);
    bg.lineStyle(5, 0x55e6ff, 0.6).strokeRect(22, 22, WORLD.width - 44, WORLD.height - 44);
    const obstacles = [
      [320, 240, 210, 32], [830, 190, 300, 32], [1290, 320, 180, 32],
      [270, 780, 290, 32], [840, 920, 220, 32], [1270, 760, 300, 32],
      [580, 470, 36, 170], [1180, 480, 36, 190]
    ];
    for (const [x, y, width, height] of obstacles) {
      bg.fillStyle(0x111c36, 1).fillRect(x, y, width, height);
      bg.lineStyle(2, 0x5741a5, 0.75).strokeRect(x, y, width, height);
      bg.fillStyle(0x55e6ff, 0.18).fillRect(x + 5, y + 5, Math.min(16, width - 10), Math.min(16, height - 10));
    }
  }

  update() {
    if (!joined || !this.keys) return;
    const dx = Number(Boolean(this.keys.D.isDown || this.keys.RIGHT.isDown)) - Number(Boolean(this.keys.A.isDown || this.keys.LEFT.isDown));
    const dy = Number(Boolean(this.keys.S.isDown || this.keys.DOWN.isDown)) - Number(Boolean(this.keys.W.isDown || this.keys.UP.isDown));
    this.updateAim();
    if (Date.now() - this.lastInputAt > 45) {
      this.lastInputAt = Date.now();
      socket.emit("input", { dx, dy, angle: this.aimAngle ?? 0 });
    }
    renderHud();
  }

  updateAim() {
    const self = this.players.get(socket.id);
    if (!self) return;
    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.aimAngle = Phaser.Math.Angle.Between(self.x, self.y, worldPoint.x, worldPoint.y);
  }

  tryShoot() {
    if (!joined || Date.now() - this.lastShotAt < 180) return;
    this.lastShotAt = Date.now();
    socket.emit("combat:shoot", { angle: this.aimAngle ?? 0 });
  }

  upsertPlayer(player) {
    let sprite = this.players.get(player.id);
    if (!sprite) {
      sprite = this.createPlayerSprite(player);
      this.players.set(player.id, sprite);
    }
    sprite.playerData = player;
    sprite.setPosition(player.x, player.y);
    sprite.rotation = player.angle || 0;
    sprite.body.clear();
    sprite.body.fillStyle(Phaser.Display.Color.HexStringToColor(player.color || "#55e6ff").color, 1);
    sprite.body.fillRect(-17, -17, 34, 34);
    sprite.body.lineStyle(2, player.id === socket.id ? 0xffffff : 0x17213f, 1).strokeRect(-17, -17, 34, 34);
    sprite.hpFill.scaleX = Math.max(0, player.hp / player.maxHp);
    sprite.hpFill.x = -20;
    sprite.nameText.text = player.respawnAt ? `${player.username} // DOWN` : player.username;
    sprite.nameText.setColor(player.id === socket.id ? "#55e6ff" : "#d9e7ff");
    sprite.setAlpha(player.respawnAt ? 0.42 : 1);
    return sprite;
  }

  createPlayerSprite(player) {
    const container = this.add.container(player.x, player.y).setDepth(10);
    container.body = this.add.graphics();
    container.hpBack = this.add.rectangle(0, -27, 42, 5, 0x101729).setOrigin(0.5).setDepth(1);
    container.hpFill = this.add.rectangle(-20, -27, 40, 3, 0xff667d).setOrigin(0, 0.5).setDepth(2);
    container.nameText = this.add.text(0, 27, player.username, { fontFamily: "Courier New", fontSize: "11px", color: "#d9e7ff" }).setOrigin(0.5);
    container.add([container.body, container.hpBack, container.hpFill, container.nameText]);
    return container;
  }

  renderPlayers(players) {
    const visible = new Set();
    for (const player of players) {
      visible.add(player.id);
      this.upsertPlayer(player);
    }
    for (const [id, sprite] of this.players) {
      if (!visible.has(id)) {
        sprite.destroy();
        this.players.delete(id);
      }
    }
    const self = this.players.get(socket.id);
    if (self) this.cameras.main.startFollow(self, true, 0.12, 0.12);
  }

  renderCoins(coins) {
    const visible = new Set();
    for (const coin of coins) {
      visible.add(coin.id);
      let sprite = this.coins.get(coin.id);
      if (!sprite) {
        sprite = this.add.graphics().setDepth(5);
        sprite.fillStyle(0xffe66e, 1).fillRect(-8, -8, 16, 16);
        sprite.lineStyle(2, 0xffffff, 0.65).strokeRect(-8, -8, 16, 16);
        this.coins.set(coin.id, sprite);
      }
      sprite.setPosition(coin.x, coin.y);
    }
    for (const [id, sprite] of this.coins) {
      if (!visible.has(id)) {
        sprite.destroy();
        this.coins.delete(id);
      }
    }
  }

  showShot(event) {
    if (!event?.from || !event?.to) return;
    const g = this.add.graphics().setDepth(15);
    g.lineStyle(3, event.hit ? 0xff667d : 0x55e6ff, 0.9);
    g.lineBetween(event.from.x, event.from.y, event.to.x, event.to.y);
    this.tweens.add({ targets: g, alpha: 0, duration: 150, onComplete: () => g.destroy() });
  }

  showFloatingText(x, y, text, color = "#ffffff") {
    const label = this.add.text(x, y, text, { fontFamily: "Courier New", fontSize: "13px", color, stroke: "#070a14", strokeThickness: 4 }).setOrigin(0.5).setDepth(25);
    this.tweens.add({ targets: label, y: y - 30, alpha: 0, duration: 850, onComplete: () => label.destroy() });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: 960,
  height: 600,
  backgroundColor: "#070a14",
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [ArenaScene]
});

socket.on("connect", () => {
  setConnectionStatus("Servidor conectado. Elige una sala para entrar.");
  dom.joinButton.disabled = false;
});

socket.on("disconnect", () => {
  dom.joinButton.disabled = true;
  if (joined) setConnectionStatus("Conexión perdida. Recarga cuando el servidor vuelva.", true);
  else setConnectionStatus("Sin conexión con el servidor.", true);
});

socket.on("connect_error", () => setConnectionStatus("No se pudo conectar al servidor. Revisa la URL configurada.", true));

socket.on("room:state", (state) => {
  currentRoom = state.roomId;
  currentProfile = state.profile;
  dom.roomLabel.textContent = String(state.roomId).toUpperCase();
  arenaScene.renderPlayers(state.players || []);
  arenaScene.renderCoins(state.coins || []);
  renderHud();
  renderShop(state.shop || []);
  setJoinedState(true);
});

socket.on("game:state", (state) => {
  if (!joined || state.roomId !== currentRoom) return;
  arenaScene.renderPlayers(state.players || []);
  arenaScene.renderCoins(state.coins || []);
  for (const player of state.players || []) {
    if (player.id === socket.id && player.respawnAt) {
      const seconds = Math.max(1, Math.ceil((player.respawnAt - Date.now()) / 1000));
      dom.respawnBanner.textContent = `REAPARICIÓN EN ${seconds}s`;
      dom.respawnBanner.classList.remove("hidden");
    } else if (player.id === socket.id && !player.respawnAt) {
      dom.respawnBanner.classList.add("hidden");
    }
  }
  renderHud();
});

socket.on("leaderboard", renderLeaderboard);
socket.on("combat:shot", (event) => arenaScene.showShot(event));
socket.on("combat:hit", (event) => {
  const target = arenaScene.players.get(event.targetId);
  if (target) arenaScene.showFloatingText(target.x, target.y - 35, `-${event.damage}`, "#ff667d");
});
socket.on("combat:kill", (event) => {
  const target = arenaScene.players.get(event.targetId);
  if (target) arenaScene.showFloatingText(target.x, target.y - 35, "K.O.", "#ffe66e");
  if (event.killerId === socket.id) showToast("Eliminación confirmada +10 monedas");
});
socket.on("coin:collected", (event) => {
  const player = arenaScene.players.get(event.playerId);
  if (player) arenaScene.showFloatingText(player.x, player.y - 40, `+${event.value}¢`, "#b7ff72");
});
socket.on("chat:message", addChatMessage);
socket.on("server:notice", (message) => showToast(message));

dom.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!socket.connected) return setConnectionStatus("Esperando la conexión con el servidor…", true);
  const username = dom.username.value.trim();
  const roomId = dom.roomSelect.value;
  dom.joinButton.disabled = true;
  socket.emit("join:game", { username, roomId }, (result) => {
    dom.joinButton.disabled = false;
    if (!result?.ok) {
      setConnectionStatus(result?.error || "No se pudo entrar a la sala.", true);
      return;
    }
    setConnectionStatus("Entrando…");
  });
});

dom.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = dom.chatInput.value.trim();
  if (!text) return;
  socket.emit("chat:send", { text }, (result) => {
    if (!result?.ok) showToast(result?.error || "No se pudo enviar el mensaje.");
    else dom.chatInput.value = "";
  });
});

dom.shopButton.addEventListener("click", () => dom.shopModal.classList.remove("hidden"));
dom.closeShop.addEventListener("click", () => dom.shopModal.classList.add("hidden"));
dom.shopModal.addEventListener("click", (event) => {
  if (event.target === dom.shopModal) dom.shopModal.classList.add("hidden");
});
dom.leaveButton.addEventListener("click", () => {
  socket.emit("leave:game");
  setJoinedState(false);
  setConnectionStatus("Has salido de la sala. Puedes volver a entrar.");
  arenaScene.players.forEach((sprite) => sprite.destroy());
  arenaScene.players.clear();
  arenaScene.coins.forEach((sprite) => sprite.destroy());
  arenaScene.coins.clear();
});

