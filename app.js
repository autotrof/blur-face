import initDetect, { detect_faces } from './public/wasm/face-detect/wajah_detect.js';
import initBlur, { blur_rgba } from './public/wasm/blur/wajah_blur.js';

const $ = (s) => document.querySelector(s);
const ui = { input: $('#file-input'), list: $('#image-list'), empty: $('#empty-state'), editor: $('#editor'), name: $('#active-name'), size: $('#active-size'), canvas: $('#photo-canvas'), overlay: $('#overlay-canvas'), wrap: $('#canvas-wrap'), faceNote: $('#face-note'), dim: $('#dimension-note'), scan: $('#scan-message'), areaList: $('#area-list'), strength: $('#strength'), strengthLabel: $('#strength-label'), style: $('#blur-style'), downloadOne: $('#download-one'), downloadAll: $('#download-all'), toast: $('#toast'), addArea: $('#add-area') };
const ctx = ui.canvas.getContext('2d', { willReadFrequently: true });
const overlayCtx = ui.overlay.getContext('2d');
let items = [], activeId = null, addMode = false, drag = null, wasmReady = false, toastTimer, previewToken = 0;
let selectedShape = 'oval';
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const randAngle = () => Math.round(Math.random() * 30 - 15);
const selected = () => items.find((item) => item.id === activeId);
async function readyWasm() {
  if (wasmReady) return;
  await Promise.all([
    initDetect(new URL('./public/wasm/face-detect/wajah_detect_bg.wasm', import.meta.url)),
    initBlur(new URL('./public/wasm/blur/wajah_blur_bg.wasm', import.meta.url)),
  ]);
  wasmReady = true;
}
function toast(message) { ui.toast.textContent = message; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600); }
function niceSize(bytes) { return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1e6).toFixed(1)} MB`; }
function filenameBase(name) { return (name || 'foto').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'foto'; }

ui.input.addEventListener('change', async (event) => {
  const files = [...event.target.files].filter((file) => file.type.startsWith('image/'));
  event.target.value = '';
  if (!files.length) return;
  try { await readyWasm(); } catch (error) { console.error(error); toast('Editor belum siap. Muat ulang halaman untuk mencoba lagi.'); return; }
  for (const file of files) {
    try {
      const image = await createImageBitmap(file);
      const item = { id: id(), file, image, thumbUrl: URL.createObjectURL(file), regions: [], status: 'scanning', error: '' };
      items.push(item); activeId = item.id; renderList(); showEditor(); render();
      detect(item);
    } catch { toast(`Foto “${file.name}” tidak bisa dibuka.`); }
  }
});

async function detect(item) {
  if (activeId === item.id) ui.scan.hidden = false;
  try {
    const scale = Math.min(1, 1280 / Math.max(item.image.width, item.image.height));
    const width = Math.max(1, Math.round(item.image.width * scale)), height = Math.max(1, Math.round(item.image.height * scale));
    const temp = document.createElement('canvas'); temp.width = width; temp.height = height;
    const tempCtx = temp.getContext('2d', { willReadFrequently: true }); tempCtx.drawImage(item.image, 0, 0, width, height);
    const rgba = tempCtx.getImageData(0, 0, width, height).data, gray = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < rgba.length; p += 4, i++) gray[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
    const faces = detect_faces(gray, width, height, 20);
    item.regions = faces.map((face) => {
      const x = face.x / scale, y = face.y / scale, fw = face.width / scale, fh = face.height / scale;
      const mx = fw * .2, top = fh * .34, bottom = fh * .27;
      const rx = Math.max(0, x - mx), ry = Math.max(0, y - top);
      return { id: id(), kind: 'face', shape: selectedShape, x: rx, y: ry,
        width: Math.min(item.image.width - rx, fw + mx * 2), height: Math.min(item.image.height - ry, fh + top + bottom), angle: randAngle(), enabled: true };
    });
    item.selected = item.regions[0]?.id || null;
    item.status = 'ready';
  } catch (error) { item.status = 'error'; item.error = String(error); console.error(error); }
  if (activeId === item.id) { ui.scan.hidden = true; renderList(); renderAreas(); render(); updateNote(item); }
  else renderList();
}
function showEditor() { ui.empty.hidden = true; ui.editor.hidden = false; }
function renderList() {
  ui.list.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button'); button.className = `image-item ${item.id === activeId ? 'active' : ''}`; button.type = 'button'; button.setAttribute('aria-label', `Pilih ${item.file.name}`);
    const thumb = document.createElement('img'); thumb.className = 'image-thumb'; thumb.src = item.thumbUrl; thumb.alt = '';
    const info = document.createElement('span'); info.className = 'image-info';
    const name = document.createElement('span'); name.className = 'image-name'; name.textContent = item.file.name;
    const meta = document.createElement('span'); meta.className = 'image-meta'; meta.textContent = niceSize(item.file.size);
    info.append(name, meta); button.append(thumb, info); button.addEventListener('click', () => select(item.id)); ui.list.append(button);
  }
  ui.downloadAll.disabled = items.length === 0;
  if (!items.length) { ui.editor.hidden = true; ui.empty.hidden = false; }
}
function select(which) {
  activeId = which; addMode = false; ui.addArea.classList.remove('selected'); renderList(); showEditor();
  const item = selected(); ui.name.textContent = item.file.name; ui.size.textContent = niceSize(item.file.size);
  ui.scan.hidden = item.status !== 'scanning'; renderAreas(); updateNote(item); render();
}
function updateNote(item) {
  if (!item) return;
  ui.name.textContent = item.file.name; ui.size.textContent = niceSize(item.file.size); ui.dim.textContent = `${item.image.width} × ${item.image.height}`;
  const faces = item.regions.filter((region) => region.kind === 'face').length;
  ui.faceNote.textContent = item.status === 'scanning' ? 'Mencari wajah…' : item.status === 'error' ? 'Pencarian wajah gagal. Tambahkan area secara manual.' : faces ? `${faces} wajah terdeteksi` : 'Tidak ada wajah terdeteksi';
}
function renderAreas() {
  const item = selected(); if (!item) return; ui.areaList.replaceChildren();
  if (!item.regions.length) { const empty = document.createElement('span'); empty.className = 'image-meta'; empty.textContent = 'Belum ada area'; ui.areaList.append(empty); return; }
  item.regions.forEach((region, index) => {
    const chip = document.createElement('label'); chip.className = `area-chip ${region.enabled ? '' : 'off'}`;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = region.enabled; check.setAttribute('aria-label', `Aktifkan area ${index + 1}`);
    check.addEventListener('change', () => { region.enabled = check.checked; chip.classList.toggle('off', !region.enabled); render(); });
    const label = document.createElement('span'); label.textContent = region.kind === 'face' ? `Wajah ${item.regions.slice(0, index + 1).filter((r) => r.kind === 'face').length}` : `Area ${index + 1}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'area-delete'; remove.title = 'Hapus area'; remove.setAttribute('aria-label', `Hapus area ${index + 1}`); remove.textContent = '×';
    remove.addEventListener('click', (event) => { event.preventDefault(); item.regions.splice(index, 1); renderAreas(); render(); updateNote(item); });
    chip.append(check, label, remove); ui.areaList.append(chip);
  });
}

