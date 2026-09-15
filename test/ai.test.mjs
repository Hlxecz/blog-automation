import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkAI, runAIJson } from '../scripts/ai.mjs';
import { generate, analyzeWritingStyle } from '../scripts/generate.mjs';
import { createApp } from '../scripts/server.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-ai-test-'));
  const keys = ['TISTORY_CODEX_BIN', 'TISTORY_CLAUDE_BIN', 'HDEV_FAKE_MODE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('hdev-ai-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  const fake = path.join(root, 'fake-cli.mjs');
  fs.writeFileSync(fake, `import fs from 'node:fs';import assert from 'node:assert/strict';
const args=process.argv.slice(2), mode=process.env.HDEV_FAKE_MODE;
if(args.includes('status')){console.log(args[0]==='auth'?JSON.stringify({loggedIn:mode!=='logged_out',email:'private@example.invalid'}):mode==='logged_out'?'Not logged in':'Logged in using ChatGPT');process.exit(mode==='logged_out'?1:0);}
let input='';for await(const chunk of process.stdin)input+=chunk;
const claude=args.includes('--print'); let prompt=input;
if(claude){assert.ok(args.includes('--safe-mode'));assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--permission-mode')+1],'dontAsk');assert.ok(args.includes('--no-session-persistence'));
const message=JSON.parse(input);assert.equal(message.type,'user');assert.equal(message.message.role,'user');prompt=message.message.content[0].text;
if(!prompt.includes('<samples>')){const image=message.message.content[1];assert.equal(image.source.media_type,'image/png');assert.ok(Buffer.from(image.source.data,'base64').subarray(1,4).equals(Buffer.from('PNG')));}}
else{assert.equal(args[0],'exec');assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.ok(args.includes('--ignore-user-config'));if(!prompt.includes('<samples>'))assert.ok(fs.existsSync(args[args.indexOf('--image')+1]));}
if(mode==='failure'){console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,errors:['quota exceeded']}));process.exit(1);}
const result=prompt.includes('<samples>')?{profile:'짧고 정확한 존댓말로 작성해요.'}:{draft:{title:'이미지로 확인한 기록',tags:[],blocks:[]},analysis:'한글 분석 '.repeat(10000),review:'',sensitiveImages:[]};
if(claude){const output=JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:result});for(let i=0;i<output.length;i+=3000)process.stdout.write(output.slice(i,i+3000));}
else fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(result));`);
  process.env.TISTORY_CODEX_BIN = fake; process.env.TISTORY_CLAUDE_BIN = fake;
  fs.mkdirSync(path.join(root, 'images')); fs.copyFileSync(new URL('./fixtures/redis-test.png', import.meta.url), path.join(root, 'images', 'test.png'));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ images: [{ name: 'test.png' }] }));
  return root;
}

test('both CLI protocols receive actual image bytes/paths and return large Korean structured output and style results', async t => {
  const root = fixture(t);
  for (const provider of ['codex', 'claude']) {
    const auth = await checkAI(provider); assert.deepEqual(auth, { provider, status: 'connected', connected: true });
    assert.equal(JSON.stringify(auth).includes('private@'), false);
    const result = await generate({ root, directory: root, title: '가상 기록', notes: '자료', style: '짧게 작성', provider });
    assert.equal(result.draft.title, '이미지로 확인한 기록'); assert.equal(result.analysis, '한글 분석 '.repeat(10000));
    assert.deepEqual(await analyzeWritingStyle({ provider, samples: [{ text: '본문' }] }), { profile: '짧고 정확한 존댓말로 작성해요.' });
  }
});

