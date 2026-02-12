const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Serwujemy statyczny frontend z katalogu "public"
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Proste dane w pamięci – publiczne kanały tekstowe
const channels = [
  { id: 'general', name: 'general' },
  { id: 'games', name: 'games' },
  { id: 'music', name: 'music' }
];

// Pokoje tworzone przez użytkowników: code -> { code, channelId, createdAt }
let rooms = {};

// Prości użytkownicy: key (lowercase nazwy) -> { username, passwordHash, createdAt }
let users = {};

// Mapowanie: channelId -> lista wiadomości
let messagesByChannel = {
  general: [],
  games: [],
  music: []
};

// Prosta "pamięć trwała" w pliku (lokalnie). Na darmowym Renderze
// może być czyszczona przy redeployu, ale na Twoim komputerze
// wiadomości i pokoje zostaną zachowane między restartami.
const DATA_PATH = path.join(__dirname, 'data.json');

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function loadState() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = fs.readFileSync(DATA_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.messagesByChannel && typeof parsed.messagesByChannel === 'object') {
        messagesByChannel = { ...messagesByChannel, ...parsed.messagesByChannel };
      }
      if (parsed.rooms && typeof parsed.rooms === 'object') {
        rooms = parsed.rooms;
      }
      if (parsed.users && typeof parsed.users === 'object') {
        users = parsed.users;
      }
    }
  } catch (err) {
    console.error('Nie udało się wczytać stanu z pliku:', err);
  }
}

function saveState() {
  try {
    const payload = JSON.stringify(
      {
        messagesByChannel,
        rooms,
        users
      },
      null,
      2
    );
    fs.writeFileSync(DATA_PATH, payload, 'utf8');
  } catch (err) {
    console.error('Nie udało się zapisać stanu do pliku:', err);
  }
}

loadState();

// Prosty endpoint resetu (opcjonalny, teraz użyty przez Ciebie raz – przez usunięcie pliku)
// app.post('/api/admin/reset', (req, res) => { ... })

// REST API – lista kanałów
app.get('/api/channels', (req, res) => {
  res.json(channels);
});

// REST API – rejestracja / logowanie użytkownika (proste, bez tokenów)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const name = String(username || '').trim();
  const pass = String(password || '').trim();

  if (!name || !pass) {
    return res.status(400).json({ error: 'Nazwa użytkownika i hasło są wymagane.' });
  }

  const key = name.toLowerCase();
  const passHash = hashPassword(pass);

  const existing = users[key];
  if (!existing) {
    // tworzymy nowe konto
    users[key] = {
      username: name,
      passwordHash: passHash,
      createdAt: new Date().toISOString()
    };
    saveState();
    return res.json({ username: name, created: true });
  }

  if (existing.passwordHash !== passHash) {
    return res.status(401).json({ error: 'Nieprawidłowe hasło.' });
  }

  return res.json({ username: existing.username, created: false });
});

// REST API – lista pokoi (do odtworzenia listy po odświeżeniu)
app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms).map((room) => ({
    code: room.code,
    channelId: room.channelId,
    name: `Pokój ${room.code}`
  }));
  res.json(list);
});

// REST API – usunięcie kanału/pokoju (tylko dynamiczne pokoje)
app.delete('/api/channels/:id', (req, res) => {
  const { id } = req.params;

  // Nie pozwalamy usuwać domyślnych kanałów
  const isDefault = channels.some((c) => c.id === id);
  if (isDefault) {
    return res.status(400).json({ error: 'Nie można usunąć domyślnego kanału.' });
  }

  // Znajdź pokój po channelId
  const roomEntry = Object.entries(rooms).find(([, room]) => room.channelId === id);
  if (roomEntry) {
    const [code] = roomEntry;
    delete rooms[code];
  }

  if (messagesByChannel[id]) {
    delete messagesByChannel[id];
  }

  saveState();

  res.json({ ok: true });
});

// REST API – tworzenie pokoju (zwraca kod i id kanału)
app.post('/api/rooms', (req, res) => {
  // prosty 6‑znakowy kod
  let code;
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms[code]);

  const channelId = `room-${code}`;
  rooms[code] = {
    code,
    channelId,
    createdAt: new Date().toISOString()
  };

  if (!messagesByChannel[channelId]) {
    messagesByChannel[channelId] = [];
  }

  saveState();

  res.json({
    code,
    channelId,
    name: `Pokój ${code}`
  });
});

