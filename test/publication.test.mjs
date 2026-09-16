import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
import { newJob, readyJob, prepareJob } from '../scripts/blog.mjs';
import { createPublications, draftDigest, publicationHtml, verifyPublishedHtml } from '../scripts/publication.mjs';

const blogUrl = 'https://example.tistory.com';
const receipt = draft => ({ url: `${blogUrl}/entry/test`, title: draft.title, verifiedAt: new Date().toISOString(), evidence: { public: true, body: true, images: true } });
const remoteImage = '<figure class="imageblock" data-ke-mobilestyle="widthOrigin"><span data-url="https://blog.kakaocdn.net/dn/one/img.png"><img src="https://blog.kakaocdn.net/dn/one/img.png" data-ke-src="https://blog.kakaocdn.net/dn/one/img.png"></span></figure>';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-publish-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('hdev-publish-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'tistory.config.json'), JSON.stringify({ blogUrl, inbox: 'inbox', output: 'drafts', styleSamples: 'style', styleProfile: 'style.md' }));
  const { job, images } = newJob(root, 'test');
  fs.copyFileSync(new URL('./fixtures/redis-test.png', import.meta.url), path.join(images, 'one.png'));
  readyJob(root, 'test');
  const { directory } = prepareJob(root, 'test');
  const draft = { title: '검토한 <제목>', tags: ['Redis'], blocks: [
    { type: 'paragraph', text: '연결을 확인했습니다.' },
    { type: 'image', file: 'one.png', alt: '사용자가 쓴 설명', caption: '확인 <화면>' },
    { type: 'code', text: 'const a = 1;\nconsole.log(a);' }
  ] };
  fs.writeFileSync(path.join(directory, 'draft.json'), JSON.stringify(draft));
  return { job, directory, draft, manifest: JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'))) };
}
async function settle(publications, job) {
  for (let i = 0; i < 100; i++) {
    if (!publications.isRunning(job)) return publications.state(job);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('publication did not settle');
}

test('publish rejects a stale draft or changed photo before touching Tistory', t => {
  const { job, directory } = fixture(t);
  const publications = createPublications({ blogUrl, adapter: () => assert.fail('must not start') });
  assert.throws(() => publications.start({ job, directory, expectedDigest: 'old' }), /초안이 변경/);
  fs.appendFileSync(path.join(directory, 'images', 'one.png'), 'changed');
  assert.throws(() => publications.start({ job, directory, expectedDigest: draftDigest(directory) }), /사진이 변경/);
  assert.equal(publications.state(job).phase, 'idle');
});

test('snapshot, durable submit marker, and double clicks preserve one reviewed publication', async t => {
  const { job, directory, draft } = fixture(t);
  let release, attempts = 0, sent;
  const gate = new Promise(resolve => { release = resolve; });
  const publications = createPublications({ blogUrl, adapter: async request => {
    attempts++; sent = request;
    await gate;
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(request.directory, 'draft.json'))), draft);
    request.beforeSubmit();
    assert.ok(JSON.parse(fs.readFileSync(path.join(job, 'publication.json'))).submittedAt);
    return receipt(request.draft);
  } });
  const first = publications.start({ job, directory, expectedDigest: draftDigest(directory) });
  const again = publications.start({ job, directory, expectedDigest: 'a different digest' });
  assert.equal(first.attemptId, again.attemptId);
  fs.writeFileSync(path.join(directory, 'draft.json'), JSON.stringify({ ...draft, title: '나중에 바뀐 제목' }));
  release();
  const result = await settle(publications, job);
  assert.equal(attempts, 1); assert.equal(sent.draft.title, draft.title);
  assert.equal(result.phase, 'published'); assert.equal(result.title, draft.title);
  const restarted = createPublications({ blogUrl, adapter: () => assert.fail('already published') });
  assert.equal(restarted.start({ job, directory, expectedDigest: draftDigest(directory) }).url, result.url);
});

test('failures before submission can retry; an uncertain submission cannot retry', async t => {
  const { job, directory } = fixture(t);
  let attempts = 0;
  const publications = createPublications({ blogUrl, adapter: async request => {
    if (++attempts === 1) throw new Error('사진 업로드 실패');
    request.beforeSubmit(); throw new Error('연결 끊김');
  } });
  publications.start({ job, directory, expectedDigest: draftDigest(directory) });
  assert.equal((await settle(publications, job)).phase, 'failed');
  publications.start({ job, directory, expectedDigest: draftDigest(directory) });
  assert.equal((await settle(publications, job)).phase, 'uncertain');
  assert.throws(() => publications.start({ job, directory, expectedDigest: draftDigest(directory) }), /불확실/);
  assert.equal(attempts, 2);
});