function render() {
  const item = selected(); if (!item) return;
  const token = ++previewToken;
  requestAnimationFrame(() => {
    if (token !== previewToken || item !== selected()) return;
    ui.canvas.width = item.image.width; ui.canvas.height = item.image.height;
    ui.overlay.width = item.image.width; ui.overlay.height = item.image.height;
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height); ctx.drawImage(item.image, 0, 0);
    const enabled = item.regions.filter((region) => region.enabled);
    if (enabled.length) {
      const pixels = ctx.getImageData(0, 0, ui.canvas.width, ui.canvas.height);
      const output = blur_rgba(new Uint8Array(pixels.data), ui.canvas.width, ui.canvas.height, enabled.map((region) => ({ ...region })), Number(ui.strength.value), ui.style.value);
      pixels.data.set(output); ctx.putImageData(pixels, 0, 0);
    }
    drawRegions(item);
  });
}
function drawOverlay(item = selected()) {
  if (!item || !ui.overlay.width || !ui.overlay.height) return;
  overlayCtx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  drawRegions(item);
}
function drawRegions(item) {
  const box = ui.canvas.getBoundingClientRect();
  const displayScale = box.width ? ui.canvas.width / box.width : 1;
  const line = 2 * displayScale;
  const radius = 6 * displayScale;
  for (const region of item.regions) {
    overlayCtx.save(); overlayCtx.translate(region.x + region.width / 2, region.y + region.height / 2); overlayCtx.rotate(region.angle * Math.PI / 180);
    overlayCtx.globalAlpha = region.enabled ? 1 : .48; overlayCtx.lineWidth = line; overlayCtx.setLineDash(region.enabled ? [] : [line * 2, line * 1.5]);
    overlayCtx.strokeStyle = region.kind === 'face' ? '#1672e8' : '#e28c35'; overlayCtx.fillStyle = region.kind === 'face' ? '#ffffff16' : '#ffffff22';
    overlayCtx.beginPath(); if (region.shape === 'oval') overlayCtx.ellipse(0, 0, region.width / 2, region.height / 2, 0, 0, Math.PI * 2); else overlayCtx.rect(-region.width / 2, -region.height / 2, region.width, region.height); overlayCtx.fill(); overlayCtx.stroke();
    if (region.id === item.selected || region.id === drag?.id) {
      overlayCtx.setLineDash([]); overlayCtx.fillStyle = '#fff'; overlayCtx.strokeStyle = '#1267cf'; overlayCtx.lineWidth = Math.max(2 * displayScale, line * .7);
      for (const [x, y] of [[-region.width / 2, -region.height / 2], [region.width / 2, -region.height / 2], [-region.width / 2, region.height / 2], [region.width / 2, region.height / 2]]) { overlayCtx.beginPath(); overlayCtx.arc(x, y, radius, 0, Math.PI * 2); overlayCtx.fill(); overlayCtx.stroke(); }
    }
    overlayCtx.restore();
  }
}
function canvasPoint(event) { const box = ui.canvas.getBoundingClientRect(); return { x: (event.clientX - box.left) * ui.canvas.width / box.width, y: (event.clientY - box.top) * ui.canvas.height / box.height }; }
function localPoint(point, region) { const dx = point.x - region.x - region.width / 2, dy = point.y - region.y - region.height / 2, angle = -region.angle * Math.PI / 180; return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) }; }
function hitRegion(point) {
  const item = selected();
  for (let i = item.regions.length - 1; i >= 0; i--) {
    const region = item.regions[i], local = localPoint(point, region);
    const inside = region.shape === 'oval' ? (local.x / (region.width / 2)) ** 2 + (local.y / (region.height / 2)) ** 2 <= 1 : Math.abs(local.x) <= region.width / 2 && Math.abs(local.y) <= region.height / 2;
    if (inside) return region;
  }
  return null;
}
function resizeCorner(point, region) {
  const local = localPoint(point, region), box = ui.canvas.getBoundingClientRect();
  const scaleX = box.width ? box.width / ui.canvas.width : 1, scaleY = box.height ? box.height / ui.canvas.height : 1;
  const threshold = 12;
  const corners = [[-region.width / 2, -region.height / 2], [region.width / 2, -region.height / 2], [-region.width / 2, region.height / 2], [region.width / 2, region.height / 2]];
  let best = null, distance = threshold;
  for (const [x, y] of corners) { const d = Math.hypot((local.x - x) * scaleX, (local.y - y) * scaleY); if (d <= distance) { distance = d; best = { sx: Math.sign(x), sy: Math.sign(y) }; } }
  return best;
}
ui.canvas.addEventListener('pointerdown', (event) => {
  const item = selected(); if (!item) return; const point = canvasPoint(event); ui.canvas.setPointerCapture(event.pointerId);
  if (addMode) {
    const region = { id: id(), kind: 'manual', shape: selectedShape, x: point.x, y: point.y, width: 1, height: 1, angle: randAngle(), enabled: true };
    item.regions.push(region); item.selected = region.id; drag = { id: region.id, mode: 'create', start: point, orig: { ...region } }; addMode = false; ui.addArea.classList.remove('selected');
  } else {
    const item = selected();
    const handleRegion = [...item.regions].reverse().find((candidate) => resizeCorner(point, candidate));
    const region = handleRegion || hitRegion(point);
    if (!region) { item.selected = null; drag = null; drawOverlay(item); return; }
    item.selected = region.id; const corner = resizeCorner(point, region);
    drag = { id: region.id, mode: corner ? 'resize' : 'move', corner, start: point, orig: { x: region.x, y: region.y, width: region.width, height: region.height } };
  }
  drawOverlay(item);
});
ui.canvas.addEventListener('pointermove', (event) => {
  if (!drag) return; const region = selected()?.regions.find((r) => r.id === drag.id); if (!region) return;
  const point = canvasPoint(event), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
  if (drag.mode === 'create') { region.x = Math.min(drag.start.x, point.x); region.y = Math.min(drag.start.y, point.y); region.width = Math.abs(dx); region.height = Math.abs(dy); }
  else if (drag.mode === 'resize') {
    const angle = region.angle * Math.PI / 180, localDx = dx * Math.cos(angle) + dy * Math.sin(angle), localDy = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const width = Math.max(24, drag.orig.width + localDx * drag.corner.sx), height = Math.max(24, drag.orig.height + localDy * drag.corner.sy);
    const centerShiftX = drag.corner.sx * (width - drag.orig.width) / 2, centerShiftY = drag.corner.sy * (height - drag.orig.height) / 2;
    const shiftX = centerShiftX * Math.cos(angle) - centerShiftY * Math.sin(angle), shiftY = centerShiftX * Math.sin(angle) + centerShiftY * Math.cos(angle);
    region.width = width; region.height = height;
    region.x = drag.orig.x + shiftX + (drag.orig.width - width) / 2;
    region.y = drag.orig.y + shiftY + (drag.orig.height - height) / 2;
  } else { region.x = drag.orig.x + dx; region.y = drag.orig.y + dy; }
  drawOverlay();
});
function endDrag() { if (!drag) return; const item = selected(), region = item?.regions.find((r) => r.id === drag.id); if (drag.mode === 'create' && region && (region.width < 15 || region.height < 15)) { item.regions = item.regions.filter((r) => r.id !== region.id); toast('Seret area dengan ukuran lebih besar.'); } drag = null; renderAreas(); render(); if (item) updateNote(item); }
ui.canvas.addEventListener('pointerup', endDrag); ui.canvas.addEventListener('pointercancel', endDrag);

