const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- Game constants ---
const CANVAS_W = 400;
const CANVAS_H = 700;
const BOAT_W = 54;
const BOAT_SPEED = 5;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

const OBS_DEFS = [
  { name: 'log',       w: 40, h: 18, color: '#8B5E3C', dmg: 15, weight: 40 },
  { name: 'rock',      w: 30, h: 28, color: '#888',    dmg: 25, weight: 25 },
  { name: 'crate',     w: 32, h: 32, color: '#C4963C', dmg: 10, weight: 15 },
  { name: 'mine',      w: 26, h: 26, color: '#333',    dmg: 50, weight: 10 },
  { name: 'jellyfish', w: 28, h: 34, color: '#FF69B4', dmg: 20, weight: 10 },
];

const LEVELS = [
  { minScore: 0,   spawnInterval: 60, baseSpeed: 2,   label: 'Calm Seas' },
  { minScore: 10,  spawnInterval: 50, baseSpeed: 2.5, label: 'Choppy Waters' },
  { minScore: 25,  spawnInterval: 40, baseSpeed: 3,   label: 'Rough Seas' },
  { minScore: 45,  spawnInterval: 30, baseSpeed: 3.5, label: 'Storm Brewing' },
  { minScore: 70,  spawnInterval: 22, baseSpeed: 4,   label: 'Full Storm' },
  { minScore: 100, spawnInterval: 16, baseSpeed: 4.5, label: 'Hurricane!' },
  { minScore: 140, spawnInterval: 12, baseSpeed: 5,   label: 'Kraken\'s Wrath' },
];

// --- Game state ---
let gameState = 'waiting'; // waiting | playing | over
let players = {};
let obstacles = { 1: [], 2: [] };
let waves = { 1: [], 2: [] };
let particles = { 1: [], 2: [] };
let winner = null;
let tickTimer = null;
let sockets = {};

function getLevel(score) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) {
    if (score >= l.minScore) lvl = l;
  }
  return lvl;
}

function pickObstacle() {
  const totalWeight = OBS_DEFS.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * totalWeight;
  for (const o of OBS_DEFS) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return OBS_DEFS[0];
}

function createPlayer(id) {
  return {
    x: CANVAS_W / 2,
    y: CANVAS_H - 80,
    vx: 0,
    health: 100,
    score: 0,
    frameCount: 0,
    invincible: 0,
    dead: false,
    level: 0,
    input: { left: false, right: false },
    bestScore: 0,
  };
}

function resetGame() {
  winner = null;
  obstacles = { 1: [], 2: [] };
  waves = { 1: [], 2: [] };
  particles = { 1: [], 2: [] };
  for (const id of [1, 2]) {
    if (players[id]) {
      const best = players[id].bestScore;
      players[id] = createPlayer(id);
      players[id].bestScore = best;
    }
  }
}

function spawnObstacle(playerId) {
  const def = pickObstacle();
  const lvl = getLevel(players[playerId].score);
  obstacles[playerId].push({
    x: Math.random() * (CANVAS_W - def.w),
    y: -def.h,
    w: def.w,
    h: def.h,
    speed: lvl.baseSpeed + Math.random() * 1.5,
    type: def.name,
    color: def.color,
    dmg: def.dmg,
  });
}

function spawnRogueWave(playerId) {
  if (Math.random() < 0.003) {
    const fromLeft = Math.random() < 0.5;
    waves[playerId].push({
      x: fromLeft ? -CANVAS_W : CANVAS_W,
      y: 0,
      dir: fromLeft ? 1 : -1,
      alpha: 0.7,
      speed: 3 + Math.random() * 2,
    });
  }
}

