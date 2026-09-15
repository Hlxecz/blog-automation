import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../scripts/server.mjs';
import { styleURLs, publicIP, parseStyleArticle, collectStyleSamples, createStyles } from '../scripts/style.mjs';

const text = '연결 오류를 확인했어요. 설정을 바꾸기 전에 로그부터 읽어 봅니다. '.repeat(20);
const article = `<html><head><meta property="og:title" content="개발 기록"></head><body><nav>메뉴는 제외</nav><div class="contents_style"><p>${text}</p><blockquote>다른 작성자 인용 제외</blockquote><pre>코드 제외</pre><div class="comments">댓글 제외</div></div></body></html>`;
const fakePage = async url => ({ url, text: url.endsWith('/rss') ? `<rss><channel>${[1,2,3].map(n=>`<item><link>${url.slice(0,-4)}/${n}</link></item>`).join('')}</channel></rss>` : /\/\d$/.test(url) ? article : '<html>블로그 목록</html>' });
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdev-style-test-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('hdev-style-test-')); fs.rmSync(root,{recursive:true,force:true}); });
  return root;
}
async function settle(styles) {
  for (let i=0;i<100;i++) { if (styles.state().analysis.phase !== 'running') return styles.state(); await new Promise(resolve=>setTimeout(resolve,10)); }
  throw new Error('Style analysis did not finish');
}

test('style inputs enforce three public HTTPS blogs, deduplicate and reject local addresses', () => {
  assert.equal(styleURLs([' https://one.tistory.com/ ', '', 'https://blog.naver.com/two']).length,2);
  for (const values of [['https://one.com','https://two.com','https://three.com','https://four.com'],['https://one.com','https://one.com/'],['http://one.com'],['https://127.0.0.1'],['https://[::1]'],['https://localhost'],['https://app.internal'],['https://user:pass@one.com']]) assert.throws(()=>styleURLs(values));
  for (const address of ['127.0.0.1','10.0.0.2','169.254.169.254','192.168.1.1','172.20.1.2','::1','::ffff:127.0.0.1','fd00::1','2001:db8::1']) assert.equal(publicIP(address),false,address);
  assert.equal(publicIP('8.8.8.8'),true);
});

test('style collection reads real bodies across three blogs and excludes chrome, code and quotes', async () => {
  const {samples,warnings}=await collectStyleSamples(['https://one.tistory.com','https://two.tistory.com','https://three.tistory.com'],fakePage);
  assert.equal(samples.length,9); assert.equal(warnings.length,0);
  assert.equal(new Set(samples.map(s=>s.blog)).size,3);
  assert.ok(samples.every(s=>s.text.includes('연결 오류')));
  assert.ok(samples.every(s=>!s.text.includes('제외')));
  assert.equal(parseStyleArticle(`<nav>${text}</nav>`, 'https://one.com'),null);
  assert.equal(parseStyleArticle('<article>너무 짧은 글</article>', 'https://one.com'),null);
  await assert.rejects(collectStyleSamples(['https://one.com'],async()=>({text:'본문 없음',url:'https://one.com'})), /본문을 읽지 못/);
});

test('analysis never overwrites an edited profile, preserves evidence and can recover after restart', async t => {
  const root=temporary(t),profileFile=path.join(root,'profile.md');fs.writeFileSync(profileFile,'직접 수정한 말투');
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const styles=createStyles({root,profileFile,fetchPage:fakePage,analyzer:async({samples})=>{assert.equal(samples.length,3);await gate;return {profile:'분석한 편한 존댓말'};}});
  const first=styles.state();
  styles.start(['https://one.tistory.com']);
  assert.throws(()=>styles.start(['https://two.tistory.com']), /분석 중/);
  styles.save({revision:first.revision,profile:'분석 중에도 보존할 직접 편집',urls:[]});
  assert.throws(()=>styles.save({revision:first.revision,profile:'오래된 창',urls:[]}),/다른 창/);
  finish();const done=await settle(styles);
  assert.equal(done.profile,'분석 중에도 보존할 직접 편집'); assert.equal(done.analysis.phase,'done');
  const restarted=createStyles({root,profileFile});assert.equal(restarted.state().analysis.sources.length,3);
  const saved=restarted.save({revision:done.revision,profile:done.analysis.profile,urls:done.analysis.urls,analysisId:done.analysis.id});
  assert.equal(saved.profile,'분석한 편한 존댓말');assert.equal(saved.sources.length,3);
  assert.ok(fs.readdirSync(path.join(root,'style/history')).length>=2);
  assert.ok(!fs.readFileSync(path.join(root,'style/settings.json'),'utf8').includes(text));
});

