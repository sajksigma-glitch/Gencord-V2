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
let username = null;

const channelListEl = document.getElementById('channel-list');
const messagesEl = document.getElementById('messages');
const currentChannelNameEl = document.getElementById('current-channel-name');
const currentUsernameEl = document.getElementById('current-username');
const messageFormEl = document.getElementById('message-form');
const messageInputEl = document.getElementById('message-input');

const usernameModalEl = document.getElementById('username-modal');
const usernameInputEl = document.getElementById('username-input');
const usernameSaveBtn = document.getElementById('username-save');
const privateChannelBtn = document.getElementById('private-channel-btn');
const voiceToggleBtn = document.getElementById('voice-toggle-btn');

// WebRTC – rozmowy głosowe
let isVoiceActive = false;
let localStream = null;
const peers = {};
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function renderChannels(channels) {
  channelListEl.innerHTML = '';
  channels.forEach((channel) => {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.dataset.channelId = channel.id;
    li.innerHTML = `
      <span class="channel-hash">#</span>
      <span>${channel.name}</span>
    `;

    li.addEventListener('click', () => {
      selectChannel(channel.id, channel.name);
    });

    channelListEl.appendChild(li);
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

    if (channels.length > 0) {
      selectChannel(channels[0].id, channels[0].name);
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

function selectChannel(channelId, channelName) {
  if (!username) {
    showUsernameModal();
    return;
  }

  // Przy zmianie kanału rozłącz rozmowę głosową, jeśli trwa
  if (isVoiceActive) {
    stopVoice();
  }

  if (currentChannelId === channelId) return;
  currentChannelId = channelId;

  currentChannelNameEl.textContent = channelName;
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
  if (!username) {
    showUsernameModal();
    return;
  }

  const password = prompt('Podaj hasło do kanału prywatnego:');
  if (!password) return;

  try {
    const res = await fetch('/api/private/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    if (!res.ok) {
      alert('Nieprawidłowe hasło do kanału prywatnego.');
      return;
    }

    const channel = await res.json();

    // Sprawdź, czy już jest w liście kanałów
    let item = document.querySelector(`.channel-item[data-channel-id="${channel.id}"]`);
    if (!item) {
      item = document.createElement('li');
      item.className = 'channel-item';
      item.dataset.channelId = channel.id;
      item.innerHTML = `
        <span class="channel-hash">#</span>
        <span>${channel.name}</span>
      `;
      item.addEventListener('click', () => {
        selectChannel(channel.id, channel.name);
      });
      channelListEl.appendChild(item);
    }

    // Przełącz od razu na kanał prywatny
    selectChannel(channel.id, channel.name);
  } catch (err) {
    console.error('Błąd dołączania do kanału prywatnego:', err);
    alert('Wystąpił błąd przy dołączaniu do kanału prywatnego.');
  }
}

function showUsernameModal() {
  usernameModalEl.style.display = 'flex';
  usernameInputEl.focus();
}

function hideUsernameModal() {
  usernameModalEl.style.display = 'none';
}

function setUsername(newName) {
  username = newName.trim() || null;
  if (username) {
    currentUsernameEl.textContent = username;
    // zapisz nazwę w localStorage, żeby po odświeżeniu nie pytało ponownie
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
      selectChannel(channelId, channelName);
    }
  }
}

usernameSaveBtn.addEventListener('click', () => {
  setUsername(usernameInputEl.value);
});

usernameInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    setUsername(usernameInputEl.value);
  }
});

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
  const storedName = localStorage.getItem('gencord:username');
  if (storedName) {
    username = storedName;
    currentUsernameEl.textContent = username;
    hideUsernameModal();
  } else {
    showUsernameModal();
  }

  loadChannels();
});

usernameInputEl.addEventListener('change', () => {
  const value = usernameInputEl.value.trim();
  if (value) {
    localStorage.setItem('gencord:username', value);
  }
});

if (privateChannelBtn) {
  privateChannelBtn.addEventListener('click', joinPrivateChannel);
}

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', () => {
    if (!isVoiceActive) {
      startVoice();
    } else {
      stopVoice();
    }
  });
}

