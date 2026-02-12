// Jeśli strona jest otwarta jako plik (file://), a nie z serwera,
// backend nie będzie działał – pokaż jasny komunikat.
if (window.location.protocol === 'file:') {
  alert(
    'Aplikacja Gencord musi być uruchomiona przez serwer.\n' +
      '1) W terminalu w folderze Gencord wpisz: npm start\n' +
      '2) Wejdź w przeglądarce na: http://localhost:3000\n\n' +
      'Nie otwieraj pliku index.html przez podwójne kliknięcie.'
  );
}

const socket = io();

let currentChannelId = null;
let currentRoomCode = null;
let username = null;

const channelListEl = document.getElementById('channel-list');
const messagesEl = document.getElementById('messages');
const currentChannelNameEl = document.getElementById('current-channel-name');
const currentUsernameEl = document.getElementById('current-username');
const messageFormEl = document.getElementById('message-form');
const messageInputEl = document.getElementById('message-input');

const usernameModalEl = document.getElementById('username-modal');
const usernameInputEl = document.getElementById('username-input');
const passwordInputEl = document.getElementById('password-input');
const usernameSaveBtn = document.getElementById('username-save');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const voiceToggleBtn = document.getElementById('voice-toggle-btn');
const roomCodeBadgeEl = document.getElementById('room-code-badge');
const deleteChannelBtn = document.getElementById('delete-channel-btn');

// WebRTC – rozmowy głosowe
let isVoiceActive = false;
let localStream = null;
const peers = {};
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function ensureChannelItem(channelId, name, roomCode) {
  let li = document.querySelector(`.channel-item[data-channel-id="${channelId}"]`);
  if (!li) {
    li = document.createElement('li');
    li.className = 'channel-item';
    li.dataset.channelId = channelId;
    channelListEl.appendChild(li);
  }

  li.dataset.roomCode = roomCode || '';
  li.innerHTML = `
      <span class="channel-hash">#</span>
      <span>${name}</span>
    `;

  li.onclick = () => {
    const code = li.dataset.roomCode || null;
    selectChannel(channelId, name, code);
  };

  return li;
}

function renderChannels(channels) {
  channelListEl.innerHTML = '';
  channels.forEach((channel) => {
    ensureChannelItem(channel.id, channel.name, null);
  });
}

function clearMessages() {
  messagesEl.innerHTML = '';
}

