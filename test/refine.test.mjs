import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRefinement, refinementSelection, refineWriting } from '../scripts/refine.mjs';
import { createApp } from '../scripts/server.mjs';

const base = { title: '기존 제목', tags: ['Java'], blocks: [
  { type: 'paragraph', text: '스택은 먼저 들어온게 나중에 나와요.' },
  { type: 'code', text: 'stack.push(1);' },
  { type: 'list', items: ['항목 하나', '항목 둘'] },
  { type: 'table', headers: ['이름', '값'], rows: [['Stack', '1']] },
  { type: 'image', file: 'photo.png', alt: '기존 사진', caption: '' }
] };
const response = input => ({ blocks: input.indices.map(index => {
  const { file, ...block } = input.draft.blocks[index];
  return { index, ...block, ...(block.text ? { text: block.text + ' 문장을 다듬었습니다.' } : {}) };
}) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-refine-test-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('hdev-refine-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

test('refinement changes only selected text and rejects missing, duplicate or malformed blocks', () => {
  const next = applyRefinement(base, [0], response({ draft: base, indices: [0] }));
  assert.equal(next.title, base.title); assert.deepEqual(next.blocks.slice(1), base.blocks.slice(1));
  assert.notEqual(next.blocks[0].text, base.blocks[0].text);
  for (const indices of [[], [1], [0, 0], [-1], [99]]) assert.throws(() => refinementSelection(base, indices));
  for (const value of [{ blocks: [] }, { blocks: [{ index: 2, type: 'paragraph', text: '다른 칸' }] },
    { blocks: [{ index: 0, type: 'code', text: '유형 변경' }] }, { blocks: [{ index: 0, type: 'paragraph', text: '' }] }]) assert.throws(() => applyRefinement(base, [0], value));
  assert.throws(() => applyRefinement(base, [2], { blocks: [{ index: 2, type: 'list', items: ['항목 삭제'] }] }));
  assert.throws(() => applyRefinement(base, [3], { blocks: [{ index: 3, type: 'table', headers: ['열 변경'], rows: [['x']] }] }));
  assert.throws(() => applyRefinement(base, [4], { blocks: [{ index: 4, type: 'image', alt: '설명', caption: '사진을 안 보고 추가한 설명' }] }));
  const image = applyRefinement(base, [4], { blocks: [{ index: 4, type: 'image', alt: '다듬은 사진 설명', caption: '' }] });
  assert.equal(image.blocks[4].file, 'photo.png');
});

test('text-only drafts refine with frozen preferences, preserve failed input, and undo after reopening', async t => {
  const root = temporary(t), calls = []; let release, failNext = false, gated = true;
  const gate = new Promise(resolve => { release = resolve; });
  fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({ blogUrl: 'https://example.tistory.com', inbox: 'inbox', output: 'drafts', styleSamples: 'style', styleProfile: 'style.md' }));
  fs.writeFileSync(path.join(root, 'style.md'), '기본 말투');
  const server = createApp({ root, checkGenerator: async () => true, refiner: async input => {
    calls.push(input); if (gated) await gate; if (failNext) throw new Error('CLI 오류'); return response(input);
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`, boot = await (await fetch(origin + '/api/bootstrap')).json();
  const request = async (route, method = 'GET', body, token = boot.token) => {
    const result = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', 'X-App-Token': token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
  };
  const id = (await request('/api/jobs', 'POST', { title: '직접 쓴 글' })).data.id, route = `/api/jobs/${id}`;
  const draft = { ...base, blocks: base.blocks.slice(0, 4), category: { blogUrl: boot.blogUrl, id: '0', path: ['카테고리 없음'] } };
  let saved = (await request(route + '/draft', 'PUT', { draft, review: '검토 메모' })).data;
  assert.deepEqual(saved.draft, draft); assert.deepEqual(saved.images, []);
  const prompts = (await request('/api/writing-prompts')).data;
  await request('/api/writing-prompts', 'PUT', { category: draft.category, prompt: '개념을 쉽게', revision: prompts.revision });
  const body = { indices: [0], instruction: '부드러운 존댓말', draftDigest: saved.draftDigest };
  assert.equal((await request(route + '/refine', 'POST', body, 'bad')).status, 403);
  assert.equal((await request(route + '/refine', 'POST', { ...body, draftDigest: 'old' })).status, 409);
  assert.equal((await request(route + '/refine', 'POST', body)).status, 202);
  assert.equal((await request(route + '/refine', 'POST', body)).status, 409);
  assert.equal((await request(route + '/draft', 'PUT', { draft, review: '' })).status, 409);
  assert.equal((await request(route, 'DELETE')).status, 409);
  fs.writeFileSync(path.join(root, 'style.md'), '나중에 바뀐 말투');
  gated = false; release();
  const settled = async () => {
    for (let i = 0; i < 100; i++) { const job = (await request(route)).data; if (job.refinement.phase !== 'refining') return job; await pause(20); }
    assert.fail('Refinement timed out');
  };
  saved = await settled(); assert.equal(saved.refinement.phase, 'done'); assert.equal(saved.refinement.canUndo, true);
  assert.equal(calls[0].style, '기본 말투'); assert.equal(calls[0].writing.prompt, '개념을 쉽게'); assert.equal(calls[0].instruction, '부드러운 존댓말');
  assert.equal(calls[0].provider, 'codex'); assert.deepEqual(saved.draft.blocks.slice(1), draft.blocks.slice(1));
  saved = (await request(route + '/draft', 'PUT', { draft: saved.draft, review: '다듬은 뒤 추가한 검토 메모' })).data;
  const undone = await request(route + '/refine/undo', 'POST', { draftDigest: saved.draftDigest });
  assert.equal(undone.status, 200); assert.deepEqual(undone.data.draft, draft); assert.equal(undone.data.review, '다듬은 뒤 추가한 검토 메모');
  assert.equal(undone.data.refinement.canUndo, false);
  failNext = true;
  await request(route + '/refine', 'POST', { ...body, draftDigest: undone.data.draftDigest });
  saved = await settled(); assert.equal(saved.refinement.phase, 'error'); assert.deepEqual(saved.draft, draft);
  failNext = false;
  await request(route + '/refine', 'POST', { ...body, draftDigest: saved.draftDigest });
  saved = await settled();
  const edited = { ...saved.draft, title: '다듬은 뒤 직접 수정' };
  const editedJob = (await request(route + '/draft', 'PUT', { draft: edited, review: '검토 메모' })).data;
  assert.equal(editedJob.refinement.canUndo, false);
  assert.equal((await request(route + '/refine/undo', 'POST', { draftDigest: saved.draftDigest })).status, 409);
});

test('both CLIs receive text-only refinement input and the selected writing preferences', async t => {
  const root = temporary(t), fake = path.join(root, 'cli.mjs');
  const keys = ['TISTORY_CODEX_BIN', 'TISTORY_CLAUDE_BIN'], previous = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  fs.writeFileSync(fake, `import fs from 'node:fs';import assert from 'node:assert/strict';
const args=process.argv.slice(2);let input='';for await(const chunk of process.stdin)input+=chunk;
const claude=args.includes('--print');const prompt=claude?JSON.parse(input).message.content[0].text:input;
assert.ok(prompt.includes('기본 문체'));assert.ok(prompt.includes('카테고리 문체'));assert.ok(prompt.includes('쉽게 설명'));
assert.ok(prompt.includes('<selected_indices>[0]</selected_indices>'));assert.ok(!args.includes('--image'));
const result={blocks:[{index:0,type:'paragraph',text:'문장을 자연스럽게 다듬었어요.'}]};
if(claude){assert.equal(JSON.parse(input).message.content.length,1);console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:result}));}
else fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(result));`);
  keys.forEach(key => { process.env[key] = fake; });
  for (const provider of ['codex', 'claude']) {
    const result = await refineWriting({ draft: base, indices: [0], style: '기본 문체', writing: { prompt: '카테고리 문체' }, instruction: '쉽게 설명', provider });
    assert.equal(applyRefinement(base, [0], result).blocks[0].text, '문장을 자연스럽게 다듬었어요.');
  }
});
