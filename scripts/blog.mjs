import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { articleBlocks, manifestImage } from '../web/draft-model.js';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = /\.(png|jpe?g|webp)$/i;
const sha = data => createHash('sha256').update(data).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const check = (condition, message) => { if (!condition) throw new Error(message); };

function config(root) {
  const c = readJson(path.join(root, 'tistory.config.json'));
  for (const key of ['inbox', 'output', 'styleSamples', 'styleProfile']) {
    check(typeof c[key] === 'string' && c[key].trim(), `설정 누락: ${key}`);
    c[key] = path.resolve(root, c[key]);
  }
  return c;
}

function jobPath(c, id) {
  check(typeof id === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(id),
    '글 ID는 문자/숫자로 시작하는 80자 이하의 문자, 숫자, 밑줄, 하이픈으로 입력하세요.');
  check(!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id), 'Windows 예약 이름은 사용할 수 없습니다.');
  return path.join(c.inbox, id);
}

function realFile(file, directory = false) {
  const stat = fs.lstatSync(file);
  check(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
    `일반 ${directory ? '폴더' : '파일'}만 사용할 수 있습니다: ${file}`);
}

function snapshot(job) {
  realFile(job, true);
  realFile(path.join(job, 'images'), true);
  let names = fs.readdirSync(path.join(job, 'images')).filter(n => IMAGE.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }) || a.localeCompare(b));
  const orderFile = path.join(job, 'order.json');
  if (fs.existsSync(orderFile)) {
    realFile(orderFile);
    const order = readJson(orderFile);
    check(Array.isArray(order) && new Set(order).size === order.length && order.every(n => names.includes(n)), '사진 순서 목록이 올바르지 않습니다.');
    names = order;
  }
  check(names.length, `images 폴더에 PNG, JPEG 또는 WebP 캡처를 넣으세요: ${job}`);
  const images = names.map(name => {
    const file = path.join(job, 'images', name);
    realFile(file);
    const bytes = fs.readFileSync(file);
    check(bytes.length, `빈 이미지 파일입니다: ${name}`);
    return { name, sha256: sha(bytes), bytes: bytes.length };
  });
  const noteFile = path.join(job, 'notes.md');
  if (fs.existsSync(noteFile)) realFile(noteFile);
  const notes = fs.existsSync(noteFile) ? fs.readFileSync(noteFile, 'utf8') : '';
  const digest = sha(JSON.stringify({ images, notes }));
  return { digest, images, notes };
}

export function newJob(root, id) {
  const c = config(root), job = jobPath(c, id);
  fs.mkdirSync(c.inbox, { recursive: true });
  fs.mkdirSync(job); // Existing jobs must never be overwritten.
  fs.mkdirSync(path.join(job, 'images'));
  fs.writeFileSync(path.join(job, 'notes.md'),
    '# 개발 메모 (선택)\n\n- 하려던 작업:\n- 겪은 문제 / 시도한 방법:\n- 실제 결과:\n- 글에 넣고 싶은 내용:\n\n캡처는 images 폴더에 01, 02, 03 순서로 저장하세요.\n');
  return { id, job, images: path.join(job, 'images') };
}

export function readyJob(root, id) {
  const c = config(root), job = jobPath(c, id), input = snapshot(job);
  const ready = { digest: input.digest, readyAt: new Date().toISOString() };
  writeJson(path.join(job, 'ready.json'), ready);
  return { id, ...ready };
}

export function listJobs(root) {
  const c = config(root);
  if (!fs.existsSync(c.inbox)) return [];
  return fs.readdirSync(c.inbox, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    try {
      const job = jobPath(c, d.name), marker = path.join(job, 'ready.json');
      if (!fs.existsSync(marker)) return { id: d.name, status: 'collecting' };
      const input = snapshot(job);
      if (readJson(marker).digest !== input.digest) return { id: d.name, status: 'changed', hint: 'ready를 다시 실행하세요.' };
      const dest = path.join(c.output, d.name, input.digest);
      let status = 'ready';
      if (fs.existsSync(path.join(dest, 'manifest.json'))) status = 'prepared';
      if (fs.existsSync(path.join(dest, 'preview.html'))) status = 'local_draft';
      if (fs.existsSync(path.join(dest, 'tistory-receipt.json'))) {
        const receipt = readJson(path.join(dest, 'tistory-receipt.json'));
        // This is an agent-written record, not an independent remote verification.
        const draftFile = path.join(dest, 'draft.json');
        status = receipt.inputDigest === input.digest && receipt.verifiedAt && receipt.editorUrl && receipt.title &&
          fs.existsSync(draftFile) && receipt.draftDigest === sha(fs.readFileSync(draftFile))
          ? 'saved_recorded' : 'remote_review_needed';
      }
      return { id: d.name, status, directory: dest };
    } catch (error) { return { id: d.name, status: 'error', error: error.message }; }
  });
}