function addSystemMessage(text, timestamp = new Date().toISOString()) {
  const div = document.createElement('div');
  div.className = 'system-message';
  const time = new Date(timestamp).toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit'
  });
  div.textContent = `[${time}] ${text}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addUserMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = (msg.username || '?')[0]?.toUpperCase() || '?';

  const body = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'message-header';

  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'username';
  usernameSpan.textContent = msg.username || 'Użytkownik';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'timestamp';
  timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit'
  });

  header.appendChild(usernameSpan);
  header.appendChild(timeSpan);

  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = msg.content;

  body.appendChild(header);
  body.appendChild(content);

  wrapper.appendChild(avatar);
  wrapper.appendChild(body);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadChannels() {
  try {
    const res = await fetch('/api/channels');
    if (!res.ok) {
      console.error('Nie udało się pobrać kanałów, status:', res.status);
      alert(
        'Nie udało się połączyć z serwerem kanałów.\n' +
          'Upewnij się, że w terminalu w folderze Gencord działa komenda: npm start\n' +
          'i że wchodzisz na adres: http://localhost:3000'
      );
      return;
    }
    const channels = await res.json();
    renderChannels(channels);

    // dociągnij również pokoje zapisane na serwerze
    try {
      const roomsRes = await fetch('/api/rooms');
      if (roomsRes.ok) {
        const rooms = await roomsRes.json();
        rooms.forEach((room) => {
          ensureChannelItem(room.channelId, room.name, room.code);
        });
      }
    } catch (e) {
      console.error('Błąd pobierania pokoi:', e);
    }

    if (channels.length > 0) {
      selectChannel(channels[0].id, channels[0].name, null);
    }
  } catch (err) {
    console.error('Błąd pobierania kanałów:', err);
  }
}

async function loadMessages(channelId) {
  clearMessages();
  try {
    const res = await fetch(`/api/channels/${channelId}/messages`);
    if (!res.ok) return;
    const messages = await res.json();

    messages.forEach((msg) => {
      if (msg.type === 'system') {
        addSystemMessage(msg.content, msg.timestamp);
      } else {
        addUserMessage(msg);
      }
    });
  } catch (err) {
    console.error('Błąd pobierania wiadomości:', err);
  }
}

function highlightActiveChannel(channelId) {
  document.querySelectorAll('.channel-item').forEach((item) => {
    if (item.dataset.channelId === channelId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function updateRoomBadge(code) {
  currentRoomCode = code || null;
  if (!roomCodeBadgeEl) return;
  if (currentRoomCode) {
    roomCodeBadgeEl.textContent = `Kod pokoju: ${currentRoomCode}`;
  } else {
    roomCodeBadgeEl.textContent = '';
  }
}

function selectChannel(channelId, channelName, roomCode) {
  if (!username) {
    showUsernameModal();
    return;
  }

  // Przy zmianie kanału rozłącz rozmowę głosową, jeśli trwa
  if (isVoiceActive) {
    stopVoice();
  }

  if (currentChannelId === channelId && currentRoomCode === roomCode) return;
  currentChannelId = channelId;

  currentChannelNameEl.textContent = channelName;
  updateRoomBadge(roomCode);
  highlightActiveChannel(channelId);

  socket.emit('channel:join', { channelId, username });
  loadMessages(channelId);
}

async function startVoice() {
  if (!currentChannelId) {
    alert('Najpierw wybierz kanał tekstowy.');
    return;
  }

  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  } catch (err) {
    console.error('Błąd uzyskiwania mikrofonu:', err);
    alert('Nie udało się uzyskać dostępu do mikrofonu. Sprawdź uprawnienia przeglądarki.');
    return;
  }

  isVoiceActive = true;
  if (voiceToggleBtn) {
    voiceToggleBtn.textContent = 'Rozłącz głos';
    voiceToggleBtn.classList.add('active');
  }

  socket.emit('voice:join', { channelId: currentChannelId });
}

function stopVoice() {
  isVoiceActive = false;

  if (voiceToggleBtn) {
    voiceToggleBtn.textContent = 'Połącz głosowo';
    voiceToggleBtn.classList.remove('active');
  }

  // Zamknij wszystkie połączenia z innymi
  Object.keys(peers).forEach((id) => {
    const entry = peers[id];
    if (entry.pc) {
      try {
        entry.pc.close();
      } catch (_) {}
    }
    if (entry.audio && entry.audio.parentNode) {
      entry.audio.parentNode.removeChild(entry.audio);
    }
    delete peers[id];
  });

  // Zatrzymaj lokalny mikrofon
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  socket.emit('voice:leave');
}

function createPeerConnection(peerId, isInitiator) {
  if (peers[peerId]?.pc) {
    return peers[peerId].pc;
  }

  const pc = new RTCPeerConnection(rtcConfig);

  peers[peerId] = peers[peerId] || { pc: null, audio: null };
  peers[peerId].pc = pc;

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('voice:signal', {
        to: peerId,
        data: { candidate: event.candidate }
      });
    }
  };

  pc.ontrack = (event) => {
    let audioEl = peers[peerId].audio;
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      // nie pokazujemy audio w UI, ale musi być w DOM
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      peers[peerId].audio = audioEl;
    }
    audioEl.srcObject = event.streams[0];
  };

  if (isInitiator) {
    pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('voice:signal', {
          to: peerId,
          data: { sdp: pc.localDescription }
        });
      })
      .catch((err) => console.error('Błąd tworzenia oferty WebRTC:', err));
  }

  return pc;
}

async function joinPrivateChannel() {
  // funkcja nieużywana – zostawiona tylko dla zgodności
}

async function createRoom() {
  if (!username) {
    showUsernameModal();
    return;
  }

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      alert('Nie udało się stworzyć pokoju.');
      return;
    }

    const room = await res.json();

    // dodaj pokój do listy kanałów dla tego klienta
    ensureChannelItem(room.channelId, room.name, room.code);

    // automatycznie wejdź do pokoju
    selectChannel(room.channelId, room.name, room.code);
    alert(`Pokój utworzony. Kod pokoju: ${room.code}`);
  } catch (err) {
    console.error('Błąd tworzenia pokoju:', err);
    alert('Wystąpił błąd przy tworzeniu pokoju.');
  }
}

async function joinRoom() {
  if (!username) {
    showUsernameModal();
    return;
  }

  const code = prompt('Podaj kod pokoju:');
  if (!code) return;

  try {
    const res = await fetch('/api/rooms/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code })
    });

    if (!res.ok) {
      alert('Taki pokój nie istnieje lub kod jest błędny.');
      return;
    }

    const room = await res.json();

    // dodaj pokój do listy kanałów dla tego klienta
    ensureChannelItem(room.channelId, room.name, room.code);

    // automatycznie przełącz na pokój
    selectChannel(room.channelId, room.name, room.code);
  } catch (err) {
    console.error('Błąd dołączania do pokoju:', err);
    alert('Wystąpił błąd przy dołączaniu do pokoju.');
  }
}

function showUsernameModal() {
  usernameModalEl.style.display = 'flex';
  usernameInputEl.focus();
}

function hideUsernameModal() {
  usernameModalEl.style.display = 'none';
}

async function loginOrRegister() {
  const name = usernameInputEl.value.trim();
  const pass = passwordInputEl.value.trim();

  if (!name || !pass) {
    alert('Podaj nazwę użytkownika i hasło.');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: name, password: pass })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Nie udało się zalogować.');
      return;
    }

    const data = await res.json();
    username = data.username;
    currentUsernameEl.textContent = username;
    localStorage.setItem('gencord:username', username);
    hideUsernameModal();

    // jeśli nie ma jeszcze aktywnego kanału, wybierz pierwszy z listy
    let activeChannel = document.querySelector('.channel-item.active');
    if (!activeChannel) {
      activeChannel = document.querySelector('.channel-item');
    }
    if (activeChannel) {
      const channelId = activeChannel.dataset.channelId;
      const nameSpan = activeChannel.querySelector('span:nth-child(2)');
      const channelName = nameSpan
        ? nameSpan.textContent
        : activeChannel.textContent.trim().replace(/^#\s*/, '');
      const code = activeChannel.dataset.roomCode || null;
      selectChannel(channelId, channelName, code);
    }
  } catch (err) {
    console.error('Błąd logowania:', err);
    alert('Wystąpił błąd podczas logowania.');
  }
}

usernameSaveBtn.addEventListener('click', () => {
  loginOrRegister();
});

usernameInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    loginOrRegister();
  }
});

if (passwordInputEl) {
  passwordInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loginOrRegister();
    }
  });
}

messageFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentChannelId || !username) {
    showUsernameModal();
    return;
  }

  const content = messageInputEl.value.trim();
  if (!content) return;

  socket.emit('message:send', {
    channelId: currentChannelId,
    content,
    username
  });

  messageInputEl.value = '';
});

socket.on('message:new', (msg) => {
  if (msg.channelId !== currentChannelId) return;
  addUserMessage(msg);
});

socket.on('system:message', (msg) => {
  addSystemMessage(msg.content, msg.timestamp);
});

// --- Socket.IO: sygnalizacja głosu ---
socket.on('voice:users', async (users) => {
  if (!isVoiceActive || !localStream) return;
  for (const id of users) {
    createPeerConnection(id, true);
  }
});

socket.on('voice:signal', async ({ from, data }) => {
  if (!isVoiceActive) return;

  const pc = createPeerConnection(from, false);

  try {
    if (data.sdp) {
      const desc = new RTCSessionDescription(data.sdp);
      await pc.setRemoteDescription(desc);
      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:signal', {
          to: from,
          data: { sdp: pc.localDescription }
        });
      }
    } else if (data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error('Błąd obsługi sygnału WebRTC:', err);
  }
});

socket.on('voice:user-left', (id) => {
  const entry = peers[id];
  if (!entry) return;
  if (entry.pc) {
    try {
      entry.pc.close();
    } catch (_) {}
  }
  if (entry.audio && entry.audio.parentNode) {
    entry.audio.parentNode.removeChild(entry.audio);
  }
  delete peers[id];
});

window.addEventListener('load', () => {
  // po skasowaniu danych zaczynamy "na czysto" – wymagamy logowania
  showUsernameModal();
  loadChannels();
});

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', () => {
    if (!isVoiceActive) {
      startVoice();
    } else {
      stopVoice();
    }
  });
}

if (createRoomBtn) {
  createRoomBtn.addEventListener('click', createRoom);
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener('click', joinRoom);
}

if (deleteChannelBtn) {
  deleteChannelBtn.addEventListener('click', async () => {
    if (!currentChannelId) return;

    // nie pozwalamy usuwać domyślnych kanałów (bez currentRoomCode)
    if (!currentRoomCode) {
      alert('Tego kanału nie można usunąć. Usuń tylko własny pokój.');
      return;
    }

    const text = prompt('Aby usunąć kanał, wpisz dokładnie: usun');
    if (!text || text.trim().toLowerCase() !== 'usun') {
      alert('Kanał NIE został usunięty.');
      return;
    }

    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(currentChannelId)}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Nie udało się usunąć kanału.');
        return;
      }

      // usuń kanał z listy w UI
      const item = document.querySelector(`.channel-item[data-channel-id="${currentChannelId}"]`);
      if (item && item.parentNode) {
        item.parentNode.removeChild(item);
      }

      // wyczyść widok
      stopVoice();
      clearMessages();
      currentChannelId = null;
      updateRoomBadge(null);
      currentChannelNameEl.textContent = 'Wybierz kanał';
      highlightActiveChannel('');

      alert('Kanał został usunięty.');
    } catch (err) {
      console.error('Błąd usuwania kanału:', err);
      alert('Wystąpił błąd podczas usuwania kanału.');
    }
  });
}

