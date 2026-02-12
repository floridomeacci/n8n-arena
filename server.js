const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── State ──────────────────────────────────────────────────────────────────
let currentTask = 1;
let participants = {}; // { id: { name, completedTasks: Set, secretKey, postCount } }
let sseClients = [];

// Admin credentials for basic auth tasks
const ADMIN_USER = 'n8n';
const ADMIN_PASS = 'rocks';

// ─── SSE Stream ─────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
  // Send current state immediately
  sendState(res);
});

function broadcast() {
  sseClients.forEach((c) => sendState(c));
}

function sendState(client) {
  const data = {
    currentTask,
    participants: Object.entries(participants).map(([id, p]) => ({
      id,
      name: p.name,
      completedTasks: [...p.completedTasks],
      postCount: p.postCount || 0,
    })),
    taskDescriptions: TASKS,
  };
  client.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Task descriptions ─────────────────────────────────────────────────────
const TASKS = [
  {
    id: 1,
    title: 'Hello World',
    subtitle: 'Make a GET request',
    description: 'Make a <strong>GET</strong> request to your endpoint.',
    hint: 'GET /api/player/{your-id}/task1',
    icon: '🌐',
  },
  {
    id: 2,
    title: 'Authenticated',
    subtitle: 'GET with Basic Auth',
    description:
      'Make a <strong>GET</strong> request with <strong>Basic Auth</strong>.',
    hint: `GET /api/player/{your-id}/task2<br>Username: <code>${ADMIN_USER}</code> &nbsp; Password: <code>${ADMIN_PASS}</code>`,
    icon: '🔐',
  },
  {
    id: 3,
    title: 'Say Something',
    subtitle: 'Authenticated POST with message',
    description:
      'Make an authenticated <strong>POST</strong> request with a JSON body containing a <code>message</code> field.',
    hint: `POST /api/player/{your-id}/task3<br>Basic Auth + Body: <code>{ "message": "your text" }</code>`,
    icon: '💬',
  },
  {
    id: 4,
    title: 'Speed Round',
    subtitle: 'First to 4 POST requests',
    description:
      'First player to make <strong>4 POST requests</strong> wins! Progress is tracked live.',
    hint: 'POST /api/player/{your-id}/task4<br>Any body works. First to 4 wins!',
    icon: '⚡',
  },
  {
    id: 5,
    title: 'Secret Key',
    subtitle: 'GET a key, then POST it back',
    description:
      'First <strong>GET</strong> a secret key, then <strong>POST</strong> it back.',
    hint: 'GET /api/player/{your-id}/task5/key → receive a key<br>POST /api/player/{your-id}/task5 with <code>{ "key": "..." }</code>',
    icon: '🗝️',
  },
  {
    id: 6,
    title: 'Picture Time',
    subtitle: 'Send a base64 image',
    description:
      'Send a <strong>POST</strong> request with a <strong>base64-encoded image</strong>.',
    hint: 'POST /api/player/{your-id}/task6<br>Body: <code>{ "image": "data:image/png;base64,..." }</code>',
    icon: '🖼️',
  },
];

// ─── Helper: check basic auth ──────────────────────────────────────────────
function checkBasicAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

// ─── Helper: get or verify player ──────────────────────────────────────────
function getPlayer(req, res) {
  const { id } = req.params;
  if (!participants[id]) {
    return res.status(404).json({ error: 'Player not registered. Register first via POST /api/register' });
  }
  return participants[id];
}

// ─── Admin: Register player ────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20) + '-' + crypto.randomBytes(2).toString('hex');
  participants[id] = {
    name,
    completedTasks: new Set(),
    secretKey: null,
    postCount: 0,
  };
  broadcast();
  res.json({ id, name, message: `Welcome ${name}! Your player ID is: ${id}` });
});

// ─── Admin: Set current task ────────────────────────────────────────────────
app.post('/api/admin/task', (req, res) => {
  const { task } = req.body;
  if (!task || task < 1 || task > 6) return res.status(400).json({ error: 'Task must be 1-6' });
  currentTask = task;
  // Reset task-specific state
  Object.values(participants).forEach((p) => {
    if (task === 4) p.postCount = 0;
    if (task === 5) p.secretKey = null;
  });
  broadcast();
  res.json({ currentTask: task });
});

// ─── Admin: Reset everything ────────────────────────────────────────────────
app.post('/api/admin/reset', (req, res) => {
  Object.values(participants).forEach((p) => {
    p.completedTasks = new Set();
    p.postCount = 0;
    p.secretKey = null;
  });
  currentTask = 1;
  broadcast();
  res.json({ message: 'All progress reset' });
});

