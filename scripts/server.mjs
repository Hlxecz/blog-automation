import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { newJob, readyJob, prepareJob, renderDraft, buildPreview, listJobs } from './blog.mjs';
import { generate } from './generate.mjs';
import { checkAI, providers } from './ai.mjs';
import { createLibrary } from './tistory.mjs';
import { createCategories } from './categories.mjs';
import { createStyles } from './style.mjs';
import { normalizeReferences, readReferences, collectReferences, referenceReview } from './references.mjs';
import { createPublications, draftDigest } from './publication.mjs';
import { jobStorage, deleteJobStorage } from './storage.mjs';
import { manifestImage, normalizeCategory } from '../web/draft-model.js';
import { articleCss, normalizeGitHubCard } from '../web/article-renderer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, value) => { const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, file); };
const exists = fs.existsSync;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (condition, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), { status }); };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

export function createApp({ root = ROOT, webRoot = path.join(ROOT, 'web'), generator = generate, checkGenerator = checkAI, fetchPublic = fetch, publishAdapter = null, categoryReader = null, styleAnalyzer, fetchStyle, fetchReference, notionReader } = {}) {
  const c = json(path.join(root, 'tistory.config.json'));
  const library = createLibrary(root, c.blogUrl, fetchPublic);
  const categories = createCategories({ root, blogUrl: c.blogUrl, reader: categoryReader });
  const styles = createStyles({ root, profileFile: path.resolve(root, c.styleProfile), analyzer: styleAnalyzer, fetchPage: fetchStyle });
  const publications = createPublications({ adapter: publishAdapter, blogUrl: c.blogUrl, tocMode: c.tocMode });
  const inbox = path.resolve(root, c.inbox), output = path.resolve(root, c.output);
  const token = randomBytes(32).toString('hex');
  const active = new Set();
  const generationStates = new Map();
  const referenceReadStates = new Map();
  const aiFile = path.join(root, 'ai.settings.json');
  let provider = exists(aiFile) ? json(aiFile).provider : 'codex';
  if (!Object.hasOwn(providers, provider)) provider = 'codex';
  let ai = { provider, status: 'checking', connected: false }, checkingAI = false;
  async function refreshAI() {
    const selected = provider;
    try {
      const value = await checkGenerator(selected);
      ai = typeof value === 'boolean' ? { provider: selected, connected: value, status: value ? 'connected' : 'login_required' } : { ...value, provider: selected };
    } catch { ai = { provider: selected, connected: false, status: 'error' }; }
    return ai;
  }
  const connectionCheck = refreshAI();
  const jobDir = id => {
    fail(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(id), '잘못된 글 주소입니다.');
    const dir = path.join(inbox, id);
    fail(exists(dir) && fs.lstatSync(dir).isDirectory() && !fs.lstatSync(dir).isSymbolicLink(), '글을 찾을 수 없습니다.', 404);
    return dir;
  };
  const mutableJob = id => {
    jobDir(id);
    fail(!categories.isRunning(), '카테고리를 불러온 뒤 다시 시도해 주세요.', 409);
    fail(!active.has(id), '글 작성 또는 발행 중입니다. 완료된 뒤 수정하거나 삭제해 주세요.', 409);
  };
  const metaFor = dir => exists(path.join(dir, 'app.json')) ? json(path.join(dir, 'app.json')) : { title: '', updatedAt: fs.statSync(dir).mtime.toISOString(), directory: null };
  const imageNames = dir => exists(path.join(dir, 'order.json')) ? json(path.join(dir, 'order.json')) : fs.readdirSync(path.join(dir, 'images')).filter(n => /\.(png|jpe?g|webp)$/i.test(n)).sort();
  function savedDirectory(id, meta) {
    if (!meta.directory) return null;
    const resolved = path.resolve(meta.directory), base = path.resolve(output, id);
    fail(resolved.startsWith(base + path.sep), '초안 경로가 올바르지 않습니다.');
    return exists(path.join(resolved, 'manifest.json')) ? resolved : null;
  }
  function readJob(id) {
    const dir = jobDir(id), meta = metaFor(dir), saved = savedDirectory(id, meta);
    const state = generationStates.get(id) || (meta.generating ? { phase: 'error', message: '앱이 재시작되어 글 작성이 중단됐습니다. 다시 시도해 주세요.' } : { phase: 'idle' });
    const draft = saved && exists(path.join(saved, 'draft.json')) ? json(path.join(saved, 'draft.json')) : null;
    const savedInput = saved ? json(path.join(saved, 'manifest.json')) : null;
    const references = readReferences(dir);
    const sameReferences = JSON.stringify(references) === JSON.stringify(savedInput?.references || []);
    const checked = exists(path.join(dir,'references-check.json')) ? json(path.join(dir,'references-check.json')) : null;
    const reports = checked && JSON.stringify(checked.references) === JSON.stringify(references) ? checked.reports
      : saved && sameReferences && exists(path.join(saved, 'references-read.json')) ? json(path.join(saved, 'references-read.json')) : [];
    const referenceReports = reports.map(({ text, ...report }) => ({ ...report, characters:text.length, excerpt:text.slice(0,800) }));
    let changed = false;
    if (savedInput) {
      const names = imageNames(dir);
      changed = names.join('\n') !== savedInput.images.map(i => i.name).join('\n') ||
        fs.readFileSync(path.join(dir, 'notes.md'), 'utf8') !== fs.readFileSync(path.join(saved, 'notes.md'), 'utf8') || !sameReferences;
    }
    return { id, title: meta.title || '', notes: fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), references, referenceReports, referenceRead:referenceReadStates.get(id) || {phase:'idle'},
      updatedAt: meta.updatedAt, images: imageNames(dir).map(name => ({ name, label: meta.labels?.[name] || name, url: `/api/jobs/${id}/images/${encodeURIComponent(name)}` })),
      draft, draftImages: savedInput?.images.map(i => ({ name: i.name, url: `/api/jobs/${id}/draft-images/${encodeURIComponent(i.name)}` })) || [],
      coverImages: [...new Set([...(meta.coverUploads || []), ...(savedInput?.coverImages || []).map(i => i.name)])].map(name => ({ name, label:meta.labels?.[name] || '표지 사진', url:`/api/jobs/${id}/${savedInput?.coverImages?.some(i=>i.name===name) ? 'draft-images' : 'images'}/${encodeURIComponent(name)}` })),
      review: saved && exists(path.join(saved, 'review.md')) ? fs.readFileSync(path.join(saved, 'review.md'), 'utf8') : '',
      analysis: saved && exists(path.join(saved, 'analysis.md')) ? fs.readFileSync(path.join(saved, 'analysis.md'), 'utf8') : '',
      generation: state, changed, transfer: meta.transfer || null,
      draftDigest: draft ? draftDigest(saved) : null, publication: publications.state(dir) };
  }
  const saveMeta = (dir, patch) => write(path.join(dir, 'app.json'), { ...metaFor(dir), ...patch, updatedAt: new Date().toISOString() });
  function prepare(id) {
    readyJob(root, id);
    const prepared = prepareJob(root, id);
    saveMeta(jobDir(id), { directory: prepared.directory });
    return prepared.directory;
  }
  function persistDraft(id, directory, draft, review = '', analysis = '', referenceReports) {
    if (draft?.category != null) {
      try { draft.category = normalizeCategory(draft.category, c.blogUrl); }
      catch (error) { fail(false, error.message); }
    }
    if (draft?.githubCard != null) {
      try {draft.githubCard=normalizeGitHubCard(draft.githubCard);}
      catch(error){fail(false,error.message);}
    }
    const manifest = json(path.join(directory, 'manifest.json'));
    let coverSource;
    if (draft?.cover != null && !manifestImage(manifest,draft.cover)) {
      fail(typeof draft.cover === 'string' && path.basename(draft.cover) === draft.cover && !/[\\/]/.test(draft.cover) && /\.(png|jpe?g|webp)$/i.test(draft.cover), '표지 사진 경로가 올바르지 않습니다.');
      const images = path.join(jobDir(id),'images');
      fail(!fs.lstatSync(images).isSymbolicLink(), '표지 사진 폴더가 올바르지 않습니다.');
      coverSource = path.join(images,draft.cover);
      fail(exists(coverSource) && fs.lstatSync(coverSource).isFile() && !fs.lstatSync(coverSource).isSymbolicLink(), '표지 사진을 찾을 수 없습니다.');
      const bytes = fs.readFileSync(coverSource);
      manifest.coverImages = [...(manifest.coverImages || []), {name:draft.cover,sha256:sha(bytes),bytes:bytes.length}];
    }
    const {usedImages} = buildPreview(draft, manifest); // Validate before overwriting the previous draft.
    for (const name of usedImages) {
      const source = coverSource && name === draft.cover ? coverSource : path.join(directory,'images',name);
      fail(sha(fs.readFileSync(source)) === manifestImage(manifest,name).sha256, '보관한 사진이 변경됐습니다. 다시 확인해 주세요.');
    }
    if (coverSource) {
      const destination = path.join(directory,'images',draft.cover);
      if (!exists(destination)) fs.copyFileSync(coverSource,destination,fs.constants.COPYFILE_EXCL);
      fail(!fs.lstatSync(destination).isSymbolicLink() && sha(fs.readFileSync(destination)) === manifestImage(manifest,draft.cover).sha256, '보관한 표지 사진이 변경됐습니다.');
      write(path.join(directory,'manifest.json'),manifest);
    }
    const file = path.join(directory, 'draft.json');
    if (exists(file)) {
      fs.mkdirSync(path.join(directory, 'history'), { recursive: true });
      const version = `${Date.now()}-${randomUUID().slice(0,8)}`;
      fs.copyFileSync(file, path.join(directory, 'history', `draft-${version}.json`));
      if (exists(path.join(directory, 'references-read.json'))) fs.copyFileSync(path.join(directory, 'references-read.json'), path.join(directory, 'history', `references-${version}.json`));
    }
    write(file, draft);
    if (referenceReports) write(path.join(directory, 'references-read.json'), referenceReports);
    fs.writeFileSync(path.join(directory, 'review.md'), review);
    if (analysis) fs.writeFileSync(path.join(directory, 'analysis.md'), analysis);
    renderDraft(directory);
    saveMeta(jobDir(id), { directory, generating: false, transfer: null });
  }
  async function readBody(req, max = 2 * 1024 * 1024) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length; fail(size <= max, '파일이 너무 큽니다. 사진 한 장은 10MB 이하로 올려 주세요.', 413); chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  const bodyJson = async req => {
    fail(req.headers['content-type']?.includes('application/json'), 'JSON 요청이 필요합니다.', 415);
    try { return JSON.parse((await readBody(req)).toString()); }
    catch (e) { if (e.status) throw e; throw Object.assign(new Error('요청 내용을 읽을 수 없습니다.'), { status: 400 }); }
  };
  const sendJson = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const sendFile = (res, file) => {
    fail(exists(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), '파일을 찾을 수 없습니다.', 404);
    res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'}${/\.(js|css|html)$/.test(file) ? '; charset=utf-8' : ''}` });
    fs.createReadStream(file).pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'");
    try {
      fail(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ''), '로컬 앱 주소로 접속해 주세요.', 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.headers.origin) fail(req.headers.origin === url.origin, '허용되지 않은 요청입니다.', 403);
      if (!['GET', 'HEAD'].includes(req.method)) fail(req.headers['x-app-token'] === token, '앱을 새로고침한 뒤 다시 시도해 주세요.', 403);
      const route = url.pathname;
      if (route === '/api/categories' && req.method === 'GET') return sendJson(res, categories.state());
      if (route === '/api/categories' && req.method === 'POST') {
        fail(active.size === 0 && !styles.isRunning() && !checkingAI, '진행 중인 작업이 끝난 뒤 카테고리를 불러와 주세요.', 409);
        return sendJson(res, await categories.refresh());
      }
      if (req.method !== 'GET' && (route === '/api/style/analyze' || route.startsWith('/api/ai') || /\/(generate|publish|references\/read)$/.test(route))) {
        fail(!categories.isRunning(), '카테고리를 불러온 뒤 다시 시도해 주세요.', 409);
      }
      if (route === '/api/ai' && req.method === 'GET') { await connectionCheck; return sendJson(res, ai); }
      if ((route === '/api/ai' && req.method === 'PUT') || (route === '/api/ai/check' && req.method === 'POST')) {
        const b = req.method === 'PUT' ? await bodyJson(req) : { provider };
        fail(Object.hasOwn(providers, b.provider), 'Codex 또는 Claude Code를 선택해 주세요.');
        fail(!checkingAI && active.size === 0 && !styles.isRunning() && !categories.isRunning(), '진행 중인 작업이 끝난 뒤 AI 연결을 변경하거나 확인해 주세요.', 409);
        checkingAI = true;
        try {
          await connectionCheck;
          write(aiFile, { provider: b.provider }); provider = b.provider;
          return sendJson(res, await refreshAI());
        } finally { checkingAI = false; }
      }
      if (route === '/api/style' && req.method === 'GET') return sendJson(res, styles.state());
      if (route === '/api/style' && req.method === 'PUT') return sendJson(res, styles.save(await bodyJson(req)));
      if (route === '/api/style/analyze' && req.method === 'POST') {
        const b = await bodyJson(req);
        fail(!categories.isRunning(), '카테고리를 불러온 뒤 다시 시도해 주세요.', 409);
        fail(!checkingAI, 'AI 연결 확인이 끝난 뒤 다시 시도해 주세요.', 409);
        return sendJson(res, styles.start(b.urls, { provider }), 202);
      }
      if (route === '/api/blogs' && req.method === 'GET') return sendJson(res, library.list());
      if (route === '/api/blogs' && req.method === 'POST') {
        const b = await bodyJson(req);
        return sendJson(res, library.add(b.url), 201);
      }
      const remote = route.match(/^\/api\/blogs\/([a-z0-9-]+)(?:\/(sync))?$/);
      if (remote && req.method === 'GET' && !remote[2]) return sendJson(res, library.read(remote[1]));
      if (remote && req.method === 'POST' && remote[2] === 'sync') return sendJson(res, await library.sync(remote[1]));
      if (route === '/api/bootstrap' && req.method === 'GET') { await connectionCheck; return sendJson(res, {
        token, blogUrl: c.blogUrl, connected: ai.connected, ai, canPublish: !!publishAdapter, categories: categories.state(),
        style: exists(path.resolve(root, c.styleProfile)) ? fs.readFileSync(path.resolve(root, c.styleProfile), 'utf8') : ''
      }); }
      if (route === '/api/jobs' && req.method === 'GET') {
        const jobs = listJobs(root).map(j => { const p = readJob(j.id); return { id: p.id, title: p.draft?.title || p.title || '새로운 개발 기록', updatedAt: p.updatedAt, imageCount: p.images.length, hasDraft: !!p.draft, phase: p.generation.phase, busy: active.has(j.id), storageBytes: jobStorage(root, [inbox, output], j.id).bytes }; });
        return sendJson(res, jobs.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      if (route === '/api/jobs' && req.method === 'POST') {
        const b = await bodyJson(req); const id = `${new Date().toISOString().slice(0,10)}-${randomUUID().slice(0,8)}`;
        newJob(root, id); const dir = jobDir(id);
        saveMeta(dir, { title: typeof b.title === 'string' ? b.title.slice(0,200) : '' });
        fs.writeFileSync(path.join(dir, 'notes.md'), ''); write(path.join(dir, 'order.json'), []);
        return sendJson(res, readJob(id), 201);
      }
      const match = route.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]), action = match[2] || '', dir = jobDir(id);
        if (!action && req.method === 'GET') return sendJson(res, readJob(id));
        if (req.method !== 'GET' && action !== 'publish') mutableJob(id);
        if (!action && req.method === 'DELETE') {
          const deletedBytes = deleteJobStorage(root, [inbox, output], id);
          generationStates.delete(id);
          return sendJson(res, { id, deletedBytes });
        }
        if (action === 'publish' && req.method === 'POST') {
          if (publications.isRunning(dir) || publications.state(dir).phase === 'published') return sendJson(res,readJob(id));
          fail(active.size === 0,'다른 글을 작성하거나 발행하고 있습니다. 완료 후 시도해 주세요.',409);
          const b=await bodyJson(req);
          mutableJob(id);
          fail(active.size === 0,'다른 글을 작성하거나 발행하고 있습니다. 완료 후 시도해 주세요.',409);
          const directory=savedDirectory(id,metaFor(dir));
          fail(directory && exists(path.join(directory,'draft.json')),'먼저 검토한 초안을 보관해 주세요.');
          publications.start({job:dir,directory,expectedDigest:b.draftDigest,onFinish:()=>active.delete(id)});
          active.add(id);
          return sendJson(res,readJob(id),202);
        }
        if (!action && req.method === 'PUT') {
          const b = await bodyJson(req);
          mutableJob(id);
          fail(typeof b.title === 'string' && b.title.length <= 200 && typeof b.notes === 'string' && b.notes.length <= 20000, '제목이나 메모 길이를 확인해 주세요.');
          const allNames = fs.readdirSync(path.join(dir, 'images'));
          fail(Array.isArray(b.order) && b.order.length <= 20 && new Set(b.order).size === b.order.length && b.order.every(n => allNames.includes(n) && path.basename(n) === n), '사진 목록이 올바르지 않습니다.');
          const references = b.references === undefined ? readReferences(dir) : normalizeReferences(b.references);
          fs.writeFileSync(path.join(dir, 'notes.md'), b.notes); write(path.join(dir, 'order.json'), b.order);
          write(path.join(dir, 'references.json'), references);
          saveMeta(dir, { title: b.title });
          return sendJson(res, readJob(id));
        }
        if (['images','covers'].includes(action) && req.method === 'POST') {
          const bytes = await readBody(req, 10 * 1024 * 1024);
          mutableJob(id);
          const meta = metaFor(dir), coverOnly = action === 'covers';
          const names = coverOnly ? (meta.coverUploads || []) : imageNames(dir); fail(names.length < 20, coverOnly ? '표지 후보는 한 글에 최대 20장까지 보관할 수 있습니다.' : '한 글에 사진을 최대 20장까지 올릴 수 있습니다.');
          let ext;
          if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext = '.png';
          else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = '.jpg';
          else if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') ext = '.webp';
          fail(ext, 'PNG, JPEG 또는 WebP 사진을 선택해 주세요.', 415);
          const name = `${randomUUID()}${ext}`;
          fs.writeFileSync(path.join(dir, 'images', name), bytes, { flag: 'wx' });
          if (!coverOnly) write(path.join(dir, 'order.json'), [...names, name]);
          saveMeta(dir, { ...(coverOnly ? {coverUploads:[...names,name]} : {}), labels: { ...meta.labels, [name]: (url.searchParams.get('name') || name).slice(0,200) } });
          return sendJson(res, readJob(id), 201);
        }
        if ((action.startsWith('images/') || action.startsWith('draft-images/')) && req.method === 'GET') {
          const name = decodeURIComponent(action.slice(action.indexOf('/') + 1));
          fail(name === path.basename(name) && !/[\\/]/.test(name) && /\.(png|jpe?g|webp)$/i.test(name), '잘못된 사진 경로입니다.');
          const base = action.startsWith('draft-images/') ? savedDirectory(id, metaFor(dir)) : dir;
          fail(base, '초안 사진을 찾을 수 없습니다.', 404);
          return sendFile(res, path.join(base, 'images', name));
        }
        if (action === 'references/read' && req.method === 'POST') {
          const references = readReferences(dir);
          fail(references.length > 0, '참고자료 링크를 먼저 추가해 주세요.');
          active.add(id);
          referenceReadStates.set(id,{phase:'reading',message:'참고자료의 본문을 확인하고 있어요.'});
          sendJson(res,readJob(id),202);
          collectReferences(references,fetchReference,message=>referenceReadStates.set(id,{phase:'reading',message}),notionReader)
            .then(reports=>{
              write(path.join(dir,'references-check.json'),{references,reports});
              referenceReadStates.set(id,{phase:'done'});
            }).catch(error=>referenceReadStates.set(id,{phase:'error',message:error.message}))
            .finally(()=>active.delete(id));
          return;
        }
        if (action === 'generate' && req.method === 'POST') {
          fail(!checkingAI, 'AI 연결 확인이 끝난 뒤 다시 시도해 주세요.', 409);
          fail(active.size === 0, '다른 글을 작성 중입니다. 완료된 뒤 시도해 주세요.', 409);
          fail(imageNames(dir).length > 0, '먼저 개발 캡처를 올려 주세요.');
          const meta = metaFor(dir), previousDirectory = meta.directory || null;
          const previousDraft = previousDirectory && exists(path.join(previousDirectory,'draft.json')) ? json(path.join(previousDirectory,'draft.json')) : null;
          const directory = prepare(id);
          const styleFile = path.resolve(root, c.styleProfile);
          fail(exists(styleFile), '말투 참고 자료가 없습니다. 설정에서 기존 글의 말투를 먼저 준비해 주세요.');
          active.add(id); saveMeta(dir, { generating: true, directory: previousDirectory });
          generationStates.set(id, { phase: 'generating', message: '캡처를 분석할 준비를 하고 있어요.' });
          sendJson(res, readJob(id), 202);
          Promise.resolve().then(async () => {
            const onProgress = message => generationStates.set(id, { phase: 'generating', message });
            const references = await collectReferences(readReferences(directory), fetchReference, onProgress, notionReader);
            const result = await generator({ provider, root, directory, title: meta.title, notes: fs.readFileSync(path.join(directory, 'notes.md'), 'utf8'),
              references, style: fs.readFileSync(styleFile, 'utf8'), onProgress });
            return { result, references };
          })
            .then(({ result, references }) => {
              fail(typeof result.analysis === 'string' && typeof result.review === 'string' && Array.isArray(result.sensitiveImages), '초안 결과 형식이 올바르지 않습니다.');
              const blocked = new Set(result.sensitiveImages);
              fail(Array.isArray(result.draft?.blocks), '본문이 생성되지 않았습니다.');
              result.draft.blocks = result.draft.blocks.filter(b => b.type !== 'image' || !blocked.has(b.file));
              // Cover selection belongs to the user, and survives regeneration.
              delete result.draft.category;
              if (previousDraft?.category) result.draft.category = previousDraft.category;
              delete result.draft.cover;
              if (previousDraft?.cover && !blocked.has(previousDraft.cover)) result.draft.cover = previousDraft.cover;
              // The user owns the info card; AI regeneration cannot replace it.
              delete result.draft.githubCard;
              if (previousDraft?.githubCard) result.draft.githubCard=structuredClone(previousDraft.githubCard);
              const labels = metaFor(dir).labels || {};
              const review = result.review + referenceReview(references) + (blocked.size ? '\n\n민감한 정보가 보일 수 있어 제외한 사진:\n' + [...blocked].map(name => labels[name] || name).join('\n') : '');
              persistDraft(id, directory, result.draft, review, result.analysis, references);
              write(path.join(dir,'references-check.json'),{references:readReferences(directory),reports:references});
              generationStates.set(id, { phase: 'done', message: '초안을 만들었어요. 내용과 사진을 확인해 주세요.' });
            }).catch(e => { saveMeta(dir, { generating: false }); generationStates.set(id, { phase: 'error', message: e.message }); })
            .finally(() => active.delete(id));
          return;
        }
        if (action === 'draft' && req.method === 'PUT') {
          const b = await bodyJson(req);
          mutableJob(id);
          const meta = metaFor(dir);
          const directory = savedDirectory(id, meta) || prepare(id);
          fail(typeof b.review === 'string', '검토 메모 형식을 확인해 주세요.');
          persistDraft(id, directory, b.draft, b.review);
          return sendJson(res, readJob(id));
        }
        if (action === 'transfer' && req.method === 'POST') {
          const meta = metaFor(dir), directory = savedDirectory(id, meta);
          fail(directory && exists(path.join(directory, 'draft.json')), '먼저 초안을 만들어 보관해 주세요.');
          const render = json(path.join(directory, 'render.json'));
          const instruction = `티스토리 초안을 임시저장해줘. 작업 폴더: ${directory}\n현재 draft.json과 review.md를 읽고, ${c.blogUrl} 글쓰기 화면에 사진과 본문을 넣어 임시저장해줘. 새로 글을 생성하지 말고 내가 검토한 초안을 사용해줘. 기존 저장 기록이 있으면 중복 글을 만들지 말고 확인해줘. 최종 발행은 내가 할게.`;
          write(path.join(directory, 'transfer-request.json'), { status: 'pending', requestedAt: new Date().toISOString(), draftDigest: render.draftDigest, instruction });
          saveMeta(dir, { transfer: 'pending' });
          return sendJson(res, { instruction, message: '임시저장 요청이 준비됐습니다. 아래 요청을 Codex에 보내 주세요. 아직 티스토리에 저장되지는 않았습니다.' });
        }
        fail(false, '요청한 기능을 찾을 수 없습니다.', 404);
      }
      if (req.method === 'GET' && route === '/article.css') { res.writeHead(200, { 'Content-Type':'text/css; charset=utf-8' }); return res.end(articleCss); }
      const staticFiles = { '/': 'index.html', '/app.js': 'app.js', '/ai-help.js': 'ai-help.js', '/style-settings.js': 'style-settings.js', '/draft-model.js':'draft-model.js', '/article-renderer.js':'article-renderer.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg', '/favicon.png': 'favicon.png', '/logo.png': 'logo.png' };
      if (req.method === 'GET' && Object.hasOwn(staticFiles, route)) return sendFile(res, path.join(webRoot, staticFiles[route]));
      fail(false, '페이지를 찾을 수 없습니다.', 404);
    } catch (error) {
      if (!res.headersSent) sendJson(res, { error: error.status ? error.message : '작업을 완료하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.' }, error.status || 500);
      else res.end();
    }
  });
  server.hasActiveGeneration = () => active.size > 0 || styles.isRunning() || categories.isRunning();
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TISTORY_APP_PORT || 4173);
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`H.Dev Studio: http://127.0.0.1:${port}`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `포트 ${port}를 사용 중입니다. 실행 중인 앱을 확인해 주세요.` : e.message); process.exitCode = 1; });
}
