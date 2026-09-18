import { articleBlocks, uncategorizedCategory, selectableCategories, categoryLabel } from './draft-model.js';
import { renderArticleContent, renderGitHubCard, normalizeGitHubCard } from './article-renderer.js';
import { initStyleSettings } from './style-settings.js';
import { initCategoryPrompts } from './category-prompts.js';
import { createAIHelp, connectionMessage } from './ai-help.js';

const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const icons = {
  github:'<path d="M9 19c-4.3 1.3-4.3-2.5-6-3m12 6v-3.5c0-1 .1-1.6-.5-2.2 3-.3 6.2-1.5 6.2-6.8A5.3 5.3 0 0 0 19.3 6c.1-.3.6-1.7-.1-3.5 0 0-1.2-.4-3.8 1.4a13.4 13.4 0 0 0-6.8 0C6 2.1 4.8 2.5 4.8 2.5 4.1 4.3 4.6 5.7 4.7 6a5.3 5.3 0 0 0-1.4 3.5c0 5.3 3.2 6.5 6.2 6.8-.5.5-.7 1.2-.5 2.2V22"/>',
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
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>'
};
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[el.dataset.icon] || ''}</svg>`; });

let token, settings, jobs = [], current = null, draft = null, mode = 'preview';
let selectedCategory = null, creatingJob;
const currentCategory = () => selectedCategory || uncategorizedCategory(settings.blogUrl);
let references = [];
let referenceTimer, referenceStarting = false;
let draftDirty = false, materialDirty = false, materialVersion = 0, saveTimer, pollTimer, toastTimer;
let saveQueue = Promise.resolve(), uploadBusy = false, switching = false, publishStarting = false, publishTimer;
let deleting = false, draftSave = Promise.resolve(), categoryLoading = false, categoryPollTimer;
let blockDrag = null;
const blockLabels = {paragraph:'문단',heading:'소제목',code:'코드',list:'목록',image:'사진',table:'비교 표'};
const isPublishing = p => ['preparing','waiting_login','uploading','filling','submitting','verifying'].includes(p?.phase);
const busy = (allowPublicationSave = false) => categoryLoading || settings?.categories?.busy || referenceStarting || current?.referenceRead?.phase === 'reading' || deleting || uploadBusy || (!allowPublicationSave && publishStarting) || current?.generation.phase === 'generating' || isPublishing(current?.publication);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-App-Token': token || '', ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.json !== undefined ? JSON.stringify(options.json) : options.body });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '작업을 완료하지 못했습니다.'), { status: response.status });
  return data;
}
function toast(message, error = false, undo) {
  clearTimeout(toastTimer); const el = $('toast'); el.textContent = message; el.className = `toast${error ? ' error' : ''}`; el.hidden = false;
  if (undo) { const b = document.createElement('button'); b.textContent = '되돌리기'; b.onclick = () => { undo(); el.hidden = true; }; el.append(b); }
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 4000);
}
function modal(title, content) { $('modal-title').textContent = title; $('modal-content').replaceChildren(content); if (!$('modal').open) $('modal').showModal(); }
const openAIHelp = createAIHelp({ api, modal, toast, getAI: () => settings?.ai, onChanged: ai => {
  if (!settings) return;
  settings.ai = ai; settings.connected = ai.connected; updateControls();
} });
$('help-nav').onclick = openAIHelp;
window.addEventListener('hdev:ai-help', openAIHelp);
function openBlogSettings() {
  if (!settings) return;
  const form = document.createElement('form'); form.className = 'add-blog-form';
  const label = document.createElement('label'); label.htmlFor = 'publish-blog-address'; label.textContent = '글을 발행할 내 티스토리 주소';
  const input = document.createElement('input'); input.id = 'publish-blog-address'; input.type = 'url'; input.required = true;
  input.placeholder = 'https://내블로그이름.tistory.com'; input.value = settings.blogConfigured ? settings.blogUrl : '';
  const help = document.createElement('p'); help.textContent = '티스토리 로그인과 카테고리 조회, 발행에 사용할 주소입니다. 로그인만으로 블로그 주소가 자동 설정되지는 않아요.';
  const status = document.createElement('p'); status.id = 'blog-settings-status'; status.setAttribute('role', 'status');
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'button primary'; save.textContent = '블로그 주소 저장';
  form.append(label, input, help, status, save);
  form.onsubmit = async event => {
    event.preventDefault(); if (busy()) { status.textContent = '진행 중인 작업이 끝난 뒤 저장해 주세요.'; return; }
    if (styleSettings.isDirty() || categoryPrompts.isDirty()) { status.textContent = '편집 중인 말투·카테고리 지침을 먼저 저장해 주세요.'; return; }
    save.disabled = true; input.disabled = true; status.textContent = '저장 중…';
    try {
      await saveAll();
      const result = await api('/api/blog-settings', { method: 'PUT', json: { blogUrl: input.value.trim() } });
      Object.assign(settings, result); library = null; blogs = [];
      updateBlogLinks(); renderCategories(); updateControls();
      if (!$('style-page').hidden) await categoryPrompts.open(currentCategory());
      if (!$('library-page').hidden) { blogs = await api('/api/blogs'); await loadBlog(new URL(settings.blogUrl).hostname.split('.')[0]); }
      $('modal').close(); toast('내 블로그 주소를 저장했어요. 로그인 / 글 관리에서 로그인해 주세요.');
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; input.disabled = false; }
  };
  modal(settings.blogConfigured ? '내 블로그 설정' : '먼저 내 블로그를 연결해 주세요', form); input.focus();
}
function updateBlogLinks() {
  if (settings.blogConfigured) { $('blog-link').href = settings.blogUrl; $('blog-link').textContent = '내 블로그 열기 ↗'; }
  else { $('blog-link').removeAttribute('href'); $('blog-link').textContent = '내 블로그 설정'; }
}
$('blog-settings-nav').onclick = openBlogSettings;
$('blog-link').onclick = event => { if (!settings?.blogConfigured) { event.preventDefault(); openBlogSettings(); } };
$('manage-blog').onclick = event => { if (!settings?.blogConfigured) { event.preventDefault(); openBlogSettings(); } };
window.addEventListener('hdev:blog-settings', openBlogSettings);
$('close-modal').onclick = () => $('modal').close();
$('modal').addEventListener('cancel', e => { if (deleting) e.preventDefault(); });
$('modal').addEventListener('click', e => { if (!deleting && e.target === $('modal') && (e.offsetX < 0 || e.offsetY < 0 || e.offsetX > $('modal').clientWidth || e.offsetY > $('modal').clientHeight)) $('modal').close(); });
function saveStatus(text) { $('save-state').textContent = text; }
function markMaterial() { materialDirty = true; materialVersion++; saveStatus('변경사항 보관 중…'); clearTimeout(saveTimer); saveTimer = setTimeout(() => saveMaterial().catch(e => { saveStatus('보관 실패'); toast(e.message,true); }), 800); }
function markDraft() { draftDirty = true; saveStatus('수정한 글 · 보관 필요'); updateFooter(); }

function renderCategories() {
  const state = settings?.categories, select = $('draft-category');
  $('category-section').hidden = false;
  if (!settings) return;
  const choices = selectableCategories(state?.items || [], settings.blogUrl), category = currentCategory();
  select.replaceChildren();
  for (const item of choices) select.add(new Option(categoryLabel(item, choices), item.id));
  select.value = '0';
  if (selectedCategory) {
    const found = choices.find(item => JSON.stringify(item) === JSON.stringify(selectedCategory));
    if (!found) {
      const previous = new Option(`기존 선택: ${selectedCategory.path.join(' / ')} · 다시 선택해 주세요`, 'saved');
      previous.disabled = true; select.add(previous);
    }
    select.value = found ? found.id : 'saved';
  }
  $('category-status').classList.remove('error');
  $('category-status').textContent = state?.busy || categoryLoading ? '티스토리 창에서 목록을 읽고 있어요. 로그인 화면이 나오면 로그인해 주세요.'
    : !state?.canRead ? '카테고리 목록을 새로 불러오려면 데스크톱 앱을 사용하세요.'
    : select.value === 'saved' ? '저장된 선택을 확인하려면 목록을 불러와 다시 선택해 주세요.'
    : state?.updatedAt ? '초안을 만들기 전에 선택하세요. 이 분류의 글쓰기 지침으로 작성하고 발행할 때도 적용해요.'
    : '카테고리를 불러오면 하위 카테고리까지 선택할 수 있어요.';
  const prompt = settings?.writingPrompts?.profiles.find(item => JSON.stringify(item.category) === JSON.stringify(category))?.prompt;
  $('writing-prompt-summary').textContent = prompt ? `적용할 지침: ${categoryLabel(category, choices)} · ${prompt.split('\n')[0].slice(0,90)}` : '기본 블로그용 프롬프트로 작성해요.';
  if (draft) $('writing-prompt-summary').textContent += ' 지침 변경은 초안을 다시 만들 때 반영돼요.';
}
$('draft-category').onchange = () => {
  if (busy() || switching || $('draft-category').value === 'saved') return;
  const category = selectableCategories(settings?.categories?.items || [], settings.blogUrl).find(item => item.id === $('draft-category').value);
  if (!category) return;
  selectedCategory = structuredClone(category);
  if (draft) {
    draft.category = structuredClone(category);
    markDraft();
  } else markMaterial();
  renderCategories(); updateControls();
};
async function pollCategories() {
  clearTimeout(categoryPollTimer);
  try { settings.categories = await api('/api/categories'); renderCategories(); updateControls(); }
  catch (error) { toast(error.message, true); }
  if (settings?.categories?.busy) categoryPollTimer = setTimeout(pollCategories, 1500);
}
async function refreshCategories() {
  if (!settings.blogConfigured) { openBlogSettings(); throw new Error('먼저 내 블로그 주소를 저장해 주세요.'); }
  if (busy() || switching) return;
  try {
    await saveAll(); categoryLoading = true; renderCategories(); updateControls();
    settings.categories = await api('/api/categories', { method: 'POST' });
    categoryLoading = false; renderCategories();
    toast('티스토리 카테고리를 불러왔어요.');
  } catch (error) {
    categoryLoading = false;
    $('category-status').classList.add('error'); $('category-status').textContent = error.message;
    throw error;
  } finally { categoryLoading = false; updateControls(); }
}
$('category-refresh').onclick = () => refreshCategories().catch(error => toast(error.message, true));

async function ensureJob() {
  if (!current) {
    creatingJob ||= api('/api/jobs', { method:'POST', json:{ title:$('topic').value } });
    try { current = await creatingJob; } finally { creatingJob = null; }
    localStorage.setItem('hdev.current', current.id);
  }
  return current;
}
async function saveMaterial(allowPublicationSave = false) {
  clearTimeout(saveTimer);
  if (!materialDirty || busy(allowPublicationSave)) return saveQueue;
  await ensureJob();
  const id = current.id, version = materialVersion;
  const body = { title:$('topic').value, notes:$('notes').value, order:current.images.map(i => i.name), references:structuredClone(references), category: structuredClone(currentCategory()) };
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

function resetReferenceForm() { $('reference-url').value = ''; $('reference-status').textContent = ''; $('reference-status').classList.remove('error'); }
$('reference-form').onsubmit = event => {
  event.preventDefault();
  if (busy() || references.length >= 5) return;
  try {
    const url = new URL($('reference-url').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || /\.(localhost|local|internal)$/i.test(url.hostname)) throw new Error('공개 웹페이지의 https:// 주소를 입력해 주세요.');
    url.hash = ''; const address = url.href.replace(/\/$/, '');
    if (references.some(item => item.url === address)) throw new Error('이미 추가한 참고자료예요.');
    references.push({ url:address, content:'' }); resetReferenceForm(); markMaterial(); renderReferences(); updateControls();
    if (references.length < 5) $('reference-url').focus();
  } catch (error) { $('reference-status').classList.add('error'); $('reference-status').textContent = error instanceof TypeError ? '올바른 링크를 입력해 주세요.' : error.message; }
};
function updateReferenceReports() {
  const matching = JSON.stringify(references.map(item => ({ ...item, content:item.content.trim() }))) === JSON.stringify(current?.references || []);
  document.querySelectorAll('.reference-result').forEach((node, index) => {
    const reference = references[index];
    const report = matching && current?.referenceReports?.find(item => item.url === reference.url);
    const row = node.closest('.reference-item');
    row.querySelector('a').textContent = report?.status === 'read' ? report.title : reference.url.replace('https://','');
    row.querySelector('.reference-excerpt').hidden = !report?.excerpt;
    row.querySelector('.reference-excerpt pre').textContent = report?.excerpt || '';
    node.classList.toggle('unavailable', report?.status === 'unavailable');
    node.textContent = report ? report.message : reference.content.trim() ? '붙여 넣은 내용을 다음 초안에 참고해요.' : '초안을 만들 때 본문을 읽어요.';
  });
}
function renderReferences() {
  const list = $('reference-list'); list.replaceChildren();
  $('reference-count').textContent = `${references.length} / 5`;
  references.forEach((reference, index) => {
    const row = document.createElement('div'); row.className = 'reference-item';
    row.innerHTML = `<div class="reference-row"><a href="${escape(reference.url)}" target="_blank" rel="noopener noreferrer" title="${escape(reference.url)}">${escape(reference.url.replace('https://',''))}</a><button type="button" class="reference-remove" aria-label="참고자료 ${index + 1} 삭제">×</button></div><p class="reference-result"></p><details class="reference-excerpt" hidden><summary>읽은 내용 미리보기</summary><pre></pre></details><details class="reference-paste"><summary>필요한 내용 직접 붙여 넣기</summary><label for="reference-content-${index}">비공개 노션이나 읽기 어려운 페이지는 필요한 내용을 붙여 넣어 주세요. 입력한 내용을 우선 참고해요.</label><textarea id="reference-content-${index}" rows="4" maxlength="10000" placeholder="참고할 내용 (최대 10,000자)"></textarea></details>`;
    row.querySelector('textarea').value = reference.content;
    row.querySelector('.reference-paste').open = !!reference.content;
    row.querySelector('textarea').oninput = event => { reference.content = event.target.value; markMaterial(); updateReferenceReports(); };
    row.querySelector('button').onclick = () => {
      if (busy()) return;
      references.splice(index,1); markMaterial(); renderReferences(); updateControls();
    };
    list.append(row);
  });
  updateReferenceReports();
}

$('reference-read').onclick = async () => {
  if (busy() || !references.length) return;
  try {
    await saveAll(); referenceStarting = true; updateControls();
    current = await api(`/api/jobs/${current.id}/references/read`,{method:'POST'});
    pollReferences(current.id);
  } catch(error) { toast(error.message,true); }
  finally { referenceStarting = false; updateControls(); }
};
function pollReferences(id) {
  clearTimeout(referenceTimer);
  referenceTimer = setTimeout(async()=>{
    try {
      const next = await api(`/api/jobs/${id}`); if(current?.id!==id)return;
      current = next; updateControls();
      if(next.referenceRead.phase==='reading'){pollReferences(id);return;}
      renderReferences();
      $('reference-status').classList.toggle('error', next.referenceRead.phase==='error');
      $('reference-status').textContent = next.referenceRead.phase==='error' ? next.referenceRead.message : '읽기 결과를 확인해 주세요. 초안을 만들 때 이 자료를 함께 참고해요.';
    } catch(error) { toast(error.message,true); pollReferences(id); }
  },800);
}

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
  if (switching || publishStarting || deleting || uploadBusy || referenceStarting) return;
  switching = true;
  try {
    await saveAll(); clearTimeout(pollTimer); clearTimeout(referenceTimer);
    current = await api(`/api/jobs/${id}`); draft = current.draft ? structuredClone(current.draft) : null;
    selectedCategory = structuredClone(current.category || null);
    references = structuredClone(current.references || []); resetReferenceForm(); renderReferences();
    draftDirty = false; materialDirty = false; localStorage.setItem('hdev.current', id);
    $('topic').value = current.title;
    $('notes').value = current.notes.startsWith('# 개발 메모 (선택)') ? '' : current.notes;
    if ($('notes').value !== current.notes) markMaterial();
    $('review-notes').value = current.review; $('analysis-text').textContent = current.analysis;
    $('breadcrumb-title').textContent = current.draft?.title || current.title || '새로운 개발 기록';
    renderPhotos(); renderDraft(); updateControls(); await refreshJobs();
    saveStatus('이 PC에 보관됨');
    if (current.generation.phase === 'generating') pollGeneration(id);
    if (current.referenceRead?.phase === 'reading') pollReferences(id);
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
  clearTimeout(referenceTimer);
  current = null; draft = null; draftDirty = false; materialDirty = false;
  selectedCategory = null;
  references = []; resetReferenceForm(); renderReferences();
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
    await saveAll(); await refreshJobs(); const box = document.createElement('div'); box.className = 'archive-content';
    const total = document.createElement('p'); total.className = 'archive-storage'; total.textContent = `보관한 기록 ${jobs.length}개 · 사용 공간 ${formatBytes(jobs.reduce((sum, job) => sum + job.storageBytes, 0))}`;
    if (jobs.length) box.append(total);
    else {
      const empty = document.createElement('div'); empty.className = 'archive-empty';
      empty.innerHTML = '<img src="/logo.png" width="112" height="112" alt=""><h3>첫 개발 기록을 남겨보세요</h3><p>캡처와 메모로 시작한 글이 이곳에 모여요.<br>보관한 글은 언제든 이어서 쓸 수 있어요.</p>';
      box.append(empty);
    }
    for (const job of jobs) {
      const row = document.createElement('div'); row.className = 'archive-row';
      const b = document.createElement('button'); b.className = 'archive-item';
      b.innerHTML = `<span><strong>${escape(job.title)}</strong><small>사진 ${job.imageCount}장 · ${formatBytes(job.storageBytes)} · ${new Date(job.updatedAt).toLocaleDateString('ko-KR')}</small></span><span class="archive-badge">${job.busy ? '작업 중' : job.hasDraft ? '초안 보관' : '자료 수집'}</span>`;
      b.onclick = async () => { try { await selectJob(job.id); $('modal').close(); } catch(e) { toast(e.message,true); } };
      const remove = document.createElement('button'); remove.className = 'button delete-button'; remove.textContent = '삭제'; remove.setAttribute('aria-label', `${job.title} 삭제`); remove.disabled = job.busy || busy() || switching;
      remove.onclick = () => confirmDelete(job, true);
      row.append(b, remove); box.append(row);
    }
    const footer = document.createElement('div'); footer.className = 'archive-actions';
    if (jobs.length) { const hint = document.createElement('span'); hint.textContent = '글을 선택해 이어서 작성하세요.'; footer.append(hint); }
    const add = document.createElement('button'); add.id = 'archive-new-post'; add.className = 'button primary'; add.textContent = '＋ 새 글 작성';
    add.disabled = !!busy() || switching;
    add.onclick = async () => { try { await newPost(); $('modal').close(); $('topic').focus(); } catch(e) { toast(e.message, true); } }; footer.append(add); box.append(footer);
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
const styleSettings = initStyleSettings({ api, toast, onSaved: profile => { settings.style = profile; } });
const categoryPrompts = initCategoryPrompts({ api, toast, getCategories: () => settings?.categories, refreshCategories, isBusy: busy,
  onSaved: state => { settings.writingPrompts = state; renderCategories(); } });
async function showStyle() {
  try {
    await saveAll();
    await styleSettings.open();
    settings.categories = await api('/api/categories');
    await categoryPrompts.open(currentCategory());
    document.querySelector('main').hidden = true; $('library-page').hidden = true; $('style-page').hidden = false;
    $('style-profile').scrollTop = 0;
    $('studio-nav').classList.remove('selected'); $('library-nav').classList.remove('selected'); $('style-nav').classList.add('selected');
    window.scrollTo({ top: 0 });
  } catch (e) { toast(e.message, true); }
}
$('style-nav').onclick = showStyle; $('style-summary').onclick = showStyle;
$('writing-prompt-settings').onclick = showStyle;
$('style-back').onclick = () => showWorkspace();

function setSidebar(collapsed) {
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('sidebar-toggle').setAttribute('aria-label', collapsed ? '사이드바 펼치기' : '사이드바 접기');
  $('sidebar-toggle').title = collapsed ? '사이드바 펼치기' : '사이드바 접기';
  $('sidebar-scrim').hidden = collapsed || !matchMedia('(max-width:760px)').matches;
  $('sidebar').inert = collapsed && matchMedia('(max-width:760px)').matches;
  localStorage.setItem('hdev.sidebar-collapsed', String(collapsed));
}
setSidebar(localStorage.getItem('hdev.sidebar-collapsed') === 'true' || (localStorage.getItem('hdev.sidebar-collapsed') === null && matchMedia('(max-width:980px)').matches));
$('sidebar-toggle').onclick = () => setSidebar(!document.documentElement.classList.contains('sidebar-collapsed'));
$('sidebar-scrim').onclick = () => setSidebar(true);
window.addEventListener('keydown', event => { if (event.key === 'Escape' && matchMedia('(max-width:760px)').matches) setSidebar(true); });
matchMedia('(max-width:760px)').addEventListener('change', () => setSidebar(document.documentElement.classList.contains('sidebar-collapsed')));
$('sidebar').addEventListener('click', event => { if (event.target.closest('button,a') && matchMedia('(max-width:760px)').matches) setSidebar(true); });

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
  $('draft-category').disabled = running || switching;
  $('writing-prompt-settings').disabled = running;
  $('category-refresh').disabled = running || !settings?.categories?.canRead;
  $('category-refresh').textContent = categoryLoading || settings?.categories?.busy ? '불러오는 중…' : settings?.categories?.updatedAt ? '목록 새로고침' : '카테고리 불러오기';
  const reading = referenceStarting || current?.referenceRead?.phase === 'reading';
  $('reference-read').disabled = running || !references.length;
  $('reference-read').textContent = reading ? '읽는 중…' : '자료 읽기';
  if(reading){$('reference-status').classList.remove('error');$('reference-status').textContent = current?.referenceRead?.message || '참고자료의 본문을 확인하고 있어요.';}
  $('reference-url').disabled = running || references.length >= 5;
  $('reference-add').disabled = running || references.length >= 5;
  $('reference-list').querySelectorAll('button,textarea').forEach(el => { el.disabled = running; });
  updateReferenceReports();
  $('generate').disabled = running || !hasImages;
  $('manual-start').disabled = running || !hasImages;
  $('save-all').disabled = running;
  $('github-card').disabled = running || !draft;
  $('github-card').setAttribute('aria-pressed',String(!!draft?.githubCard));
  $('github-card').title = draft?.githubCard ? 'GitHub 정보 카드 편집' : '목차 아래에 GitHub 정보 카드 추가';
  for (const id of ['choose-cover','upload-cover','reset-cover','cover-file-input']) $(id).disabled = running || !draft;
  $('delete-current').hidden = !current;
  $('delete-current').disabled = running || switching;
  const publication=current?.publication;
  $('transfer').disabled = running || !draft || !settings?.canPublish || !settings?.blogConfigured || ['published','uncertain'].includes(publication?.phase);
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
  let message = settings?.connected ? `${connectionMessage(settings.ai)} · 사진을 읽고 내 말투로 작성해요` : connectionMessage(settings?.ai);
  $('style-ai-provider').textContent = settings?.ai?.provider === 'claude' ? 'Claude Code' : 'Codex';
  if (settings?.connected) status.classList.add('connected');
  if (generation?.phase === 'generating') { status.classList.add('busy'); message = generation.message; }
  if (generation?.phase === 'error') { status.classList.add('error'); message = generation.message; }
  status.replaceChildren(); const dot = document.createElement('span'); dot.className='connection-dot'; const text=document.createElement('span'); text.textContent=message; status.append(dot,text);
  if (!settings?.connected) { const connect = document.createElement('button'); connect.className = 'text-button'; connect.textContent = 'AI 연결'; connect.onclick = openAIHelp; status.append(connect); }
  $('changed-banner').hidden = !current?.changed;
  $('step-two').className = generation?.phase==='generating' ? 'current' : draft ? 'done' : '';
  $('step-three').className = draft && generation?.phase!=='generating' ? 'current' : '';
  $('review-section').hidden = !draft;
  $('article-editor').querySelectorAll('input,textarea,button,select').forEach(el => { el.disabled=running; });
  const editBlocks=$('block-editor').querySelectorAll('.edit-block');
  editBlocks.forEach((el,index)=>{
    el.querySelector('.block-up').disabled=running||index===0;
    el.querySelector('.block-down').disabled=running||index===editBlocks.length-1;
    el.querySelector('.block-drag-handle').draggable=!running;
  });
  if (running) { clearBlockDrag(); closeBlockInsertMenus(); }
}
function updateFooter() {
  $('word-count').textContent = draft ? `${draft.blocks.reduce((n,b)=>n+(b.text||b.items?.join('')||b.caption||'').replace(/\s/g,'').length,0).toLocaleString()}자 · 사진 ${articleBlocks(draft).filter(b=>b.type==='image').length}장` : '사진과 글이 함께 표시됩니다';
}
const imageURL = name => (current?.draftImages.find(i=>i.name===name) || current?.coverImages?.find(i=>i.name===name) || current?.images.find(i=>i.name===name))?.url || '';
function renderCover() {
  $('cover-section').hidden = !draft;
  if (!draft) return;
  const name = draft.cover || draft.blocks.find(block=>block.type==='image')?.file;
  const preview = $('cover-preview'); preview.replaceChildren();
  if (name) { const img = document.createElement('img'); img.src = imageURL(name); img.alt = '선택한 글 표지'; preview.append(img); }
  else preview.textContent = '표지 없음';
  $('cover-badge').textContent = draft.cover ? '직접 선택' : '자동';
  $('cover-description').textContent = draft.cover ? '이 사진을 표지로 보관했어요.' : name ? '첫 번째 본문 사진을 사용해요.' : '글을 보여줄 표지 사진을 추가해 보세요.';
  $('reset-cover').hidden = !draft.cover;
}
async function changeCover(name, file) {
  if (!draft || busy() || switching) return;
  const id = current.id;
  try {
    await saveAll();
    if (busy() || current?.id !== id) return;
    uploadBusy = true; updateControls();
    if (file) {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10*1024*1024) throw new Error('표지는 PNG, JPG, WebP 형식의 10MB 이하 사진을 선택해 주세요.');
      const bitmap = await createImageBitmap(file); bitmap.close();
      const oldNames = new Set(current.coverImages?.map(i=>i.name));
      current = await api(`/api/jobs/${id}/covers?name=${encodeURIComponent(file.name)}`,{method:'POST',body:file,headers:{'Content-Type':file.type}});
      name = current.coverImages.find(i=>!oldNames.has(i.name))?.name;
      if (!name) throw new Error('업로드한 표지를 찾지 못했습니다.');
    }
    const next = structuredClone(draft);
    if (name) next.cover = name; else delete next.cover;
    draftSave = api(`/api/jobs/${id}/draft`,{method:'PUT',json:{draft:next,review:$('review-notes').value}});
    current = await draftSave; draft = structuredClone(current.draft); draftDirty = false;
    renderDraft(); saveStatus('표지까지 이 PC에 보관됨'); await refreshJobs();
    toast(name ? '선택한 표지를 보관했어요.' : '첫 번째 본문 사진을 사용하는 자동 표지로 바꿨어요.');
  } catch(e) { toast(e.message,true); }
  finally { uploadBusy = false; updateControls(); }
}
$('choose-cover').onclick = () => {
  if (!draft || busy()) return;
  const images = [...new Map([...(current.images || []),...(current.coverImages || []),...current.draftImages].map(i=>[i.name,i])).values()];
  const box = document.createElement('div'); box.className = 'photo-picker cover-picker';
  if (!images.length) box.textContent = '표지 업로드로 사진을 먼저 추가해 주세요.';
  for (const [index,image] of images.entries()) {
    const b = document.createElement('button'); b.classList.toggle('selected',draft.cover === image.name); b.setAttribute('aria-pressed',String(draft.cover === image.name)); b.setAttribute('aria-label',`${index+1}번 사진을 표지로 선택`);
    b.innerHTML = `<img src="${escape(imageURL(image.name))}" alt="${escape(image.label || `사진 ${index+1}`)}"><span>${draft.cover===image.name ? '✓ 선택한 표지' : image.label ? escape(image.label) : `사진 ${index+1}`}</span>`;
    b.onclick = () => { $('modal').close(); changeCover(image.name); }; box.append(b);
  }
  modal('표지로 사용할 사진',box);
};
$('upload-cover').onclick = () => { if (!busy()) $('cover-file-input').click(); };
$('cover-file-input').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) changeCover(null,file); };
$('reset-cover').onclick = () => changeCover(null);
function renderPreview() {
  if (!draft) return;
  const content = renderArticleContent(articleBlocks(draft), { inlineStyles:false, imageURL, githubCard:draft.githubCard });
  $('article-preview').innerHTML = `<h1 class="hdev-title">${escape(draft.title)}</h1><div class="article-tags">${draft.tags.map(t=>`#${escape(t)}`).join(' &nbsp; ')}</div>${content}`;
}
$('github-card').onclick=()=>{
  if (!draft || busy() || switching) return;
  const targetDraft=draft;
  const card=draft.githubCard || {icon:'📚',categoryLabel:'주제',topic:draft.title,sourceLabel:'GitHub',url:'',linkText:'관련 코드 보기',description:''};
  const form=document.createElement('form'); form.className='github-card-form';
  const input=(key,label,max,placeholder='',type='text')=>`<label for="github-${key}">${label}<input id="github-${key}" name="${key}" type="${type}" value="${escape(card[key])}" maxlength="${max}" placeholder="${escape(placeholder)}" required></label>`;
  form.innerHTML=`<p class="github-card-intro">목차 아래에 주제와 코드 링크를 함께 보여줘요. 목차가 없는 글에서는 본문 맨 위에 표시해요.</p>
    <div class="github-form-row github-icon-row">${input('icon','아이콘',20,'📚')}${input('categoryLabel','주제 분류',60,'Java Collection')}</div>
    ${input('topic','주제',200,'Stack & Deque')}
    ${input('url','GitHub · 참고 링크 주소',2048,'https://github.com/사용자/저장소','url')}
    <div class="github-form-row">${input('sourceLabel','링크 분류',60,'Problem Source')}${input('linkText','링크 이름',200,'GitHub - 프로젝트 이름')}</div>
    <label for="github-description">한 줄 설명 <span>선택</span><textarea id="github-description" name="description" maxlength="1000" rows="2" placeholder="이 글에서 다루는 내용을 짧게 소개하세요.">${escape(card.description)}</textarea></label>
    <div class="github-preview-heading"><strong>카드 미리보기</strong><button id="github-copy" type="button" class="text-button">HTML 복사</button></div>
    <div id="github-card-preview" class="github-card-preview hdev-article"></div>
    <p id="github-card-error" class="github-card-error" role="alert" hidden></p>
    <div class="github-card-actions"><button id="github-remove" type="button" class="text-button" ${draft.githubCard?'':'hidden'}>카드 빼기</button><span></span><button id="github-cancel" type="button" class="button secondary">취소</button><button id="github-apply" type="submit" class="button primary">${draft.githubCard?'카드 수정':'카드 추가'}</button></div>`;
  const readCard=()=>normalizeGitHubCard(Object.fromEntries(new FormData(form)));
  const preview=()=>{
    form.querySelector('#github-card-error').hidden=true;
    try {
      form.querySelector('#github-card-preview').innerHTML=renderGitHubCard(readCard(),{inlineStyles:false});
      form.querySelector('#github-copy').disabled=false;
    } catch {
      form.querySelector('#github-card-preview').textContent='주제와 링크 주소를 입력하면 카드가 여기에 보여요.';
      form.querySelector('#github-copy').disabled=true;
    }
  };
  const apply=value=>{
    if (draft!==targetDraft || busy() || switching) return;
    if (value) draft.githubCard=value; else delete draft.githubCard;
    markDraft(); mode='preview'; renderDraft(); $('modal').close();
    $('article-preview').querySelector('[data-hdev-github-card]')?.scrollIntoView({block:'center'});
    toast(value?'목차 아래에 GitHub 정보 카드를 넣었어요.':'GitHub 정보 카드를 뺐어요.');
  };
  form.oninput=preview;
  form.onsubmit=event=>{
    event.preventDefault();
    try {apply(readCard());}
    catch(error){const message=form.querySelector('#github-card-error');message.textContent=error.message;message.hidden=false;}
  };
  form.querySelector('#github-remove').onclick=()=>apply(null);
  form.querySelector('#github-cancel').onclick=()=>$('modal').close();
  form.querySelector('#github-copy').onclick=async()=>{
    try {await navigator.clipboard.writeText(renderGitHubCard(readCard()));toast('카드 HTML을 복사했어요.');}
    catch(error){toast(error.message || 'HTML을 복사하지 못했습니다.',true);}
  };
  modal('GitHub 정보 카드',form); preview();
  form.querySelector(draft.githubCard?'#github-topic':'#github-url').focus();
};
function closeBlockInsertMenus() {
  $('block-editor').querySelectorAll('.block-insert-options').forEach(el=>{el.hidden=true;});
  $('block-editor').querySelectorAll('.block-insert-toggle').forEach(el=>el.setAttribute('aria-expanded','false'));
}
function clearBlockDrag() {
  blockDrag=null;
  $('block-editor').classList.remove('is-dragging');
  $('block-editor').querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'));
}
function canDropBlock(event) {
  return !busy() && !switching && blockDrag?.draft===draft && draft.blocks.includes(blockDrag.block) && event.dataTransfer?.types.includes('text/hdev-block');
}
function showBlockDrop(event, position) {
  if (!canDropBlock(event)) return;
  event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect='move';
  $('block-editor').querySelectorAll('.block-insert').forEach(el=>el.classList.toggle('drop-target',Number(el.dataset.position)===position));
}
function finishBlockEdit(index, editing=false) {
  markDraft(); renderEditor(); renderCover();
  const block=$('block-editor').querySelectorAll('.edit-block')[index];
  const focus=block?.querySelector(editing?'textarea,input':'.block-drag-handle') || $('block-editor').querySelector('.block-insert-toggle');
  focus?.focus({preventScroll:true}); focus?.scrollIntoView({block:'nearest'});
  if (editing) focus?.select?.();
}
function moveBlock(from,to) {
  if (!draft || busy() || switching || !Number.isInteger(from) || !Number.isInteger(to) || from<0 || to<0 || from>=draft.blocks.length || to>=draft.blocks.length || from===to) return;
  const [block]=draft.blocks.splice(from,1); draft.blocks.splice(to,0,block);
  finishBlockEdit(to);
  $('editor-status').textContent=`${blockLabels[block.type]}을 ${to+1}번째로 옮겼어요.`;
}
function dropBlock(event,position) {
  if (!canDropBlock(event)) return;
  event.preventDefault(); event.stopPropagation();
  const from=draft.blocks.indexOf(blockDrag.block);
  clearBlockDrag();
  // A gap is an insertion boundary before removing the source block.
  moveBlock(from,position>from?position-1:position);
}
function insertBlock(type,position) {
  if (!draft || busy() || switching || !Object.hasOwn(blockLabels,type)) return;
  const targetDraft=draft, before=draft.blocks[position];
  const insert=block=>{
    if (draft!==targetDraft || busy() || switching) return;
    const index=before?draft.blocks.indexOf(before):draft.blocks.length;
    if (index<0) return;
    draft.blocks.splice(index,0,block);
    if ($('modal').open) $('modal').close();
    finishBlockEdit(index,true);
    $('editor-status').textContent=`${blockLabels[type]}을 ${index+1}번째에 추가했어요.`;
  };
  closeBlockInsertMenus();
  if (type==='image') {
    const box=document.createElement('div'); box.className='photo-picker';
    if (!current?.draftImages.length) box.textContent='초안에 사용할 사진을 먼저 추가해 주세요.';
    for (const [index,image] of (current?.draftImages || []).entries()) {
      const button=document.createElement('button'); button.type='button'; button.setAttribute('aria-label',`${index+1}번 사진 추가`);
      button.innerHTML=`<img src="${escape(image.url)}" alt="${escape(image.name)}"><span>사진 ${index+1} 추가</span>`;
      button.onclick=()=>insert({type:'image',file:image.name,alt:'개발 캡처',caption:''}); box.append(button);
    }
    modal('본문에 넣을 사진',box); return;
  }
  insert(type==='list'?{type,items:['새 항목']}:type==='table'?{type,headers:['항목','내용'],rows:[['새 항목','내용을 입력하세요.']]}:{type,text:type==='heading'?'새 소제목':type==='code'?'// 코드를 입력하세요.':'새 내용을 입력하세요.'});
}
function blockInsertGap(position) {
  const gap=document.createElement('div'); gap.className='block-insert'; gap.dataset.position=position;
  const label=position===0?'맨 앞에 내용 추가':position===draft.blocks.length?'맨 뒤에 내용 추가':`${position}번째 항목 뒤에 내용 추가`;
  gap.innerHTML=`<button type="button" class="block-insert-toggle" aria-label="${label}" aria-expanded="false" aria-controls="block-insert-${position}"><span aria-hidden="true">＋</span> 여기에 추가</button><div id="block-insert-${position}" class="block-insert-options" role="group" aria-label="추가할 내용" hidden></div>`;
  const toggle=gap.querySelector('button'), options=gap.querySelector('.block-insert-options');
  toggle.onclick=()=>{if(busy())return;const open=options.hidden;closeBlockInsertMenus();options.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
  for (const [type,name] of Object.entries(blockLabels)) {
    const button=document.createElement('button'); button.type='button'; button.dataset.blockType=type; button.textContent=name;
    button.onclick=()=>insertBlock(type,position); options.append(button);
  }
  gap.onkeydown=event=>{if(event.key==='Escape'){closeBlockInsertMenus();toggle.focus();event.stopPropagation();}};
  gap.ondragover=event=>showBlockDrop(event,position);
  gap.ondrop=event=>dropBlock(event,position);
  return gap;
}
document.addEventListener('click',event=>{if(!event.target.closest('.block-insert'))closeBlockInsertMenus();});
$('block-editor').ondragleave=event=>{
  if (!$('block-editor').contains(event.relatedTarget)) $('block-editor').querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));
};
function renderEditor() {
  if (!draft) return;
  clearBlockDrag();
  $('draft-title').value=draft.title; $('draft-tags').value=draft.tags.join(', ');
  const editor=$('block-editor'); editor.replaceChildren();
  draft.blocks.forEach((b,index)=>{
    const el=document.createElement('div'); el.className='edit-block'; el.dataset.type=b.type;
    el.innerHTML=`<div class="edit-block-header"><span class="edit-block-label"><button type="button" class="block-drag-handle" draggable="true" aria-label="${index+1}번 ${blockLabels[b.type]} 끌어서 이동" title="끌어서 이동 · 위아래 방향키로도 이동할 수 있어요"><svg viewBox="0 0 12 18" width="12" height="18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/></svg></button>${blockLabels[b.type]}</span><span class="edit-block-actions"><button type="button" class="block-up" aria-label="블록 ${index+1} 위로 이동">↑</button><button type="button" class="block-down" aria-label="블록 ${index+1} 아래로 이동">↓</button><button type="button" class="block-remove" aria-label="블록 ${index+1} 삭제">×</button></span></div>`;
    const handle=el.querySelector('.block-drag-handle');
    handle.ondragstart=event=>{
      if (busy() || switching) {event.preventDefault();return;}
      closeBlockInsertMenus(); blockDrag={draft,block:b};
      event.dataTransfer.setData('text/hdev-block',String(index)); event.dataTransfer.effectAllowed='move'; event.dataTransfer.setDragImage(el,24,16);
      el.classList.add('dragging'); editor.classList.add('is-dragging');
    };
    handle.ondragend=clearBlockDrag;
    handle.onkeydown=event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();moveBlock(index,index+(event.key==='ArrowUp'?-1:1));}};
    const dropPosition=event=>index+(event.clientY>el.getBoundingClientRect().top+el.getBoundingClientRect().height/2?1:0);
    el.ondragover=event=>showBlockDrop(event,dropPosition(event));
    el.ondrop=event=>dropBlock(event,dropPosition(event));
    el.querySelector('.block-up').onclick=()=>moveBlock(index,index-1);
    el.querySelector('.block-down').onclick=()=>moveBlock(index,index+1);
    el.querySelector('.block-remove').onclick=()=>{if(busy())return;draft.blocks.splice(index,1);finishBlockEdit(Math.min(index,draft.blocks.length-1));};
    if(b.type==='image'){
      const img=document.createElement('img'); img.src=imageURL(b.file); img.alt=b.alt; img.draggable=false; el.append(img);
      for(const [field,label] of [['caption','사진 설명'],['alt','사진 대체 텍스트']]){
        const input=document.createElement('input'); input.className='image-caption'; input.value=b[field]||''; input.placeholder=label; input.setAttribute('aria-label',`${index+1}번 ${label}`); input.oninput=()=>{b[field]=input.value;markDraft();}; el.append(input);
      }
    }else{
      const textarea=document.createElement('textarea'); textarea.setAttribute('aria-label',`${index+1}번 ${blockLabels[b.type]}`);
      textarea.value=b.type==='list'?b.items.join('\n'):b.type==='table'?[b.headers,...b.rows].map(row=>row.join('\t')).join('\n'):b.text;
      textarea.rows=b.type==='heading'?2:Math.max(3,Math.min(12,textarea.value.split('\n').length+1));
      if(b.type==='table')textarea.title='탭으로 열을 구분하고 줄바꿈으로 행을 구분합니다.';
      textarea.oninput=()=>{ if(b.type==='list')b.items=textarea.value.split('\n'); else if(b.type==='table'){const rows=textarea.value.split('\n').map(row=>row.split('\t'));b.headers=rows.shift();b.rows=rows;}else b.text=textarea.value;markDraft();}; el.append(textarea);
    }
    editor.append(blockInsertGap(index),el);
  });
  editor.append(blockInsertGap(draft.blocks.length));
  updateControls();
}
function renderDraft() {
  $('empty-draft').hidden=!!draft; $('article-preview').hidden=!draft||mode!=='preview'; $('article-editor').hidden=!draft||mode!=='edit';
  $('preview-view').classList.toggle('active',mode==='preview'); $('edit-view').classList.toggle('active',mode==='edit');
  $('preview-view').setAttribute('aria-pressed',mode==='preview'); $('edit-view').setAttribute('aria-pressed',mode==='edit');
  renderCover(); renderCategories(); if(draft){renderPreview();renderEditor();} updateFooter(); updateControls();
}
$('draft-title').oninput=()=>{draft.title=$('draft-title').value;markDraft();};
$('draft-tags').oninput=()=>{draft.tags=$('draft-tags').value.split(',').map(t=>t.trim().replace(/^#/, '')).filter(Boolean);markDraft();};
$('review-notes').oninput=markDraft;
$('edit-view').onclick=()=>{mode='edit';renderDraft();}; $('preview-view').onclick=()=>{mode='preview';renderDraft();};
$('manual-start').onclick=async()=>{
  try{await saveMaterial();draft={title:$('topic').value||'새로운 개발 기록',tags:[],category:structuredClone(currentCategory()),blocks:[{type:'paragraph',text:'이곳에 개발 기록을 적어주세요.'},...current.images.map(i=>({type:'image',file:i.name,alt:i.label,caption:''}))]};draftDirty=true;await saveAll();mode='edit';renderDraft();}catch(e){toast(e.message,true);}
};
$('add-block').onclick=()=>{if(draft)insertBlock($('block-type').value,draft.blocks.length);};
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
      renderReferences();
      if(next.generation.phase==='done'){draft=structuredClone(next.draft);draftDirty=false;mode='preview';$('review-notes').value=next.review;$('analysis-text').textContent=next.analysis;renderDraft();saveStatus('초안 보관됨');toast('초안을 만들었어요. 사진과 내용을 함께 확인해 보세요.');}
      else toast(next.generation.message||'글 작성이 중단됐습니다.',true);
      await refreshJobs();
    }catch(e){toast(e.message,true);pollGeneration(id);}
  },2500);
}
$('transfer').onclick=async()=>{
  if(busy() || !draft || !settings?.canPublish)return;
  if (!draft.category) { draft.category = structuredClone(currentCategory()); markDraft(); }
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
window.addEventListener('beforeunload',e=>{if(draftDirty||materialDirty||styleSettings.isDirty()||categoryPrompts.isDirty()){e.preventDefault();e.returnValue='';}});

async function boot(){
  try{
    settings=await api('/api/bootstrap');token=settings.token;
    if (settings.categories?.busy) categoryPollTimer = setTimeout(pollCategories, 1500);
    updateBlogLinks();
    await refreshJobs();const last=localStorage.getItem('hdev.current');
    if(last&&jobs.some(j=>j.id===last))await selectJob(last);else{renderPhotos();renderReferences();renderDraft();updateControls();}
    if (!settings.blogConfigured) openBlogSettings();
  }catch(e){saveStatus('앱 연결 실패');toast('앱에 연결하지 못했어요. 실행 상태를 확인하고 새로고침해 주세요.',true);}
}
boot();

let blogs = [], library = null, libraryLoading = false;
function showWorkspace() {
  document.querySelector('main').hidden = false; $('library-page').hidden = true; $('style-page').hidden = true;
  $('studio-nav').classList.add('selected'); $('library-nav').classList.remove('selected'); $('style-nav').classList.remove('selected');
}
function renderLibrary() {
  $('blog-select').replaceChildren(...blogs.map(b => new Option(b.title || b.id, b.id)));
  if (library) $('blog-select').value = library.id;
  if (settings?.blogConfigured) $('manage-blog').href = `${settings.blogUrl}/manage`;
  else $('manage-blog').removeAttribute('href');
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
  if (!settings?.blogConfigured) { openBlogSettings(); return; }
  try {
    await saveAll(); blogs = await api('/api/blogs');
    document.querySelector('main').hidden = true; $('library-page').hidden = false; $('style-page').hidden = true;
    $('studio-nav').classList.remove('selected'); $('library-nav').classList.add('selected'); $('style-nav').classList.remove('selected');
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
