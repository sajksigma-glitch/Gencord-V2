const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

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

// Proste dane w pamięci (bez bazy danych)
const channels = [
  { id: 'general', name: 'general' },
  { id: 'games', name: 'games' },
  { id: 'music', name: 'music' }
];

// Jeden kanał prywatny, NIE pokazujemy go na liście /api/channels
const PRIVATE_CHANNEL = { id: 'private-999', name: 'sekretny' };
const PRIVATE_PASSWORD = '99900';

// Mapowanie: channelId -> lista wiadomości
const messagesByChannel = {
  general: [],
  games: [],
  music: [],
  [PRIVATE_CHANNEL.id]: []
};

// REST API – lista kanałów
app.get('/api/channels', (req, res) => {
  res.json(channels);
});

// REST API – dołączenie do kanału prywatnego po haśle
app.post('/api/private/join', (req, res) => {
  const { password } = req.body || {};
  const normalized = String(password ?? '').trim();

  if (normalized !== PRIVATE_PASSWORD) {
    return res.status(403).json({ error: 'Nieprawidłowe hasło' });
  }

  // Zwracamy minimum informacji o kanale, dopiero po poprawnym haśle
  res.json({
    id: PRIVATE_CHANNEL.id,
    name: PRIVATE_CHANNEL.name
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