test('failed and interrupted analyses keep the saved profile and permit a fresh retry', async t=>{
  const root=temporary(t),profileFile=path.join(root,'profile.md');fs.writeFileSync(profileFile,'기존 말투');
  const styles=createStyles({root,profileFile,fetchPage:fakePage,analyzer:async()=>{throw new Error('로그인 필요');}});
  styles.start(['https://one.com']);const failed=await settle(styles);
  assert.equal(failed.profile,'기존 말투');assert.equal(failed.analysis.phase,'error');
  fs.writeFileSync(path.join(root,'style/analysis.json'),JSON.stringify({phase:'running',urls:['https://one.com']}));
  const restarted=createStyles({root,profileFile,fetchPage:fakePage,analyzer:async()=>({profile:'재시도 결과'})});
  assert.equal(restarted.state().analysis.phase,'error');restarted.start(['https://one.com']);
  assert.equal((await settle(restarted)).analysis.phase,'done');
});

test('style API protects mutations and saved instructions are used in the next draft generation', async t=>{
  const root=temporary(t);
  fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleProfile:'profile.md',styleSamples:'samples'}));
  fs.writeFileSync(path.join(root,'profile.md'),'기존 말투');
  let received;
  const server=createApp({root,checkGenerator:async()=>true,fetchStyle:fakePage,styleAnalyzer:async()=>({profile:'분석된 말투'}),generator:async({style})=>{received=style;return {draft:{title:'테스트',tags:[],blocks:[{type:'paragraph',text:'본문'}]},analysis:'분석',review:'',sensitiveImages:[]};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`,{token}=await (await fetch(origin+'/api/bootstrap')).json();
  async function request(route,method='GET',body,headers={}) {
    const raw=Buffer.isBuffer(body);
    return fetch(origin+route,{method,headers:{'X-App-Token':token,'Content-Type':raw?'image/png':'application/json',...headers},body:body?raw?body:JSON.stringify(body):undefined});
  }
  const before=await (await request('/api/style')).json();
  const value={revision:before.revision,profile:'짧은 문장과 편한 존댓말로 작성해요.',urls:['https://one.com']};
  assert.equal((await request('/api/style','PUT',value,{'X-App-Token':'wrong'})).status,403);
  assert.equal((await request('/api/style','PUT',value,{Origin:'https://example.com'})).status,403);
  assert.equal((await request('/api/style','PUT',value)).status,200);
  assert.equal((await request('/api/style','PUT',value)).status,409);
  assert.equal((await request('/api/style/analyze','POST',{urls:Array(4).fill('https://one.com')})).status,400);
  const job=await (await request('/api/jobs','POST',{title:'새 글'})).json();
  const png=fs.readFileSync(new URL('./fixtures/redis-test.png',import.meta.url));
  await request(`/api/jobs/${job.id}/images`,'POST',png);
  assert.equal((await request(`/api/jobs/${job.id}/generate`,'POST')).status,202);
  for(let i=0;i<100;i++){const result=await (await request(`/api/jobs/${job.id}`)).json();if(result.generation.phase==='done')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(received,value.profile);
  assert.equal((await (await request('/api/bootstrap')).json()).style,value.profile);
});
