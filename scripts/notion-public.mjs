import { publicAddress, fetchPublicJSON } from './public-web.mjs';

export const isNotionPage = url => /(^|\.)(notion\.site|notion\.so)$/.test(new URL(url).hostname);
const blockValue = entry => entry?.value?.value || entry?.value;
const richText = parts => Array.isArray(parts) ? parts.map(part => {
  if (!Array.isArray(part) || typeof part[0] !== 'string') return '';
  const link = part[1]?.find?.(annotation => annotation[0] === 'a' && /^https?:\/\//i.test(annotation[1]));
  return link && link[1] !== part[0] ? `${part[0]} (${link[1]})` : part[0];
}).join('') : '';

export function notionPageId(input) {
  const url = new URL(publicAddress(input));
  if (!isNotionPage(url.href)) throw new Error('노션 공개 페이지 주소가 아닙니다.');
  const match = url.pathname.match(/([a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/?$/i);
  if (!match) throw new Error('노션 페이지의 전체 공유 주소를 입력해 주세요.');
  const id = match[1].replace(/-/g,'').toLowerCase();
  return id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
}

export function notionArticle(blocks, pageId) {
  const root = blockValue(blocks[pageId]);
  if (!root || root.alive === false || root.type !== 'page') throw new Error('노션 공개 본문에 접근하지 못했습니다.');
  const title = richText(root.properties?.title).trim();
  const lines = [], visited = new Set();
  let missing = 0;
  function visit(id, parent) {
    if (visited.has(id)) return;
    visited.add(id);
    const block = blockValue(blocks[id]);
    if (!block) { missing++; return; }
    if (block.alive === false) return;
    const props = block.properties || {}, text = richText(props.title);
    if (block.type === 'table_row') {
      lines.push((parent?.format?.table_block_column_order || Object.keys(props)).map(key => richText(props[key])).join(' | '));
    } else if (block.type === 'code') {
      lines.push('```' + richText(props.language) + '\n' + text + '\n```');
    } else if (block.type === 'divider') lines.push('---');
    else if (text) {
      const prefix = {header:'# ',sub_header:'## ',sub_sub_header:'### ',bulleted_list:'- ',numbered_list:'1. ',to_do:richText(props.checked)==='Yes'?'[x] ':'[ ] '}[block.type] || '';
      lines.push(prefix + text);
    }
    for (const key of ['caption','source']) { const value = richText(props[key]); if (value && value !== text) lines.push(value); }
    // Child pages/databases are separate documents. Toggle/list/table children belong to this page.
    if (id !== pageId && ['page','collection_view','collection_view_page'].includes(block.type)) return;
    for (const child of block.content || []) visit(child,block);
  }
  visit(pageId);
  if (missing) throw new Error('노션 본문 일부가 아직 로드되지 않았습니다. 다시 읽어 주세요.');
  const text = lines.join('\n\n').trim();
  if (!title || text.length <= title.length) throw new Error('노션 페이지에 읽을 본문이 없습니다.');
  return {title:title.slice(0,300),text:text.slice(0,60000),truncated:text.length>60000,sourceCharacters:text.length,blockCount:visited.size,reader:'notion'};
}

// Uses the same anonymous, read-only chunk request as Notion's public web client.
// No workspace credentials, login cookies or external document links are used.
export async function readNotionPage(input, request = fetchPublicJSON, onProgress = () => {}) {
  const url = new URL(publicAddress(input)), pageId = notionPageId(url.href);
  const endpoint = new URL('/api/v3/loadCachedPageChunkV2',url).href;
  const blocks = {}, pending = [{id:pageId,cursor:{stack:[]}}], seen = new Set(), sessions = new Map();
  const started = Date.now(); let chunks = 0;
  // Notion omits collapsed heading/toggle children from the initial page chunks.
  // Load only missing descendants listed by this page, never unrelated records.
  function missingParents(id, visited = new Set()) {
    if (visited.has(id)) return [];
    visited.add(id);
    const block = blockValue(blocks[id]);
    if (!block || block.alive === false || (id !== pageId && ['page','collection_view','collection_view_page'].includes(block.type))) return [];
    const children = block.content || [];
    return [...(children.some(child => !blockValue(blocks[child])) ? [id] : []), ...children.flatMap(child => missingParents(child,visited))];
  }
  while (true) {
    if (!pending.length) pending.push(...missingParents(pageId).map(id=>({id,cursor:{stack:[]}})));
    if (!pending.length) break;
    if (++chunks > 48 || Date.now()-started > 45000) throw new Error('노션 본문을 모두 읽기 전에 시간이 초과됐습니다. 다시 읽어 주세요.');
    const {id,cursor} = pending.shift(), key = id + JSON.stringify(cursor);
    if (seen.has(key)) throw new Error('노션 본문의 다음 부분을 확인하지 못했습니다. 다시 읽어 주세요.');
    seen.add(key); onProgress(`노션 본문 ${chunks}번째 부분을 읽고 있어요.`);
    const dedupeSessionId = sessions.get(id);
    const data = await request(endpoint,{page:{id},cursor,verticalColumns:false,...(dedupeSessionId?{dedupeSessionId}:{})});
    if (!data.recordMap?.block || !Array.isArray(data.cursors)) throw new Error('노션 공개 본문에 접근하지 못했습니다.');
    Object.assign(blocks,data.recordMap.block);
    if (typeof data.dedupeSessionId === 'string') sessions.set(id,data.dedupeSessionId);
    for (const next of data.cursors) {
      if (!Array.isArray(next?.stack)) throw new Error('노션 본문 응답을 확인하지 못했습니다.');
      if (next.stack.length) pending.push({id,cursor:next});
    }
  }
  return notionArticle(blocks,pageId);
}
