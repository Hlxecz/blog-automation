import fs from 'node:fs';
import path from 'node:path';
import { normalizeCategory } from '../web/draft-model.js';

export function createCategories({ root, blogUrl, reader }) {
  const origin = new URL(blogUrl).origin, file = path.join(root, 'library', 'categories.json');
  let saved = { blogUrl: origin, items: [], updatedAt: null }, busy = false;
  const validate = items => {
    if (!Array.isArray(items) || !items.length || items.length > 1000) throw new Error('카테고리 목록을 읽지 못했습니다.');
    const normalized = items.map(item => normalizeCategory(item, origin));
    if (!normalized.some(item => item.id === '0') || new Set(normalized.map(item => item.id)).size !== normalized.length) throw new Error('카테고리 목록을 다시 확인해 주세요.');
    return normalized;
  };
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache.blogUrl === origin) saved = { blogUrl: origin, items: validate(cache.items), updatedAt: cache.updatedAt };
  } catch { /* A missing, invalid or other-blog cache must never supply choices. */ }
  const state = () => ({ ...saved, busy, canRead: !!reader });
  async function refresh() {
    if (!reader) throw Object.assign(new Error('카테고리 불러오기는 데스크톱 앱에서 사용할 수 있어요.'), { status: 409 });
    if (busy) throw Object.assign(new Error('카테고리를 불러오는 중입니다.'), { status: 409 });
    busy = true;
    try {
      const next = { blogUrl: origin, items: validate(await reader({ blogUrl: origin })), updatedAt: new Date().toISOString() };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2)); fs.renameSync(`${file}.tmp`, file);
      saved = next;
    } catch (error) { throw Object.assign(new Error(error.message), { status: 400 }); }
    finally { busy = false; }
    return state();
  }
  return { state, refresh, isRunning: () => busy };
}
