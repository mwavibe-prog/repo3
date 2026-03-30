// --- Connection ---
const socket = io(window.location.origin, {
  transports: ['websocket', 'polling'],
});
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let myPlayerId = null;
let latestState = null;
let canvasW = 400;
let canvasH = 700;
let input = { left: false, right: false };
let oceanOffset = 0;

// --- Waiting screen elements ---
const waitingScreen = document.getElementById('waiting-screen');
const statusEl = document.getElementById('status');
const playerBadge = document.getElementById('player-badge');
const qrSection = document.getElementById('qr-section');
const fullScreenMsg = document.getElementById('full-screen');

// --- Determine player from URL ---
const urlParams = new URLSearchParams(window.location.search);
const requestedPlayer = parseInt(urlParams.get('player')) || 0;

// --- Socket events ---
socket.on('assigned', (data) => {
  myPlayerId = data.playerId;
  canvasW = data.canvasW;
  canvasH = data.canvasH;
  canvas.width = canvasW;
  canvas.height = canvasH;

  if (myPlayerId === 1) {
    playerBadge.textContent = 'Player 1 (Host)';
    playerBadge.className = 'player-badge p1-badge';
  } else {
    playerBadge.textContent = 'Player 2';
    playerBadge.className = 'player-badge p2-badge';
  }
});

socket.on('players-update', (data) => {
  if (!myPlayerId) return;

  if (data.p1 && data.p2) {
    statusEl.textContent = 'Both players connected!';
    statusEl.classList.remove('dot-anim');
  } else if (myPlayerId === 1 && !data.p2) {
    statusEl.textContent = 'Waiting for Player 2';
    statusEl.classList.add('dot-anim');
    showQRCode();
  } else if (myPlayerId === 2 && !data.p1) {
    statusEl.textContent = 'Waiting for Host';
    statusEl.classList.add('dot-anim');
  }
});

socket.on('game-start', () => {
  waitingScreen.style.display = 'none';
});

socket.on('game-state', (state) => {
  latestState = state;

  if (state.gameState === 'waiting' && waitingScreen.style.display === 'none') {
    waitingScreen.style.display = 'flex';
  }
});

socket.on('full', () => {
  playerBadge.style.display = 'none';
  statusEl.style.display = 'none';
  qrSection.style.display = 'none';
  fullScreenMsg.style.display = 'block';
});

socket.on('disconnect', () => {
  waitingScreen.style.display = 'flex';
  statusEl.textContent = 'Disconnected from server';
  statusEl.classList.remove('dot-anim');
  qrSection.style.display = 'none';
});

// --- QR code generation (P1 only) ---
let qrGenerated = false;

function showQRCode() {
  if (myPlayerId !== 1) return;
  const p2url = `${window.location.origin}/?player=2`;

  qrSection.style.display = 'block';
  document.getElementById('p2-url').textContent = p2url;

  if (qrGenerated) return;

  const qrCanvas = document.getElementById('qr-canvas');

  function tryGenerateQR() {
    if (typeof QRCode !== 'undefined') {
      QRCode.toCanvas(qrCanvas, p2url, {
        width: 200,
        margin: 1,
        color: { dark: '#0a1628', light: '#ffffff' },
      }, (err) => {
        if (!err) qrGenerated = true;
      });
    } else {
      // CDN not loaded yet, retry
      setTimeout(tryGenerateQR, 500);
    }
  }
  tryGenerateQR();
}

// --- Input handling ---
const keyMap = {};

document.addEventListener('keydown', (e) => {
  if (keyMap[e.key]) return;
  keyMap[e.key] = true;
  updateInputFromKeys();

  // Restart on Enter/Space when game is over
  if (latestState && latestState.gameState === 'over') {
    if (e.key === 'Enter' || e.key === ' ') {
      socket.emit('restart-request');
    }
  }
});

document.addEventListener('keyup', (e) => {
  delete keyMap[e.key];
  updateInputFromKeys();
});