test('restart classifies interrupted attempts according to the durable submit marker', t => {
  const { job } = fixture(t);
  const publications = createPublications({ blogUrl, adapter: null });
  fs.writeFileSync(path.join(job, 'publication.json'), JSON.stringify({ phase: 'uploading' }));
  assert.equal(publications.state(job).phase, 'failed');
  fs.writeFileSync(path.join(job, 'publication.json'), JSON.stringify({ phase: 'verifying', submittedAt: '2026-09-15' }));
  assert.equal(publications.state(job).phase, 'uncertain');
});

test('a response without matching public content never records success', async t => {
  const { job, directory } = fixture(t);
  const publications = createPublications({ blogUrl, adapter: async request => {
    request.beforeSubmit(); return { ...receipt(request.draft), evidence: { public: false, body: true, images: true } };
  } });
  publications.start({ job, directory, expectedDigest: draftDigest(directory) });
  assert.equal((await settle(publications, job)).phase, 'uncertain');
});

test('uploaded figures preserve image metadata, order, captions and escaped text', t => {
  const { draft, manifest } = fixture(t);
  const html = publicationHtml(draft, manifest, { 'one.png': remoteImage });
  const $ = load(html, null, false);
  assert.deepEqual($.root().children().toArray().map(el => el.name), ['p', 'figure', 'pre']);
  assert.equal($('figure').attr('data-ke-mobilestyle'), 'widthOrigin');
  assert.equal($('img').attr('alt'), '사용자가 쓴 설명');
  assert.equal($('figcaption').text(), '확인 <화면>');
  assert.ok(!html.includes('src="images/'));
  assert.throws(() => publicationHtml(draft, manifest, {}), /업로드하지/);
  assert.throws(() => publicationHtml(draft, manifest, { 'one.png': '<img src="file:///secret.png">' }), /업로드가 완료/);
});

test('public verification rejects login pages, wrong titles, missing body or images', t => {
  const { draft, manifest } = fixture(t);
  const uploaded = { 'one.png': remoteImage };
  const html = `<html><head><meta property="og:title" content="검토한 &lt;제목&gt;"></head><body>${publicationHtml(draft, manifest, uploaded)}</body></html>`;
  assert.equal(verifyPublishedHtml(html, draft, uploaded), true);
  assert.equal(verifyPublishedHtml('<h1>로그인</h1>', draft, uploaded), false);
  assert.equal(verifyPublishedHtml(html.replace('연결을 확인했습니다.', ''), draft, uploaded), false);
  assert.equal(verifyPublishedHtml(html.replaceAll('/dn/one/', '/dn/wrong/'), draft, uploaded), false);
  assert.equal(verifyPublishedHtml(html.replace('검토한 &lt;제목&gt;', '다른 제목'), draft, uploaded), false);
});

test('selected cover must match the public representative image, including resized thumbnail URLs', t => {
  const {draft,manifest} = fixture(t); draft.cover = 'one.png';
  const uploaded = {'one.png':remoteImage};
  const page = cover => `<html><head><meta property="og:title" content="검토한 &lt;제목&gt;"><meta property="og:image" content="${cover}"></head><body>${publicationHtml(draft,manifest,uploaded)}</body></html>`;
  const source = 'https://blog.kakaocdn.net/dn/one/img.png';
  assert.equal(verifyPublishedHtml(page(source),draft,uploaded),true);
  assert.equal(verifyPublishedHtml(page(`https://img1.daumcdn.net/thumb/R1280x0/?fname=${encodeURIComponent(source)}`),draft,uploaded),true);
  assert.equal(verifyPublishedHtml(page(source.replace('/one/','/other/')),draft,uploaded),false);
  assert.equal(verifyPublishedHtml(page(''),draft,uploaded),false);
});

test('publication does not claim success when a selected cover was not verified', async t => {
  const {job,directory,draft} = fixture(t);
  draft.cover = 'one.png'; fs.writeFileSync(path.join(directory,'draft.json'),JSON.stringify(draft));
  const publications = createPublications({blogUrl,adapter:async request=>{request.beforeSubmit();return receipt(request.draft);}});
  publications.start({job,directory,expectedDigest:draftDigest(directory)});
  assert.equal((await settle(publications,job)).phase,'uncertain');
});

test('the configured skin TOC mode reaches the publisher without removing article headings', async t => {
  const {job,directory,draft}=fixture(t);
  draft.blocks.unshift({type:'heading',text:'본문 소제목'});
  fs.writeFileSync(path.join(directory,'draft.json'),JSON.stringify(draft));
  let received;
  const publications=createPublications({blogUrl,tocMode:'skin',adapter:async request=>{
    received=request;request.beforeSubmit();return receipt(request.draft);
  }});
  publications.start({job,directory,expectedDigest:draftDigest(directory)});
  assert.equal((await settle(publications,job)).phase,'published');
  assert.equal(received.includeToc,false);
  assert.deepEqual(received.draft.blocks[0],draft.blocks[0]);
});
