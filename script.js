// Simple Whiteboard 

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBGT-N0W939RgfgE2nrSNlDAuQ4cWWxzy0",
  authDomain: "whiteboard-ad25d.firebaseapp.com",
  projectId: "whiteboard-ad25d",
  storageBucket: "whiteboard-ad25d.firebasestorage.app",
  messagingSenderId: "406925749146",
  appId: "1:406925749146:web:53600f8ea08e2685df6823"
};

// ------------------------------------------------------
// DOM references
// ------------------------------------------------------
const board = document.getElementById('board');
const boardContainer = document.getElementById('board-container');
const connectionsLayer = document.getElementById('connections-layer');
const drawLayer = document.getElementById('draw-layer');

// Toolbar buttons
const addNoteBtn = document.getElementById('add-note-btn');
const imageUpload = document.getElementById('image-upload');
const addVoiceBtn = document.getElementById('add-voice-btn');

const saveBoardBtn = document.getElementById('save-board-btn');
const loadBoardBtn = document.getElementById('load-board-btn');
const boardFileInput = document.getElementById('board-file-input');

const clearBoardBtn = document.getElementById('clear-board-btn');
const zoomIndicator = document.getElementById('zoom-indicator');

// Settings
const darkModeToggle = document.getElementById('dark-mode-toggle');
const gridToggle = document.getElementById('grid-toggle');
const resetZoomBtn = document.getElementById('reset-zoom-btn');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsPanel = document.getElementById('settings-panel');
const coordsIndicator = document.getElementById('coords-indicator');

const showCursorsToggle = document.getElementById('show-cursors-toggle');
const showUsernamesToggle = document.getElementById('show-usernames-toggle');
const userCursorColorInput = document.getElementById('user-cursor-color');
const changeNameBtn = document.getElementById('change-name-btn');
const currentUsernameEl = document.getElementById('current-username');
const cursorsLayer = document.getElementById('cursors-layer');

// Drawing tools
const drawModeBtn = document.getElementById('draw-mode-btn');
const drawControls = document.getElementById('draw-controls');
const drawColorInput = document.getElementById('draw-color');
const drawWidthInput = document.getElementById('draw-width');

const eraseModeBtn = document.getElementById('erase-mode-btn');
const eraseControls = document.getElementById('erase-controls');
const eraseWidthInput = document.getElementById('erase-width');

// Collaboration UI
const shareLinkEl = document.getElementById('share-link');
const copyLinkBtn = document.getElementById('copy-link-btn');

// ------------------------------------------------------
// State
// ------------------------------------------------------
let dragTarget = null;
let offsetX = 0;
let offsetY = 0;

let scale = 1;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

const STORAGE_BOARD_KEY = 'simple_whiteboard_v16_board';
const STORAGE_SETTINGS_KEY = 'simple_whiteboard_v16_settings';

let nextItemId = 1;
let connections = []; // { fromId, toId }

// connection via context menu
let pendingConnectionFromId = null;

// draw states
let drawModeActive = false;
let eraseModeActive = false;
let isDrawing = false;
let drawColor = '#ffffff';
let drawWidth = 3;
let eraseWidth = 20;

const drawCtx = drawLayer.getContext('2d');

// Context menu for items
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
document.body.appendChild(contextMenu);
let contextMenuItemId = null;

// Collaboration internals
let collab = {
  enabled: false,
  db: null,
  boardDocRef: null,
  boardId: null,
  lastLocalUpdate: 0,
  isApplyingRemote: false,
  // live cursors / presence
  presenceRef: null,
  otherUsers: {},
  userId: null,
  userName: null,
  userColor: null,
  lastPresenceWrite: 0
};

// User identity (per board) for presence + settings
let userIdentity = null;
const PRESENCE_THROTTLE_MS = 80;
const PRESENCE_STALE_MS = 30000;

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
function generateItemId() {
  return 'item-' + nextItemId++;
}

function refreshNextItemId() {
  let max = 0;
  const children = board.children;

  for (let el of children) {
    if (!el.dataset) continue;
    const id = el.dataset.itemId;
    if (!id) continue;

    const num = parseInt(id.replace('item-', ''), 10);
    if (!isNaN(num) && num > max) max = num;
  }

  nextItemId = max + 1;
}

function getOrCreateBoardId() {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  let id = params.get('board');

  if (!id) {
    id = Math.random().toString(36).slice(2, 8); // short id
    params.set('board', id);
    url.search = params.toString();
    window.history.replaceState({}, '', url.toString());
  }

  return id;
}

function updateShareLink(boardId) {
  const url = new URL(window.location.href);
  url.searchParams.set('board', boardId);
  const link = url.toString();
  if (shareLinkEl) {
    shareLinkEl.textContent = link;
  }
}

// Resize draw canvas but preserve drawing (best-effort)
function resizeDrawLayer() {
  const oldWidth = drawLayer.width;
  const oldHeight = drawLayer.height;
  let oldData = null;

  if (oldWidth && oldHeight) {
    try {
      oldData = drawCtx.getImageData(0, 0, oldWidth, oldHeight);
    } catch (e) {
      oldData = null;
    }
  }

  drawLayer.width = board.offsetWidth;
  drawLayer.height = board.offsetHeight;

  if (oldData) {
    drawCtx.putImageData(oldData, 0, 0);
  }
}

window.addEventListener('resize', resizeDrawLayer);

// ------------------------------------------------------
// Items: notes, images, voice notes
// ------------------------------------------------------