function updateInputFromKeys() {
  // P1: A/D or arrows, P2: arrows or A/D — both work for either player
  const left = keyMap['a'] || keyMap['A'] || keyMap['ArrowLeft'];
  const right = keyMap['d'] || keyMap['D'] || keyMap['ArrowRight'];
  input = { left: !!left, right: !!right };
  socket.emit('player-input', input);
}

// --- Touch controls ---
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');

function sendTouchInput(left, right) {
  input = { left, right };
  socket.emit('player-input', input);
}

btnLeft.addEventListener('touchstart', (e) => { e.preventDefault(); sendTouchInput(true, input.right); });
btnLeft.addEventListener('touchend', (e) => { e.preventDefault(); sendTouchInput(false, input.right); });
btnRight.addEventListener('touchstart', (e) => { e.preventDefault(); sendTouchInput(input.left, true); });
btnRight.addEventListener('touchend', (e) => { e.preventDefault(); sendTouchInput(input.left, false); });

// Also handle restart via tap on game-over screen
canvas.addEventListener('touchstart', () => {
  if (latestState && latestState.gameState === 'over') {
    socket.emit('restart-request');
  }
});

// --- Rendering ---
function render() {
  requestAnimationFrame(render);
  if (!latestState || latestState.gameState === 'waiting') {
    drawWaitingCanvas();
    return;
  }

  const state = latestState;
  ctx.clearRect(0, 0, canvasW, canvasH);

  drawOcean();

  // Draw both players
  for (const id of [1, 2]) {
    const p = state.players[id];
    if (!p) continue;

    const isMe = parseInt(id) === myPlayerId;

    // Draw obstacles
    if (state.obstacles[id]) {
      drawObstacles(state.obstacles[id], isMe ? 1.0 : 0.4);
    }

    // Draw rogue waves
    if (state.waves[id]) {
      drawWaves(state.waves[id], isMe ? 1.0 : 0.3);
    }

    // Draw particles
    if (state.particles[id]) {
      drawParticles(state.particles[id]);
    }

    // Draw boat
    if (!p.dead) {
      drawBoat(p.x, p.y, id, isMe);
    }
  }

  // HUD
  drawHUD(state);

  // Game over overlay
  if (state.gameState === 'over') {
    drawGameOver(state);
  }
}

function drawWaitingCanvas() {
  ctx.clearRect(0, 0, canvasW, canvasH);
  drawOcean();
  ctx.fillStyle = 'rgba(10, 22, 40, 0.6)';
  ctx.fillRect(0, 0, canvasW, canvasH);
}

