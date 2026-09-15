const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const icons = {
  layout:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
  archive:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  feather:'<path d="M20 3c-5-1-13 3-13 10v4h4c6 0 10-8 9-14ZM4 21 16 9M7 17h6M11 13V9"/>',
  save:'<path d="m5 3 12 0 4 4v14H3V3h2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  images:'<rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 8v11a2 2 0 0 0 2 2h11M7 13l4-4 5 5 2-2 3 3"/><circle cx="16" cy="7" r="1"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 5 5 3-3 5 5"/><circle cx="15" cy="8" r="1.5"/>',
  file:'<path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h6"/>',
  sparkles:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4M18 4h4"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>'
};
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[el.dataset.icon] || ''}</svg>`; });

let token, settings, jobs = [], current = null, draft = null, mode = 'preview';
let draftDirty = false, materialDirty = false, materialVersion = 0, saveTimer, pollTimer, toastTimer;
let saveQueue = Promise.resolve(), uploadBusy = false, switching = false, publishStarting = false, publishTimer;
let deleting = false, draftSave = Promise.resolve();
const isPublishing = p => ['preparing','waiting_login','uploading','filling','submitting','verifying'].includes(p?.phase);
const busy = (allowPublicationSave = false) => deleting || uploadBusy || (!allowPublicationSave && publishStarting) || current?.generation.phase === 'generating' || isPublishing(current?.publication);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-App-Token': token || '', ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.json !== undefined ? JSON.stringify(options.json) : options.body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '작업을 완료하지 못했습니다.');
  return data;
}
function toast(message, error = false, undo) {
  clearTimeout(toastTimer); const el = $('toast'); el.textContent = message; el.className = `toast${error ? ' error' : ''}`; el.hidden = false;
  if (undo) { const b = document.createElement('button'); b.textContent = '되돌리기'; b.onclick = () => { undo(); el.hidden = true; }; el.append(b); }
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 4000);
}
function modal(title, content) { $('modal-title').textContent = title; $('modal-content').replaceChildren(content); if (!$('modal').open) $('modal').showModal(); }
$('close-modal').onclick = () => $('modal').close();
$('modal').addEventListener('cancel', e => { if (deleting) e.preventDefault(); });
$('modal').addEventListener('click', e => { if (!deleting && e.target === $('modal') && (e.offsetX < 0 || e.offsetY < 0 || e.offsetX > $('modal').clientWidth || e.offsetY > $('modal').clientHeight)) $('modal').close(); });
function saveStatus(text) { $('save-state').textContent = text; }
function markMaterial() { materialDirty = true; materialVersion++; saveStatus('변경사항 보관 중…'); clearTimeout(saveTimer); saveTimer = setTimeout(() => saveMaterial().catch(e => { saveStatus('보관 실패'); toast(e.message,true); }), 800); }
function markDraft() { draftDirty = true; saveStatus('수정한 글 · 보관 필요'); updateFooter(); }

async function ensureJob() {
  if (!current) {
    current = await api('/api/jobs', { method:'POST', json:{ title:$('topic').value } });
    localStorage.setItem('hdev.current', current.id);
  }
  return current;
}
async function saveMaterial(allowPublicationSave = false) {
  clearTimeout(saveTimer);
  if (!materialDirty || busy(allowPublicationSave)) return saveQueue;
  await ensureJob();
  const id = current.id, version = materialVersion;
  const body = { title:$('topic').value, notes:$('notes').value, order:current.images.map(i => i.name) };
  const task = saveQueue.catch(() => {}).then(() => api(`/api/jobs/${id}`, { method:'PUT', json:body }));
  saveQueue = task;
  const saved = await task;
  if (current?.id === id && version === materialVersion) {
    materialDirty = false; current = saved; saveStatus(draftDirty ? '수정한 글 · 보관 필요' : '이 PC에 보관됨'); updateControls();
    $('changed-banner').hidden = !current.changed;
  }
  await refreshJobs();
}
async function saveAll(allowPublicationSave = false) {
  if (busy(allowPublicationSave)) return;
  await saveMaterial(allowPublicationSave);
  if (busy(allowPublicationSave)) return;
  if (draft && draftDirty) {
    await ensureJob();
    draftSave = api(`/api/jobs/${current.id}/draft`, { method:'PUT', json:{ draft, review:$('review-notes').value } });
    current = await draftSave;
    draftDirty = false; saveStatus('이 PC에 보관됨'); updateControls(); await refreshJobs();
  }
}
$('save-all').onclick = async () => { try { await saveAll(); toast(current ? '글과 자료를 이 PC에 보관했어요.' : '먼저 사진이나 메모를 추가해 주세요.'); } catch(e) { toast(e.message,true); } };
$('topic').oninput = () => { $('breadcrumb-title').textContent = $('topic').value || '새로운 개발 기록'; markMaterial(); };
$('notes').oninput = markMaterial;

async function refreshJobs() {
  jobs = await api('/api/jobs');
  $('archive-count').textContent = jobs.filter(j => j.hasDraft).length;
  $('recent-jobs').replaceChildren();
  for (const job of jobs.slice(0,7)) {
    const b = document.createElement('button'); b.className = `recent-job${current?.id === job.id ? ' current' : ''}`; b.textContent = job.title; b.title = job.title;
    b.onclick = () => selectJob(job.id).catch(e => toast(e.message,true)); $('recent-jobs').append(b);
  }
}
async function selectJob(id) {
  showWorkspace();
  if (switching || publishStarting || deleting) return;
  switching = true;
  try {
    await saveAll(); clearTimeout(pollTimer);
    current = await api(`/api/jobs/${id}`); draft = current.draft ? structuredClone(current.draft) : null;
    draftDirty = false; materialDirty = false; localStorage.setItem('hdev.current', id);
    $('topic').value = current.title;
    $('notes').value = current.notes.startsWith('# 개발 메모 (선택)') ? '' : current.notes;
    if ($('notes').value !== current.notes) markMaterial();
    $('review-notes').value = current.review; $('analysis-text').textContent = current.analysis;
    $('breadcrumb-title').textContent = current.draft?.title || current.title || '새로운 개발 기록';
    renderPhotos(); renderDraft(); updateControls(); await refreshJobs();
    saveStatus('이 PC에 보관됨');
    if (current.generation.phase === 'generating') pollGeneration(id);
    if (isPublishing(current.publication)) pollPublication(id);
  } finally { switching = false; updateControls(); }
}
async function newPost() {
  showWorkspace();
  if (busy()) { toast('현재 작업이 끝난 뒤 새 글을 만들어 주세요.'); return; }
  await saveAll(); clearWorkspace();
}
function clearWorkspace() {
  clearTimeout(saveTimer); clearTimeout(pollTimer); clearTimeout(publishTimer);
  current = null; draft = null; draftDirty = false; materialDirty = false;
  $('topic').value = ''; $('notes').value = ''; $('review-notes').value = ''; $('analysis-text').textContent = '';
  $('breadcrumb-title').textContent = '새로운 개발 기록'; localStorage.removeItem('hdev.current');
  renderPhotos(); renderDraft(); updateControls(); saveStatus('새로운 글을 시작해 보세요');
}
$('new-post').onclick = () => newPost().catch(e => toast(e.message,true));
$('studio-nav').onclick = () => { showWorkspace(); $('modal').close(); window.scrollTo({ top:0, behavior:'smooth' }); };
const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`;
async function showArchive() {
  if (deleting) return;
  try {
    await refreshJobs(); const box = document.createElement('div');
    const total = document.createElement('p'); total.className = 'archive-storage'; total.textContent = `이 PC에 ${jobs.length}개 보관 · ${formatBytes(jobs.reduce((sum, job) => sum + job.storageBytes, 0))}`; box.append(total);
    if (!jobs.length) box.textContent = '아직 보관한 글이 없어요. 사진을 올려 첫 기록을 시작해 보세요.';
    for (const job of jobs) {
      const row = document.createElement('div'); row.className = 'archive-row';
      const b = document.createElement('button'); b.className = 'archive-item';
      b.innerHTML = `<span><strong>${escape(job.title)}</strong><small>사진 ${job.imageCount}장 · ${formatBytes(job.storageBytes)} · ${new Date(job.updatedAt).toLocaleDateString('ko-KR')}</small></span><span class="archive-badge">${job.busy ? '작업 중' : job.hasDraft ? '초안 보관' : '자료 수집'}</span>`;
      b.onclick = async () => { try { await selectJob(job.id); $('modal').close(); } catch(e) { toast(e.message,true); } };
      const remove = document.createElement('button'); remove.className = 'button delete-button'; remove.textContent = '삭제'; remove.setAttribute('aria-label', `${job.title} 삭제`); remove.disabled = job.busy || busy() || switching;
      remove.onclick = () => confirmDelete(job, true);
      row.append(b, remove); box.append(row);
    }
    const add = document.createElement('button'); add.className = 'text-button'; add.textContent = '＋ 새로운 글 시작하기'; add.onclick = async () => { await newPost(); $('modal').close(); }; box.append(add);
    modal('보관한 글', box);
  } catch(e) { toast(e.message,true); }
}
$('archive-nav').onclick = showArchive;
function confirmDelete(job, fromArchive = false) {
  if (busy() || switching) return;
  const box = document.createElement('div'); box.className = 'delete-confirm';
  box.innerHTML = `<p class="delete-title">${escape(current?.id === job.id ? draft?.title || current.title || job.title : job.title)}</p><p>이 PC에 보관한 사진 원본·메모·모든 초안·편집 이력을 영구 삭제합니다. 목록에서 제외한 사진도 함께 지워집니다.</p><p class="delete-size">정리할 자료 약 ${formatBytes(job.storageBytes)}</p><p>티스토리에 발행한 글은 그대로 유지됩니다. 삭제한 로컬 자료는 복구할 수 없습니다.</p>`;
  const actions = document.createElement('div'); actions.className = 'delete-actions';
  const cancel = document.createElement('button'); cancel.className = 'button secondary'; cancel.textContent = '취소';
  cancel.onclick = () => { if (fromArchive) showArchive(); else $('modal').close(); };
  const remove = document.createElement('button'); remove.className = 'button danger'; remove.textContent = '이 PC에서 영구 삭제';
  remove.onclick = async () => {
    if (busy() || switching) return;
    deleting = true; cancel.disabled = true; remove.disabled = true; remove.textContent = '삭제 중…'; $('close-modal').disabled = true; updateControls();
    if (current?.id === job.id) clearTimeout(saveTimer);
    try {
      await Promise.allSettled([saveQueue, draftSave]);
      const result = await api(`/api/jobs/${job.id}`, { method:'DELETE' });
      if (current?.id === job.id) clearWorkspace();
      if (localStorage.getItem('hdev.current') === job.id) localStorage.removeItem('hdev.current');
      await refreshJobs(); $('modal').close();
      toast(`글과 자료 ${formatBytes(result.deletedBytes)}를 이 PC에서 삭제했어요.`);
    } catch(e) {
      toast(e.message,true); remove.disabled = false; cancel.disabled = false; remove.textContent = '이 PC에서 영구 삭제';
    } finally { deleting = false; $('close-modal').disabled = false; updateControls(); if (materialDirty) saveTimer = setTimeout(() => saveMaterial().catch(e => toast(e.message,true)), 800); }
  };
  actions.append(cancel, remove); box.append(actions); modal('보관한 글을 삭제할까요?', box); cancel.focus();
}
$('delete-current').onclick = async () => {
  if (!current || busy() || switching) return;
  const id = current.id;
  try { await refreshJobs(); const job = jobs.find(item => item.id === id); if (job && current?.id === id) confirmDelete(job); }
  catch(e) { toast(e.message,true); }
};
function showStyle() { const pre = document.createElement('pre'); pre.textContent = settings?.style || '말투 자료를 준비해 주세요.'; modal('나의 글쓰기 스타일',pre); }
$('style-nav').onclick = showStyle; $('style-summary').onclick = showStyle;

