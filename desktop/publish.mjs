import path from 'node:path';
import { publicationHtml, verifyPublishedHtml } from '../scripts/publication.mjs';
import { parseFeed } from '../scripts/tistory.mjs';
import { articleBlocks } from '../web/draft-model.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const error = message => { throw new Error(message); };

export async function waitForPublishedPost({ blogUrl, draft, uploaded, candidateUrl, fetchPublic = fetch, timeoutMs = 90000 }) {
  const origin = new URL(blogUrl).origin, candidates = new Set([candidateUrl]);
  const articleUrl = value => { try { const u = new URL(value); return u.origin === origin && /^\/(\d+|entry\/[^/]+)\/?$/.test(u.pathname); } catch { return false; } };
  const deadline = Date.now() + timeoutMs;
  do {
    // Tistory can show an /entry/ slug in the editor while the published permalink
    // is numeric. Its public feed supplies the actual link after publication.
    try {
      const feed = await fetchPublic(`${origin}/rss`, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
      if (feed.ok) for (const post of parseFeed(await feed.text(), origin).posts) if (post.title === draft.title && articleUrl(post.url)) candidates.add(post.url);
    } catch { /* A cached or temporarily unavailable feed does not discard the editor URL. */ }
    for (const url of [...candidates].reverse()) {
      if (!articleUrl(url)) continue;
      try {
        const response = await fetchPublic(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(10000) });
        if (response.status >= 300 && response.status < 400) {
          const target = new URL(response.headers.get('location'), url).href;
          if (articleUrl(target)) candidates.add(target);
        } else if (response.ok && verifyPublishedHtml(await response.text(), draft, uploaded)) return url;
      } catch { /* Keep checking only public pages; never resubmit a post. */ }
    }
    if (Date.now() < deadline) await pause(1500);
  } while (Date.now() < deadline);
  error('공개 발행 요청 후 게시 결과를 확인하지 못했습니다.');
}

// These controls were checked in the signed-in Tistory editor on 2026-09-15.
// Only the editor's public DOM and TinyMCE API are used; no private write API.
function editorCommand(command, data) {
  const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const editor = window.tinymce?.get('editor-tistory');
  const title = document.getElementById('post-title-inp');
  const normalize = text => String(text || '').replace(/\s+/g, '');
  if (command === 'writeLink') return [...document.querySelectorAll('a[href]')]
    .find(a => visible(a) && a.textContent.trim() === '글쓰기' && new URL(a.href).origin === location.origin)?.href || null;
  if (command === 'ready') return !!editor?.initialized && visible(title) && !!editor.getBody();
  if (!editor || !title) throw new Error('티스토리 기본 편집기를 찾지 못했습니다. 기본모드에서 다시 시도해 주세요.');
  const images = () => [...editor.getBody().querySelectorAll('img')].map(img => ({
    src: img.getAttribute('src'), ready: img.complete && img.naturalWidth > 0
  }));
  if (command === 'empty') return !title.value.trim() && !editor.getBody().textContent.trim() && !images().length;
  if (command === 'images') return images();
  if (command === 'imageMarkup') {
    // Tistory's getContent hook serializes images into its own shortcode format.
    // Keep the actual uploaded figure and its Tistory metadata from the editor DOM.
    const img = [...editor.getBody().querySelectorAll('img')].find(i => i.getAttribute('src') === data.src);
    if (!img) throw new Error('업로드된 사진 정보를 읽지 못했습니다.');
    const copy = (img.closest('figure') || img).cloneNode(true);
    for (const el of [copy, ...copy.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) if (attr.name.startsWith('data-mce-') || attr.name === 'contenteditable') el.removeAttribute(attr.name);
    }
    return copy.outerHTML;
  }
  if (command === 'click') {
    const button = document.getElementById(data.id);
    if (!visible(button) || button.disabled) return false;
    if (data.text && button.textContent.trim() !== data.text) return false;
    button.click(); return true;
  }
  if (command === 'fill') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(title, data.title); title.dispatchEvent(new Event('input', { bubbles: true })); title.dispatchEvent(new Event('change', { bubbles: true }));
    editor.setContent(data.html);
    if (editor.dispatch) editor.dispatch('change'); else editor.fire('change');
    editor.setDirty(true); editor.save();
    return true;
  }
  if (command === 'tag') {
    const input = document.getElementById('tagText');
    if (!visible(input) || input.value) throw new Error('태그 입력란을 확인해 주세요.');
    input.focus(); return true;
  }
  if (command === 'tagSaved') {
    const input = document.getElementById('tagText');
    return input?.value === '' && [...document.querySelectorAll('a')].some(a =>
      [a.textContent, a.getAttribute('aria-label'), a.getAttribute('title')].some(label => normalize(label) === normalize(`${data.tag} 태그 수정`)));
  }
  if (command === 'verify') {
    const expected = new DOMParser().parseFromString(data.html, 'text/html').body;
    const actual = editor.getBody();
    const expectedImages = [...expected.querySelectorAll('img')].map(i => i.getAttribute('src'));
    const actualImages = images();
    return title.value === data.title && normalize(actual.textContent) === normalize(expected.textContent) &&
      actualImages.length === expectedImages.length && actualImages.every((img, i) => img.src === expectedImages[i] && img.ready);
  }
  if (command === 'panel') {
    const button = document.getElementById('publish-btn'), radio = document.getElementById('open20');
    const slug = document.getElementById('urlPublish');
    if (!visible(button) || !visible(radio) || !slug) return null;
    // Read the permalink shown by Tistory instead of deriving a slug from the title.
    let parent = slug.parentElement, prefix;
    for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
      prefix = parent.textContent.match(/https:\/\/[a-z0-9-]+\.tistory\.com\/(?:entry\/)?/i)?.[0];
      if (prefix) break;
    }
    const candidate = prefix && slug.value ? new URL(slug.value, prefix).href : null;
    const checked = [...document.querySelectorAll('input[type=radio]:checked')];
    const reserved = checked.some(input => {
      const label = [...document.querySelectorAll('label')].find(l => l.htmlFor === input.id);
      return label?.textContent.trim() === '예약';
    });
    return { public: radio.checked, text: button.textContent.trim(), url: candidate, reserved };
  }
  throw new Error('지원하지 않는 편집 동작입니다.');
}