function drawOcean() {
  oceanOffset = (oceanOffset + 0.3) % 40;

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
  grad.addColorStop(0, '#0a2a4a');
  grad.addColorStop(0.5, '#0e3d6b');
  grad.addColorStop(1, '#0a1e3a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Wave lines
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let y = oceanOffset; y < canvasH; y += 40) {
    ctx.beginPath();
    for (let x = 0; x <= canvasW; x += 10) {
      const wy = y + Math.sin((x + oceanOffset * 3) * 0.03) * 5;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
}

function drawBoat(x, y, playerId, isMe) {
  ctx.save();
  ctx.translate(x, y);

  const scale = isMe ? 1.0 : 0.7;
  const alpha = isMe ? 1.0 : 0.5;
  ctx.globalAlpha = alpha;
  ctx.scale(scale, scale);

  // Hull
  const hullColor = playerId == 1 ? '#22668a' : '#8a2222';
  const hullHighlight = playerId == 1 ? '#3399cc' : '#cc4444';

  ctx.beginPath();
  ctx.moveTo(-27, -8);
  ctx.lineTo(-22, 16);
  ctx.lineTo(22, 16);
  ctx.lineTo(27, -8);
  ctx.closePath();
  ctx.fillStyle = hullColor;
  ctx.fill();
  ctx.strokeStyle = hullHighlight;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Deck line
  ctx.beginPath();
  ctx.moveTo(-20, 2);
  ctx.lineTo(20, 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Mast
  ctx.fillStyle = '#ddd';
  ctx.fillRect(-2, -35, 4, 30);

  // Sail
  ctx.beginPath();
  ctx.moveTo(2, -33);
  ctx.lineTo(18, -15);
  ctx.lineTo(2, -8);
  ctx.closePath();
  ctx.fillStyle = playerId == 1 ? 'rgba(100, 200, 255, 0.7)' : 'rgba(255, 100, 100, 0.7)';
  ctx.fill();

  // Flag
  ctx.beginPath();
  ctx.moveTo(0, -35);
  ctx.lineTo(10, -40);
  ctx.lineTo(0, -45);
  ctx.fillStyle = playerId == 1 ? '#4a9eff' : '#ff4a4a';
  ctx.fill();

  ctx.restore();

  // Player label
  if (isMe) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', x, y + 30 * scale);
  }
}

function drawObstacles(obs, alpha) {
  ctx.globalAlpha = alpha;
  for (const ob of obs) {
    ctx.save();
    switch (ob.type) {
      case 'log':
        ctx.fillStyle = '#8B5E3C';
        ctx.beginPath();
        ctx.ellipse(ob.x + ob.w / 2, ob.y + ob.h / 2, ob.w / 2, ob.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6B3E1C';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'rock':
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.moveTo(ob.x + ob.w * 0.5, ob.y);
        ctx.lineTo(ob.x + ob.w, ob.y + ob.h * 0.7);
        ctx.lineTo(ob.x + ob.w * 0.8, ob.y + ob.h);
        ctx.lineTo(ob.x + ob.w * 0.2, ob.y + ob.h);
        ctx.lineTo(ob.x, ob.y + ob.h * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'crate':
        ctx.fillStyle = '#C4963C';
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 2;
        ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
        ctx.beginPath();
        ctx.moveTo(ob.x, ob.y);
        ctx.lineTo(ob.x + ob.w, ob.y + ob.h);
        ctx.moveTo(ob.x + ob.w, ob.y);
        ctx.lineTo(ob.x, ob.y + ob.h);
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'mine':
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(ob.x + ob.w / 2, ob.y + ob.h / 2, ob.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(ob.x + ob.w / 2, ob.y + ob.h / 2, 4, 0, Math.PI * 2);
        ctx.fill();
        // Spikes
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const cx = ob.x + ob.w / 2;
          const cy = ob.y + ob.h / 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * (ob.w / 2 - 2), cy + Math.sin(angle) * (ob.w / 2 - 2));
          ctx.lineTo(cx + Math.cos(angle) * (ob.w / 2 + 5), cy + Math.sin(angle) * (ob.w / 2 + 5));
          ctx.strokeStyle = '#555';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        break;
      case 'jellyfish':
        ctx.fillStyle = 'rgba(255, 105, 180, 0.7)';
        ctx.beginPath();
        ctx.ellipse(ob.x + ob.w / 2, ob.y + ob.h * 0.3, ob.w / 2, ob.h * 0.3, 0, Math.PI, 0);
        ctx.fill();
        // Tentacles
        ctx.strokeStyle = 'rgba(255, 105, 180, 0.5)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const tx = ob.x + ob.w * 0.2 + i * (ob.w * 0.2);
          ctx.beginPath();
          ctx.moveTo(tx, ob.y + ob.h * 0.3);
          ctx.quadraticCurveTo(tx + 3, ob.y + ob.h * 0.6, tx - 2, ob.y + ob.h);
          ctx.stroke();
        }
        break;
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1.0;
}

function drawWaves(wavesArr, alpha) {
  for (const w of wavesArr) {
    ctx.save();
    ctx.globalAlpha = w.alpha * alpha;
    const grad = ctx.createLinearGradient(w.x, 0, w.x + 200 * w.dir, 0);
    grad.addColorStop(0, 'rgba(100, 200, 255, 0.4)');
    grad.addColorStop(1, 'rgba(100, 200, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(
      w.dir > 0 ? w.x : w.x - 200,
      0,
      200,
      canvasH
    );
    ctx.restore();
  }
}

function drawParticles(parts) {
  for (const pt of parts) {
    ctx.globalAlpha = pt.life / 40;
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1.0;
}

function drawHUD(state) {
  const p1 = state.players[1];
  const p2 = state.players[2];

  // Background bar
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvasW, 55);

  // P1 info (left)
  if (p1) {
    ctx.fillStyle = myPlayerId === 1 ? '#8ad4ff' : '#aaa';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(myPlayerId === 1 ? 'YOU (P1)' : 'P1', 10, 16);

    // Health bar
    ctx.fillStyle = '#333';
    ctx.fillRect(10, 22, 80, 8);
    ctx.fillStyle = p1.health > 30 ? '#4a9eff' : '#ff4444';
    ctx.fillRect(10, 22, (p1.health / 100) * 80, 8);

    ctx.fillStyle = '#ccc';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Score: ${p1.score}`, 10, 44);
  }

  // P2 info (right)
  if (p2) {
    ctx.fillStyle = myPlayerId === 2 ? '#ff8a8a' : '#aaa';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(myPlayerId === 2 ? 'YOU (P2)' : 'P2', canvasW - 10, 16);

    // Health bar
    ctx.fillStyle = '#333';
    ctx.fillRect(canvasW - 90, 22, 80, 8);
    ctx.fillStyle = p2.health > 30 ? '#ff4a4a' : '#ff4444';
    ctx.fillRect(canvasW - 90, 22, (p2.health / 100) * 80, 8);

    ctx.fillStyle = '#ccc';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Score: ${p2.score}`, canvasW - 10, 44);
  }

  // Level (center)
  const myPlayer = state.players[myPlayerId];
  if (myPlayer) {
    const lvlIdx = myPlayer.level || 0;
    const LEVELS = [
      'Calm Seas', 'Choppy Waters', 'Rough Seas',
      'Storm Brewing', 'Full Storm', 'Hurricane!', "Kraken's Wrath"
    ];
    ctx.fillStyle = '#ffcc44';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(LEVELS[lvlIdx] || 'Calm Seas', canvasW / 2, 44);
  }
}

function drawGameOver(state) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.textAlign = 'center';

  // Title
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('GAME OVER', canvasW / 2, canvasH / 2 - 80);

  // Winner
  ctx.font = 'bold 24px sans-serif';
  if (state.winner === 'tie') {
    ctx.fillStyle = '#ffcc44';
    ctx.fillText("It's a tie!", canvasW / 2, canvasH / 2 - 30);
  } else if (state.winner) {
    const isWinner = state.winner === myPlayerId;
    ctx.fillStyle = isWinner ? '#44ff44' : '#ff6666';
    ctx.fillText(
      isWinner ? 'YOU WIN!' : `Player ${state.winner} wins!`,
      canvasW / 2, canvasH / 2 - 30
    );
  }

  // Scores
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#ccc';
  const p1 = state.players[1];
  const p2 = state.players[2];
  if (p1) ctx.fillText(`P1 Score: ${p1.score} (Best: ${p1.bestScore})`, canvasW / 2, canvasH / 2 + 20);
  if (p2) ctx.fillText(`P2 Score: ${p2.score} (Best: ${p2.bestScore})`, canvasW / 2, canvasH / 2 + 50);

  // Restart prompt
  ctx.fillStyle = '#4a9eff';
  ctx.font = '16px sans-serif';
  ctx.fillText('Press ENTER or tap to restart', canvasW / 2, canvasH / 2 + 100);
}

// --- Resize canvas to fit screen ---
function resizeCanvas() {
  const maxW = window.innerWidth - 20;
  const maxH = window.innerHeight - 20;
  const scale = Math.min(maxW / canvasW, maxH / canvasH, 1.5);
  canvas.style.width = (canvasW * scale) + 'px';
  canvas.style.height = (canvasH * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Start render loop ---
requestAnimationFrame(render);