test('missing CLI, logged-out CLI and failed generation are distinct and never fall back to another provider', async t => {
  const root = fixture(t);
  process.env.HDEV_FAKE_MODE = 'logged_out';
  for (const provider of ['codex', 'claude']) assert.equal((await checkAI(provider)).status, 'login_required');
  process.env.TISTORY_CODEX_BIN = path.join(root, 'not-installed.exe');
  assert.equal((await checkAI('codex')).status, 'missing');
  process.env.HDEV_FAKE_MODE = 'failure';
  await assert.rejects(generate({ root, directory: root, provider: 'claude' }), /Claude Code 계정의 사용량/);
  fs.writeFileSync(path.join(root, 'images/test.png'), Buffer.alloc(6 * 1024 * 1024));
  await assert.rejects(generate({ root, directory: root, provider: 'claude' }), /5MB 이하/);
  fs.writeFileSync(path.join(root, 'images/test.png'), Buffer.alloc(4 * 1024 * 1024));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ images: [{ name: 'test.png' }, { name: 'test.png' }] }));
  await assert.rejects(generate({ root, directory: root, provider: 'claude' }), /입력 용량/);
  assert.throws(() => runAIJson({ provider: 'other' }), /지원하지 않는 AI/);
});

test('provider selection persists, reaches both AI routes, and cannot change during a running job', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({ blogUrl: 'https://example.tistory.com', inbox: 'inbox', output: 'drafts', styleSamples: 'samples', styleProfile: 'profile.md' }));
  fs.writeFileSync(path.join(root, 'profile.md'), '테스트 문체');
  let finish, usedDraft, usedStyle;
  const gate = new Promise(resolve => { finish = resolve; });
  const makeServer = () => createApp({ root, checkGenerator: async provider => ({ provider, connected: true, status: 'connected' }),
    generator: async ({ provider }) => { usedDraft = provider; await gate; return { draft: { title: 'test', tags: [], blocks: [{ type: 'paragraph', text: '본문' }] }, analysis: '', review: '', sensitiveImages: [] }; },
    fetchStyle: async url => ({ url, text: '<div class="contents_style"><p>' + '검증된 문장을 정확하게 써요. '.repeat(40) + '</p></div>' }),
    styleAnalyzer: async ({ provider }) => { usedStyle = provider; return { profile: '확인한 내용만 작성해요.' }; }
  });
  let server = makeServer();
  t.after(async () => { finish(); await new Promise(resolve => server.close(resolve)); });
  async function listen() { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); }
  await listen();
  let base = `http://127.0.0.1:${server.address().port}`, bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  const call = async (route, method = 'GET', body, token = bootstrap.token) => {
    const res = await fetch(base + route, { method, headers: { 'x-app-token': token, ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}) }, body: body ? Buffer.isBuffer(body) ? body : JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  assert.equal((await call('/api/ai', 'PUT', { provider: 'claude' }, 'wrong')).status, 403);
  assert.equal((await call('/api/ai', 'PUT', { provider: 'unknown' })).status, 400);
  assert.equal((await call('/api/ai', 'PUT', { provider: 'claude' })).data.provider, 'claude');
  const created = await call('/api/jobs', 'POST', { title: '테스트' }); assert.equal(created.status, 201); const job = created.data;
  await call('/api/jobs/' + job.id + '/images?name=test.png', 'POST', fs.readFileSync(path.join(root, 'images/test.png')));
  assert.equal((await call('/api/jobs/' + job.id + '/generate', 'POST')).status, 202);
  assert.equal((await call('/api/ai', 'PUT', { provider: 'codex' })).status, 409);
  assert.equal(usedDraft, 'claude'); finish();
  assert.equal((await call('/api/style/analyze', 'POST', { urls: ['https://example.tistory.com/1'] })).status, 202);
  for (let i = 0; i < 100 && server.hasActiveGeneration(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(usedStyle, 'claude'); assert.equal(server.hasActiveGeneration(), false);
  await new Promise(resolve => server.close(resolve)); server = makeServer(); await listen();
  base = `http://127.0.0.1:${server.address().port}`;
  bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  assert.equal(bootstrap.ai.provider, 'claude'); assert.equal(bootstrap.connected, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'ai.settings.json'))), { provider: 'claude' });
});