// New note
addNoteBtn.addEventListener('click', () => {
  const note = createNote({
    id: generateItemId(),
    x: 120,
    y: 140,
    title: '',
    text: '',
    color: 'yellow',
    width: 220,
    height: 160
  });

  board.appendChild(note);
  refreshConnections();
  autoSaveToLocalStorage();
});

// New voice note
if (addVoiceBtn) {
  addVoiceBtn.addEventListener('click', () => {
    const voiceItem = createVoiceItem({
      id: generateItemId(),
      x: 200,
      y: 200,
      width: 230,
      height: 110,
      audioData: null
    });

    board.appendChild(voiceItem);
    refreshConnections();
    autoSaveToLocalStorage();
  });
}

// Image upload
imageUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const imgWrapper = createImageItem({
      id: generateItemId(),
      x: 150,
      y: 150,
      src: e.target.result,
      width: 260,
      height: null
    });

    board.appendChild(imgWrapper);
    refreshConnections();
    autoSaveToLocalStorage();
    imageUpload.value = '';
  };

  reader.readAsDataURL(file);
});

// ------------------------------------------------------
// Drag & resize
// ------------------------------------------------------
function makeDraggable(element, handle) {
  const dragHandle = handle || element;

  dragHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    if (
      e.target.tagName === 'TEXTAREA' ||
      e.target.tagName === 'INPUT'
    ) {
      return;
    }

    if (dragHandle === element) {
      const style = window.getComputedStyle(element);
      const canResize = style.resize !== 'none';

      if (canResize) {
        const rect = element.getBoundingClientRect();
        const edgeSize = 18;

        const offsetXFromLeft = e.clientX - rect.left;
        const offsetYFromTop = e.clientY - rect.top;

        const inResizeCorner =
          offsetXFromLeft > rect.width - edgeSize &&
          offsetYFromTop > rect.height - edgeSize;

        if (inResizeCorner) {
          return;
        }
      }
    }

    dragTarget = element;

    const rect = element.getBoundingClientRect();
    offsetX = (e.clientX - rect.left) / scale;
    offsetY = (e.clientY - rect.top) / scale;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    e.preventDefault();
  });
}

function onMouseMove(e) {
  if (!dragTarget) return;

  const boardRect = board.getBoundingClientRect();
  let x = (e.clientX - boardRect.left) / scale - offsetX;
  let y = (e.clientY - boardRect.top) / scale - offsetY;

  dragTarget.style.left = x + 'px';
  dragTarget.style.top = y + 'px';

  if (connections.length > 0) {
    refreshConnections();
  }
}

function onMouseUp() {
  if (dragTarget) {
    autoSaveToLocalStorage();
  }
  dragTarget = null;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

// Shared handlers (context menu, connections)
function attachCommonItemHandlers(el) {
  const id = el.dataset.itemId;

  // Right-click -> context menu
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, id);
  });

  // Click to finish a connection (choose target)
  el.addEventListener('click', (e) => {
    if (!pendingConnectionFromId) return;

    if (
      e.target.tagName === 'TEXTAREA' ||
      e.target.tagName === 'INPUT'
    ) {
      return;
    }

    e.stopPropagation();

    const targetId = id;
    if (targetId && targetId !== pendingConnectionFromId) {
      connections.push({
        fromId: pendingConnectionFromId,
        toId: targetId
      });

      pendingConnectionFromId = null;
      clearConnectionSourceHighlight();
      refreshConnections();
      autoSaveToLocalStorage();
      closeContextMenu();
    }
  });

  // whenever text changes == autosave (but not too crazy heavy)
  el.addEventListener('input', () => {
    autoSaveToLocalStorage();
  });
}

// ------------------------------------------------------
// Notes
// ------------------------------------------------------
function createNote({ id, x, y, title, text, color, width, height }) {
  const note = document.createElement('div');
  note.className = 'note';
  note.style.left = x + 'px';
  note.style.top = y + 'px';
  if (width) note.style.width = width + 'px';
  if (height) note.style.height = height + 'px';
  note.dataset.itemId = id || generateItemId();
  note.dataset.color = color || 'yellow';

  const header = document.createElement('div');
  header.className = 'note-header';

  const colorPicker = document.createElement('div');
  colorPicker.className = 'note-color-picker';

  const colors = ['yellow', 'blue', 'green', 'pink'];
  colors.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'note-color-dot';
    btn.dataset.color = c;

    if (c === note.dataset.color) {
      btn.classList.add('active');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setNoteColor(note, c);
      autoSaveToLocalStorage();
    });

    colorPicker.appendChild(btn);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'note-delete-btn';
  deleteBtn.innerText = '✕';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const noteId = note.dataset.itemId;
    connections = connections.filter(
      (c) => c.fromId !== noteId && c.toId !== noteId
    );
    note.remove();
    refreshConnections();
    autoSaveToLocalStorage();
  });

  header.appendChild(colorPicker);
  header.appendChild(deleteBtn);

  const titleInput = document.createElement('input');
  titleInput.className = 'note-title';
  titleInput.placeholder = 'Title...';
  titleInput.value = title || '';

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Write your idea here...';
  textarea.value = text || '';

  note.appendChild(header);
  note.appendChild(titleInput);
  note.appendChild(textarea);

  makeDraggable(note, header);
  attachCommonItemHandlers(note);
  setNoteColor(note, note.dataset.color);

  const resizeObserver = new ResizeObserver(() => {
    refreshConnections();
  });
  resizeObserver.observe(note);

  return note;
}