export function prepareJob(root, id) {
  const c = config(root), job = jobPath(c, id), input = snapshot(job);
  const marker = path.join(job, 'ready.json');
  check(fs.existsSync(marker), '먼저 ready 명령으로 캡처 수집 완료를 표시하세요.');
  check(readJson(marker).digest === input.digest, '준비 완료 이후 사진/메모가 바뀌었습니다. ready를 다시 실행하세요.');
  const dest = path.join(c.output, id, input.digest);
  const manifestFile = path.join(dest, 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = readJson(manifestFile);
    for (const image of manifest.images) {
      const file = path.join(dest, 'images', image.name);
      check(fs.existsSync(file) && sha(fs.readFileSync(file)) === image.sha256, '보관 이미지가 변경됐습니다. 원본과 비교해 복구하세요.');
    }
    check(fs.readFileSync(path.join(dest, 'notes.md'), 'utf8') === input.notes, '보관 메모가 변경됐습니다.');
    return { directory: dest, reused: true };
  }
  fs.mkdirSync(path.join(dest, 'images'), { recursive: true });
  for (const img of input.images) {
    const bytes = fs.readFileSync(path.join(job, 'images', img.name));
    check(sha(bytes) === img.sha256, '복사 중 원본 사진이 바뀌었습니다. ready를 다시 실행하세요.');
    fs.writeFileSync(path.join(dest, 'images', img.name), bytes);
  }
  fs.writeFileSync(path.join(dest, 'notes.md'), input.notes);
  check(snapshot(job).digest === input.digest, '준비 중 원본이 바뀌었습니다. ready를 다시 실행하세요.');
  const manifest = { id, inputDigest: input.digest, preparedAt: new Date().toISOString(),
    blogUrl: c.blogUrl, images: input.images, styleSamples: c.styleSamples, styleProfile: c.styleProfile };
  fs.writeFileSync(path.join(dest, 'task.md'),
    `이 프로젝트의 AGENTS.md와 docs/WRITING.md를 읽고 다음 입력으로 티스토리 임시저장 초안을 처리하세요.\n\n` +
    `작업 폴더: ${dest}\n블로그: ${c.blogUrl || '미설정 — 주소 필요'}\n` +
    `말투 참고 글: ${c.styleSamples}\n말투 프로필: ${c.styleProfile}\n\n` +
    `manifest.json 순서대로 images의 실제 이미지를 보고 notes.md를 읽으세요.\n` +
    `analysis.md, draft.json, review.md를 작성한 뒤 node scripts/blog.mjs render "${dest}"를 실행하세요.\n` +
    `사진과 참고 글이 없으면 임의로 경험이나 말투를 만들어 완료 처리하지 마세요.\n` +
    `브라우저에서 임시저장을 확인한 경우에만 tistory-receipt.json을 기록하세요. 발행은 사용자가 직접 합니다.\n`);
  writeJson(manifestFile, manifest); // Completion marker goes last; interrupted preparation can be retried.
  return { directory: dest, reused: false };
}

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function requiredText(value, label) {
  check(typeof value === 'string' && value.trim(), `${label}에 텍스트가 필요합니다.`);
  return value;
}

