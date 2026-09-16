import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import { publicAddress, fetchPublicPage } from './public-web.mjs';
import { isNotionPage, readNotionPage } from './notion-public.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function normalizeReferences(value) {
  if (!Array.isArray(value) || value.length > 5) fail('참고자료는 한 글에 최대 5개까지 추가할 수 있어요.');
  const references = value.map(item => {
    if (!item || typeof item.url !== 'string' || item.url.length > 2048 || (item.content !== undefined && (typeof item.content !== 'string' || item.content.length > 10000))) fail('참고자료 주소와 붙여 넣은 내용(10,000자 이하)을 확인해 주세요.');
    return { url: publicAddress(item.url.trim()), content: (item.content || '').trim() };
  });
  if (new Set(references.map(item => item.url)).size !== references.length) fail('이미 추가한 참고자료 주소예요.');
  return references;
}
export function readReferences(directory) {
  const file = path.join(directory, 'references.json');
  if (!fs.existsSync(file)) return [];
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('참고자료 파일 경로가 올바르지 않습니다.');
  return normalizeReferences(JSON.parse(fs.readFileSync(file, 'utf8')));
}
export function parseReferencePage(html, url, contentType = '') {
  if (contentType && !/html|text\/plain|text\/markdown/i.test(contentType)) return null;
  if (/text\/(plain|markdown)/i.test(contentType)) {
    const text = html.trim();
    return text.length >= 100 ? { title: new URL(url).hostname, text: text.slice(0, 10000), truncated: text.length > 10000 } : null;
  }
  const $ = load(html);
  if (/\/(login|signin|auth)(\/|\?|$)/i.test(new URL(url).pathname) || $('input[type="password"]').length) return null;
  const title = ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text()).trim().slice(0, 300);
  for (const selector of ['.tt_article_useless_p_margin','.contents_style','.article_view','.se-main-container','#postViewArea','.notion-page-content','[itemprop="articleBody"]','.entry-content','.post-content','.markdown-body','article','main','[role="main"]']) {
    const node = $(selector);
    if (node.length !== 1) continue;
    const copy = node.clone();
    copy.find('script,style,nav,header,footer,aside,form,button,iframe,.comments,#comments,.comment-list,.area_reply,.adsbygoogle,[hidden],[aria-hidden="true"],[class*="advert"],[class*="related"]').remove();
    copy.find('br').replaceWith('\n'); copy.find('p,li,h1,h2,h3,h4,pre,tr').append('\n');
    const text = copy.text().replace(/\r/g, '').replace(/[\t ]+\n/g, '\n').replace(/\n\s*\n+/g, '\n\n').trim();
    if (text.length >= 100) return { title: title || new URL(url).hostname, text: text.slice(0, 10000), truncated: text.length > 10000 };
  }
  return null;
}
export async function collectReferences(inputs, fetchPage = fetchPublicPage, onProgress = () => {}, notionReader = readNotionPage) {
  const results = [];
  for (const [index, reference] of normalizeReferences(inputs).entries()) {
    onProgress(`참고자료 ${index + 1}/${inputs.length}의 내용을 읽고 있어요.`);
    const base = { url: reference.url, title: new URL(reference.url).hostname, readAt: new Date().toISOString() };
    if (reference.content) {
      results.push({ ...base, status: 'provided', text: reference.content, message: '직접 붙여 넣은 내용 사용', truncated: false });
      continue;
    }
    try {
      const reader = new URL(reference.url);
      if (reader.hostname === 'blog.naver.com') reader.hostname = 'm.blog.naver.com';
      const notion = isNotionPage(reader.href);
      const page = notion ? null : await fetchPage(reader.href);
      const article = notion ? await notionReader(reader.href, undefined, onProgress) : parseReferencePage(page.text, page.url, page.contentType);
      if (!article) throw new Error('No readable body');
      results.push({ ...base, ...article, resolvedUrl: page?.url || reader.href, status: 'read', message: article.truncated ? `본문 앞부분 ${article.text.length.toLocaleString('ko-KR')}자 확인 (길이 제한)` : notion ? `공개 노션 본문 확인 · ${article.text.length.toLocaleString('ko-KR')}자` : '공개 본문 확인' });
    } catch (error) {
      const notion = isNotionPage(reference.url);
      results.push({ ...base, status: 'unavailable', text: '', message: notion ? (/^노션/.test(error.message) ? error.message : '노션 본문을 불러오지 못했어요. 잠시 후 다시 읽어 주세요.') : '본문을 읽지 못했어요. 공개 웹페이지 주소를 확인하거나 필요한 내용을 직접 붙여 넣어 주세요.' });
    }
  }
  return results;
}
export function referenceReview(references) {
  if (!references.length) return '';
  return '\n\n참고자료 확인 기록\n' + references.map(item => `- ${item.url}: ${item.message} (${item.readAt})`).join('\n');
}
