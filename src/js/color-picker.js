// Color Picker Module
// Custom color wheel with hue ring and saturation/value square
// Reusable: call openColorPicker(currentHex, onApply) from anywhere

// Color conversion helpers
export function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, v };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) };
}

// Internal state
let initialized = false;
let dialog, wheelCanvas, svCanvas, wheelCtx, svCtx;
let wheelCursor, svCursor, hexInput, hexPreview;
let hue = 0, sat = 0, val = 1;
let isDraggingWheel = false, isDraggingSV = false;
let currentOnApply = null;

const wheelRadius = 100;
const wheelInner = 88;
const svSize = 120;
const svOffset = 40;

function createDialogHTML() {
  const el = document.createElement('div');
  el.id = 'color-picker-dialog';
  el.innerHTML = `
    <div class="color-picker-panel">
      <div class="color-picker-wheel-area">
        <canvas id="color-wheel" width="200" height="200"></canvas>
        <canvas id="color-sv-picker" width="120" height="120"></canvas>
        <div id="wheel-cursor"></div>
        <div id="sv-cursor"></div>
      </div>
      <div class="color-picker-controls">
        <div id="hex-preview"></div>
        <input type="text" id="hex-input" maxlength="7" spellcheck="false">
      </div>
      <div class="color-picker-actions">
        <button class="modal-btn modal-btn-secondary" id="color-picker-cancel">Cancel</button>
        <button class="modal-btn modal-btn-primary" id="color-picker-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

function initPicker() {
  if (initialized) return;
  initialized = true;

  dialog = createDialogHTML();
  wheelCanvas = document.getElementById('color-wheel');
  svCanvas = document.getElementById('color-sv-picker');
  wheelCtx = wheelCanvas.getContext('2d');
  svCtx = svCanvas.getContext('2d');
  wheelCursor = document.getElementById('wheel-cursor');
  svCursor = document.getElementById('sv-cursor');
  hexInput = document.getElementById('hex-input');
  hexPreview = document.getElementById('hex-preview');

  // Wheel drag
  wheelCanvas.addEventListener('pointerdown', (e) => {
    const rect = wheelCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left - wheelRadius;
    const y = e.clientY - rect.top - wheelRadius;
    const dist = Math.sqrt(x * x + y * y);
    if (dist >= wheelInner && dist <= wheelRadius) {
      isDraggingWheel = true;
      wheelCanvas.setPointerCapture(e.pointerId);
      updateHueFromPos(x, y);
    }
  });

  wheelCanvas.addEventListener('pointermove', (e) => {
    if (!isDraggingWheel) return;
    const rect = wheelCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left - wheelRadius;
    const y = e.clientY - rect.top - wheelRadius;
    updateHueFromPos(x, y);
  });

  wheelCanvas.addEventListener('pointerup', () => { isDraggingWheel = false; });

  // SV drag
  svCanvas.addEventListener('pointerdown', (e) => {
    isDraggingSV = true;
    svCanvas.setPointerCapture(e.pointerId);
    updateSVFromEvent(e);
  });

  svCanvas.addEventListener('pointermove', (e) => {
    if (!isDraggingSV) return;
    updateSVFromEvent(e);
  });

  svCanvas.addEventListener('pointerup', () => { isDraggingSV = false; });

  // Hex input
  hexInput.addEventListener('input', () => {
    let value = hexInput.value.trim();
    if (!value.startsWith('#')) value = '#' + value;
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      const rgb = hexToRgb(value);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hue = hsv.h; sat = hsv.s; val = hsv.v;
      drawSV();
      updateUI();
    }
  });

  // Apply
  document.getElementById('color-picker-apply').addEventListener('click', () => {
    const rgb = hsvToRgb(hue, sat, val);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    if (currentOnApply) currentOnApply(hex);
    close();
  });

  // Cancel
  document.getElementById('color-picker-cancel').addEventListener('click', close);

  // Click outside panel
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
}

function drawWheel() {
  wheelCtx.clearRect(0, 0, 200, 200);
  for (let angle = 0; angle < 360; angle++) {
    const startAngle = (angle - 1) * Math.PI / 180;
    const endAngle = (angle + 1) * Math.PI / 180;
    wheelCtx.beginPath();
    wheelCtx.arc(wheelRadius, wheelRadius, wheelRadius - 2, startAngle, endAngle);
    wheelCtx.arc(wheelRadius, wheelRadius, wheelInner, endAngle, startAngle, true);
    wheelCtx.closePath();
    wheelCtx.fillStyle = `hsl(${angle}, 100%, 50%)`;
    wheelCtx.fill();
  }
}

function drawSV() {
  const hueColor = hsvToRgb(hue, 1, 1);
  const rgbStr = `rgb(${hueColor.r},${hueColor.g},${hueColor.b})`;

  const gradH = svCtx.createLinearGradient(0, 0, svSize, 0);
  gradH.addColorStop(0, '#ffffff');
  gradH.addColorStop(1, rgbStr);
  svCtx.fillStyle = gradH;
  svCtx.fillRect(0, 0, svSize, svSize);

  const gradV = svCtx.createLinearGradient(0, 0, 0, svSize);
  gradV.addColorStop(0, 'rgba(0,0,0,0)');
  gradV.addColorStop(1, 'rgba(0,0,0,1)');
  svCtx.fillStyle = gradV;
  svCtx.fillRect(0, 0, svSize, svSize);
}

function updateUI() {
  const wheelAngle = hue * Math.PI / 180;
  const wheelR = (wheelRadius + wheelInner) / 2;
  const wheelX = wheelRadius + Math.cos(wheelAngle) * wheelR;
  const wheelY = wheelRadius + Math.sin(wheelAngle) * wheelR;
  wheelCursor.style.left = wheelX + 'px';
  wheelCursor.style.top = wheelY + 'px';

  const svX = svOffset + (sat * svSize);
  const svY = svOffset + ((1 - val) * svSize);
  svCursor.style.left = svX + 'px';
  svCursor.style.top = svY + 'px';

  const rgb = hsvToRgb(hue, sat, val);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  hexInput.value = hex;
  hexPreview.style.background = hex;
}

function updateHueFromPos(x, y) {
  hue = Math.atan2(y, x) * 180 / Math.PI;
  if (hue < 0) hue += 360;
  drawSV();
  updateUI();
}

function updateSVFromEvent(e) {
  const rect = svCanvas.getBoundingClientRect();
  let x = Math.max(0, Math.min(svSize, e.clientX - rect.left));
  let y = Math.max(0, Math.min(svSize, e.clientY - rect.top));
  sat = x / svSize;
  val = 1 - y / svSize;
  updateUI();
}

function close() {
  dialog.classList.remove('visible');
  currentOnApply = null;
}

/**
 * Open the color picker dialog.
 * @param {string} currentHex - Current hex color (e.g. '#ff0000')
 * @param {function} onApply - Called with the new hex string when user clicks Apply
 */
export function openColorPicker(currentHex, onApply) {
  initPicker();
  currentOnApply = onApply;

  const rgb = hexToRgb(currentHex || '#ffffff');
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  hue = hsv.h; sat = hsv.s; val = hsv.v;

  drawWheel();
  drawSV();
  updateUI();
  dialog.classList.add('visible');
}

/**
 * Intercept a native <input type="color"> so clicking it opens
 * the custom color picker instead of the browser's native one.
 * Existing input/change event listeners continue to work.
 */
export function hijackColorInput(input) {
  // Prevent native picker from opening
  input.addEventListener('click', (e) => {
    e.preventDefault();
    openColorPicker(input.value, (hex) => {
      input.value = hex;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
