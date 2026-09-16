import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newJob, readyJob, listJobs, prepareJob, renderDraft } from '../scripts/blog.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tistory-draft-test-'));
  fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({
    blogUrl: 'https://example.tistory.com', inbox: 'inbox', output: 'drafts',
    styleSamples: 'style/samples', styleProfile: 'style/profile.md'
  }));
  t.after(() => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('tistory-draft-test-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const { job, images } = newJob(root, '개발-기록');
  fs.writeFileSync(path.join(images, '02 결과.png'), PNG);
  fs.writeFileSync(path.join(images, '01 원인.png'), PNG);
  return { root, job, images, id: '개발-기록' };
}

function draft(directory, blocks = [{ type: 'image', file: '02 결과.png', alt: '결과 화면' }]) {
  fs.writeFileSync(path.join(directory, 'draft.json'), JSON.stringify({ title: '[JAVA] 결과 정리', tags: ['Java'], blocks }));
}

test('ready snapshots ordered files; preparation is repeatable and preserves user edits', t => {
  const { root, id } = fixture(t);
  assert.equal(listJobs(root)[0].status, 'collecting');
  assert.throws(() => prepareJob(root, id), /먼저 ready/);
  readyJob(root, id);
  assert.equal(listJobs(root)[0].status, 'ready');
  const first = prepareJob(root, id);
  const manifest = JSON.parse(fs.readFileSync(path.join(first.directory, 'manifest.json')));
  assert.deepEqual(manifest.images.map(i => i.name), ['01 원인.png', '02 결과.png']);
  fs.writeFileSync(path.join(first.directory, 'review.md'), '사용자가 적어둔 내용');
  const second = prepareJob(root, id);
  assert.equal(second.directory, first.directory);
  assert.equal(second.reused, true);
  assert.equal(fs.readFileSync(path.join(first.directory, 'review.md'), 'utf8'), '사용자가 적어둔 내용');
  assert.equal(listJobs(root)[0].status, 'prepared');
});

test('edits after ready require a new ready marker and keep the old snapshot', t => {
  const { root, id, job } = fixture(t);
  readyJob(root, id);
  const old = prepareJob(root, id);
  fs.writeFileSync(path.join(job, 'notes.md'), '실제 결과가 달랐음');
  assert.equal(listJobs(root)[0].status, 'changed');
  assert.throws(() => prepareJob(root, id), /바뀌었습니다/);
  readyJob(root, id);
  const current = prepareJob(root, id);
  assert.notEqual(current.directory, old.directory);
  assert.notEqual(fs.readFileSync(path.join(old.directory, 'notes.md'), 'utf8'), '실제 결과가 달랐음');
});

test('added and modified photos invalidate readiness', t => {
  const { root, id, images } = fixture(t);
  readyJob(root, id);
  fs.writeFileSync(path.join(images, '03 추가.png'), PNG);
  assert.throws(() => prepareJob(root, id), /바뀌었습니다/);
  readyJob(root, id);
  fs.writeFileSync(path.join(images, '03 추가.png'), Buffer.concat([PNG, Buffer.from('changed')]));
  assert.throws(() => prepareJob(root, id), /바뀌었습니다/);
});

test('unsafe IDs and overwriting an existing job are rejected', t => {
  const { root, id } = fixture(t);
  for (const unsafe of ['..', '../outside', 'CON', 'NUL', 'a/b', 'x:y']) {
    assert.throws(() => newJob(root, unsafe));
  }
  assert.throws(() => newJob(root, id), /EEXIST/);
});

test('empty jobs cannot be made ready', t => {
  const { root } = fixture(t);
  newJob(root, 'empty');
  assert.throws(() => readyJob(root, 'empty'), /캡처를 넣으세요/);
});

test('HTML preview escapes text, preserves code, and references only snapshot images', t => {
  const { root, id } = fixture(t);
  readyJob(root, id);
  const { directory } = prepareJob(root, id);
  draft(directory, [
    { type: 'paragraph', text: '<script>alert(1)</script>\n다음 줄' },
    { type: 'code', text: 'List<String> a;\n// 코드 유지' },
    { type: 'table', headers: ['전', '후'], rows: [['<내용>', '수정']] },
    { type: 'image', file: '02 결과.png', alt: '결과 "화면"' }
  ]);
  const { preview } = renderDraft(directory);
  const html = fs.readFileSync(preview, 'utf8');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('List&lt;String&gt; a;\n// 코드 유지'));
  assert.ok(html.includes('<br>다음 줄'));
  assert.ok(html.includes('images/02%20%EA%B2%B0%EA%B3%BC.png'));
  assert.match(html, /<td\b[^>]*>&lt;내용&gt;<\/td>/);
  assert.equal(listJobs(root)[0].status, 'local_draft');
});

test('unknown images and changed snapshots are rejected', t => {
  const { root, id } = fixture(t);
  readyJob(root, id);
  const { directory } = prepareJob(root, id);
  draft(directory, [{ type: 'image', file: '../../secret.png', alt: 'bad' }]);
  assert.throws(() => renderDraft(directory), /입력에 없는/);
  draft(directory);
  fs.writeFileSync(path.join(directory, 'images', '02 결과.png'), 'changed');
  assert.throws(() => renderDraft(directory), /보관 이미지가 변경/);
  assert.throws(() => prepareJob(root, id), /보관 이미지가 변경/);
});

test('a saved receipt applies only to the exact rendered draft', t => {
  const { root, id } = fixture(t);
  readyJob(root, id);
  const { directory } = prepareJob(root, id);
  draft(directory);
  renderDraft(directory);
  const rendered = JSON.parse(fs.readFileSync(path.join(directory, 'render.json')));
  fs.writeFileSync(path.join(directory, 'tistory-receipt.json'), JSON.stringify({
    inputDigest: rendered.inputDigest, draftDigest: rendered.draftDigest,
    title: '검증용 기록', editorUrl: 'https://example.tistory.com/manage', verifiedAt: new Date().toISOString()
  }));
  assert.equal(listJobs(root)[0].status, 'saved_recorded');
  draft(directory, [{ type: 'paragraph', text: '수정된 새 내용' }]);
  assert.equal(listJobs(root)[0].status, 'remote_review_needed');
  renderDraft(directory);
  assert.equal(listJobs(root)[0].status, 'remote_review_needed');
});

test('malformed drafts fail before creating a preview', t => {
  const { root, id } = fixture(t);
  readyJob(root, id);
  const { directory } = prepareJob(root, id);
  draft(directory, [{ type: 'table', headers: ['A', 'B'], rows: [['only A']] }]);
  assert.throws(() => renderDraft(directory), /열 수/);
  assert.ok(!fs.existsSync(path.join(directory, 'preview.html')));
});