function setNoteColor(note, color) {
  note.dataset.color = color;

  const dots = note.querySelectorAll('.note-color-dot');
  dots.forEach((dot) => {
    dot.classList.toggle('active', dot.dataset.color === color);
  });
}

// ------------------------------------------------------
// Images
// ------------------------------------------------------
function createImageItem({ id, x, y, src, width, height }) {
  const imgWrapper = document.createElement('div');
  imgWrapper.className = 'image-item';
  imgWrapper.style.left = x + 'px';
  imgWrapper.style.top = y + 'px';
  if (width) imgWrapper.style.width = width + 'px';
  if (height) imgWrapper.style.height = height + 'px';
  imgWrapper.dataset.itemId = id || generateItemId();

  const img = document.createElement('img');
  img.src = src;
  imgWrapper.appendChild(img);

  if (!height) {
    img.addEventListener('load', () => {
      const naturalWidth = img.naturalWidth || 1;
      const naturalHeight = img.naturalHeight || 1;
      const aspect = naturalHeight / naturalWidth;

      const currentWidth = imgWrapper.offsetWidth || width || 260;
      const computedHeight = currentWidth * aspect;

      imgWrapper.style.height = `${computedHeight}px`;
      refreshConnections();
      autoSaveToLocalStorage();
    });
  }

  makeDraggable(imgWrapper);
  attachCommonItemHandlers(imgWrapper);

  const resizeObserver = new ResizeObserver(() => {
    refreshConnections();
  });
  resizeObserver.observe(imgWrapper);

  return imgWrapper;
}

// ------------------------------------------------------
// Voice notes
// ------------------------------------------------------
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function createVoiceItem({ id, x, y, width, height, audioData }) {
  const voice = document.createElement('div');
  voice.className = 'voice-item';
  voice.style.left = x + 'px';
  voice.style.top = y + 'px';
  if (width) voice.style.width = width + 'px';
  if (height) voice.style.height = height + 'px';
  voice.dataset.itemId = id || generateItemId();

  if (audioData) {
    voice.dataset.audioData = audioData;
  }

  const header = document.createElement('div');
  header.className = 'voice-header';

  const icon = document.createElement('span');
  icon.className = 'voice-icon';
  icon.textContent = 'VOICE NOTE';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'voice-delete-btn';
  deleteBtn.innerText = '✕';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const vid = voice.dataset.itemId;
    connections = connections.filter(
      (c) => c.fromId !== vid && c.toId !== vid
    );
    voice.remove();
    refreshConnections();
    autoSaveToLocalStorage();
  });

  header.appendChild(icon);
  header.appendChild(deleteBtn);

  const controls = document.createElement('div');
  controls.className = 'voice-controls';

  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'voice-buttons';

  const recordBtn = document.createElement('button');
  recordBtn.className = 'voice-record-btn';
  recordBtn.textContent = 'Record';

  const playBtn = document.createElement('button');
  playBtn.className = 'voice-play-btn';
  playBtn.textContent = '▶ Play';
  playBtn.disabled = !audioData;

  const status = document.createElement('span');
  status.className = 'voice-status';
  status.textContent = audioData ? 'Saved recording' : 'Ready';

  buttonsRow.appendChild(recordBtn);
  buttonsRow.appendChild(playBtn);
  buttonsRow.appendChild(status);

  const progressRow = document.createElement('div');
  progressRow.className = 'voice-progress-row';

  const progress = document.createElement('input');
  progress.type = 'range';
  progress.className = 'voice-progress';
  progress.min = 0;
  progress.max = 100;
  progress.value = 0;

  const timeLabel = document.createElement('span');
  timeLabel.className = 'voice-time';
  timeLabel.textContent = '00:00 / 00:00';

  progressRow.appendChild(progress);
  progressRow.appendChild(timeLabel);

  controls.appendChild(buttonsRow);
  controls.appendChild(progressRow);

  voice.appendChild(header);
  voice.appendChild(controls);

  makeDraggable(voice, header);
  attachCommonItemHandlers(voice);

  let mediaRecorder = null;
  let chunks = [];
  let currentAudioData = audioData || null;
  let audioEl = null;
  let isPlaying = false;
  let isSeeking = false;

  function ensureAudioEl() {
    if (!currentAudioData) return null;
    if (audioEl) return audioEl;

    audioEl = new Audio(currentAudioData);

    audioEl.addEventListener('loadedmetadata', () => {
      timeLabel.textContent = `00:00 / ${formatTime(audioEl.duration)}`;
    });

    audioEl.addEventListener('timeupdate', () => {
      if (!audioEl || isSeeking) return;

      const ratio = audioEl.currentTime / audioEl.duration;
      progress.value = isFinite(ratio) ? Math.round(ratio * 100) : 0;

      timeLabel.textContent =
        `${formatTime(audioEl.currentTime)} / ` +
        `${formatTime(audioEl.duration)}`;
    });

    audioEl.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.textContent = '▶ Play';
      progress.value = 0;
      timeLabel.textContent = `00:00 / ${formatTime(audioEl.duration)}`;
      status.textContent = 'Finished';
    });

    return audioEl;
  }

  recordBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      recordBtn.textContent = 'Record';
      status.textContent = 'Processing recording...';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();

        reader.onloadend = () => {
          currentAudioData = reader.result;
          voice.dataset.audioData = currentAudioData;
          playBtn.disabled = false;
          status.textContent = 'Saved recording';

          audioEl = null;
          isPlaying = false;
          progress.value = 0;
          timeLabel.textContent = '00:00 / 00:00';
          autoSaveToLocalStorage();
        };

        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      recordBtn.textContent = 'Stop';
      status.textContent = 'Recording...';
    } catch (err) {
      console.error('Recording error', err);
      status.textContent = 'Microphone not available';
    }
  });

  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (!currentAudioData && voice.dataset.audioData) {
      currentAudioData = voice.dataset.audioData;
    }
    if (!currentAudioData) return;

    const audio = ensureAudioEl();
    if (!audio) return;

    if (audio.paused) {
      audio
        .play()
        .then(() => {
          isPlaying = true;
          playBtn.textContent = '⏸ Pause';
          status.textContent = 'Playing...';
        })
        .catch((err) => {
          console.error(err);
          status.textContent = 'Playback error';
        });
    } else {
      audio.pause();
      isPlaying = false;
      playBtn.textContent = '▶ Play';
      status.textContent = 'Paused';
    }
  });

  progress.addEventListener('input', () => {
    if (!audioEl || !isFinite(audioEl.duration)) return;
    isSeeking = true;

    const ratio = progress.value / 100;
    audioEl.currentTime = ratio * audioEl.duration;

    timeLabel.textContent =
      `${formatTime(audioEl.currentTime)} / ` +
      `${formatTime(audioEl.duration)}`;
  });

  progress.addEventListener('change', () => {
    isSeeking = false;
  });

  if (currentAudioData) {
    const tmpAudio = new Audio(currentAudioData);
    tmpAudio.addEventListener('loadedmetadata', () => {
      timeLabel.textContent = `00:00 / ${formatTime(tmpAudio.duration)}`;
    });
  }

  return voice;
}