export function buildPreview(draft, manifest) {
  const title = requiredText(draft.title, 'title');
  check(Array.isArray(draft.blocks) && draft.blocks.length, 'blocks가 비어 있습니다.');
  check(Array.isArray(draft.tags) && draft.tags.every(t => typeof t === 'string'), 'tags는 문자열 배열이어야 합니다.');
  const imageMap = new Map(manifest.images.map(i => [i.name, i]));
  if (draft.cover != null) {
    check(typeof draft.cover === 'string' && draft.cover === path.basename(draft.cover) && !/[\\/]/.test(draft.cover) && manifestImage(manifest, draft.cover), '표지 사진을 찾을 수 없습니다. 다시 선택해 주세요.');
    imageMap.set(draft.cover, manifestImage(manifest, draft.cover));
  }
  const usedImages = new Set();
  const blocks = articleBlocks(draft).map(block => {
    check(block && typeof block === 'object', '각 block은 객체여야 합니다.');
    switch (block.type) {
      case 'heading': return `<h2>${escapeHtml(requiredText(block.text, 'heading.text'))}</h2>`;
      case 'paragraph': return `<p>${escapeHtml(requiredText(block.text, 'paragraph.text')).replace(/\n/g, '<br>')}</p>`;
      case 'code': return `<pre><code>${escapeHtml(requiredText(block.text, 'code.text'))}</code></pre>`;
      case 'list':
        check(Array.isArray(block.items) && block.items.length, 'list.items가 비어 있습니다.');
        return `<ul>${block.items.map(t => `<li>${escapeHtml(requiredText(t, 'list item'))}</li>`).join('')}</ul>`;
      case 'table':
        check(Array.isArray(block.headers) && block.headers.length && Array.isArray(block.rows), 'table.headers / rows가 필요합니다.');
        return `<table><thead><tr>${block.headers.map(t => `<th>${escapeHtml(requiredText(t, 'table header'))}</th>`).join('')}</tr></thead><tbody>` +
          block.rows.map(row => {
            check(Array.isArray(row) && row.length === block.headers.length && row.every(t => typeof t === 'string'), '표의 열 수와 문자열 값을 확인하세요.');
            return `<tr>${row.map(t => `<td>${escapeHtml(t)}</td>`).join('')}</tr>`;
          }).join('') + '</tbody></table>';
      case 'image': {
        const item = imageMap.get(block.file);
        check(item && path.basename(block.file) === block.file, `입력에 없는 이미지입니다: ${block.file}`);
        usedImages.add(block.file);
        return `<figure><img src="images/${encodeURIComponent(block.file)}" alt="${escapeHtml(requiredText(block.alt, 'image.alt'))}">` +
          `${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`;
      }
      default: throw new Error(`지원하지 않는 block.type: ${block.type}`);
    }
  });
  const body = blocks.join('\n');
  const html = `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'">\n` +
    `<title>${escapeHtml(title)}</title><style>body{max-width:800px;margin:48px auto;padding:0 24px;color:#242424;font:17px/1.85 system-ui,sans-serif}h1{font-size:32px;line-height:1.4}h2{margin-top:2em}img{max-width:100%;height:auto}figure{margin:32px 0}figcaption{font-size:14px;color:#666}pre{padding:20px;background:#f3f4f6;overflow:auto}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%;font-size:15px}th,td{border:1px solid #ddd;padding:10px;text-align:left}.status{font-size:14px;color:#666;border-bottom:1px solid #ddd;padding-bottom:16px}</style></head>\n` +
    `<body><p class="status">로컬 검토용 초안 · 티스토리 저장 여부는 별도 확인</p><h1>${escapeHtml(title)}</h1>${body}</body></html>\n`;
  return { html, body, usedImages: [...usedImages] };
}

export function renderDraft(directory) {
  const dest = path.resolve(directory), draft = readJson(path.join(dest, 'draft.json'));
  const manifest = readJson(path.join(dest, 'manifest.json'));
  const { html, usedImages } = buildPreview(draft, manifest);
  for (const name of usedImages) {
    const item = manifestImage(manifest, name);
    check(sha(fs.readFileSync(path.join(dest, 'images', name))) === item.sha256, `보관 이미지가 변경됐습니다: ${name}`);
  }
  fs.writeFileSync(path.join(dest, 'preview.html'), html);
  // Use JSON blocks to populate the editor; local image paths are not upload URLs.
  writeJson(path.join(dest, 'render.json'), { renderedAt: new Date().toISOString(),
    inputDigest: manifest.inputDigest, draftDigest: sha(fs.readFileSync(path.join(dest, 'draft.json'))),
    usedImages: [...usedImages], omittedImages: manifest.images.map(i => i.name).filter(n => !usedImages.includes(n)) });
  return { preview: path.join(dest, 'preview.html'), usedImages: [...usedImages] };
}

function main() {
  const [command, arg] = process.argv.slice(2);
  const commands = {
    new: () => newJob(PROJECT, arg), ready: () => readyJob(PROJECT, arg),
    list: () => listJobs(PROJECT), prepare: () => prepareJob(PROJECT, arg),
    render: () => { check(arg, '초안 폴더의 경로가 필요합니다.'); return renderDraft(arg); }
  };
  if (!command || command === 'help') {
    console.log('node scripts/blog.mjs new <글-ID>\nnode scripts/blog.mjs ready <글-ID>\nnode scripts/blog.mjs list\nnode scripts/blog.mjs prepare <글-ID>\nnode scripts/blog.mjs render <초안-폴더>');
    return;
  }
  check(Object.hasOwn(commands, command), `알 수 없는 명령: ${command}`);
  console.log(JSON.stringify(commands[command](), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
