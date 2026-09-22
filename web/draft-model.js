export function canRefineBlock(block) {
  if (!block || !['paragraph', 'heading', 'list', 'table', 'image'].includes(block.type)) return false;
  return !![block.text, block.alt, block.caption, ...(block.items || []), ...(block.headers || []), ...(block.rows || []).flat()].some(value => typeof value === 'string' && value.trim());
}

// The same photo order is used in the app, exported preview, and publication.
export function articleBlocks(draft) {
  if (!draft.cover) return draft.blocks;
  const index = draft.blocks.findIndex(block => block.type === 'image' && block.file === draft.cover);
  const cover = index < 0 ? { type:'image', file:draft.cover, alt:`${draft.title} 표지`, caption:'' } : draft.blocks[index];
  return [cover, ...draft.blocks.filter((_, i) => i !== index)];
}

export function manifestImage(manifest, name) {
  return manifest.images.find(image => image.name === name) || manifest.coverImages?.find(image => image.name === name);
}

export function normalizeCategory(value, blogUrl) {
  const invalid = () => { throw new Error('카테고리 정보를 확인하고 목록에서 다시 선택해 주세요.'); };
  if (!value || typeof value !== 'object' || !/^(0|[1-9]\d{0,14})$/.test(value.id) || typeof value.id !== 'string') invalid();
  let url;
  try { url = new URL(value.blogUrl); } catch { invalid(); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.tistory\.com$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) invalid();
  if (blogUrl && url.origin !== new URL(blogUrl).origin) throw new Error('다른 블로그의 카테고리입니다. 현재 블로그의 목록을 불러와 다시 선택해 주세요.');
  if (!Array.isArray(value.path) || value.path.length < 1 || value.path.length > 2 || value.path.some(name => typeof name !== 'string' || !name.trim() || name.length > 100)) invalid();
  const names = value.path.map(name => name.trim());
  if (value.id === '0' && (names.length !== 1 || names[0] !== '카테고리 없음')) invalid();
  return { blogUrl: url.origin, id: value.id, path: names };
}

export function uncategorizedCategory(blogUrl) {
  return normalizeCategory({ blogUrl: new URL(blogUrl).origin, id: '0', path: ['카테고리 없음'] }, blogUrl);
}

// Keep complete paths for publication, but only offer categories without children.
export function selectableCategories(items, blogUrl) {
  const origin = new URL(blogUrl).origin, own = items.filter(item => item.blogUrl === origin);
  const parents = new Set(own.filter(item => item.path.length > 1).map(item => item.path[0]));
  return [uncategorizedCategory(origin), ...own.filter(item => item.id !== '0' && (item.path.length > 1 || !parents.has(item.path[0])))];
}

export function categoryLabel(category, choices) {
  const name = category.path.at(-1);
  return choices.some(item => item.id !== category.id && item.path.at(-1) === name) && category.path.length > 1
    ? `${name} (${category.path[0]})` : name;
}

// Tistory's editor labels child options with "- "; IDs distinguish equal names.
export function categoriesFromEditor(options, blogUrl) {
  if (!Array.isArray(options) || !options.length || options.length > 1000) throw new Error('카테고리 목록을 읽지 못했습니다.');
  let parent;
  const ids = new Set();
  const result = options.map(({ id, label }) => {
    if (typeof label !== 'string') throw new Error('카테고리 이름을 읽지 못했습니다.');
    const child = label.startsWith('- '), name = child ? label.slice(2).trim() : label.trim();
    if (child && !parent) throw new Error('하위 카테고리의 상위 분류를 확인하지 못했습니다.');
    const category = normalizeCategory({ blogUrl, id, path: child ? [parent, name] : [name] }, blogUrl);
    if (ids.has(id)) throw new Error('카테고리 번호가 중복되었습니다.');
    ids.add(id);
    if (!child && id !== '0') parent = name;
    return category;
  });
  if (!ids.has('0')) throw new Error('카테고리 없음 항목을 확인하지 못했습니다.');
  return result;
}
