import initDetect, { detect_faces } from './public/wasm/face-detect/wajah_detect.js';
import initBlur, { blur_rgba } from './public/wasm/blur/wajah_blur.js';

const $ = (s) => document.querySelector(s);
const ui = { input: $('#file-input'), list: $('#image-list'), empty: $('#empty-state'), editor: $('#editor'), name: $('#active-name'), size: $('#active-size'), canvas: $('#photo-canvas'), overlay: $('#overlay-canvas'), wrap: $('#canvas-wrap'), faceNote: $('#face-note'), dim: $('#dimension-note'), strength: $('#strength'), strengthLabel: $('#strength-label'), downloadOne: $('#download-one'), downloadAll: $('#download-all'), toast: $('#toast'), addArea: $('#add-area'), batch: $('#batch-loading'), batchText: $('#batch-loading-text'), drop: $('#drop-indicator'), cropRatio: $('#crop-ratio'), cropZoom: $('#crop-zoom'), background: $('#background-setting') };
const ctx = ui.canvas.getContext('2d', { willReadFrequently: true });
const overlayCtx = ui.overlay.getContext('2d');
let items = [], activeId = null, drag = null, cropMode = false, wasmReady = false, toastTimer, previewToken = 0;
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

ui.input.addEventListener('change', async (event) => { const files = [...event.target.files]; event.target.value = ''; await addFiles(files); });
async function addFiles(rawFiles) {
  const files = [...rawFiles].filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;
  ui.batch.hidden = false; ui.batchText.textContent = `Memuat ${files.length} foto…`;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const added = [];
  for (const file of files) {
    try { const image = await createImageBitmap(file); const item = { id: id(), file, image, thumbUrl: URL.createObjectURL(file), regions: [], status: 'ready', error: '', crop: frameFor(image, 'original', 'crop') }; items.push(item); added.push(item); }
    catch { toast(`Foto “${file.name}” tidak bisa dibuka.`); }
  }
  if (added.length) { activeId = added.at(-1).id; renderList(); showEditor(); select(activeId); }
  if (added.length) {
    ui.batchText.textContent = `Menyiapkan ${added.length} foto…`;
    try { await readyWasm(); await Promise.all(added.map(detect)); }
    catch (error) { console.error(error); toast('Editor belum siap. Muat ulang halaman untuk mencoba lagi.'); }
    finally { ui.batch.hidden = true; }
  } else ui.batch.hidden = true;
}
const workspace = document.querySelector('.workspace');
ui.list.addEventListener('scroll', () => document.querySelectorAll('.delete-popover').forEach((popover) => popover.remove()), { passive: true });
document.addEventListener('click', (event) => { if (!event.target.closest?.('.delete-popover,.row-remove')) document.querySelectorAll('.delete-popover').forEach((popover) => popover.remove()); });
['dragenter','dragover'].forEach((type) => workspace.addEventListener(type, (event) => { event.preventDefault(); if ([...event.dataTransfer.types].includes('Files')) ui.drop.classList.add('visible'); }));
['dragleave','drop'].forEach((type) => workspace.addEventListener(type, (event) => { event.preventDefault(); if (type === 'drop') { ui.drop.classList.remove('visible'); addFiles([...event.dataTransfer.files]); } else if (!workspace.contains(event.relatedTarget)) ui.drop.classList.remove('visible'); }));
document.addEventListener('dragover', (event) => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
document.addEventListener('drop', (event) => { if (event.target.closest?.('.workspace')) return; event.preventDefault(); ui.drop.classList.remove('visible'); if ([...event.dataTransfer.files].length) addFiles([...event.dataTransfer.files]); });

async function detect(item) {
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
  if (activeId === item.id) { renderList(); render(); updateNote(item); }
  else renderList();
}
function showEditor() { ui.empty.hidden = true; ui.editor.hidden = false; }
function renderList() {
  ui.list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'image-item-row';
    const button = document.createElement('button'); button.className = `image-item ${item.id === activeId ? 'active' : ''}`; button.type = 'button'; button.setAttribute('aria-label', `Pilih ${item.file.name}`);
    const thumb = document.createElement('img'); thumb.className = 'image-thumb'; thumb.src = item.thumbUrl; thumb.alt = '';
    const info = document.createElement('span'); info.className = 'image-info';
    const name = document.createElement('span'); name.className = 'image-name'; name.textContent = item.file.name;
    const meta = document.createElement('span'); meta.className = 'image-meta'; meta.textContent = niceSize(item.file.size);
    info.append(name, meta); button.append(thumb, info); button.addEventListener('click', () => select(item.id));
    const removeWrap = document.createElement('div'); removeWrap.className = 'row-remove-wrap';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'row-remove'; remove.setAttribute('aria-label', `Hapus ${item.file.name}`); remove.setAttribute('aria-haspopup', 'true'); remove.title = 'Hapus foto'; remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg>';
    remove.addEventListener('click', (event) => { event.stopPropagation(); openDeletePopover(item.id, removeWrap); });
    removeWrap.append(remove); row.append(button, removeWrap); ui.list.append(row);
  }
  ui.downloadAll.disabled = items.length === 0;
  if (!items.length) { ui.editor.hidden = true; ui.empty.hidden = false; }
}
function openDeletePopover(itemId, anchor) {
  document.querySelectorAll('.delete-popover').forEach((popover) => popover.remove());
  const popover = document.createElement('div'); popover.className = 'delete-popover'; popover.setAttribute('role', 'group'); popover.setAttribute('aria-label', 'Konfirmasi hapus foto');
  const question = document.createElement('span'); question.textContent = 'Hapus foto ini?';
  const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'delete-confirm'; yes.textContent = 'Sure';
  const no = document.createElement('button'); no.type = 'button'; no.className = 'delete-cancel'; no.textContent = 'Cancel';
  yes.addEventListener('click', (event) => { event.stopPropagation(); popover.remove(); removeItem(itemId); });
  no.addEventListener('click', (event) => { event.stopPropagation(); popover.remove(); });
  popover.append(question, yes, no); document.body.append(popover);
  const buttonBox = anchor.getBoundingClientRect(), popoverBox = popover.getBoundingClientRect();
  const top = buttonBox.bottom + popoverBox.height + 8 <= innerHeight ? buttonBox.top : Math.max(8, buttonBox.top - popoverBox.height - 8);
  const left = Math.max(8, Math.min(innerWidth - popoverBox.width - 8, buttonBox.right - popoverBox.width));
  popover.style.left = `${left}px`; popover.style.top = `${top}px`;
}
function removeItem(itemId) {
  const index = items.findIndex((entry) => entry.id === itemId); if (index < 0) return;
  const wasActive = activeId === itemId, [item] = items.splice(index, 1);
  item.image.close?.(); URL.revokeObjectURL(item.thumbUrl);
  if (wasActive) activeId = items[Math.min(index, items.length - 1)]?.id || null;
  renderList();
  if (activeId) select(activeId);
}
function select(which) {
  activeId = which; cropMode = false; $('#crop-position').setAttribute('aria-pressed', 'false'); $('#crop-position').classList.remove('selected'); ui.wrap.classList.remove('crop-active'); renderList(); showEditor();
  const item = selected(); ui.name.textContent = item.file.name; ui.size.textContent = niceSize(item.file.size); ui.cropRatio.value = item.crop.ratioKey || 'original';
  ui.cropZoom.value = String(item.crop.zoom || 1); document.querySelector(`input[name="frame-mode"][value="${item.crop.mode || 'crop'}"]`).checked = true;
  ui.background.querySelector(`input[value="${item.crop.background || 'white'}"]`).checked = true; syncFrameControls(item); updateNote(item); render();
}
function updateNote(item) {
  if (!item) return;
  ui.name.textContent = item.file.name; ui.size.textContent = niceSize(item.file.size); ui.dim.textContent = `${item.image.width} × ${item.image.height}`;
  const faces = item.regions.filter((region) => region.kind === 'face').length;
  ui.faceNote.textContent = item.status === 'error' ? 'Pencarian wajah gagal. Tambahkan area secara manual.' : faces ? `${faces} wajah terdeteksi` : 'Tidak ada wajah terdeteksi';
  ui.dim.textContent = `${Math.round(item.crop.width)} × ${Math.round(item.crop.height)} px`;
}
function render() {
  const item = selected(); if (!item) return;
  const token = ++previewToken;
  requestAnimationFrame(() => {
    if (token !== previewToken || item !== selected()) return;
    const crop = item.crop, transform = frameTransform(item.image, crop);
    ui.canvas.width = Math.max(1, Math.round(crop.width)); ui.canvas.height = Math.max(1, Math.round(crop.height));
    ui.overlay.width = ui.canvas.width; ui.overlay.height = ui.canvas.height;
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    if (crop.mode === 'expand') { ctx.fillStyle = crop.background === 'black' ? '#000' : '#fff'; ctx.fillRect(0, 0, crop.width, crop.height); ctx.drawImage(item.image, transform.offsetX, transform.offsetY, item.image.width * transform.scale, item.image.height * transform.scale); }
    else ctx.drawImage(item.image, crop.x, crop.y, crop.width, crop.height, 0, 0, ui.canvas.width, ui.canvas.height);
    const enabled = item.regions.filter((region) => region.enabled);
    if (enabled.length) {
      const pixels = ctx.getImageData(0, 0, ui.canvas.width, ui.canvas.height);
      const output = blur_rgba(new Uint8Array(pixels.data), ui.canvas.width, ui.canvas.height, enabled.map((region) => ({ ...region, x: region.x * transform.scale + transform.offsetX, y: region.y * transform.scale + transform.offsetY, width: region.width * transform.scale, height: region.height * transform.scale })), Number(ui.strength.value), selectedStyle());
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
    const transform = frameTransform(item.image, item.crop), rw = region.width * transform.scale, rh = region.height * transform.scale;
    const rx = region.x * transform.scale + transform.offsetX, ry = region.y * transform.scale + transform.offsetY;
    overlayCtx.save(); overlayCtx.translate(rx + rw / 2, ry + rh / 2); overlayCtx.rotate(region.angle * Math.PI / 180);
    overlayCtx.globalAlpha = region.enabled ? 1 : .48; overlayCtx.lineWidth = line; overlayCtx.setLineDash(region.enabled ? [] : [line * 2, line * 1.5]);
    overlayCtx.strokeStyle = region.kind === 'face' ? '#1672e8' : '#e28c35'; overlayCtx.fillStyle = region.kind === 'face' ? '#ffffff16' : '#ffffff22';
    overlayCtx.beginPath(); if (region.shape === 'oval') overlayCtx.ellipse(0, 0, rw / 2, rh / 2, 0, 0, Math.PI * 2); else overlayCtx.rect(-rw / 2, -rh / 2, rw, rh); overlayCtx.fill(); overlayCtx.stroke();
    if (region.id === item.selected || region.id === drag?.id) {
      overlayCtx.setLineDash([]); overlayCtx.fillStyle = '#fff'; overlayCtx.strokeStyle = '#1267cf'; overlayCtx.lineWidth = Math.max(2 * displayScale, line * .7);
      for (const [x, y] of [[-rw / 2, -rh / 2], [rw / 2, -rh / 2], [-rw / 2, rh / 2], [rw / 2, rh / 2]]) { overlayCtx.beginPath(); overlayCtx.arc(x, y, radius, 0, Math.PI * 2); overlayCtx.fill(); overlayCtx.stroke(); }
      overlayCtx.beginPath(); overlayCtx.moveTo(0, -rh / 2); overlayCtx.lineTo(0, -rh / 2 - radius * 2.5); overlayCtx.stroke();
      overlayCtx.beginPath(); overlayCtx.arc(0, -rh / 2 - radius * 2.5, radius * 1.35, 0, Math.PI * 2); overlayCtx.fill(); overlayCtx.stroke(); overlayCtx.strokeStyle = '#1267cf'; overlayCtx.lineWidth = Math.max(1.5 * displayScale, 1); overlayCtx.beginPath(); overlayCtx.arc(0, -rh / 2 - radius * 2.5, radius * .62, Math.PI * 1.1, Math.PI * 2.8); overlayCtx.stroke();
      const tx = rw / 2 + radius * 2.3, ty = -rh / 2;
      overlayCtx.fillStyle = '#d8444d'; overlayCtx.strokeStyle = '#fff'; overlayCtx.beginPath(); overlayCtx.arc(tx, ty, radius * 1.5, 0, Math.PI * 2); overlayCtx.fill(); overlayCtx.stroke();
      overlayCtx.strokeStyle = '#fff'; overlayCtx.lineWidth = Math.max(1.5 * displayScale, 1); overlayCtx.beginPath(); overlayCtx.moveTo(tx - radius * .5, ty - radius * .45); overlayCtx.lineTo(tx + radius * .5, ty - radius * .45); overlayCtx.moveTo(tx - radius * .35, ty - radius * .2); overlayCtx.lineTo(tx - radius * .25, ty + radius * .48); overlayCtx.lineTo(tx + radius * .25, ty + radius * .48); overlayCtx.lineTo(tx + radius * .35, ty - radius * .2); overlayCtx.moveTo(tx - radius * .25, ty - radius * .6); overlayCtx.lineTo(tx + radius * .25, ty - radius * .6); overlayCtx.stroke();
    }
    overlayCtx.restore();
  }
}
function frameTransform(image, frame) { return frame.mode === 'expand' ? { scale: frame.zoom, offsetX: frame.width / 2 - frame.centerX * frame.zoom, offsetY: frame.height / 2 - frame.centerY * frame.zoom } : { scale: 1, offsetX: -frame.x, offsetY: -frame.y }; }
function canvasPoint(event) { const box = ui.canvas.getBoundingClientRect(), item = selected(), transform = frameTransform(item.image, item.crop); const x = (event.clientX - box.left) * ui.canvas.width / box.width, y = (event.clientY - box.top) * ui.canvas.height / box.height; return { x: (x - transform.offsetX) / transform.scale, y: (y - transform.offsetY) / transform.scale }; }
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
  const local = localPoint(point, region), box = ui.canvas.getBoundingClientRect(), transform = frameTransform(selected().image, selected().crop);
  const scaleX = box.width ? box.width * transform.scale / ui.canvas.width : 1, scaleY = box.height ? box.height * transform.scale / ui.canvas.height : 1;
  const threshold = 12;
  const corners = [[-region.width / 2, -region.height / 2], [region.width / 2, -region.height / 2], [-region.width / 2, region.height / 2], [region.width / 2, region.height / 2]];
  let best = null, distance = threshold;
  for (const [x, y] of corners) { const d = Math.hypot((local.x - x) * scaleX, (local.y - y) * scaleY); if (d <= distance) { distance = d; best = { sx: Math.sign(x), sy: Math.sign(y) }; } }
  return best;
}
function handleHit(point, region, kind) {
  const box = ui.canvas.getBoundingClientRect(), transform = frameTransform(selected().image, selected().crop), scale = ui.canvas.width / ((box.width || 1) * transform.scale), local = localPoint(point, region), r = 11 * scale;
  if (kind === 'rotate') return Math.hypot(local.x, local.y + region.height / 2 + 15 * scale) <= r;
  return Math.hypot(local.x - region.width / 2 - 14 * scale, local.y + region.height / 2) <= r;
}
ui.canvas.addEventListener('pointerdown', (event) => {
  const item = selected(); if (!item) return; const point = canvasPoint(event); ui.canvas.setPointerCapture(event.pointerId);
  if (cropMode) { const box = ui.canvas.getBoundingClientRect(); drag = { mode: 'crop', start: { x: event.clientX, y: event.clientY }, scaleX: item.crop.width / box.width, scaleY: item.crop.height / box.height, orig: { ...item.crop } }; }
  else {
    const handleRegion = [...item.regions].reverse().find((candidate) => resizeCorner(point, candidate) || handleHit(point, candidate, 'rotate') || handleHit(point, candidate, 'trash'));
    const region = handleRegion || hitRegion(point);
    if (!region) { item.selected = null; drag = null; drawOverlay(item); return; }
    item.selected = region.id;
    if (handleHit(point, region, 'trash')) { item.regions = item.regions.filter((entry) => entry.id !== region.id); item.selected = item.regions.at(-1)?.id || null; render(); updateNote(item); return; }
    const corner = resizeCorner(point, region), mode = handleHit(point, region, 'rotate') ? 'rotate' : corner ? 'resize' : 'move';
    drag = { id: region.id, mode, corner, start: point, orig: { x: region.x, y: region.y, width: region.width, height: region.height, angle: region.angle } };
  }
  drawOverlay(item);
});
ui.canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  if (drag.mode === 'crop') { const item = selected(), crop = item.crop, dx = (event.clientX - drag.start.x) * drag.scaleX, dy = (event.clientY - drag.start.y) * drag.scaleY; if (crop.mode === 'expand') { crop.centerX = drag.orig.centerX - dx / crop.zoom; crop.centerY = drag.orig.centerY - dy / crop.zoom; } else { crop.x = Math.max(0, Math.min(item.image.width - crop.width, drag.orig.x - dx)); crop.y = Math.max(0, Math.min(item.image.height - crop.height, drag.orig.y - dy)); } render(); return; }
  const point = canvasPoint(event), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
  const region = selected()?.regions.find((r) => r.id === drag.id); if (!region) return;
  if (drag.mode === 'rotate') { const cx = region.x + region.width / 2, cy = region.y + region.height / 2; region.angle = drag.orig.angle + (Math.atan2(point.y - cy, point.x - cx) - Math.atan2(drag.start.y - cy, drag.start.x - cx)) * 180 / Math.PI; }
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
function endDrag() { if (!drag) return; const item = selected(); drag = null; render(); if (item) updateNote(item); }
ui.canvas.addEventListener('pointerup', endDrag); ui.canvas.addEventListener('pointercancel', endDrag);

document.querySelectorAll('.shape-choice').forEach((button) => button.addEventListener('click', () => {
  selectedShape = button.dataset.shape;
  document.querySelectorAll('.shape-choice').forEach((option) => option.setAttribute('aria-pressed', String(option === button)));
  for (const item of items) for (const region of item.regions) region.shape = selectedShape;
  render();
}));
ui.addArea.addEventListener('click', () => { const item = selected(); if (!item) return; const crop = item.crop, width = Math.min(item.image.width, Math.max(72, Math.min(item.image.width, crop.width / (crop.zoom || 1)) * .22)), height = Math.min(item.image.height, Math.max(64, Math.min(item.image.height, crop.height / (crop.zoom || 1)) * .22)), centerX = crop.mode === 'expand' ? crop.centerX : crop.x + crop.width / 2, centerY = crop.mode === 'expand' ? crop.centerY : crop.y + crop.height / 2; const region = { id: id(), kind: 'manual', shape: selectedShape, x: centerX - width / 2, y: centerY - height / 2, width, height, angle: 0, enabled: true }; item.regions.push(region); item.selected = region.id; render(); });
function ratioValue(image, ratioKey) {
  let ratio = image.width / image.height;
  if (ratioKey !== 'original') { const [w,h] = ratioKey.split(':').map(Number); ratio = w / h; }
  return ratio;
}
function frameFor(image, ratioKey, mode = 'crop', zoom = 1, centerX = image.width / 2, centerY = image.height / 2, background = 'white') {
  const ratio = ratioValue(image, ratioKey);
  if (mode === 'expand') {
    const width = image.width / image.height > ratio ? image.width : image.height * ratio;
    const height = width / ratio;
    return { mode, ratioKey, zoom, width, height, x: 0, y: 0, centerX, centerY, background };
  }
  let width = image.width, height = image.height;
  if (width / height > ratio) width = height * ratio; else height = width / ratio;
  width = Math.max(1, width / zoom); height = Math.max(1, height / zoom);
  return { mode, ratioKey, zoom, x: Math.max(0, Math.min(image.width - width, centerX - width / 2)), y: Math.max(0, Math.min(image.height - height, centerY - height / 2)), width, height, background };
}
function selectedFrameMode() { return document.querySelector('input[name="frame-mode"]:checked').value; }
function selectedStyle() { return document.querySelector('input[name="blur-style"]:checked').value; }
function syncFrameControls(item) { ui.background.hidden = item.crop.mode !== 'expand'; }
function changeActiveFrame(zoom = Number(ui.cropZoom.value), mode = selectedFrameMode(), ratio = ui.cropRatio.value) { const item = selected(); if (!item) return; const c = item.crop, centerX = c.mode === 'expand' ? c.centerX : c.x + c.width / 2, centerY = c.mode === 'expand' ? c.centerY : c.y + c.height / 2; item.crop = frameFor(item.image, ratio, mode, zoom, centerX, centerY, ui.background.querySelector('input:checked').value); syncFrameControls(item); render(); updateNote(item); }
ui.cropRatio.addEventListener('change', () => changeActiveFrame());
ui.cropZoom.addEventListener('input', () => changeActiveFrame(Number(ui.cropZoom.value)));
document.querySelectorAll('input[name="frame-mode"]').forEach((input) => input.addEventListener('change', () => changeActiveFrame()));
document.querySelectorAll('input[name="expand-background"]').forEach((input) => input.addEventListener('change', () => changeActiveFrame()));
$('#crop-position').addEventListener('click', (event) => { cropMode = !cropMode; event.currentTarget.setAttribute('aria-pressed', String(cropMode)); event.currentTarget.classList.toggle('selected', cropMode); ui.wrap.classList.toggle('crop-active', cropMode); });
$('#apply-crop-all').addEventListener('click', () => { const source = selected(), frame = source.crop, centerX = (frame.mode === 'expand' ? frame.centerX : frame.x + frame.width / 2) / source.image.width, centerY = (frame.mode === 'expand' ? frame.centerY : frame.y + frame.height / 2) / source.image.height, ratio = ui.cropRatio.value, mode = selectedFrameMode(), zoom = Number(ui.cropZoom.value), background = ui.background.querySelector('input:checked').value; for (const item of items) item.crop = frameFor(item.image, ratio, mode, zoom, centerX * item.image.width, centerY * item.image.height, background); render(); updateNote(selected()); toast('Bingkai diterapkan ke semua foto.'); });
$('#remove-image').addEventListener('click', () => { const item = selected(); if (!item) return; item.image.close?.(); URL.revokeObjectURL(item.thumbUrl); items = items.filter((entry) => entry.id !== item.id); activeId = items[0]?.id || null; renderList(); if (activeId) select(activeId); });
ui.strength.addEventListener('input', () => { ui.strengthLabel.textContent = ui.strength.value; render(); });
document.querySelectorAll('input[name="blur-style"]').forEach((input) => input.addEventListener('change', render));
async function download(item) {
  if (!item) return; await readyWasm();
  const crop = item.crop, transform = frameTransform(item.image, crop), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(crop.width)); canvas.height = Math.max(1, Math.round(crop.height));
  const outCtx = canvas.getContext('2d', { willReadFrequently: true }); if (crop.mode === 'expand') { outCtx.fillStyle = crop.background === 'black' ? '#000' : '#fff'; outCtx.fillRect(0, 0, canvas.width, canvas.height); outCtx.drawImage(item.image, transform.offsetX, transform.offsetY, item.image.width * transform.scale, item.image.height * transform.scale); } else outCtx.drawImage(item.image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const pixels = outCtx.getImageData(0, 0, canvas.width, canvas.height);
  const output = blur_rgba(new Uint8Array(pixels.data), canvas.width, canvas.height, item.regions.filter((region) => region.enabled).map((region) => ({ ...region, x: region.x * transform.scale + transform.offsetX, y: region.y * transform.scale + transform.offsetY, width: region.width * transform.scale, height: region.height * transform.scale })), Number(ui.strength.value), selectedStyle());
  pixels.data.set(output); outCtx.putImageData(pixels, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export failed');
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filenameBase(item.file.name)}-blur-face.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
ui.downloadOne.addEventListener('click', async () => { try { await download(selected()); toast('Foto siap diunduh.'); } catch (error) { console.error(error); toast('Unduhan gagal. Coba lagi.'); } });
ui.downloadAll.addEventListener('click', async () => { try { for (const item of items) await download(item); toast(`${items.length} foto mulai diunduh.`); } catch (error) { console.error(error); toast('Unduhan gagal. Coba lagi.'); } });
