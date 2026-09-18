import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWritingPrompts, writingExamples } from '../scripts/writing-prompts.mjs';
import { buildGenerationPrompt } from '../scripts/generate.mjs';

const blogUrl = 'https://example.tistory.com';
const news = { blogUrl, id: '11', path: ['AI', '뉴스'] };
const other = { blogUrl, id: '21', path: ['개발', '뉴스'] };
const none = { blogUrl, id: '0', path: ['카테고리 없음'] };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-writing-test-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('hdev-writing-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'style.md'), '기존 기본 블로그 프롬프트를 그대로 보존합니다.');
  return { root, store: createWritingPrompts({ root, blogUrl }) };
}

test('category prompts persist independently and leave the existing default profile untouched', t => {
  const { root, store } = fixture(t);
  const original = fs.readFileSync(path.join(root, 'style.md'));
  assert.deepEqual(store.resolve(news), { category: news, prompt: '' });
  let state = store.save({ category: news, prompt: '핵심 소식 위주로 작성합니다.', revision: store.state().revision });
  state = store.save({ category: other, prompt: '개발 예제를 설명합니다.', revision: state.revision });
  assert.equal(createWritingPrompts({ root, blogUrl }).resolve(news).prompt, '핵심 소식 위주로 작성합니다.');
  assert.equal(store.resolve(other).prompt, '개발 예제를 설명합니다.');
  assert.equal(store.resolve({ ...news, path: ['AI', '변경된 이름'] }).prompt, '');
  store.save({ category: news, prompt: '  ', revision: state.revision });
  assert.equal(store.resolve(news).prompt, ''); assert.equal(store.resolve(other).prompt, '개발 예제를 설명합니다.');
  assert.deepEqual(fs.readFileSync(path.join(root, 'style.md')), original);
});

test('unset and explicit uncategorized choices resolve the same writing preferences', t => {
  const { store } = fixture(t);
  assert.deepEqual(store.resolve(), { category: none, prompt: '' });
  store.save({ category: none, prompt: '분류 없는 글의 지침', revision: store.state().revision });
  assert.deepEqual(store.resolve(null), store.resolve(none));
  assert.equal(store.resolve().prompt, '분류 없는 글의 지침');
  assert.equal(store.resolve(news).prompt, '');
});

test('prompt saves reject stale edits and invalid categories without overwriting other blogs', t => {
  const { root, store } = fixture(t), revision = store.state().revision;
  store.save({ category: news, prompt: '첫 저장', revision });
  assert.throws(() => store.save({ category: news, prompt: '이전 창', revision }), error => error.status === 409);
  assert.throws(() => store.save({ category: { ...news, blogUrl: 'https://other.tistory.com' }, prompt: '다른 블로그', revision: store.state().revision }), /다른 블로그/);
  assert.throws(() => store.save({ category: news, prompt: 'x'.repeat(10001), revision: store.state().revision }), /10,000/);
  const second = createWritingPrompts({ root, blogUrl: 'https://other.tistory.com' });
  second.save({ category: { ...news, blogUrl: 'https://other.tistory.com' }, prompt: '두 번째 블로그 지침', revision: second.state().revision });
  assert.equal(second.state().profiles.length, 1); assert.equal(store.state().profiles.length, 1);
  assert.equal(store.resolve(news).prompt, '첫 저장');
});

test('the default generation prompt is unchanged without an override and category instructions have explicit scope', () => {
  const input = { imageNames: ['test.png'], title: '제목', notes: '메모', style: '기존 기본 지침', references: [] };
  const base = buildGenerationPrompt(input);
  assert.equal(buildGenerationPrompt({ ...input, writing: { category: news, prompt: '' } }), base);
  const prompt = buildGenerationPrompt({ ...input, writing: { category: news, prompt: writingExamples[0].prompt } });
  assert.ok(prompt.startsWith(base));
  const value = JSON.parse(prompt.split('<category_writing_preferences>')[1].split('</category_writing_preferences>')[0]);
  assert.deepEqual(value.category, news); assert.equal(value.prompt, writingExamples[0].prompt);
  assert.match(prompt, /카테고리 지침을 우선/); assert.match(prompt, /사실과 추정 구분/);
  assert.ok(!prompt.includes(writingExamples[2].prompt));
  assert.deepEqual(writingExamples.map(item => item.name), ['AI 뉴스', '인사이트', '프로젝트 회고', '트러블슈팅', '개발 개념·사용법']);
});
