import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const plain = html => load(String(html || '')).text().replace(/\s+/g, ' ').trim();
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export function blogAddress(input) {
  let url;
  try { url = new URL(input); } catch { fail('https://블로그이름.tistory.com 형식으로 입력해 주세요.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.tistory\.com$/.test(url.hostname) || url.port || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash)
    fail('티스토리 블로그의 HTTPS 기본 주소를 입력해 주세요.');
  return { id: url.hostname.split('.')[0], url: url.origin, title: url.hostname.split('.')[0] };
}

function postAddress(input, origin) {
  try {
    const u = new URL(input, origin);
    if (u.origin === origin && (/^\/\d+\/?$/.test(u.pathname) || /^\/entry\/[^/]+\/?$/.test(u.pathname))) return u.origin + u.pathname.replace(/\/$/, '');
  } catch { /* Ignore non-article and off-site URLs in public feeds. */ }
  return null;
}

export function parseFeed(xml, origin) {
  const $ = load(xml, { xmlMode: true });
  if (!$('rss channel').length) throw new Error('RSS를 읽을 수 없습니다.');
  const posts = [];
  $('item').each((_, node) => {
    const item = $(node), url = postAddress(item.children('link').text(), origin);
    if (!url) return;
    const date = new Date(item.children('pubDate').text());
    posts.push({ url, title: plain(item.children('title').text()), category: plain(item.children('category').first().text()),
      publishedAt: Number.isNaN(date.getTime()) ? '' : date.toISOString(), summary: plain(item.children('description').text()).slice(0, 450) });
  });
  return { title: plain($('channel > title').first().text()), posts };
}

export function parseSitemap(xml, origin) {
  const $ = load(xml, { xmlMode: true });
  if (!$('urlset').length) throw new Error('사이트맵을 읽을 수 없습니다.');
  return [...new Set($('url > loc').toArray().map(el => postAddress($(el).text(), origin)).filter(Boolean))];
}

function parseArticle(html, url) {
  const $ = load(html);
  return { url, title: plain($('meta[property="og:title"]').attr('content') || $('h1').first().text()) || url,
    category: plain($('a.category').first().text()), publishedAt: $('meta[property="article:published_time"]').attr('content') || '',
    summary: plain($('meta[property="og:description"]').attr('content') || '').slice(0, 450) };
}

async function publicText(url, fetcher) {
  const res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`공개 자료를 가져오지 못했습니다 (${res.status}).`);
  let size = 0; const chunks = [];
  for await (const bytes of res.body) {
    size += bytes.length;
    if (size > 8 * 1024 * 1024) throw new Error('공개 자료가 너무 큽니다.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLibrary(root, initialUrl, fetcher = fetch) {
  const catalog = path.join(root, 'library', 'blogs.json');
  const cacheFile = id => path.join(root, 'library', `${id}.json`);
  const pending = new Map();
  function list() { return (fs.existsSync(catalog) ? read(catalog) : [blogAddress(initialUrl)]).filter(blog => blog.id !== 'your-blog'); }
  function get(id) { return list().find(b => b.id === id) || fail('등록한 블로그를 찾을 수 없습니다.'); }
  function add(input) {
    const blog = blogAddress(input), blogs = list();
    if (!blogs.some(b => b.id === blog.id)) {
      if (blogs.length >= 12) fail('블로그는 최대 12개까지 등록할 수 있습니다.');
      write(catalog, [...blogs, blog]);
    }
    return list();
  }
  function cached(id) {
    const blog = get(id);
    return fs.existsSync(cacheFile(id)) ? read(cacheFile(id)) : { ...blog, posts: [], syncedAt: null, warnings: [] };
  }
  async function refresh(id) {
    const blog = get(id);
    const result = await Promise.allSettled([
      publicText(`${blog.url}/rss`, fetcher).then(xml => parseFeed(xml, blog.url)),
      publicText(`${blog.url}/sitemap.xml`, fetcher).then(xml => parseSitemap(xml, blog.url))
    ]);
    if (result.every(r => r.status === 'rejected')) fail('블로그에 연결하지 못했습니다. 주소와 인터넷 연결을 확인해 주세요. 이전 목록은 유지됩니다.');
    const warnings = [], feed = result[0].status === 'fulfilled' ? result[0].value : { title: blog.title, posts: [] };
    if (result[0].status === 'rejected') warnings.push('RSS를 가져오지 못해 사이트맵으로 목록을 불러왔습니다.');
    if (result[1].status === 'rejected') warnings.push('사이트맵을 가져오지 못해 RSS에 나온 최근 글만 표시합니다.');
    const posts = new Map(feed.posts.map(p => [p.url, p]));
    const urls = result[1].status === 'fulfilled' ? result[1].value : [];
    const missing = urls.filter(url => !posts.has(url));
    if (missing.length > 500) warnings.push('한 번에 최근 RSS와 사이트맵의 추가 글 500개까지 표시합니다. 전체 글은 티스토리 글 관리에서 확인해 주세요.');
    let failed = 0;
    for (let i = 0; i < Math.min(missing.length, 500); i += 3) {
      await Promise.all(missing.slice(i, Math.min(i + 3, 500)).map(async url => {
        try { posts.set(url, parseArticle(await publicText(url, fetcher), url)); }
        catch { failed++; posts.set(url, { url, title: `제목을 불러오지 못한 글 · ${url.split('/').pop()}`, category: '', publishedAt: '', summary: '' }); }
      }));
    }
    if (failed) warnings.push(`${failed}개 글의 제목을 불러오지 못했습니다. 원문 보기를 이용하거나 다시 새로고침해 주세요.`);
    const data = { ...blog, title: feed.title || blog.title, syncedAt: new Date().toISOString(), warnings,
      posts: [...posts.values()].sort((a,b) => b.publishedAt.localeCompare(a.publishedAt) || b.url.localeCompare(a.url, 'en', { numeric: true })) };
    write(cacheFile(id), data);
    write(catalog, list().map(b => b.id === id ? { ...b, title: data.title } : b));
    return data;
  }
  return { list, add, read: cached, sync(id) {
    get(id);
    if (!pending.has(id)) pending.set(id, refresh(id).finally(() => pending.delete(id)));
    return pending.get(id);
  } };
}
