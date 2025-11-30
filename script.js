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
const cursorLayer = document.getElementById('cursor-layer');

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
const settingsCloseBtn = document.getElementById('settings-close-btn');
const usernameInput = document.getElementById('username-input');
const showUsernamesToggle = document.getElementById('show-usernames-toggle');
const showCursorsToggle = document.getElementById('show-cursors-toggle');
const cursorColorInput = document.getElementById('cursor-color-input');

const coordsIndicator = document.getElementById('coords-indicator');

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
const toggleLinkVisibilityBtn = document.getElementById('toggle-link-visibility-btn');

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
  isApplyingRemote: false
};

let currentShareLink = '';
let shareLinkVisible = false;

// Live cursor / user presence
let userIdentity = {
  id: null,
  name: null,
  color: '#f97316',
  showCursors: true,
  showUsernames: true
};

let cursorPresence = {
  docRef: null,
  unsubscribe: null
};

const remoteCursors = new Map();
let lastCursorSendTime = 0;


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
  currentShareLink = link;
  if (shareLinkEl) {
    shareLinkEl.textContent = shareLinkVisible
      ? link
      : 'Hidden (click "Show link" to reveal it)';
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

  const colors = ['yellow', 'blue', 'green', 'pink', 'orange', 'purple'];
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

  const resolved = resolveNoteColorValue(color);
  note.style.backgroundColor = resolved;
  note.style.borderColor = resolved;

  const dots = note.querySelectorAll('.note-color-dot');
  dots.forEach((dot) => {
    dot.classList.toggle('active', dot.dataset.color === color);
  });
}