// ------------------------------------------------------
// Context menu for connections
// ------------------------------------------------------
function clearConnectionSourceHighlight() {
  const els = board.querySelectorAll('.connection-source');
  els.forEach((el) => el.classList.remove('connection-source'));
}

function openContextMenu(x, y, itemId) {
  contextMenu.innerHTML = '';
  contextMenuItemId = itemId;

  const fromEl = board.querySelector(`[data-item-id="${itemId}"]`);

  const btnStart = document.createElement('button');
  btnStart.textContent =
    pendingConnectionFromId && pendingConnectionFromId !== itemId
      ? 'Use as connection target'
      : 'Start connection from here';

  btnStart.addEventListener('click', () => {
    if (!pendingConnectionFromId) {
      pendingConnectionFromId = itemId;
      clearConnectionSourceHighlight();
      if (fromEl) fromEl.classList.add('connection-source');
    } else if (pendingConnectionFromId && pendingConnectionFromId !== itemId) {
      connections.push({
        fromId: pendingConnectionFromId,
        toId: itemId
      });
      pendingConnectionFromId = null;
      clearConnectionSourceHighlight();
      refreshConnections();
      autoSaveToLocalStorage();
    }

    closeContextMenu();
  });

  contextMenu.appendChild(btnStart);
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('open');
}

function closeContextMenu() {
  contextMenu.classList.remove('open');
  contextMenuItemId = null;
}

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    closeContextMenu();
  }
});

// ------------------------------------------------------
// Save / load – localStorage + file + Firebase stuff
// ------------------------------------------------------
function serializeBoard() {
  const items = [];
  const children = board.children;

  for (let el of children) {
    if (el === connectionsLayer || el === drawLayer) continue;

    const x = parseInt(el.style.left, 10) || 0;
    const y = parseInt(el.style.top, 10) || 0;
    const id = el.dataset.itemId;
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    if (el.classList.contains('note')) {
      const textarea = el.querySelector('textarea');
      const titleInput = el.querySelector('.note-title');

      items.push({
        type: 'note',
        id,
        x,
        y,
        width,
        height,
        title: titleInput ? titleInput.value : '',
        text: textarea ? textarea.value : '',
        color: el.dataset.color || 'yellow'
      });
    } else if (el.classList.contains('image-item')) {
      const img = el.querySelector('img');
      items.push({
        type: 'image',
        id,
        x,
        y,
        width,
        height,
        src: img.src
      });
    } else if (el.classList.contains('voice-item')) {
      items.push({
        type: 'voice',
        id,
        x,
        y,
        width,
        height,
        audioData: el.dataset.audioData || null
      });
    }
  }

  let drawingData = null;
  try {
    drawingData = drawLayer.toDataURL('image/png');
  } catch (e) {
    drawingData = null;
  }

  return {
    version: 1,
    items,
    connections,
    drawing: drawingData
  };
}

function clearBoardElements() {
  const toRemove = [];
  const children = board.children;

  for (let el of children) {
    if (el === connectionsLayer || el === drawLayer) continue;
    toRemove.push(el);
  }

  toRemove.forEach((el) => el.remove());
}

