import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { analyzeWritingStyle } from './generate.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}
const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip, prefix);
export const publicIP = ip => isIP(ip) === 4 ? !blocked.check(ip) : isIP(ip) === 6 && /^[23][a-f\d]{3}:/i.test(ip) && !/^2001:(?:0:|db8:)/i.test(ip);
export function styleAddress(value) {
  let url;
  try { url = new URL(value); } catch { fail('https://로 시작하는 공개 블로그 주소를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname.replace(/[\[\]]/g,'')) || !url.hostname.includes('.') || /\.(localhost|local|internal)$/i.test(url.hostname)) fail('공개 블로그의 HTTPS 주소를 입력해 주세요.');
  url.hash = '';
  return url.href.replace(/\/$/, '');
}
export function styleURLs(values) {
  if (!Array.isArray(values) || values.length > 3 || values.some(v => typeof v !== 'string' || v.length > 2048)) fail('참고 블로그는 최대 3개까지 입력할 수 있습니다.');
  const urls = values.filter(v => v.trim()).map(v => styleAddress(v.trim()));
  if (new Set(urls).size !== urls.length) fail('같은 블로그 주소가 중복되어 있어요.');
  return urls;
}

// Resolve and pin public addresses for every redirect; no credentials or cookies are sent.
export async function fetchStylePage(input, redirects = 0) {
  const url = new URL(styleAddress(input));
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicIP(a.address))) fail('이 주소는 공개 블로그 주소로 사용할 수 없습니다.');
  const chosen = addresses.find(a => a.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: false, signal: AbortSignal.timeout(15000),
      headers: { Accept: 'text/html, application/xml, text/xml, */*', 'User-Agent': 'HDevStudio/0.3 (public blog style reader)' },
      lookup: (_host, options, callback) => options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family)
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= 3 || !res.headers.location) return reject(new Error('블로그 주소 이동을 확인하지 못했습니다.'));
        try { resolve(fetchStylePage(new URL(res.headers.location, url).href, redirects + 1)); } catch (e) { reject(e); }
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`공개 글에 연결하지 못했습니다 (${res.statusCode}).`)); }
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { req.destroy(new Error('공개 글의 크기가 너무 큽니다.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: url.href }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

const clean = ($, node) => {
  const copy = node.clone();
  copy.find('script,style,nav,header,footer,aside,form,button,iframe,blockquote,pre,code,.comments,#comments,.comment-list,.area_reply,.adsbygoogle,[class*="advert"],[class*="related"],[data-ke-type="moreLess"]').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p,li,h1,h2,h3,h4').append('\n');
  return copy.text().replace(/[\t ]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
};
export function parseStyleArticle(html, url) {
  const $ = load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text();
  // Never use the entire page: navigation and comment text are not writing samples.
  for (const selector of ['.tt_article_useless_p_margin','.contents_style','.article_view','.se-main-container','#postViewArea','[itemprop="articleBody"]','.entry-content','.post-content','article']) {
    const nodes = $(selector);
    if (nodes.length !== 1) continue;
    const text = clean($, nodes.first());
    if (text.length >= 250) return { url, title: title.trim(), text: text.slice(0, 8000) };
  }
  return null;
}
function feedLinks(xml, base) {
  const $ = load(xml, { xmlMode: true });
  return $('item,entry').toArray().slice(0, 8).map(el => {
    const item = $(el);
    return item.find('link[rel="alternate"]').attr('href') || item.children('link').first().attr('href') || item.children('link').text();
  }).map(value => { try { return new URL(value.trim(), base).href; } catch { return null; } }).filter(Boolean);
}
function readerURL(url) {
  const u = new URL(url);
  if (u.hostname === 'blog.naver.com') u.hostname = 'm.blog.naver.com';
  return u.href;
}
export async function collectStyleSamples(urls, fetchPage = fetchStylePage, onProgress = () => {}) {
  const samples = [], warnings = [];
  for (const blog of urls) {
    onProgress(`${new URL(blog).hostname}의 공개 글을 읽고 있어요.`);
    const blogSamples = [], candidates = [], homepageLinks = [];
    try {
      const page = await fetchPage(readerURL(blog));
      const direct = parseStyleArticle(page.text, page.url);
      if (direct) blogSamples.push(direct);
      const $ = load(page.text);
      $('link[rel="alternate"]').each((_, el) => {
        if (/rss|atom/.test($(el).attr('type') || '')) candidates.push(new URL($(el).attr('href'), page.url).href);
      });
      $('article a[href],a[href]').each((_, el) => {
        try {
          const link = new URL($(el).attr('href'), page.url);
          if (link.origin === new URL(page.url).origin && (/^\/\d+\/?$/.test(link.pathname) || /^\/entry\//.test(link.pathname) || $(el).closest('article').length)) homepageLinks.push(link.href);
        } catch { /* Ignore links that are not URLs. */ }
      });
    } catch { /* A blocked homepage may still expose a public feed. */ }
    const u = new URL(blog);
    if (/(^|\.)blog\.naver\.com$/.test(u.hostname) && u.pathname.split('/')[1]) candidates.unshift(`https://rss.blog.naver.com/${u.pathname.split('/')[1]}.xml`);
    else if (u.hostname === 'velog.io' && /^\/@[^/]+/.test(u.pathname)) candidates.unshift(`https://v2.velog.io/rss/${u.pathname.split('/')[1].slice(1)}`);
    else candidates.push(`${blog}/rss`, `${blog}/feed`);
    const links = [];
    for (const feed of [...new Set(candidates)].slice(0, 3)) {
      try { const page = await fetchPage(feed); links.push(...feedLinks(page.text, page.url)); if (links.length) break; } catch { /* Try the next public feed. */ }
    }
    for (const link of [...new Set([...links, ...homepageLinks])].slice(0, 6)) {
      if (blogSamples.length >= 3) break;
      // Only articles from the requested blog belong in its writing sample.
      const target = new URL(link);
      if (target.hostname !== u.hostname && !(u.hostname.endsWith('blog.naver.com') && target.hostname.endsWith('blog.naver.com'))) continue;
      if (u.pathname !== '/' && !/^\/\d+/.test(u.pathname) && !target.pathname.startsWith(u.pathname.split('/').slice(0, 2).join('/') + '/')) continue;
      try {
        const page = await fetchPage(readerURL(link));
        const article = parseStyleArticle(page.text, page.url);
        if (article && !blogSamples.some(s => s.url === article.url)) blogSamples.push(article);
      } catch { /* Record a shortfall below instead of guessing the article. */ }
    }
    if (!blogSamples.length) warnings.push(`${blog}: 분석할 수 있는 공개 본문을 찾지 못했어요. 공개 글 주소를 입력하거나 말투 지침을 직접 적어 주세요.`);
    else if (blogSamples.length < 3) warnings.push(`${blog}: 공개 글 ${blogSamples.length}개를 읽었어요. 일부 글만으로 분석해 말투 특성이 제한될 수 있어요.`);
    samples.push(...blogSamples.map(sample => ({ ...sample, blog })));
  }
  if (!samples.length) fail('공개 글 본문을 읽지 못했습니다. 공개 글 주소로 다시 시도하거나 말투 지침을 직접 작성해 주세요.');
  return { samples, warnings };
}

export function createStyles({ root, profileFile, analyzer = analyzeWritingStyle, fetchPage = fetchStylePage }) {
  const metadataFile = path.join(root, 'style', 'settings.json'), analysisFile = path.join(root, 'style', 'analysis.json');
  let running = false;
  let analysis = fs.existsSync(analysisFile) ? read(analysisFile) : { phase: 'idle' };
  if (analysis.phase === 'running') analysis = { ...analysis, phase: 'error', message: '앱이 종료되어 분석이 중단됐어요. 다시 분석해 주세요.' };
  const progress = patch => { analysis = { ...analysis, ...patch }; write(analysisFile, JSON.stringify(analysis, null, 2)); };
  function state() {
    const profile = fs.existsSync(profileFile) ? fs.readFileSync(profileFile, 'utf8') : '';
    const metadata = fs.existsSync(metadataFile) ? read(metadataFile) : { urls: [], sources: [] };
    const revision = createHash('sha256').update(profile + JSON.stringify(metadata)).digest('hex');
    return { ...metadata, profile, revision, analysis };
  }
  function save(value) {
    const previous = state();
    if (value.revision !== previous.revision) fail('다른 창에서 말투를 수정했어요. 설정을 다시 연 뒤 변경사항을 확인해 주세요.', 409);
    if (typeof value.profile !== 'string' || !value.profile.trim() || value.profile.length > 20000) fail('말투 지침은 1~20,000자로 입력해 주세요.');
    const urls = styleURLs(value.urls);
    const sources = value.analysisId && value.analysisId === analysis.id && analysis.phase === 'done' ? analysis.sources : previous.sources;
    if (value.analysisId && (value.analysisId !== analysis.id || analysis.phase !== 'done')) fail('분석 결과가 변경됐어요. 최신 결과를 확인해 주세요.', 409);
    if (previous.profile) write(path.join(root, 'style', 'history', `${Date.now()}-${randomUUID()}.md`), previous.profile);
    write(profileFile, value.profile.trim());
    write(metadataFile, JSON.stringify({ urls, sources, updatedAt: new Date().toISOString() }, null, 2));
    return state();
  }
  function start(values, { provider = 'codex' } = {}) {
    if (running) fail('말투를 분석 중이에요. 완료 후 다시 시도해 주세요.', 409);
    const urls = styleURLs(values);
    if (!urls.length) fail('분석할 블로그 주소를 하나 이상 입력해 주세요.');
    running = true;
    analysis = { id: randomUUID(), phase: 'running', urls, message: '블로그에 연결할 준비를 하고 있어요.' };
    progress({});
    Promise.resolve().then(async () => {
      const { samples, warnings } = await collectStyleSamples(urls, fetchPage, message => progress({ message }));
      const result = await analyzer({ provider, samples, onProgress: message => progress({ message }) });
      if (typeof result?.profile !== 'string' || !result.profile.trim() || result.profile.length > 20000) throw new Error('분석한 말투 지침의 형식이 올바르지 않습니다. 다시 시도해 주세요.');
      const readAt = new Date().toISOString();
      progress({ phase: 'done', message: `공개 글 ${samples.length}개의 말투를 분석했어요.`, profile: result.profile,
        sources: samples.map(({ blog, url, title }) => ({ blog, url, title, readAt })), warnings });
    }).catch(e => progress({ phase: 'error', message: e.message || '말투 분석을 완료하지 못했습니다.' })).finally(() => { running = false; });
    return state();
  }
  return { state, save, start, isRunning: () => running };
}