function resolveNoteColorValue(color) {
  switch (color) {
    case 'yellow':
      return '#fef9c3';
    case 'blue':
      return '#dbeafe';
    case 'green':
      return '#dcfce7';
    case 'pink':
      return '#fce7f3';
    case 'orange':
      return '#ffedd5';
    case 'purple':
      return '#ede9fe';
    default:
      if (typeof color === 'string' && color.startsWith('#')) {
        return color;
      }
      return '#fef9c3';
  }
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

  // Start / target connection button
  const btnStart = document.createElement('button');
  btnStart.textContent =
    pendingConnectionFromId && pendingConnectionFromId !== itemId
      ? 'Use as connection target'
      : 'Connect notes';

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

  // Duplicate item (notes, images & voice notes)
  if (fromEl && (fromEl.classList.contains('note') || fromEl.classList.contains('image-item') || fromEl.classList.contains('voice-item'))) {
    const btnDuplicate = document.createElement('button');
    btnDuplicate.textContent = 'Duplicate';
    btnDuplicate.addEventListener('click', () => {
      const x = parseInt(fromEl.style.left, 10) || 0;
      const y = parseInt(fromEl.style.top, 10) || 0;
      const width = fromEl.offsetWidth;
      const height = fromEl.offsetHeight;

      let duplicate = null;

      if (fromEl.classList.contains('note')) {
        const titleInput = fromEl.querySelector('.note-title');
        const textarea = fromEl.querySelector('textarea');
        const color = fromEl.dataset.color || 'yellow';

        duplicate = createNote({
          id: generateItemId(),
          x: x + 30,
          y: y + 30,
          title: titleInput ? titleInput.value : '',
          text: textarea ? textarea.value : '',
          color,
          width,
          height
        });
      } else if (fromEl.classList.contains('image-item')) {
        const img = fromEl.querySelector('img');
        const src = img ? img.src : '';

        duplicate = createImageItem({
          id: generateItemId(),
          x: x + 30,
          y: y + 30,
          src,
          width,
          height
        });
      } else if (fromEl.classList.contains('voice-item')) {
        const audioData = fromEl.dataset.audioData || null;

        duplicate = createVoiceItem({
          id: generateItemId(),
          x: x + 30,
          y: y + 30,
          width,
          height,
          audioData
        });
      }

      if (duplicate) {
        board.appendChild(duplicate);
        refreshConnections();
        autoSaveToLocalStorage();
      }

      closeContextMenu();
    });

    contextMenu.appendChild(btnDuplicate);
  }

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
  updateShareLink(boardId);

  if (copyLinkBtn && shareLinkEl) {
    copyLinkBtn.addEventListener('click', async () => {
      try {
        const textToCopy = currentShareLink || window.location.href;
        await navigator.clipboard.writeText(textToCopy);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyLinkBtn.textContent = 'Copy link';
        }, 1500);
      } catch (err) {
        console.error('Clipboard error', err);
      }
    });
  }

  if (toggleLinkVisibilityBtn && shareLinkEl) {
    toggleLinkVisibilityBtn.addEventListener('click', () => {
      shareLinkVisible = !shareLinkVisible;
      if (shareLinkVisible) {
        shareLinkEl.textContent = currentShareLink || window.location.href;
        toggleLinkVisibilityBtn.textContent = 'Hide link';
      } else {
        shareLinkEl.textContent = 'Hidden (click "Show link" to reveal it)';
        toggleLinkVisibilityBtn.textContent = 'Show link';
      }
    });
  }

  const docRef = db.collection('boards').doc(boardId);
  collab.boardDocRef = docRef;

  // live cursors / presence
  initLiveCursorCollaboration();

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
// Live cursor presence (Firebase sub-collection)
// ------------------------------------------------------
function initLiveCursorCollaboration() {
  if (!collab.db || !collab.boardId) return;
  if (!window.firebase || !firebase.firestore) return;

  const userId = userIdentity.id || getOrCreateUserId();
  userIdentity.id = userId;

  const boardDoc = collab.db.collection('boards').doc(collab.boardId);
  const cursorsCol = boardDoc.collection('cursors');
  const presenceDoc = cursorsCol.doc(userId);
  cursorPresence.docRef = presenceDoc;

  // Initial presence (no position yet)
  try {
    presenceDoc.set(
      {
        name: userIdentity.name || 'Anonymous',
        color: userIdentity.color,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        x: null,
        y: null
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Error initialising cursor presence', err);
  }

  // Listen to other users' cursors
  cursorPresence.unsubscribe = cursorsCol.onSnapshot((snapshot) => {
    const now = Date.now();
    remoteCursors.clear();

    snapshot.forEach((doc) => {
      if (doc.id === userId) return;

      const data = doc.data() || {};
      if (typeof data.x !== 'number' || typeof data.y !== 'number') {
        return;
      }

      let lastSeenMs = 0;
      if (data.lastSeen && typeof data.lastSeen.toMillis === 'function') {
        lastSeenMs = data.lastSeen.toMillis();
      }

      if (lastSeenMs && now - lastSeenMs > 30000) {
        // ignore stale cursors (>30s)
        return;
      }

      remoteCursors.set(doc.id, {
        x: data.x,
        y: data.y,
        name: data.name || 'Guest',
        color: data.color || '#f97316'
      });
    });

    renderRemoteCursors();
  });

  // Clean up our presence on unload (best-effort)
  window.addEventListener('beforeunload', () => {
    try {
      if (cursorPresence.docRef) {
        cursorPresence.docRef.delete();
      }
      if (cursorPresence.unsubscribe) {
        cursorPresence.unsubscribe();
      }
    } catch (err) {
      console.error('Error cleaning up cursor presence', err);
    }
  });
}

function pushIdentityToCursorDoc() {
  if (!cursorPresence.docRef || !window.firebase || !firebase.firestore) return;

  try {
    cursorPresence.docRef.set(
      {
        name: userIdentity.name || 'Anonymous',
        color: userIdentity.color,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Cursor identity update error', err);
  }
}

function updateOwnCursorPosition(x, y) {
  if (!cursorPresence.docRef || !window.firebase || !firebase.firestore) return;

  const now = Date.now();
  if (now - lastCursorSendTime < 50) {
    return;
  }
  lastCursorSendTime = now;

  try {
    cursorPresence.docRef.set(
      {
        x,
        y,
        name: userIdentity.name || 'Anonymous',
        color: userIdentity.color,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Cursor position update error', err);
  }
}

function hideOwnCursorRemotely() {
  if (!cursorPresence.docRef || !window.firebase || !firebase.firestore) return;

  try {
    cursorPresence.docRef.set(
      {
        x: null,
        y: null,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Cursor hide error', err);
  }
}

function renderRemoteCursors() {
  if (!cursorLayer) return;
  cursorLayer.innerHTML = '';

  if (!userIdentity.showCursors) {
    return;
  }

  remoteCursors.forEach((cursor) => {
    const el = document.createElement('div');
    el.className = 'live-cursor';
    el.style.left = cursor.x + 'px';
    el.style.top = cursor.y + 'px';

    const dot = document.createElement('div');
    dot.className = 'live-cursor-dot';
    dot.style.backgroundColor = cursor.color || '#f97316';
    el.appendChild(dot);

    if (userIdentity.showUsernames && cursor.name) {
      const label = document.createElement('div');
      label.className = 'live-cursor-label';
      label.textContent = cursor.name;
      el.appendChild(label);
    }

    cursorLayer.appendChild(el);
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
  ensureUserIdentity();
  updateScale(scale);

  // show URL even if Firebase is not configured (still useful lol)
  const boardId = getOrCreateBoardId();
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
  const settings = loadSettings() || {};

  const dark =
    typeof settings.darkMode === 'boolean' ? settings.darkMode : true;
  const showGrid =
    typeof settings.showGrid === 'boolean' ? settings.showGrid : true;
  const showUsernames =
    typeof settings.showUsernames === 'boolean' ? settings.showUsernames : true;
  const showCursors =
    typeof settings.showCursors === 'boolean' ? settings.showCursors : true;
  const cursorColor = settings.cursorColor || '#f97316';
  const username = settings.username || '';

  document.body.classList.toggle('dark', dark);
  board.classList.toggle('no-grid', !showGrid);

  if (darkModeToggle) darkModeToggle.checked = dark;
  if (gridToggle) gridToggle.checked = showGrid;

  if (showUsernamesToggle) showUsernamesToggle.checked = showUsernames;
  if (showCursorsToggle) showCursorsToggle.checked = showCursors;
  if (cursorColorInput) cursorColorInput.value = cursorColor;
  if (usernameInput && username) usernameInput.value = username;

  userIdentity.showUsernames = showUsernames;
  userIdentity.showCursors = showCursors;
  userIdentity.color = cursorColor;
  if (username) {
    userIdentity.name = username;
  }
}

function getCurrentSettings() {
  return {
    darkMode: !!(darkModeToggle && darkModeToggle.checked),
    showGrid: !!(gridToggle && gridToggle.checked),
    showUsernames: !!(showUsernamesToggle && showUsernamesToggle.checked),
    showCursors: !!(showCursorsToggle && showCursorsToggle.checked),
    cursorColor: cursorColorInput ? cursorColorInput.value : '#f97316',
    username:
      usernameInput ? usernameInput.value.trim() : (userIdentity.name || '')
  };
}

function getOrCreateUserId() {
  let id = null;
  try {
    id = localStorage.getItem('simple_whiteboard_v16_user_id');
  } catch (err) {
    console.error('Error reading user id', err);
  }

  if (!id) {
    id = 'user-' + Math.random().toString(36).slice(2, 10);
    try {
      localStorage.setItem('simple_whiteboard_v16_user_id', id);
    } catch (err) {
      console.error('Error saving user id', err);
    }
  }
  return id;
}

function ensureUserIdentity() {
  if (!userIdentity.id) {
    userIdentity.id = getOrCreateUserId();
  }

  if (!userIdentity.name) {
    const fallback = 'Guest-' + Math.floor(Math.random() * 9999);
    let name = window.prompt(
      'Pick a name so others can see who you are on this board:',
      fallback
    );

    if (name === null) {
      name = fallback;
    }
    name = String(name).trim();
    if (!name) {
      name = fallback;
    }

    userIdentity.name = name;

    if (usernameInput) {
      usernameInput.value = name;
    }

    const settings = getCurrentSettings();
    settings.username = name;
    saveSettings(settings);
  }
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

function openSettingsModal() {
  if (!settingsPanel) return;
  settingsPanel.classList.add('open');
  if (settingsToggleBtn) {
    settingsToggleBtn.classList.add('active');
  }
}

function closeSettingsModal() {
  if (!settingsPanel) return;
  settingsPanel.classList.remove('open');
  if (settingsToggleBtn) {
    settingsToggleBtn.classList.remove('active');
  }
}

if (settingsToggleBtn && settingsPanel) {
  settingsToggleBtn.addEventListener('click', () => {
    if (settingsPanel.classList.contains('open')) {
      closeSettingsModal();
    } else {
      openSettingsModal();
    }
  });
}

if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', () => {
    closeSettingsModal();
  });
}

if (showUsernamesToggle) {
  showUsernamesToggle.addEventListener('change', () => {
    userIdentity.showUsernames = showUsernamesToggle.checked;
    saveSettings(getCurrentSettings());
    renderRemoteCursors();
  });
}

if (showCursorsToggle) {
  showCursorsToggle.addEventListener('change', () => {
    userIdentity.showCursors = showCursorsToggle.checked;
    saveSettings(getCurrentSettings());
    renderRemoteCursors();
  });
}

if (cursorColorInput) {
  cursorColorInput.addEventListener('input', () => {
    userIdentity.color = cursorColorInput.value || '#f97316';
    saveSettings(getCurrentSettings());
    pushIdentityToCursorDoc();
  });
}

if (usernameInput) {
  usernameInput.addEventListener('change', () => {
    let name = usernameInput.value.trim();
    if (!name) {
      name = userIdentity.name || 'Guest-' + Math.floor(Math.random() * 9999);
      usernameInput.value = name;
    }
    userIdentity.name = name;
    saveSettings(getCurrentSettings());
    pushIdentityToCursorDoc();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsPanel && settingsPanel.classList.contains('open')) {
    closeSettingsModal();
  }
});
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
    hideOwnCursorRemotely();
    return;
  }

  coordsIndicator.textContent = `x: ${Math.round(x)}, y: ${Math.round(y)}`;
  updateOwnCursorPosition(x, y);
}

document.addEventListener('mousemove', updateCoords);
document.addEventListener('mouseleave', () => {
  if (coordsIndicator) {
    coordsIndicator.textContent = 'x: -, y: -';
  }
  hideOwnCursorRemotely();
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

// ------------------------------------------------------
// Settings modal tabs (Board vs User)
// ------------------------------------------------------
(function initSettingsTabs() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  const tabButtons = Array.from(panel.querySelectorAll('.settings-tab'));
  const tabPanels = Array.from(panel.querySelectorAll('[data-tab-panel]'));
  if (!tabButtons.length || !tabPanels.length) return;

  function setActiveSettingsTab(tabName) {
    const name = tabName || 'board';

    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === name;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    tabPanels.forEach((panelEl) => {
      const isActive = panelEl.dataset.tabPanel === name;
      panelEl.classList.toggle('active', isActive);
      if (isActive) {
        panelEl.removeAttribute('hidden');
      } else {
        panelEl.setAttribute('hidden', 'hidden');
      }
    });
  }

  let storedTab = 'board';
  try {
    if (window.localStorage) {
      storedTab = window.localStorage.getItem('whiteboard.settingsTab') || 'board';
    }
  } catch (err) {
    storedTab = 'board';
  }

  setActiveSettingsTab(storedTab);

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab || 'board';
      setActiveSettingsTab(tab);
      try {
        if (window.localStorage) {
          window.localStorage.setItem('whiteboard.settingsTab', tab);
        }
      } catch (err) {
        // ignore
      }
    });
  });
})();


// === Delta / patch-based Firestore sync overrides ===
// This block overrides the original full-board Firestore sync
// and stores items / connections in subcollections for better merging.

if (typeof collab === 'object' && collab) {
  collab.itemsColRef = collab.itemsColRef || null;
  collab.connectionsColRef = collab.connectionsColRef || null;
  collab.skipNextItemsSnapshot = false;
  collab.skipNextConnectionsSnapshot = false;
}

function getConnectionDocId(conn) {
  return conn.fromId + '__' + conn.toId;
}

// Apply a single remote item document to the DOM
function applyRemoteItemDoc(item) {
  if (!item || !item.id || !item.type) return;

  collab.isApplyingRemote = true;
  try {
    const existing = board.querySelector('[data-item-id="' + item.id + '"]');
    if (existing) existing.remove();

    let el = null;
    if (item.type === 'note') {
      el = createNote(item);
    } else if (item.type === 'image') {
      el = createImageItem(item);
    } else if (item.type === 'voice') {
      el = createVoiceItem(item);
    }

    if (el) {
      board.appendChild(el);
      refreshConnections();
    }
  } finally {
    collab.isApplyingRemote = false;
  }
}

function removeLocalItemById(id) {
  const existing = board.querySelector('[data-item-id="' + id + '"]');
  if (existing) {
    existing.remove();
    refreshConnections();
  }
}

function handleItemsSnapshot(snapshot) {
  if (!snapshot) return;
  if (collab.skipNextItemsSnapshot) {
    collab.skipNextItemsSnapshot = false;
    return;
  }

  snapshot.docChanges().forEach(function (change) {
    const data = change.doc.data();
    if (!data) return;

    if (change.type === 'added' || change.type === 'modified') {
      applyRemoteItemDoc(data);
    } else if (change.type === 'removed') {
      removeLocalItemById(change.doc.id);
    }
  });
}

function handleConnectionsSnapshot(snapshot) {
  if (!snapshot) return;
  if (collab.skipNextConnectionsSnapshot) {
    collab.skipNextConnectionsSnapshot = false;
    return;
  }

  const newConnections = [];
  snapshot.forEach(function (doc) {
    const data = doc.data();
    if (!data || !data.fromId || !data.toId) return;
    newConnections.push({ fromId: data.fromId, toId: data.toId });
  });

  collab.isApplyingRemote = true;
  try {
    connections = newConnections;
    refreshConnections();
  } finally {
    collab.isApplyingRemote = false;
  }
}

// Override autoSaveToLocalStorage so it still saves locally
// but now triggers per-item Firestore sync instead of full-board overwrite.
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

// New implementation: write items & connections into subcollections
function pushBoardToFirestore() {
  if (!collab.db || !collab.boardDocRef || typeof firebase === 'undefined' || !firebase.firestore) return;
  if (!collab.itemsColRef || !collab.connectionsColRef) return;
  if (collab.isApplyingRemote) return;

  const boardData = serializeBoard();
  const batch = collab.db.batch();

  (boardData.items || []).forEach(function (item) {
    if (!item.id) return;
    const ref = collab.itemsColRef.doc(item.id);
    batch.set(ref, item, { merge: true });
  });

  (boardData.connections || []).forEach(function (conn) {
    if (!conn.fromId || !conn.toId) return;
    const id = getConnectionDocId(conn);
    const ref = collab.connectionsColRef.doc(id);
    batch.set(ref, { fromId: conn.fromId, toId: conn.toId }, { merge: true });
  });

  batch.commit().catch(function (err) {
    console.error('Firestore batch write error', err);
  });
}

// Override initFirebaseCollaboration to use per-item collections
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
  updateShareLink(boardId);

  if (copyLinkBtn && shareLinkEl) {
    copyLinkBtn.onclick = async function () {
      try {
        const textToCopy = currentShareLink || window.location.href;
        await navigator.clipboard.writeText(textToCopy);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(function () {
          copyLinkBtn.textContent = 'Copy link';
        }, 1500);
      } catch (err) {
        console.error('Clipboard error', err);
      }
    };
  }

  if (toggleLinkVisibilityBtn && shareLinkEl) {
    toggleLinkVisibilityBtn.onclick = function () {
      shareLinkVisible = !shareLinkVisible;
      if (shareLinkVisible) {
        shareLinkEl.textContent = currentShareLink || window.location.href;
        toggleLinkVisibilityBtn.textContent = 'Hide link';
      } else {
        shareLinkEl.textContent = 'Hidden (click "Show link" to reveal it)';
        toggleLinkVisibilityBtn.textContent = 'Show link';
      }
    };
  }

  const docRef = db.collection('boards').doc(boardId);
  collab.boardDocRef = docRef;
  collab.itemsColRef = docRef.collection('items');
  collab.connectionsColRef = docRef.collection('connections');

  // live cursors / presence (existing implementation)
  initLiveCursorCollaboration();

  Promise.all([
    collab.itemsColRef.get(),
    collab.connectionsColRef.get()
  ]).then(function (results) {
    const itemsSnap = results[0];
    const connSnap = results[1];
    const hasRemote = !itemsSnap.empty || !connSnap.empty;

    if (hasRemote) {
      const remoteBoard = { version: 1, items: [], connections: [], drawing: null };

      itemsSnap.forEach(function (doc) {
        const data = doc.data();
        if (data) remoteBoard.items.push(data);
      });

      connSnap.forEach(function (doc) {
        const data = doc.data();
        if (data && data.fromId && data.toId) {
          remoteBoard.connections.push({ fromId: data.fromId, toId: data.toId });
        }
      });

      collab.isApplyingRemote = true;
      try {
        loadBoardFromData(remoteBoard);
      } finally {
        collab.isApplyingRemote = false;
      }
    } else {
      // No remote state yet – push our current local board
      pushBoardToFirestore();
    }

    collab.enabled = true;
    collab.lastLocalUpdate = Date.now();

    // Skip the initial "added" events that simply mirror the state we just loaded
    collab.skipNextItemsSnapshot = true;
    collab.skipNextConnectionsSnapshot = true;

    collab.itemsColRef.onSnapshot(handleItemsSnapshot);
    collab.connectionsColRef.onSnapshot(handleConnectionsSnapshot);
  }).catch(function (err) {
    console.error('Error initializing collaboration', err);
  });
}