function loadBoardFromData(data) {
  if (drawCtx) {
    drawCtx.clearRect(0, 0, drawLayer.width, drawLayer.height);

    if (data && data.drawing) {
      const img = new Image();
      img.onload = () => {
        drawCtx.clearRect(0, 0, drawLayer.width, drawLayer.height);
        drawCtx.drawImage(img, 0, 0, drawLayer.width, drawLayer.height);
      };
      img.src = data.drawing;
    }
  }

  clearBoardElements();
  connections = Array.isArray(data && data.connections)
    ? data.connections
    : [];

  if (!data || !Array.isArray(data.items)) {
    refreshConnections();
    return;
  }

  data.items.forEach((item) => {
    if (item.type === 'note') {
      const note = createNote(item);
      board.appendChild(note);
    } else if (item.type === 'image') {
      const imageItem = createImageItem(item);
      board.appendChild(imageItem);
    } else if (item.type === 'voice') {
      const voiceItem = createVoiceItem(item);
      board.appendChild(voiceItem);
    }
  });

  refreshNextItemId();
  refreshConnections();
}

function autoSaveToLocalStorage() {
  const data = serializeBoard();
  try {
    localStorage.setItem(STORAGE_BOARD_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Auto-save error', err);
  }

  if (collab.enabled && collab.boardDocRef) {
    pushBoardToFirestore();
  }
}

function downloadBoardFile() {
  const data = serializeBoard();
  autoSaveToLocalStorage();

  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'whiteboard-board.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadBoardFromFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      loadBoardFromData(data);
      autoSaveToLocalStorage();
    } catch (err) {
      console.error(err);
      alert('Error: file is not a valid whiteboard JSON.');
    }
  };

  reader.readAsText(file, 'utf-8');
}

saveBoardBtn.addEventListener('click', () => {
  downloadBoardFile();
});

loadBoardBtn.addEventListener('click', () => {
  if (!boardFileInput) return;
  boardFileInput.value = '';
  boardFileInput.click();
});

if (boardFileInput) {
  boardFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    loadBoardFromFile(file);
  });
}

clearBoardBtn.addEventListener('click', () => {
  const sure = confirm(
    'Clear the whole board? (EVERYTHING will be removed)'
  );
  if (!sure) return;

  connections = [];
  clearBoardElements();

  if (drawCtx) {
    drawCtx.clearRect(0, 0, drawLayer.width, drawLayer.height);
  }

  refreshConnections();
  autoSaveToLocalStorage();
});


// ------------------------------------------------------
// User identity & live cursor helpers
// ------------------------------------------------------
function getUserStorageKey(boardId) {
  return 'simple_whiteboard_user_' + boardId;
}

function ensureUserIdentity(boardId) {
  if (userIdentity) return userIdentity;

  const key = getUserStorageKey(boardId);
  let stored = null;

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      stored = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading stored user identity', err);
  }

  if (!stored || !stored.id) {
    const randomId = Math.random().toString(36).slice(2, 10);
    let name = prompt('Choose a name for yourself on this board:', '') || '';
    name = name.trim();
    if (!name) {
      name = 'Guest-' + randomId.slice(0, 4);
    }

    const palette = ['#22c55e', '#3b82f6', '#f97316', '#ec4899', '#a855f7', '#0ea5e9'];
    const color = palette[Math.floor(Math.random() * palette.length)];

    stored = {
      id: randomId,
      name,
      color
    };
  }

  userIdentity = stored;
  collab.userId = stored.id;
  collab.userName = stored.name;
  collab.userColor = stored.color;

  // Update UI if present
  if (currentUsernameEl) {
    currentUsernameEl.textContent = stored.name;
  }
  if (userCursorColorInput) {
    userCursorColorInput.value = stored.color || '#22c55e';
  }

  try {
    localStorage.setItem(key, JSON.stringify(stored));
  } catch (err) {
    console.error('Error saving user identity', err);
  }

  return stored;
}

function persistUserIdentity(boardId) {
  if (!userIdentity) return;
  const key = getUserStorageKey(boardId);
  try {
    localStorage.setItem(key, JSON.stringify(userIdentity));
  } catch (err) {
    console.error('Error saving user identity', err);
  }
}

function updateUserNameOnBoard(newName) {
  if (!newName) return;
  const trimmed = newName.trim();
  if (!trimmed) return;

  const boardId = collab.boardId || getOrCreateBoardId();
  ensureUserIdentity(boardId);

  userIdentity.name = trimmed;
  collab.userName = trimmed;
  if (currentUsernameEl) {
    currentUsernameEl.textContent = trimmed;
  }
  persistUserIdentity(boardId);
  updatePresencePosition();
}

function updateUserColorOnBoard(newColor) {
  if (!newColor) return;

  const boardId = collab.boardId || getOrCreateBoardId();
  ensureUserIdentity(boardId);

  userIdentity.color = newColor;
  collab.userColor = newColor;
  persistUserIdentity(boardId);
  updatePresencePosition();
}

// Live cursor presence in Firestore
function startPresenceListener(boardId) {
  if (!collab.db || !collab.boardDocRef) return;

  const presenceRef = collab.boardDocRef.collection('presence');
  collab.presenceRef = presenceRef;

  presenceRef.onSnapshot((snapshot) => {
    const others = {};
    const now = Date.now();

    snapshot.forEach((doc) => {
      if (doc.id === collab.userId) return;
      const data = doc.data() || {};

      if (typeof data.x !== 'number' || typeof data.y !== 'number') {
        return;
      }

      if (typeof data.lastActive === 'number' && now - data.lastActive > PRESENCE_STALE_MS) {
        return;
      }

      others[doc.id] = data;
    });

    collab.otherUsers = others;
    renderCursors();
  });

  // Initial write so that others see us
  updatePresencePosition();
}