// REST API – dołączenie do istniejącego pokoju po kodzie
app.post('/api/rooms/join', (req, res) => {
  const { code } = req.body || {};
  const normalized = String(code || '').trim().toUpperCase();

  const room = rooms[normalized];
  if (!room) {
    return res.status(404).json({ error: 'Taki pokój nie istnieje' });
  }

  if (!messagesByChannel[room.channelId]) {
    messagesByChannel[room.channelId] = [];
  }

  res.json({
    code: room.code,
    channelId: room.channelId,
    name: `Pokój ${room.code}`
  });
});

// REST API – wiadomości z kanału
app.get('/api/channels/:id/messages', (req, res) => {
  const { id } = req.params;
  if (!messagesByChannel[id]) {
    return res.status(404).json({ error: 'Kanał nie istnieje' });
  }
  res.json(messagesByChannel[id]);
});

io.on('connection', (socket) => {
  console.log('Użytkownik połączony:', socket.id);

  // Dołączenie do kanału
  socket.on('channel:join', ({ channelId, username }) => {
    if (!messagesByChannel[channelId]) return;
    socket.join(channelId);
    socket.data.username = username;
    socket.data.channelId = channelId;

    console.log(`${username} dołączył do kanału ${channelId}`);

    // Powiadom innych w kanale
    socket.to(channelId).emit('system:message', {
      id: Date.now().toString(),
      type: 'system',
      content: `${username} dołączył do kanału`,
      timestamp: new Date().toISOString()
    });
  });

  // Odbieranie wiadomości tekstowej z frontendu
  socket.on('message:send', ({ channelId, content, username }) => {
    if (!messagesByChannel[channelId] || !content?.trim()) return;

    const message = {
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      type: 'user',
      channelId,
      username: username || socket.data.username || 'Anon',
      content: content.trim(),
      timestamp: new Date().toISOString()
    };

    messagesByChannel[channelId].push(message);

    // Trzymamy tylko ostatnie 100 wiadomości na kanał
    if (messagesByChannel[channelId].length > 100) {
      messagesByChannel[channelId].shift();
    }

    saveState();

    io.to(channelId).emit('message:new', message);
  });

  // --- Rozmowy głosowe (WebRTC + Socket.IO jako sygnalizacja) ---
  socket.on('voice:join', ({ channelId }) => {
    if (!channelId || !messagesByChannel[channelId]) return;

    const voiceRoom = `voice:${channelId}`;
    socket.join(voiceRoom);
    socket.data.voiceRoom = voiceRoom;

    const clientsInRoom = Array.from(io.sockets.adapter.rooms.get(voiceRoom) || []);
    const otherClients = clientsInRoom.filter((id) => id !== socket.id);

    // Nowy użytkownik dostaje listę tych, którzy już są w kanale głosowym
    socket.emit('voice:users', otherClients);
  });

  socket.on('voice:signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('voice:signal', {
      from: socket.id,
      data
    });
  });

  socket.on('voice:leave', () => {
    const voiceRoom = socket.data.voiceRoom;
    if (voiceRoom) {
      socket.leave(voiceRoom);
      socket.to(voiceRoom).emit('voice:user-left', socket.id);
      socket.data.voiceRoom = null;
    }
  });

  socket.on('disconnect', () => {
    const username = socket.data.username;
    const channelId = socket.data.channelId;
    if (username && channelId && messagesByChannel[channelId]) {
      socket.to(channelId).emit('system:message', {
        id: Date.now().toString(),
        type: 'system',
        content: `${username} opuścił kanał`,
        timestamp: new Date().toISOString()
      });
    }

    // Jeśli był w kanale głosowym – powiadom innych
    const voiceRoom = socket.data.voiceRoom;
    if (voiceRoom) {
      socket.to(voiceRoom).emit('voice:user-left', socket.id);
    }

    console.log('Użytkownik rozłączony:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Gencord działa na http://localhost:${PORT}`);
});

