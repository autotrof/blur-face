import initDetect, { detect_faces } from './public/wasm/face-detect/wajah_detect.js';
import initBlur, { blur_rgba } from './public/wasm/blur/wajah_blur.js';

const $ = (s) => document.querySelector(s);
const ui = { input: $('#file-input'), list: $('#image-list'), count: $('#image-count'), empty: $('#empty-state'), editor: $('#editor'), name: $('#active-name'), canvas: $('#photo-canvas'), wrap: $('#canvas-wrap'), faceNote: $('#face-note'), dim: $('#dimension-note'), scan: $('#scan-message'), areaList: $('#area-list'), strength: $('#strength'), strengthLabel: $('#strength-label'), style: $('#blur-style'), downloadOne: $('#download-one'), downloadAll: $('#download-all'), toast: $('#toast') };
const ctx = ui.canvas.getContext('2d', { willReadFrequently: true });
let items = []; let activeId = null; let addShape = null; let drag = null; let wasmReady = false; let toastTimer;
const randAngle = () => Math.round((Math.random() * 30) - 15);
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

async function readyWasm() {
  if (wasmReady) return;
  await Promise.all([
    initDetect(new URL('./public/wasm/face-detect/wajah_detect_bg.wasm', import.meta.url)),
    initBlur(new URL('./public/wasm/blur/wajah_blur_bg.wasm', import.meta.url)),
  ]);
  wasmReady = true;
}
function active() { return items.find(x => x.id === activeId); }
function toast(msg) { ui.toast.textContent = msg; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800); }
function niceSize(bytes) { return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1e6).toFixed(1)} MB`; }
function filenameBase(s) { return (s || 'foto').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'foto'; }

ui.input.addEventListener('change', async (ev) => {
  const files = [...ev.target.files].filter(f => f.type.startsWith('image/'));
  ev.target.value = '';
  if (!files.length) return;
  try { await readyWasm(); } catch (e) { toast('Alat belum siap. Coba muat ulang halaman.'); console.error(e); return; }
  for (const file of files) {
    try {
      const image = await createImageBitmap(file);
      const item = { id: id(), file, image, thumbUrl: URL.createObjectURL(file), regions: [], status: 'scanning', error: '' };
      items.push(item); activeId = item.id; renderList(); showEditor(); draw();
      detect(item);
    } catch { toast(`Foto “${file.name}” tidak bisa dibuka.`); }
  }
});
async function detect(item) {
  ui.scan.hidden = false;
  try {
    const max = 1280, scale = Math.min(1, max / Math.max(item.image.width, item.image.height));
    const w = Math.max(1, Math.round(item.image.width * scale)); const h = Math.max(1, Math.round(item.image.height * scale));
    const temp = document.createElement('canvas'); temp.width = w; temp.height = h;
    const tctx = temp.getContext('2d', { willReadFrequently: true }); tctx.drawImage(item.image, 0, 0, w, h);
    const pix = tctx.getImageData(0, 0, w, h).data; const gray = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < pix.length; p += 4, i++) gray[i] = (77 * pix[p] + 150 * pix[p + 1] + 29 * pix[p + 2]) >> 8;
    const minFace = 20;
    const faces = detect_faces(gray, w, h, minFace);
    const hits = faces.map(f => {
      const x = f.x / scale, y = f.y / scale, fw = f.width / scale, fh = f.height / scale;
      // Extend the detected box to include hairline, jaw, and side margins.
      const mx = fw * .2, top = fh * .34, bottom = fh * .27;
      const rx = Math.max(0, x - mx), ry = Math.max(0, y - top);
      return { id: id(), kind: 'face', shape: 'oval', x: rx, y: ry,
        width: Math.min(item.image.width - rx, fw + mx * 2),
        height: Math.min(item.image.height - ry, fh + top + bottom), angle: randAngle(), enabled: true };
    });
    item.regions = hits; item.status = 'ready';
  } catch (err) { item.status = 'error'; item.error = String(err); console.error(err); }
  if (activeId === item.id) { ui.scan.hidden = true; renderList(); renderAreas(); draw(); updateNote(item); }
  else renderList();
}
function showEditor() { ui.empty.hidden = true; ui.editor.hidden = false; ui.downloadAll.disabled = false; }
function renderList() {
  ui.count.textContent = items.length;
  ui.downloadAll.disabled = items.length === 0;
  ui.list.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button'); button.className = `image-item ${item.id === activeId ? 'active' : ''}`; button.type = 'button'; button.setAttribute('aria-label', `Pilih ${item.file.name}`);
    const thumb = document.createElement('img'); thumb.className = 'image-thumb'; thumb.src = item.thumbUrl; thumb.alt = '';
    const info = document.createElement('span'); info.innerHTML = `<span class="image-name"></span><span class="image-meta"></span>`;
    info.querySelector('.image-name').textContent = item.file.name; info.querySelector('.image-meta').textContent = item.status === 'scanning' ? 'Mencari wajah…' : `${item.regions.filter(r=>r.kind==='face').length} wajah · ${niceSize(item.file.size)}`;
    const state = document.createElement('span'); state.className = 'image-state'; state.textContent = item.status === 'scanning' ? '◌' : (item.regions.some(r=>r.enabled) ? '✓' : '');
    button.append(thumb, info, state); button.addEventListener('click', () => select(item.id)); ui.list.append(button);
  }
  if (!items.length) { ui.editor.hidden = true; ui.empty.hidden = false; }
}
function select(which) { activeId = which; addShape = null; renderList(); showEditor(); const item = active(); ui.name.textContent = item.file.name; ui.scan.hidden = item.status !== 'scanning'; renderAreas(); updateNote(item); draw(); }
function updateNote(item) {
  ui.name.textContent = item.file.name; ui.dim.textContent = `${item.image.width} × ${item.image.height}`;
  const n = item.regions.filter(r=>r.kind==='face').length;
  ui.faceNote.textContent = item.status === 'scanning' ? 'Foto sedang dipindai…' : item.status === 'error' ? 'Pencarian wajah gagal. Anda tetap bisa menambah area sendiri.' : n ? `${n} wajah ditemukan. Area diperluas agar wajah tertutup lebih menyeluruh.` : 'Wajah belum ditemukan. Tambahkan area oval atau kotak secara manual.';
}
function renderAreas() {
  const item = active(); if (!item) return; ui.areaList.replaceChildren();
  if (!item.regions.length) { const e = document.createElement('span'); e.className='image-meta'; e.textContent='Belum ada area samar.'; ui.areaList.append(e); return; }
  item.regions.forEach((r, i) => {
    const chip = document.createElement('label'); chip.className = `area-chip ${r.enabled?'':'off'}`;
    const check = document.createElement('input'); check.type='checkbox'; check.checked=r.enabled; check.setAttribute('aria-label', `Aktifkan area ${i+1}`); check.addEventListener('change',()=>{r.enabled=check.checked; chip.classList.toggle('off',!r.enabled); draw(); renderList();});
    const text = document.createElement('span'); text.textContent = r.kind==='face' ? `Wajah ${item.regions.slice(0,i+1).filter(x=>x.kind==='face').length}` : `${r.shape==='oval'?'Oval':'Kotak'} ${i+1}`;
    const del=document.createElement('button'); del.type='button';del.className='area-delete';del.title='Hapus area';del.textContent='×';del.addEventListener('click',(e)=>{e.preventDefault();item.regions.splice(i,1);renderAreas();draw();renderList();updateNote(item);});
    chip.append(check,text,del);ui.areaList.append(chip);
  });
}
function draw() {
  const item = active(); if (!item) return;
  ui.canvas.width = item.image.width; ui.canvas.height = item.image.height;
  ctx.clearRect(0,0,ui.canvas.width,ui.canvas.height); ctx.drawImage(item.image,0,0);
  const line = Math.max(3, Math.min(ui.canvas.width,ui.canvas.height)*.003);
  for (const [index,r] of item.regions.entries()) {
    ctx.save(); ctx.translate(r.x+r.width/2,r.y+r.height/2); ctx.rotate(r.angle*Math.PI/180);
    ctx.globalAlpha = r.enabled ? 1 : .42; ctx.lineWidth=line; ctx.setLineDash(r.enabled ? [] : [line*2,line*1.5]);
    ctx.strokeStyle = r.kind==='face' ? '#baf082' : '#ffc27b'; ctx.fillStyle = r.kind==='face' ? '#baf08216' : '#ffc27b16';
    ctx.beginPath(); if(r.shape==='oval')ctx.ellipse(0,0,r.width/2,r.height/2,0,0,Math.PI*2);else ctx.rect(-r.width/2,-r.height/2,r.width,r.height);ctx.fill();ctx.stroke();
    if (r.id===drag?.id || r.id===item.selected) { ctx.setLineDash([]);ctx.fillStyle='#fff';ctx.strokeStyle='#315f46';ctx.beginPath();ctx.arc(r.width/2,r.height/2,line*2.2,0,Math.PI*2);ctx.fill();ctx.stroke(); }
    ctx.restore();
  }
}
function canvasPoint(e) { const b=ui.canvas.getBoundingClientRect(); return {x:(e.clientX-b.left)*ui.canvas.width/b.width,y:(e.clientY-b.top)*ui.canvas.height/b.height}; }
function hitRegion(p) { const item=active(); for(let i=item.regions.length-1;i>=0;i--){const r=item.regions[i],dx=p.x-r.x-r.width/2,dy=p.y-r.y-r.height/2,a=-r.angle*Math.PI/180,lx=dx*Math.cos(a)-dy*Math.sin(a),ly=dx*Math.sin(a)+dy*Math.cos(a);if(r.shape==='oval'?((lx/(r.width/2))**2+(ly/(r.height/2))**2<=1):(Math.abs(lx)<=r.width/2&&Math.abs(ly)<=r.height/2))return r;} return null; }
ui.canvas.addEventListener('pointerdown', e => {
  const item=active(); if(!item)return; ui.canvas.setPointerCapture(e.pointerId); const p=canvasPoint(e);
  if(addShape){const r={id:id(),kind:'manual',shape:addShape,x:p.x,y:p.y,width:1,height:1,angle:randAngle(),enabled:true};item.regions.push(r);item.selected=r.id;drag={id:r.id,mode:'create',start:p,orig:{...r}};addShape=null;$('#add-oval').classList.remove('selected');$('#add-rect').classList.remove('selected');}
  else {const r=hitRegion(p);if(!r){item.selected=null;drag=null;draw();return;}item.selected=r.id;const a=r.angle*Math.PI/180, hx=r.x+r.width/2+Math.cos(a)*r.width/2-Math.sin(a)*r.height/2, hy=r.y+r.height/2+Math.sin(a)*r.width/2+Math.cos(a)*r.height/2;const handle=Math.max(18,Math.min(ui.canvas.width,ui.canvas.height)*.02);const resize=Math.hypot(p.x-hx,p.y-hy)<handle;drag={id:r.id,mode:resize?'resize':'move',start:p,orig:{x:r.x,y:r.y,width:r.width,height:r.height}};}
  draw();
});
ui.canvas.addEventListener('pointermove',e=>{if(!drag)return;const r=active().regions.find(x=>x.id===drag.id);if(!r)return;const p=canvasPoint(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(drag.mode==='create'){r.x=Math.min(drag.start.x,p.x);r.y=Math.min(drag.start.y,p.y);r.width=Math.abs(dx);r.height=Math.abs(dy);}else if(drag.mode==='resize'){r.width=Math.max(24,drag.orig.width+dx);r.height=Math.max(24,drag.orig.height+dy);}else{r.x=drag.orig.x+dx;r.y=drag.orig.y+dy;}draw();});
ui.canvas.addEventListener('pointerup',()=>{if(!drag)return;const item=active();const r=item.regions.find(x=>x.id===drag.id);if(drag.mode==='create'&&r&&(r.width<15||r.height<15)){item.regions=item.regions.filter(x=>x!==r);toast('Tarik area sedikit lebih besar.');}drag=null;renderAreas();draw();renderList();updateNote(item);});
function setAdd(shape, button) { addShape=shape; $('#add-oval').classList.toggle('selected',shape==='oval');$('#add-rect').classList.toggle('selected',shape==='rect');toast(`Tarik di foto untuk membuat area ${shape==='oval'?'oval':'kotak'}.`); }
$('#add-oval').addEventListener('click',()=>setAdd('oval',$('#add-oval')));$('#add-rect').addEventListener('click',()=>setAdd('rect',$('#add-rect')));
$('#remove-image').addEventListener('click',()=>{const item=active();if(!item)return;item.image.close?.();URL.revokeObjectURL(item.thumbUrl);items=items.filter(x=>x.id!==item.id);activeId=items[0]?.id||null;renderList();if(activeId)select(activeId);});
$('#clear-areas').addEventListener('click',()=>{const item=active();if(!item)return;item.regions=[];renderAreas();draw();renderList();updateNote(item);});
ui.strength.addEventListener('input',()=>ui.strengthLabel.textContent=ui.strength.value);
async function download(item) {
  if (!item) return;
  await readyWasm(); const c=document.createElement('canvas');c.width=item.image.width;c.height=item.image.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(item.image,0,0);
  const pixels=x.getImageData(0,0,c.width,c.height);const out=blur_rgba(new Uint8Array(pixels.data),c.width,c.height,item.regions.map(r=>({...r})),Number(ui.strength.value),ui.style.value);
  pixels.data.set(out);x.putImageData(pixels,0,0);
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${filenameBase(item.file.name)}-rapi.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
ui.downloadOne.addEventListener('click',async()=>{try{await download(active());toast('Foto siap diunduh.')}catch(e){console.error(e);toast('Unduhan gagal. Coba lagi.');}});
ui.downloadAll.addEventListener('click',async()=>{try{for(const item of items)await download(item);toast(`${items.length} foto mulai diunduh.`);}catch(e){console.error(e);toast('Unduhan gagal. Coba lagi.');}});