function renderCursors() {
  if (!cursorsLayer) return;

  cursorsLayer.innerHTML = '';

  if (showCursorsToggle && !showCursorsToggle.checked) {
    return;
  }

  const showNames = !showUsernamesToggle || showUsernamesToggle.checked;

  const others = collab.otherUsers || {};
  Object.keys(others).forEach((id) => {
    const user = others[id];
    if (typeof user.x !== 'number' || typeof user.y !== 'number') return;

    const marker = document.createElement('div');
    marker.className = 'cursor-marker';
    marker.style.left = user.x + 'px';
    marker.style.top = user.y + 'px';

    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    dot.style.backgroundColor = user.color || '#22c55e';
    marker.appendChild(dot);

    if (showNames && user.name) {
      const label = document.createElement('div');
      label.className = 'cursor-label';
      label.textContent = user.name;
      marker.appendChild(label);
    }

    cursorsLayer.appendChild(marker);
  });
}

function updatePresencePosition(x, y) {
  if (!collab.presenceRef || !collab.userId) return;

  const now = Date.now();
  if (x != null && y != null) {
    if (now - collab.lastPresenceWrite < PRESENCE_THROTTLE_MS) {
      return;
    }
  }

  const data = {
    name: collab.userName || 'Anonymous',
    color: collab.userColor || '#22c55e',
    lastActive: now
  };

  if (typeof x === 'number' && typeof y === 'number') {
    data.x = x;
    data.y = y;
  }

  collab.lastPresenceWrite = now;

  collab.presenceRef
    .doc(collab.userId)
    .set(data, { merge: true })
    .catch((err) => {
      console.error('Error writing presence', err);
    });
}

// ------------------------------------------------------
// Firebase collab
// ------------------------------------------------------
function initFirebaseCollaboration() {
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.projectId) {
    console.warn('Firebase not configured – realtime collaboration disabled.');
    if (shareLinkEl) {
      shareLinkEl.textContent = 'Collaboration is disabled (no Firebase config).';
    }
    return;
  }

  try {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  } catch (err) {
    // ignore the "already exists" errors
  }

  const db = firebase.firestore();
  collab.db = db;

  const boardId = getOrCreateBoardId();
  collab.boardId = boardId;
  const identity = ensureUserIdentity(boardId);
  updateShareLink(boardId);


  if (copyLinkBtn && shareLinkEl) {
    copyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareLinkEl.textContent);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyLinkBtn.textContent = 'Copy link';
        }, 1500);
      } catch (err) {
        console.error('Clipboard error', err);
      }
    });
  }

  const docRef = db.collection('boards').doc(boardId);
  collab.boardDocRef = docRef;

  // live cursor presence for this board
  startPresenceListener(boardId);

  // load remote board (if that exists) then start listening
  docRef.get().then((snap) => {
    const remoteData = snap.data();
    if (remoteData && remoteData.board) {
      collab.isApplyingRemote = true;
      loadBoardFromData(remoteData.board);
      collab.isApplyingRemote = false;
    } else {
      // no remote board yet == push our current state
      pushBoardToFirestore();
    }

    collab.enabled = true;
    collab.lastLocalUpdate = Date.now();

    docRef.onSnapshot((snapshot) => {
      const data = snapshot.data();
      if (!data || !data.board) return;

      if (data.updatedAt && data.updatedAt <= collab.lastLocalUpdate) {
        return;
      }

      collab.isApplyingRemote = true;
      loadBoardFromData(data.board);
      collab.isApplyingRemote = false;
    });
  }).catch((err) => {
    console.error('Error initializing collaboration', err);
  });
}

function pushBoardToFirestore() {
  if (!collab.boardDocRef || collab.isApplyingRemote) return;

  const now = Date.now();
  collab.lastLocalUpdate = now;
  const boardData = serializeBoard();

  collab.boardDocRef.set(
    {
      board: boardData,
      updatedAt: now
    },
    { merge: true }
  ).catch((err) => {
    console.error('Firestore write error', err);
  });
}

// ------------------------------------------------------
// Initial load
// ------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  resizeDrawLayer();

  const raw = localStorage.getItem(STORAGE_BOARD_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      loadBoardFromData(data);
    } catch (err) {
      console.error(err);
    }
  } else {
    refreshNextItemId();
    refreshConnections();
  }

  applySavedSettings();
  updateScale(scale);

  // show URL even if Firebase is not configured (still useful lol)
  const boardId = getOrCreateBoardId();
  ensureUserIdentity(boardId);
  updateShareLink(boardId);

  // try to enable Firebase realtime sync
  initFirebaseCollaboration();
});

setInterval(() => {
  autoSaveToLocalStorage();
}, 15000);

// ------------------------------------------------------
// Zoom & panning
// ------------------------------------------------------
boardContainer.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.altKey || e.shiftKey) return;

    e.preventDefault();

    const delta = -e.deltaY;
    const zoomIntensity = 0.0015;
    const scaleFactor = 1 + delta * zoomIntensity;

    const prevScale = scale;
    let newScale = prevScale * scaleFactor;
    let clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    if (clampedScale === prevScale) return;

    const rect = boardContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + boardContainer.scrollLeft;
    const mouseY = e.clientY - rect.top + boardContainer.scrollTop;

    scale = clampedScale;
    updateScale(scale);

    const newScrollLeft =
      (mouseX * (scale / prevScale)) - (e.clientX - rect.left);
    const newScrollTop =
      (mouseY * (scale / prevScale)) - (e.clientY - rect.top);

    boardContainer.scrollLeft = newScrollLeft;
    boardContainer.scrollTop = newScrollTop;

    refreshConnections();
  },
  { passive: false }
);