function renderPhotos() {
  const list = $('photo-list'); list.replaceChildren(); const images = current?.images || [];
  $('photo-count').textContent = `사진 ${images.length}장`; $('order-hint').hidden = images.length < 2;
  images.forEach((image,index) => {
    const tile = document.createElement('div'); tile.className = 'photo-tile'; tile.draggable = !busy();
    tile.innerHTML = `<button class="photo-open" aria-label="${escape(image.label)} 확대"><img src="${escape(image.url)}" alt="${escape(image.label)}"></button><span class="photo-number">${index+1}</span><button class="photo-remove" aria-label="${escape(image.label)} 목록에서 제거">×</button><div class="photo-label" title="${escape(image.label)}">${escape(image.label)}</div><div class="photo-order"><button aria-label="사진 ${index+1} 앞으로 이동" ${index===0 ? 'disabled' : ''}>‹</button><button aria-label="사진 ${index+1} 뒤로 이동" ${index===images.length-1 ? 'disabled' : ''}>›</button></div>`;
    tile.querySelector('.photo-open').onclick = () => { const img = document.createElement('img'); img.src = image.url; img.alt = image.label; modal(image.label,img); };
    tile.querySelector('.photo-remove').onclick = () => {
      if (busy()) return;
      current.images.splice(index,1); markMaterial(); renderPhotos(); updateControls();
      const jobId = current.id;
      toast('사진을 목록에서 뺐어요. 원본은 보관됩니다.',false,() => { if(current?.id!==jobId)return; current.images.splice(index,0,image); markMaterial(); renderPhotos(); updateControls(); });
    };
    const arrows = tile.querySelectorAll('.photo-order button'); arrows[0].onclick = () => movePhoto(index,index-1); arrows[1].onclick = () => movePhoto(index,index+1);
    tile.ondragstart = e => { if (busy()) { e.preventDefault(); return; } e.dataTransfer.setData('text/hdev-photo',String(index)); tile.classList.add('dragging'); };
    tile.ondragend = () => tile.classList.remove('dragging');
    tile.ondragover = e => { if (e.dataTransfer.types.includes('text/hdev-photo')) e.preventDefault(); };
    tile.ondrop = e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/hdev-photo')); if (Number.isInteger(from)) movePhoto(from,index); };
    list.append(tile);
  });
}
function movePhoto(from,to) { if (busy() || from===to || !current?.images[from] || to<0 || to>=current.images.length) return; const [item] = current.images.splice(from,1); current.images.splice(to,0,item); markMaterial(); renderPhotos(); }
const openFiles = () => { if (!busy()) $('file-input').click(); };
$('drop-zone').onclick = openFiles;
$('drop-zone').onkeydown = e => { if (e.key==='Enter' || e.key===' ') { e.preventDefault(); openFiles(); } };
$('drop-zone').ondragover = e => { e.preventDefault(); if (!busy()) $('drop-zone').classList.add('drag-over'); };
$('drop-zone').ondragleave = () => $('drop-zone').classList.remove('drag-over');
$('drop-zone').ondrop = e => { e.preventDefault(); $('drop-zone').classList.remove('drag-over'); if (!busy()) uploadFiles([...e.dataTransfer.files]); };
$('file-input').onchange = e => { const files = [...e.target.files]; e.target.value=''; uploadFiles(files); };
async function uploadFiles(files) {
  if (!files.length || busy()) return;
  try {
    await ensureJob(); await saveMaterial(); uploadBusy = true; updateControls();
    let count = 0;
    for (const file of files) {
      if (current.images.length >= 20) { toast('한 글에 사진을 최대 20장까지 올릴 수 있어요.',true); break; }
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>10*1024*1024) { toast(`${file.name}: PNG, JPG, WebP 10MB 이하만 올릴 수 있어요.`,true); continue; }
      $('upload-status').textContent = `${file.name} 올리는 중…`;
      try { const bitmap = await createImageBitmap(file); bitmap.close(); } catch { toast(`${file.name}: 읽을 수 없는 이미지입니다.`,true); continue; }
      current = await api(`/api/jobs/${current.id}/images?name=${encodeURIComponent(file.name)}`, { method:'POST', body:file, headers:{ 'Content-Type':file.type } });
      count++; renderPhotos();
    }
    $('upload-status').textContent = ''; if (count) { toast(`사진 ${count}장을 보관했어요.`); saveStatus('이 PC에 보관됨'); }
    await refreshJobs();
  } catch(e) { toast(e.message,true); $('upload-status').textContent = ''; }
  finally { uploadBusy = false; updateControls(); }
}