document.querySelectorAll('.shape-choice').forEach((button) => button.addEventListener('click', () => {
  selectedShape = button.dataset.shape;
  document.querySelectorAll('.shape-choice').forEach((option) => option.setAttribute('aria-pressed', String(option === button)));
  for (const item of items) for (const region of item.regions) region.shape = selectedShape;
  render();
}));
ui.addArea.addEventListener('click', () => { addMode = !addMode; ui.addArea.classList.toggle('selected', addMode); if (addMode) toast(`Seret di foto untuk membuat area ${selectedShape === 'oval' ? 'oval' : 'persegi'}.`); });
$('#remove-image').addEventListener('click', () => { const item = selected(); if (!item) return; item.image.close?.(); URL.revokeObjectURL(item.thumbUrl); items = items.filter((entry) => entry.id !== item.id); activeId = items[0]?.id || null; renderList(); if (activeId) select(activeId); });
$('#clear-areas').addEventListener('click', () => { const item = selected(); if (!item) return; item.regions = []; renderAreas(); render(); updateNote(item); });
ui.strength.addEventListener('input', () => { ui.strengthLabel.textContent = ui.strength.value; render(); });
ui.style.addEventListener('change', render);
async function download(item) {
  if (!item) return; await readyWasm();
  const canvas = document.createElement('canvas'); canvas.width = item.image.width; canvas.height = item.image.height;
  const outCtx = canvas.getContext('2d', { willReadFrequently: true }); outCtx.drawImage(item.image, 0, 0);
  const pixels = outCtx.getImageData(0, 0, canvas.width, canvas.height);
  const output = blur_rgba(new Uint8Array(pixels.data), canvas.width, canvas.height, item.regions.map((region) => ({ ...region })), Number(ui.strength.value), ui.style.value);
  pixels.data.set(output); outCtx.putImageData(pixels, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export failed');
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filenameBase(item.file.name)}-rapi.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
ui.downloadOne.addEventListener('click', async () => { try { await download(selected()); toast('Foto siap diunduh.'); } catch (error) { console.error(error); toast('Unduhan gagal. Coba lagi.'); } });
ui.downloadAll.addEventListener('click', async () => { try { for (const item of items) await download(item); toast(`${items.length} foto mulai diunduh.`); } catch (error) { console.error(error); toast('Unduhan gagal. Coba lagi.'); } });