function updateScale(newScale) {
  board.style.transform = `scale(${newScale})`;

  if (zoomIndicator) {
    zoomIndicator.textContent = `Zoom: ${Math.round(newScale * 100)}%`;
  }
}

// Panning with middle mouse button
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;

function startPanning(e) {
  if (e.button !== 1) return;

  isPanning = true;
  boardContainer.classList.add('panning');
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartScrollLeft = boardContainer.scrollLeft;
  panStartScrollTop = boardContainer.scrollTop;

  document.addEventListener('mousemove', onPanMove);
  document.addEventListener('mouseup', stopPanning);

  e.preventDefault();
}

function onPanMove(e) {
  if (!isPanning) return;

  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;

  boardContainer.scrollLeft = panStartScrollLeft - dx;
  boardContainer.scrollTop = panStartScrollTop - dy;
}

function stopPanning() {
  isPanning = false;
  boardContainer.classList.remove('panning');
  document.removeEventListener('mousemove', onPanMove);
  document.removeEventListener('mouseup', stopPanning);
}

boardContainer.addEventListener('mousedown', startPanning);
board.addEventListener('mousedown', (e) => {
  if (e.button === 1) {
    startPanning(e);
  }
});

// ------------------------------------------------------
// Settings (dark mode :D, grid, zoom reset)
// ------------------------------------------------------
function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Error saving settings', err);
  }
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading settings', err);
    return null;
  }
}


function applySavedSettings() {
  const settings = loadSettings();

  let dark = true;
  let showGrid = true;
  let showCursors = true;
  let showUsernames = true;

  if (settings) {
    if (typeof settings.darkMode === 'boolean') {
      dark = settings.darkMode;
    }
    if (typeof settings.showGrid === 'boolean') {
      showGrid = settings.showGrid;
    }
    if (typeof settings.showCursors === 'boolean') {
      showCursors = settings.showCursors;
    }
    if (typeof settings.showUsernames === 'boolean') {
      showUsernames = settings.showUsernames;
    }
  }

  document.body.classList.toggle('dark', dark);
  board.classList.toggle('no-grid', !showGrid);

  if (darkModeToggle) darkModeToggle.checked = dark;
  if (gridToggle) gridToggle.checked = showGrid;
  if (showCursorsToggle) showCursorsToggle.checked = showCursors;
  if (showUsernamesToggle) showUsernamesToggle.checked = showUsernames;
}

function getCurrentSettings() {
  return {
    darkMode: !!(darkModeToggle && darkModeToggle.checked),
    showGrid: !!(gridToggle && gridToggle.checked),
    showCursors: !!(showCursorsToggle && showCursorsToggle.checked),
    showUsernames: !!(showUsernamesToggle && showUsernamesToggle.checked)
  };
}

if (darkModeToggle) {
  darkModeToggle.addEventListener('change', () => {
    const enabled = darkModeToggle.checked;
    document.body.classList.toggle('dark', enabled);
    saveSettings(getCurrentSettings());
  });
}

if (gridToggle) {
  gridToggle.addEventListener('change', () => {
    const enabled = gridToggle.checked;
    board.classList.toggle('no-grid', !enabled);
    saveSettings(getCurrentSettings());
  });
}


if (showCursorsToggle) {
  showCursorsToggle.addEventListener('change', () => {
    saveSettings(getCurrentSettings());
    renderCursors();
  });
}

if (showUsernamesToggle) {
  showUsernamesToggle.addEventListener('change', () => {
    saveSettings(getCurrentSettings());
    renderCursors();
  });
}

if (userCursorColorInput) {
  userCursorColorInput.addEventListener('change', () => {
    updateUserColorOnBoard(userCursorColorInput.value);
  });
}

if (changeNameBtn) {
  changeNameBtn.addEventListener('click', () => {
    const currentName = (userIdentity && userIdentity.name) || (collab && collab.userName) || '';
    const next = prompt('Choose a new name for yourself:', currentName || '');
    if (next && next.trim()) {
      updateUserNameOnBoard(next);
    }
  });
}

if (resetZoomBtn) {
  resetZoomBtn.addEventListener('click', () => {
    scale = 1;
    updateScale(scale);

    boardContainer.scrollLeft =
      (board.scrollWidth - boardContainer.clientWidth) / 2;
    boardContainer.scrollTop =
      (board.scrollHeight - boardContainer.clientHeight) / 2;

    refreshConnections();
  });
}

if (settingsToggleBtn && settingsPanel) {
  settingsToggleBtn.addEventListener('click', () => {
    const isOpen = settingsPanel.classList.toggle('open');
    settingsToggleBtn.classList.toggle('active', isOpen);
  });
}

// ------------------------------------------------------
// Coords indicator
// ------------------------------------------------------

function updateCoords(e) {
  if (!coordsIndicator) return;

  const boardRect = board.getBoundingClientRect();
  const x = (e.clientX - boardRect.left) / scale;
  const y = (e.clientY - boardRect.top) / scale;

  if (x < 0 || y < 0 || x > board.offsetWidth || y > board.offsetHeight) {
    coordsIndicator.textContent = 'x: -, y: -';
    return;
  }

  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  coordsIndicator.textContent = `x: ${roundedX}, y: ${roundedY}`;

  updatePresencePosition(roundedX, roundedY);
}
document.addEventListener('mousemove', updateCoords);
document.addEventListener('mouseleave', () => {
  if (coordsIndicator) {
    coordsIndicator.textContent = 'x: -, y: -';
  }
});