export function createTistoryPublisher({ openWindow, fetchPublic = fetch, onDryRun = null }) {
  return async ({ blogUrl, draft, manifest, directory, onProgress, beforeSubmit, includeToc = true }) => {
    const blog = new URL(blogUrl);
    if (blog.protocol !== 'https:' || !/^[a-z0-9-]+\.tistory\.com$/.test(blog.hostname) || blog.username || blog.password || blog.port)
      error('발행할 티스토리 블로그 주소가 올바르지 않습니다.');
    const win = openWindow(`${blog.origin}/manage`), wc = win.webContents;
    let submitted = false;
    const evalEditor = async (command, data = {}) => {
      if (win.isDestroyed()) error('티스토리 창이 닫혔습니다.');
      if (new URL(wc.getURL() || 'about:blank').origin !== blog.origin) error('로그인이 필요하거나 다른 블로그로 이동했습니다.');
      const result = await wc.executeJavaScript(`(() => { try { return { value: (${editorCommand.toString()})(${JSON.stringify(command)},${JSON.stringify(data)}) }; } catch (error) { return { error: error.message }; } })()`, true);
      if (result.error) error(`${command}: ${result.error}`);
      return result.value;
    };
    const until = async (check, message, timeout = 30000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (win.isDestroyed()) error('티스토리 창이 닫혔습니다.');
        const result = await check(); if (result) return result;
        await pause(350);
      }
      error(message);
    };
    try {
      onProgress('waiting_login', '티스토리 로그인을 확인하고 있어요. 로그인 화면이 나오면 이 창에서 완료해 주세요.');
      const writeLink = await until(async () => {
        if (!wc.getURL().startsWith(`${blog.origin}/manage`) || wc.isLoadingMainFrame()) return null;
        return evalEditor('writeLink');
      }, '로그인 확인 시간이 지났습니다. 티스토리 로그인 후 다시 눌러 주세요.', 5 * 60 * 1000);
      if (new URL(writeLink).origin !== blog.origin || !new URL(writeLink).pathname.startsWith('/manage/')) error('글쓰기 주소가 대상 블로그와 다릅니다.');
      await wc.loadURL(writeLink);
      await until(() => evalEditor('ready'), '티스토리 기본 편집기가 열리지 않았습니다. 복구 안내가 있다면 먼저 처리해 주세요.');
      if (!await evalEditor('empty')) error('티스토리에 작성 중이던 내용이 있습니다. 해당 내용을 보관하고 빈 글쓰기 화면으로 돌아온 뒤 다시 시도해 주세요.');

      const uploaded = {};
      // Tistory's documented default representative image is the first image.
      // Keep the selected cover first in both upload order and the final body.
      const files = [...new Set(articleBlocks(draft).filter(b => b.type === 'image').map(b => b.file))];
      if (files.length) {
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Page.enable');
        await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      }
      for (const [index, file] of files.entries()) {
        onProgress('uploading', `사진 ${index + 1}/${files.length}장을 티스토리에 올리고 있어요.`);
        const previous = await evalEditor('images');
        const chooser = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { wc.debugger.removeListener('message', listener); reject(new Error('사진 선택 창이 열리지 않았습니다.')); }, 20000);
          const listener = (_event, method, params) => {
            if (method !== 'Page.fileChooserOpened') return;
            clearTimeout(timer); wc.debugger.removeListener('message', listener);
            wc.debugger.sendCommand('DOM.setFileInputFiles', { files: [path.join(directory, 'images', file)], backendNodeId: params.backendNodeId }).then(resolve, reject);
          };
          wc.debugger.on('message', listener);
        });
        // Attach a handler immediately, including when the menu itself fails.
        chooser.catch(() => {});
        await until(() => evalEditor('click', { id: 'mceu_0-open' }), '사진 첨부 버튼을 찾지 못했습니다.');
        await until(() => evalEditor('click', { id: 'attach-image' }), '사진 첨부 메뉴를 찾지 못했습니다.');
        await chooser;
        const image = await until(async () => {
          const next = (await evalEditor('images')).filter(i => !previous.some(old => old.src === i.src));
          if (next.length > 1) error('다른 사진이 함께 추가됐습니다. 내용을 확인한 뒤 다시 시도해 주세요.');
          return next.length === 1 && next[0].ready && next[0].src?.startsWith('https://') ? next[0] : null;
        }, '사진 업로드가 끝나지 않았습니다. 네트워크 연결과 티스토리 창을 확인해 주세요.', 90000);
        uploaded[file] = await evalEditor('imageMarkup', image);
      }
      if (wc.debugger.isAttached()) wc.debugger.detach();
      onProgress('filling', '검토한 제목·본문·사진·태그를 편집기에 입력하고 있어요.');
      const html = publicationHtml(draft, manifest, uploaded, { includeToc });
      await evalEditor('fill', { title: draft.title, html });
      win.show(); win.focus();
      for (const tag of draft.tags) {
        await evalEditor('tag');
        await wc.insertText(tag);
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await until(() => evalEditor('tagSaved', { tag }), `태그 “${tag}”를 확인하지 못했습니다.`, 5000);
      }
      await until(() => evalEditor('verify', { title: draft.title, html }), '편집기 내용이 검토한 초안과 다릅니다. 발행하지 않았습니다.');
      await until(() => evalEditor('click', { id: 'publish-layer-btn', text: '완료' }), '발행 설정 버튼을 찾지 못했습니다.');
      await until(() => evalEditor('panel'), '티스토리 발행 설정이 열리지 않았습니다.');
      await evalEditor('click', { id: 'open20' });
      const panel = await until(async () => {
        const panel = await evalEditor('panel'); return panel?.public && panel.text === '공개 발행' ? panel : null;
      }, '공개 발행 설정을 확인하지 못했습니다.');
      if (panel.reserved) error('예약 발행이 선택되어 있습니다. 현재 발행으로 바꾼 뒤 다시 시도해 주세요.');
      if (!panel.url || new URL(panel.url).origin !== blog.origin || !/^\/(\d+|entry\/[^/]+)\/?$/.test(new URL(panel.url).pathname))
        error('발행될 글 주소를 확인하지 못했습니다.');
      if (!await evalEditor('verify', { title: draft.title, html })) error('발행 직전 내용이 변경됐습니다. 다시 확인해 주세요.');
      // The development harness can inspect the real editor without creating a test post.
      if (onDryRun) { await onDryRun({ win, url: panel.url, draft, html, uploaded }); error('검증 모드: 사진과 본문 입력까지 확인했습니다. 공개 발행은 실행하지 않았습니다.'); }
      beforeSubmit(); submitted = true;
      try {
        if (!await evalEditor('click', { id: 'publish-btn', text: '공개 발행' })) error('공개 발행 버튼을 누르지 못했습니다.');
      } catch {
        // Successful submission can navigate away before executeJavaScript replies.
        // Verification is read-only and does not need the editor window to stay open.
      }
      onProgress('verifying', '공개된 글의 제목·본문·사진을 확인하고 있어요.');
      const url = await waitForPublishedPost({ blogUrl, draft, uploaded, candidateUrl: panel.url, fetchPublic });
      return { url, title: draft.title, verifiedAt: new Date().toISOString(), evidence: { public: true, body: true, images: true, ...(draft.cover ? {cover:true} : {}) } };
    } catch (err) {
      if (!submitted && !win.isDestroyed()) win.setTitle(`발행 중단 · ${err.message}`);
      throw err;
    } finally {
      if (!win.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
    }
  };
}
