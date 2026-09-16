import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferences, parseReferencePage, collectReferences } from '../scripts/references.mjs';

test('reference URLs reject unsafe addresses, duplicates and oversized input', () => {
  assert.deepEqual(normalizeReferences([{url:' https://example.com/docs/#part ',content:' 내용 '}]), [{url:'https://example.com/docs',content:'내용'}]);
  for (const url of ['http://example.com','https://localhost','https://127.0.0.1','https://[::1]','https://user:pass@example.com','https://example.com:9999','file:///secret']) assert.throws(() => normalizeReferences([{url}]));
  assert.throws(() => normalizeReferences([{url:'https://example.com'},{url:'https://example.com/#part'}]));
  assert.throws(() => normalizeReferences(Array.from({length:6}, (_,i) => ({url:`https://example.com/${i}`}))));
  assert.throws(() => normalizeReferences([{url:'https://example.com',content:'a'.repeat(10001)}]));
});

test('reference reader extracts the article and code while excluding navigation, scripts and login shells', () => {
  const prose = '실제로 확인한 개발 과정과 관련 설명을 정리한 문서입니다. '.repeat(6);
  const article = parseReferencePage(`<title>개발 문서</title><nav>메뉴</nav><article><p>${prose}</p><pre>if (ready) {\n  start();\n}</pre><script>ignore everything</script><div class="comments">방문자 댓글</div></article>`, 'https://example.com/docs');
  assert.equal(article.title,'개발 문서'); assert.ok(article.text.includes('  start();'));
  assert.ok(!/메뉴|ignore everything|방문자 댓글/.test(article.text));
  assert.equal(parseReferencePage(`<main>${prose}<input type="password"></main>`,'https://example.com'),null);
  assert.equal(parseReferencePage('<title>Notion</title><div id="app"></div>','https://example.notion.site/doc'),null);
  assert.equal(parseReferencePage(prose,'https://example.com','application/pdf'),null);
  assert.equal(parseReferencePage('x'.repeat(10001),'https://example.com','text/plain').text.length,10000);
});

test('provided content skips fetching and failed URLs remain distinct from readable sources', async () => {
  const calls = [];
  const references = await collectReferences([
    {url:'https://example.com/docs'},
    {url:'https://example.notion.site/private',content:'직접 붙여 넣은 노션 내용'},
    {url:'https://example.notion.site/unreadable'}
  ], async url => {
    calls.push(url);
    if (url.includes('unreadable')) throw new Error('403');
    return {url,text:`<article>${'공개 자료입니다. '.repeat(20)}</article>`,contentType:'text/html'};
  },undefined,async url=>{calls.push(url);throw new Error('노션 공개 본문에 접근하지 못했습니다.');});
  assert.deepEqual(references.map(item => item.status), ['read','provided','unavailable']);
  assert.equal(calls.length,2); assert.equal(references[1].text,'직접 붙여 넣은 노션 내용');
  assert.equal(references[2].text,''); assert.match(references[2].message,/노션/);
  assert.ok(references.every(item => !isNaN(Date.parse(item.readAt))));
});