// ------------------------------------------------------
// Connections (SVG layer)
// ------------------------------------------------------
function refreshConnections() {
  if (!connectionsLayer) return;

  connectionsLayer.innerHTML = '';
  const boardRect = board.getBoundingClientRect();

  connections.forEach((conn, index) => {
    const fromEl = board.querySelector(
      `[data-item-id="${conn.fromId}"]`
    );
    const toEl = board.querySelector(
      `[data-item-id="${conn.toId}"]`
    );

    if (!fromEl || !toEl) return;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const x1 =
      (fromRect.left - boardRect.left) / scale +
      fromRect.width / (2 * scale);
    const y1 =
      (fromRect.top - boardRect.top) / scale +
      fromRect.height / (2 * scale);
    const x2 =
      (toRect.left - boardRect.left) / scale +
      toRect.width / (2 * scale);
    const y2 =
      (toRect.top - boardRect.top) / scale +
      toRect.height / (2 * scale);

    const group = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g'
    );
    group.dataset.connIndex = index.toString();

    const line = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line'
    );
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#4f46e5');
    line.setAttribute('stroke-width', '2');

    const circle1 = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );
    circle1.setAttribute('cx', x1);
    circle1.setAttribute('cy', y1);
    circle1.setAttribute('r', 4);
    circle1.setAttribute('fill', '#4f46e5');

    const circle2 = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );
    circle2.setAttribute('cx', x2);
    circle2.setAttribute('cy', y2);
    circle2.setAttribute('r', 4);
    circle2.setAttribute('fill', '#4f46e5');

    group.appendChild(line);
    group.appendChild(circle1);
    group.appendChild(circle2);

    group.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(group.dataset.connIndex, 10);
      if (isNaN(idx)) return;

      connections.splice(idx, 1);
      refreshConnections();
      autoSaveToLocalStorage();
    });

    connectionsLayer.appendChild(group);
  });
}

// ------------------------------------------------------
// Drawing (pen + eraser)
// ------------------------------------------------------
function getBoardCoordsFromEvent(e) {
  const boardRect = board.getBoundingClientRect();
  const x = (e.clientX - boardRect.left) / scale;
  const y = (e.clientY - boardRect.top) / scale;
  return { x, y };
}

// Pen
if (drawModeBtn) {
  drawModeBtn.addEventListener('click', () => {
    drawModeActive = !drawModeActive;
    drawModeBtn.classList.toggle('active', drawModeActive);
    drawControls.classList.toggle('open', drawModeActive);

    if (drawModeActive || eraseModeActive) {
      drawLayer.style.pointerEvents = 'auto';
      connectionsLayer.style.pointerEvents = 'none';
    } else {
      drawLayer.style.pointerEvents = 'none';
      connectionsLayer.style.pointerEvents = 'auto';
    }

    if (!drawModeActive && eraseModeActive) {
      eraseModeActive = false;
      eraseModeBtn.classList.remove('active');
      eraseControls.classList.remove('open');
    }
  });
}

// Eraser
if (eraseModeBtn) {
  eraseModeBtn.addEventListener('click', () => {
    eraseModeActive = !eraseModeActive;
    eraseModeBtn.classList.toggle('active', eraseModeActive);
    eraseControls.classList.toggle('open', eraseModeActive);

    if (eraseModeActive || drawModeActive) {
      drawLayer.style.pointerEvents = 'auto';
      connectionsLayer.style.pointerEvents = 'none';
    } else {
      drawLayer.style.pointerEvents = 'none';
      connectionsLayer.style.pointerEvents = 'auto';
    }
  });
}

if (drawColorInput) {
  drawColorInput.addEventListener('input', () => {
    drawColor = drawColorInput.value || '#ffffff';
  });
}

if (drawWidthInput) {
  drawWidthInput.addEventListener('input', () => {
    drawWidth = parseInt(drawWidthInput.value, 10) || 3;
  });
}

if (eraseWidthInput) {
  eraseWidthInput.addEventListener('input', () => {
    eraseWidth = parseInt(eraseWidthInput.value, 10) || 20;
  });
}

drawLayer.addEventListener('mousedown', (e) => {
  if (!drawModeActive && !eraseModeActive) return;
  if (e.button !== 0) return;

  e.preventDefault();

  const { x, y } = getBoardCoordsFromEvent(e);
  isDrawing = true;

  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  if (eraseModeActive) {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    drawCtx.lineWidth = eraseWidth;
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = drawColor;
    drawCtx.lineWidth = drawWidth;
  }

  drawCtx.beginPath();
  drawCtx.moveTo(x, y);
});

drawLayer.addEventListener('mousemove', (e) => {
  if (!isDrawing || (!drawModeActive && !eraseModeActive)) return;

  const { x, y } = getBoardCoordsFromEvent(e);
  drawCtx.lineTo(x, y);
  drawCtx.stroke();
});

function endDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  drawCtx.closePath();
  autoSaveToLocalStorage();
}

drawLayer.addEventListener('mouseup', endDrawing);
drawLayer.addEventListener('mouseleave', endDrawing);


// Try to clean up presence when leaving the page
window.addEventListener('beforeunload', () => {
  if (collab.presenceRef && collab.userId) {
    try {
      collab.presenceRef.doc(collab.userId).delete();
    } catch (err) {
      // ignore
    }
  }
});