// ─── Admin: Remove player ───────────────────────────────────────────────────
app.delete('/api/admin/player/:id', (req, res) => {
  const { id } = req.params;
  if (!participants[id]) return res.status(404).json({ error: 'Player not found' });
  delete participants[id];
  broadcast();
  res.json({ message: 'Player removed' });
});

// ─── Task 1: Simple GET ─────────────────────────────────────────────────────
app.get('/api/player/:id/task1', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 1) return res.status(403).json({ error: 'This task is not active right now' });

  player.completedTasks.add(1);
  broadcast();
  res.json({ success: true, message: '🎉 Task 1 complete! You made your first GET request!' });
});

// ─── Task 2: GET with Basic Auth ────────────────────────────────────────────
app.get('/api/player/:id/task2', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 2) return res.status(403).json({ error: 'This task is not active right now' });

  if (!checkBasicAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized. Use Basic Auth with the correct credentials.' });
  }
  player.completedTasks.add(2);
  broadcast();
  res.json({ success: true, message: '🔐 Task 2 complete! You mastered Basic Auth!' });
});

// ─── Task 3: Authenticated POST with message ───────────────────────────────
app.post('/api/player/:id/task3', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 3) return res.status(403).json({ error: 'This task is not active right now' });

  if (!checkBasicAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized. Use Basic Auth.' });
  }
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Include a "message" field in your JSON body.' });
  }
  player.completedTasks.add(3);
  broadcast();
  res.json({ success: true, message: `💬 Task 3 complete! You said: "${message}"` });
});

// ─── Task 4: First to 4 POSTs ──────────────────────────────────────────────
app.post('/api/player/:id/task4', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 4) return res.status(403).json({ error: 'This task is not active right now' });

  if (player.completedTasks.has(4)) {
    return res.json({ success: true, message: 'You already completed this task!', postCount: player.postCount });
  }

  player.postCount = (player.postCount || 0) + 1;

  if (player.postCount >= 4) {
    player.completedTasks.add(4);
    broadcast();
    return res.json({ success: true, message: `⚡ Task 4 complete! You sent ${player.postCount} requests!`, postCount: player.postCount });
  }

  broadcast();
  res.json({ success: false, message: `POST ${player.postCount}/4 received. Keep going!`, postCount: player.postCount });
});

// ─── Task 5: GET key then POST it back ──────────────────────────────────────
app.get('/api/player/:id/task5/key', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 5) return res.status(403).json({ error: 'This task is not active right now' });

  player.secretKey = crypto.randomBytes(16).toString('hex');
  broadcast();
  res.json({ key: player.secretKey, message: 'Now POST this key back to /api/player/{your-id}/task5' });
});

app.post('/api/player/:id/task5', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 5) return res.status(403).json({ error: 'This task is not active right now' });

  if (!player.secretKey) {
    return res.status(400).json({ error: 'You need to GET your secret key first at /api/player/{id}/task5/key' });
  }

  const { key } = req.body;
  if (key !== player.secretKey) {
    return res.status(400).json({ error: 'Wrong key! Make sure you use the exact key you received.' });
  }

  player.completedTasks.add(5);
  broadcast();
  res.json({ success: true, message: '🗝️ Task 5 complete! You chained GET → POST perfectly!' });
});

// ─── Task 6: Base64 image ───────────────────────────────────────────────────
app.post('/api/player/:id/task6', (req, res) => {
  const player = getPlayer(req, res);
  if (!player) return;
  if (currentTask !== 6) return res.status(403).json({ error: 'This task is not active right now' });

  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Include an "image" field with a base64 string.' });
  }

  // Accept data URI or raw base64
  const isDataUri = image.startsWith('data:image/');
  const isRawBase64 = /^[A-Za-z0-9+/=]{50,}$/.test(image.replace(/\s/g, ''));

  if (!isDataUri && !isRawBase64) {
    return res.status(400).json({ error: 'Invalid image. Send a data URI (data:image/png;base64,...) or raw base64 string.' });
  }

  player.completedTasks.add(6);
  broadcast();
  res.json({ success: true, message: '🖼️ Task 6 complete! Image received! You are an N8N master!' });
});

// ─── Polling endpoint (Vercel fallback) ─────────────────────────────────────
app.get('/api/state', (req, res) => {
  const data = {
    currentTask,
    participants: Object.entries(participants).map(([id, p]) => ({
      id,
      name: p.name,
      completedTasks: [...p.completedTasks],
      postCount: p.postCount || 0,
    })),
    taskDescriptions: TASKS,
  };
  res.json(data);
});

// ─── Fallback ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────────────────
// ─── Start (skip when imported by Vercel) ───────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🚀 N8N Competition Server running on http://localhost:${PORT}`);
    console.log(`📺 Dashboard: http://localhost:${PORT}`);
    console.log(`📋 Register players: POST http://localhost:${PORT}/api/register { "name": "Player Name" }\n`);
  });
}

module.exports = app;
