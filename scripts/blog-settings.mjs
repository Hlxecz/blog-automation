import fs from 'node:fs';
import path from 'node:path';
import { blogAddress } from './tistory.mjs';

export function blogConfigured(value) {
  try { return blogAddress(value).id !== 'your-blog'; } catch { return false; }
}

export function requireBlog(value) {
  if (!blogConfigured(value)) throw Object.assign(new Error('먼저 내 블로그 설정에서 본인의 티스토리 주소를 저장해 주세요.'), { status: 409 });
  return blogAddress(value).url;
}

export function saveBlogAddress(root, value) {
  const url = blogAddress(typeof value === 'string' ? value.trim() : '').url;
  requireBlog(url);
  const file = path.join(root, 'tistory.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...config, blogUrl: url }, null, 2));
  fs.renameSync(temporary, file);
  return url;
}