function addParticles(playerId, x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles[playerId].push({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      life: 20 + Math.random() * 20,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function tick() {
  if (gameState !== 'playing') return;

  for (const id of [1, 2]) {
    const p = players[id];
    if (!p || p.dead) continue;

    p.frameCount++;

    // Input
    if (p.input.left) p.vx = -BOAT_SPEED;
    else if (p.input.right) p.vx = BOAT_SPEED;
    else p.vx *= 0.85;

    // Move boat
    p.x += p.vx;
    if (p.x < BOAT_W / 2) p.x = BOAT_W / 2;
    if (p.x > CANVAS_W - BOAT_W / 2) p.x = CANVAS_W - BOAT_W / 2;

    // Score
    if (p.frameCount % TICK_RATE === 0) {
      p.score++;
    }

    // Level
    const lvl = getLevel(p.score);
    p.level = LEVELS.indexOf(lvl);

    // Spawn obstacles
    if (p.frameCount % lvl.spawnInterval === 0) {
      spawnObstacle(id);
    }

    // Invincibility countdown
    if (p.invincible > 0) p.invincible--;

    // Update obstacles
    obstacles[id] = obstacles[id].filter(ob => {
      ob.y += ob.speed;
      if (ob.y > CANVAS_H + 50) return false;

      // Collision
      if (p.invincible <= 0) {
        const boatLeft = p.x - BOAT_W / 2;
        const boatRight = p.x + BOAT_W / 2;
        const boatTop = p.y - 20;
        const boatBottom = p.y + 20;
        if (
          ob.x + ob.w > boatLeft &&
          ob.x < boatRight &&
          ob.y + ob.h > boatTop &&
          ob.y < boatBottom
        ) {
          p.health -= ob.dmg;
          p.invincible = 40;
          addParticles(id, p.x, p.y, ob.color, 8);
          if (p.health <= 0) {
            p.health = 0;
            p.dead = true;
            if (p.score > p.bestScore) p.bestScore = p.score;
            addParticles(id, p.x, p.y, '#FF4444', 20);
          }
          return false;
        }
      }
      return true;
    });

    // Rogue waves
    spawnRogueWave(id);
    waves[id] = waves[id].filter(w => {
      w.x += w.speed * w.dir;
      w.alpha -= 0.005;
      if (w.alpha <= 0) return false;

      // Push boat
      const waveLeft = Math.min(w.x, w.x + CANVAS_W * w.dir);
      const waveRight = Math.max(w.x, w.x + CANVAS_W * w.dir);
      if (p.x > waveLeft && p.x < waveRight) {
        p.vx += w.dir * 1.5;
      }
      return true;
    });

    // Update particles
    particles[id] = particles[id].filter(pt => {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life--;
      return pt.life > 0;
    });
  }

  // Check game over
  const p1Dead = !players[1] || players[1].dead;
  const p2Dead = !players[2] || players[2].dead;

  if (p1Dead && p2Dead && gameState === 'playing') {
    gameState = 'over';
    if (players[1] && players[2]) {
      if (players[1].score > players[2].score) winner = 1;
      else if (players[2].score > players[1].score) winner = 2;
      else winner = 'tie';
    }
  }

  // Broadcast state
  const state = {
    gameState,
    players: {},
    obstacles,
    waves,
    particles,
    winner,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
  };
  for (const id of [1, 2]) {
    if (players[id]) {
      state.players[id] = { ...players[id], input: undefined };
    }
  }
  io.emit('game-state', state);
}

// --- Socket.io ---
io.on('connection', (socket) => {
  let playerId = null;

  // Assign player slot
  if (!sockets[1]) {
    playerId = 1;
  } else if (!sockets[2]) {
    playerId = 2;
  } else {
    socket.emit('full');
    socket.disconnect();
    return;
  }

  sockets[playerId] = socket;
  players[playerId] = createPlayer(playerId);
  socket.emit('assigned', { playerId, canvasW: CANVAS_W, canvasH: CANVAS_H });
  console.log(`Player ${playerId} connected`);

  // Notify both players of connection status
  io.emit('players-update', {
    p1: !!sockets[1],
    p2: !!sockets[2],
  });

  // Start game when both connected
  if (sockets[1] && sockets[2] && gameState === 'waiting') {
    gameState = 'playing';
    resetGame();
    io.emit('game-start');
    if (!tickTimer) {
      tickTimer = setInterval(tick, TICK_MS);
    }
  }

  socket.on('player-input', (data) => {
    if (players[playerId]) {
      players[playerId].input = data;
    }
  });

  socket.on('restart-request', () => {
    if (gameState === 'over' && sockets[1] && sockets[2]) {
      gameState = 'playing';
      resetGame();
      io.emit('game-start');
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player ${playerId} disconnected`);
    delete sockets[playerId];
    delete players[playerId];

    if (gameState === 'playing') {
      gameState = 'over';
      winner = playerId === 1 ? 2 : 1;
    } else {
      gameState = 'waiting';
      winner = null;
    }

    io.emit('players-update', {
      p1: !!sockets[1],
      p2: !!sockets[2],
    });
    io.emit('game-state', {
      gameState,
      players: {},
      obstacles: { 1: [], 2: [] },
      waves: { 1: [], 2: [] },
      particles: { 1: [], 2: [] },
      winner,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
    });
  });
});

// --- Start server ---
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  const url = `http://${localIP}:${PORT}`;
  const p2url = `${url}/?player=2`;

  console.log('\n========================================');
  console.log('   CREW OVERBOARD — Multiplayer Server');
  console.log('========================================\n');
  console.log(`  Player 1: open ${url}`);
  console.log(`  Player 2: scan QR code below\n`);
  qrcode.generate(p2url, { small: true });
  console.log(`\n  P2 URL: ${p2url}\n`);
  console.log('========================================\n');
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