function updateControls() {
  const running = busy(), hasImages = !!current?.images.length;
  $('generate').disabled = running || !hasImages;
  $('manual-start').disabled = running || !hasImages;
  $('save-all').disabled = running;
  $('delete-current').hidden = !current;
  $('delete-current').disabled = running || switching;
  const publication=current?.publication;
  $('transfer').disabled = running || !draft || !settings?.canPublish || ['published','uncertain'].includes(publication?.phase);
  $('transfer').textContent = publication?.phase==='published' ? '발행 완료' : publication?.phase==='removed' ? '티스토리에 다시 발행 ↗' : isPublishing(publication) ? '티스토리에 올리는 중…' : '티스토리에 발행 ↗';
  const publishStatus=$('publish-status'); publishStatus.replaceChildren();
  publishStatus.hidden=!draft && !publication?.message;
  if (!publishStatus.hidden) {
    const p=document.createElement('span'); p.textContent=publication?.message || (settings?.canPublish ? `${settings.blogUrl} · 버튼을 누르면 현재 초안이 공개 발행됩니다.` : '바로 발행은 최신 Windows EXE 앱에서 사용할 수 있어요.'); publishStatus.append(p);
    if (publication?.url) {const a=document.createElement('a');a.href=publication.url;a.textContent='발행한 글 보기 ↗';a.target='_blank';a.rel='noopener noreferrer';publishStatus.append(a);}
    else if (publication?.phase==='uncertain') {const a=document.createElement('a');a.href=`${settings.blogUrl}/manage`;a.textContent='글 관리에서 확인 ↗';a.target='_blank';a.rel='noopener noreferrer';publishStatus.append(a);}
  }
  $('topic').disabled = running; $('notes').disabled = running; $('file-input').disabled = running;
  $('review-notes').disabled = running;
  $('generate-label').textContent = current?.generation.phase === 'generating' ? '초안을 작성하고 있어요' : draft ? '새 자료로 다시 만들기' : '내 말투로 초안 만들기';
  const status = $('generation-state'); status.className = 'generation-state';
  const generation = current?.generation;
  let message = settings?.connected ? 'Codex 연결됨 · 사진을 읽고 내 말투로 작성해요' : '이 PC의 Codex 로그인이 필요해요';
  if (settings?.connected) status.classList.add('connected');
  if (generation?.phase === 'generating') { status.classList.add('busy'); message = generation.message; }
  if (generation?.phase === 'error') { status.classList.add('error'); message = generation.message; }
  status.replaceChildren(); const dot = document.createElement('span'); dot.className='connection-dot'; const text=document.createElement('span'); text.textContent=message; status.append(dot,text);
  $('changed-banner').hidden = !current?.changed;
  $('step-two').className = generation?.phase==='generating' ? 'current' : draft ? 'done' : '';
  $('step-three').className = draft && generation?.phase!=='generating' ? 'current' : '';
  $('review-section').hidden = !draft;
  $('article-editor').querySelectorAll('input,textarea,button,select').forEach(el => { el.disabled=running; });
  const editBlocks=$('block-editor').querySelectorAll('.edit-block');
  editBlocks.forEach((el,index)=>{const buttons=el.querySelectorAll('.edit-block-header button');buttons[0].disabled=running||index===0;buttons[1].disabled=running||index===editBlocks.length-1;});
}
function updateFooter() {
  $('word-count').textContent = draft ? `${draft.blocks.reduce((n,b)=>n+(b.text||b.items?.join('')||b.caption||'').replace(/\s/g,'').length,0).toLocaleString()}자 · 사진 ${draft.blocks.filter(b=>b.type==='image').length}장` : '사진과 글이 함께 표시됩니다';
}
const imageURL = name => (current?.draftImages.find(i=>i.name===name) || current?.images.find(i=>i.name===name))?.url || '';
function renderPreview() {
  if (!draft) return;
  const content = draft.blocks.map(b => {
    if (b.type==='heading') return `<h2>${escape(b.text)}</h2>`;
    if (b.type==='paragraph') return `<p>${escape(b.text).replace(/\n/g,'<br>')}</p>`;
    if (b.type==='code') return `<pre><code>${escape(b.text)}</code></pre>`;
    if (b.type==='list') return `<ul>${b.items.map(i=>`<li>${escape(i)}</li>`).join('')}</ul>`;
    if (b.type==='table') return `<table><thead><tr>${b.headers.map(t=>`<th>${escape(t)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row=>`<tr>${row.map(t=>`<td>${escape(t)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (b.type==='image') return `<figure><img src="${escape(imageURL(b.file))}" alt="${escape(b.alt)}"><figcaption>${escape(b.caption)}</figcaption></figure>`;
    return '';
  }).join('');
  $('article-preview').innerHTML = `<h1>${escape(draft.title)}</h1><div class="article-tags">${draft.tags.map(t=>`#${escape(t)}`).join(' &nbsp; ')}</div>${content}`;
}
function renderEditor() {
  if (!draft) return;
  $('draft-title').value=draft.title; $('draft-tags').value=draft.tags.join(', ');
  const editor=$('block-editor'); editor.replaceChildren();
  const labels={paragraph:'문단',heading:'소제목',code:'코드',list:'목록',image:'사진',table:'비교 표'};
  draft.blocks.forEach((b,index)=>{
    const el=document.createElement('div'); el.className='edit-block'; el.dataset.type=b.type;
    el.innerHTML=`<div class="edit-block-header"><span>${labels[b.type]}</span><span><button aria-label="블록 ${index+1} 위로 이동" ${index===0?'disabled':''}>↑</button><button aria-label="블록 ${index+1} 아래로 이동" ${index===draft.blocks.length-1?'disabled':''}>↓</button><button aria-label="블록 ${index+1} 삭제">×</button></span></div>`;
    const [up,down,remove]=el.querySelectorAll('button');
    const move=to=>{ if(busy()||to<0||to>=draft.blocks.length)return; const [item]=draft.blocks.splice(index,1); draft.blocks.splice(to,0,item); markDraft(); renderEditor(); };
    up.onclick=()=>move(index-1); down.onclick=()=>move(index+1); remove.onclick=()=>{ if(busy())return; draft.blocks.splice(index,1); markDraft(); renderEditor(); };
    if(b.type==='image'){
      const img=document.createElement('img'); img.src=imageURL(b.file); img.alt=b.alt; el.append(img);
      for(const [field,label] of [['caption','사진 설명'],['alt','사진 대체 텍스트']]){
        const input=document.createElement('input'); input.className='image-caption'; input.value=b[field]||''; input.placeholder=label; input.setAttribute('aria-label',`${index+1}번 ${label}`); input.oninput=()=>{b[field]=input.value;markDraft();}; el.append(input);
      }
    }else{
      const textarea=document.createElement('textarea'); textarea.setAttribute('aria-label',`${index+1}번 ${labels[b.type]}`);
      textarea.value=b.type==='list'?b.items.join('\n'):b.type==='table'?[b.headers,...b.rows].map(row=>row.join('\t')).join('\n'):b.text;
      textarea.rows=b.type==='heading'?2:Math.max(3,Math.min(12,textarea.value.split('\n').length+1));
      if(b.type==='table')textarea.title='탭으로 열을 구분하고 줄바꿈으로 행을 구분합니다.';
      textarea.oninput=()=>{ if(b.type==='list')b.items=textarea.value.split('\n'); else if(b.type==='table'){const rows=textarea.value.split('\n').map(row=>row.split('\t'));b.headers=rows.shift();b.rows=rows;}else b.text=textarea.value;markDraft();}; el.append(textarea);
    }
    editor.append(el);
  });
}
function renderDraft() {
  $('empty-draft').hidden=!!draft; $('article-preview').hidden=!draft||mode!=='preview'; $('article-editor').hidden=!draft||mode!=='edit';
  $('preview-view').classList.toggle('active',mode==='preview'); $('edit-view').classList.toggle('active',mode==='edit');
  $('preview-view').setAttribute('aria-pressed',mode==='preview'); $('edit-view').setAttribute('aria-pressed',mode==='edit');
  if(draft){renderPreview();renderEditor();} updateFooter(); updateControls();
}
$('draft-title').oninput=()=>{draft.title=$('draft-title').value;markDraft();};
$('draft-tags').oninput=()=>{draft.tags=$('draft-tags').value.split(',').map(t=>t.trim().replace(/^#/, '')).filter(Boolean);markDraft();};
$('review-notes').oninput=markDraft;
$('edit-view').onclick=()=>{mode='edit';renderDraft();}; $('preview-view').onclick=()=>{mode='preview';renderDraft();};
$('manual-start').onclick=async()=>{
  try{await saveMaterial();draft={title:$('topic').value||'새로운 개발 기록',tags:[],blocks:[{type:'paragraph',text:'이곳에 개발 기록을 적어주세요.'},...current.images.map(i=>({type:'image',file:i.name,alt:i.label,caption:''}))]};draftDirty=true;await saveAll();mode='edit';renderDraft();}catch(e){toast(e.message,true);}
};
$('add-block').onclick=()=>{
  if(!draft||busy())return;const type=$('block-type').value;
  if(type==='image'){
    const box=document.createElement('div');box.className='photo-picker';
    for(const i of current.draftImages){const b=document.createElement('button');b.innerHTML=`<img src="${escape(i.url)}" alt="${escape(i.name)}"><span>사진 추가</span>`;b.onclick=()=>{draft.blocks.push({type:'image',file:i.name,alt:'개발 캡처',caption:''});markDraft();renderEditor();$('modal').close();};box.append(b);}modal('본문에 넣을 사진',box);return;
  }
  draft.blocks.push(type==='list'?{type,items:['새 항목']}:{type,text:type==='heading'?'새 소제목':'새 내용을 입력하세요.'});markDraft();renderEditor();
};
$('generate').onclick=async()=>{
  if(busy())return;
  try{await saveAll();current=await api(`/api/jobs/${current.id}/generate`,{method:'POST'});updateControls();pollGeneration(current.id);}catch(e){toast(e.message,true);}
};
function pollGeneration(id){
  clearTimeout(pollTimer);
  pollTimer=setTimeout(async()=>{
    try{
      const next=await api(`/api/jobs/${id}`);if(current?.id!==id)return;current=next;updateControls();
      if(next.generation.phase==='generating'){pollGeneration(id);return;}
      if(next.generation.phase==='done'){draft=structuredClone(next.draft);draftDirty=false;mode='preview';$('review-notes').value=next.review;$('analysis-text').textContent=next.analysis;renderDraft();saveStatus('초안 보관됨');toast('초안을 만들었어요. 사진과 내용을 함께 확인해 보세요.');}
      else toast(next.generation.message||'글 작성이 중단됐습니다.',true);
      await refreshJobs();
    }catch(e){toast(e.message,true);pollGeneration(id);}
  },2500);
}
$('transfer').onclick=async()=>{
  if(busy() || !draft || !settings?.canPublish)return;
  publishStarting=true;updateControls();
  try{
    await saveAll(true);
    current=await api(`/api/jobs/${current.id}/publish`,{method:'POST',json:{draftDigest:current.draftDigest}});
    pollPublication(current.id);
  }catch(e){toast(e.message,true);}finally{publishStarting=false;updateControls();}
};
function pollPublication(id){
  clearTimeout(publishTimer);
  publishTimer=setTimeout(async()=>{
    try{
      const next=await api(`/api/jobs/${id}`);if(current?.id!==id)return;
      current=next;updateControls();
      if(isPublishing(next.publication)){pollPublication(id);return;}
      toast(next.publication.message || '발행 상태를 확인해 주세요.',next.publication.phase!=='published');
      await refreshJobs();
    }catch(e){toast(e.message,true);pollPublication(id);}
  },1800);
}
window.addEventListener('beforeunload',e=>{if(draftDirty||materialDirty){e.preventDefault();e.returnValue='';}});

async function boot(){
  try{
    settings=await api('/api/bootstrap');token=settings.token;
    if(settings.blogUrl)$('blog-link').href=settings.blogUrl;
    await refreshJobs();const last=localStorage.getItem('hdev.current');
    if(last&&jobs.some(j=>j.id===last))await selectJob(last);else{renderPhotos();renderDraft();updateControls();}
  }catch(e){saveStatus('앱 연결 실패');toast('앱에 연결하지 못했어요. 실행 상태를 확인하고 새로고침해 주세요.',true);}
}
boot();

let blogs = [], library = null, libraryLoading = false;
function showWorkspace() {
  document.querySelector('main').hidden = false; $('library-page').hidden = true;
  $('studio-nav').classList.add('selected'); $('library-nav').classList.remove('selected');
}
function renderLibrary() {
  $('blog-select').replaceChildren(...blogs.map(b => new Option(b.title || b.id, b.id)));
  if (library) $('blog-select').value = library.id;
  $('manage-blog').href = `${library?.url || settings?.blogUrl || 'https://your-blog.tistory.com'}/manage`;
  $('library-updated').textContent = libraryLoading ? '공개 글을 불러오는 중…' : library?.syncedAt ? `${new Date(library.syncedAt).toLocaleString('ko-KR')} 불러옴` : '아직 불러오지 않았어요';
  $('sync-blog').disabled = libraryLoading; $('blog-select').disabled = libraryLoading; $('add-blog').disabled = libraryLoading;
  const categories = [...new Set((library?.posts || []).map(p => p.category).filter(Boolean))].sort();
  const oldCategory = $('post-category').value;
  $('post-category').replaceChildren(new Option('모든 카테고리', ''), ...categories.map(c => new Option(c,c)));
  if (categories.includes(oldCategory)) $('post-category').value = oldCategory;
  $('library-warning').textContent = (library?.warnings || []).join(' '); $('library-warning').hidden = !library?.warnings?.length;
  renderPublicPosts();
}
function renderPublicPosts() {
  const needle = $('post-search').value.toLocaleLowerCase().trim(), category = $('post-category').value;
  const all = library?.posts || [], posts = all.filter(p => (!category || p.category === category) && `${p.title} ${p.summary}`.toLocaleLowerCase().includes(needle));
  $('public-post-count').textContent = needle || category ? `${posts.length} / 공개 글 ${all.length}개` : `공개 글 ${all.length}개`;
  const box = $('public-posts'); box.replaceChildren();
  if (!posts.length) { const p = document.createElement('p'); p.className = 'library-empty'; p.textContent = libraryLoading ? '블로그의 공개 글을 가져오고 있어요.' : !library?.syncedAt ? '목록 새로고침을 눌러 기존 글을 불러오세요.' : all.length ? '검색 조건에 맞는 글이 없어요.' : '확인된 공개 글이 없습니다. 로그인한 글 관리 화면도 확인해 주세요.'; box.append(p); }
  for (const post of posts) {
    const row = document.createElement('article'); row.className = 'public-post';
    const date = new Date(post.publishedAt), day = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR');
    row.innerHTML = `<div class="post-monogram" aria-hidden="true">${escape((post.category.split('/').pop() || 'LOG').slice(0,3).toUpperCase())}</div><div class="post-info"><div class="post-meta"><span>${escape(post.category || '카테고리 없음')}</span><time>${escape(day)}</time></div><h2>${escape(post.title)}</h2><p>${escape(post.summary)}</p><small>${escape(post.url)}</small></div><a class="button secondary" href="${escape(post.url)}" target="_blank" rel="noopener noreferrer">글 열기 ↗</a>`;
    box.append(row);
  }
}
async function loadBlog(id, sync = false) {
  if (libraryLoading) return;
  libraryLoading = true; renderLibrary();
  try {
    library = await api(`/api/blogs/${id}${sync ? '/sync' : ''}`, sync ? {method:'POST'} : {});
    blogs = await api('/api/blogs');
  } catch(e) { toast(e.message, true); }
  finally { libraryLoading = false; renderLibrary(); }
}
$('library-nav').onclick = async () => {
  try {
    await saveAll(); blogs = await api('/api/blogs');
    document.querySelector('main').hidden = true; $('library-page').hidden = false;
    $('studio-nav').classList.remove('selected'); $('library-nav').classList.add('selected');
    if (!library) await loadBlog(blogs[0].id); else renderLibrary();
    if (!library?.syncedAt) await loadBlog(blogs[0].id, true);
  } catch(e) { toast(e.message, true); }
};
$('sync-blog').onclick = () => loadBlog($('blog-select').value, true);
$('blog-select').onchange = async () => { const id = $('blog-select').value; $('post-search').value=''; $('post-category').value=''; await loadBlog(id); if (library?.id === id && !library.syncedAt) await loadBlog(id,true); };
$('post-search').oninput = renderPublicPosts; $('post-category').onchange = renderPublicPosts;
$('add-blog').onclick = () => {
  const box = document.createElement('form'); box.className = 'add-blog-form';
  const label = document.createElement('label'); label.textContent = '티스토리 블로그 주소'; label.htmlFor = 'blog-address';
  const input = document.createElement('input'); input.id = 'blog-address'; input.type = 'url'; input.required = true; input.placeholder = 'https://블로그이름.tistory.com';
  const help = document.createElement('p'); help.textContent = '추가한 블로그의 공개 글을 함께 볼 수 있어요. 수정 권한은 티스토리 로그인 후 확인합니다.';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'button primary'; submit.textContent = '목록에 추가';
  box.append(label,input,help,submit);
  box.onsubmit = async e => { e.preventDefault(); submit.disabled = true; try { blogs = await api('/api/blogs',{method:'POST',json:{url:input.value.trim()}}); const id = new URL(input.value.trim()).hostname.split('.')[0]; $('modal').close(); await loadBlog(id); await loadBlog(id,true); } catch(err) { toast(err.message,true); } finally {submit.disabled=false;} };
  modal('블로그 추가',box);
};
