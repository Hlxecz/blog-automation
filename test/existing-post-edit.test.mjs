import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePublicArticle, sanitizeImportedHtml, stableRemoteUrl, remoteImageIdentity, renderRichBlock } from '../scripts/existing-posts.mjs';
import { createApp } from '../scripts/server.mjs';
import { renderArticleContent } from '../web/article-renderer.js';

const origin='https://example.tistory.com', postUrl=`${origin}/17`;
const rss=()=>`<rss><channel><title>Example</title><item><title>기존 글</title><link>${postUrl}</link><category>개발/사용법</category><pubDate>Mon, 21 Sep 2026 01:00:00 GMT</pubDate><description>공개 글</description></item></channel></rss>`;
const sitemap=`<urlset><url><loc>${postUrl}</loc></url></urlset>`;
const page=body=>`<!doctype html><html><head><meta property="og:title" content="기존 글"><meta property="article:published_time" content="2026-09-21T01:00:00+09:00"><meta property="og:image" content="https://blog.kakaocdn.net/dna/key/img.png?credential=a&amp;expires=1&amp;signature=old"></head><body><a class="category">개발/사용법</a><article id="article"><div class="tt_article_useless_p_margin contents_style"><div style="padding:12px;background-color:#eef"><p>도입 문장</p><p>기존 문장 <b>강조 표시</b>와 <a href="https://example.com/docs">참고 링크</a></p><table><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>A</td><td><b>B</b></td></tr></tbody></table><pre><code>const value = 1;</code></pre><figure class="imageblock alignCenter" data-ke-type="image"><span data-url="https://blog.kakaocdn.net/dna/key/img.png?credential=a&amp;expires=1&amp;signature=old" data-alt="결과"><img src="https://blog.kakaocdn.net/dna/key/img.png?credential=a&amp;expires=1&amp;signature=old" alt="결과"></span><figcaption>사진 설명</figcaption></figure>${body}</div></div></article><div class="tags"><a href="/tag/node">#node</a><a href="/tag/test">#test</a></div></body></html>`;

test('rich public articles keep editable text runs, formatting, tables, code, image metadata and sanitize executable HTML',()=>{
  const parsed=parsePublicArticle(page('<script>alert(1)</script><iframe src="https://evil.test"></iframe>'),postUrl,origin);
  assert.equal(parsed.draft.title,'기존 글');assert.deepEqual(parsed.draft.tags,['node','test']);assert.deepEqual(parsed.source.categoryPath,['개발','사용법']);
  const rich=parsed.draft.blocks.find(block=>block.type==='rich');assert.ok(rich);assert.ok(rich.segments.includes('기존 문장'));assert.ok(rich.segments.includes('강조 표시'));
  const rendered=renderRichBlock({...rich,segments:rich.segments.map(value=>value==='기존 문장'?'수정 $& 문장':value)});
  assert.match(rendered,/수정 \$&amp; 문장/);assert.match(rendered,/<b>강조 표시<\/b>/);assert.match(rendered,/<table>/);assert.match(rendered,/const value = 1/);assert.match(rendered,/data-ke-type="image"/);
  assert.doesNotMatch(rendered,/<script|<iframe/i);assert.match(rendered,/보안상 표시하지 않는 iframe/);
  assert.match(parsed.source.rawHtml,/<script>alert\(1\)<\/script>/);
  const blocked=parsePublicArticle(page('').replace('<div style="padding:12px;background-color:#eef">','<img src="https://evil.test/private.png"><div style="padding:12px;background-color:#eef">'),postUrl,origin);assert.ok(blocked.draft.blocks.some(block=>(block.text||block.segments?.join(' ')).includes('허용되지 않은 주소의 원문 사진')));
  assert.equal(stableRemoteUrl('https://blog.kakaocdn.net/dna/key/img.png?expires=2&signature=new&width=800',origin),'https://blog.kakaocdn.net/dna/key/img.png?width=800');
  assert.equal(remoteImageIdentity('https://img1.daumcdn.net/thumb/R1280x0/?fname=https%3A%2F%2Fblog.kakaocdn.net%2Fdna%2Fkey%2Fimg.png%3Fexpires%3D2%26signature%3Dnew',origin),'https://blog.kakaocdn.net/dna/key/img.png');
  assert.equal(stableRemoteUrl('https://user@blog.kakaocdn.net/dna/key/img.png',origin),null);
  assert.doesNotMatch(sanitizeImportedHtml('<img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>',origin),/onerror|javascript:/);
  const rotated=parsePublicArticle(page('').replaceAll('expires=1','expires=99').replaceAll('signature=old','signature=new'),postUrl,origin);
  assert.equal(rotated.source.digest,parsePublicArticle(page(''),postUrl,origin).source.digest);
  assert.notEqual(parsePublicArticle(page('').replace('사진 설명','다른 설명'),postUrl,origin).source.digest,parsed.source.digest);
  const withSidebar=page('').replace('</body>','<aside><div class="tags"><a href="/tag/sidebar">sidebar</a></div></aside></body>');assert.deepEqual(parsePublicArticle(withSidebar,postUrl,origin).draft.tags,['node','test']);
  const decorated=parsePublicArticle(page('').replace('<pre><code>','<pre class="language-js"><code>').replace('<table>','<table class="styled">'),postUrl,origin);
  assert.ok(decorated.draft.blocks.some(block=>block.type==='rich'&&block.template.includes('language-js')));assert.ok(decorated.draft.blocks.some(block=>block.type==='rich'&&block.template.includes('class="styled"')));
});

test('app-authored callout, table and TOC styles survive an import round trip',()=>{
  const rendered=renderArticleContent([{type:'heading',text:'설명'},{type:'paragraph',text:'💡 팁\n안전하게 유지합니다.'},{type:'table',headers:['항목','값'],rows:[['A','B']]}]);
  const html=`<html><head><meta property="og:title" content="왕복"></head><body><article id="article"><div class="tt_article_useless_p_margin contents_style">${rendered}</div></article></body></html>`;
  const imported=parsePublicArticle(html,postUrl,origin).source.html;
  assert.match(imported,/background:#fff9e8/);assert.match(imported,/border-radius:12px/);assert.match(imported,/border-collapse:collapse/);assert.match(imported,/box-sizing:border-box/);
});

async function appFixture(t,{adapter}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'existing-post-test-'));fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:origin,inbox:'inbox',output:'drafts',styleSamples:'style',styleProfile:'style.md'}));fs.writeFileSync(path.join(root,'style.md'),'말투');
  let html=page(''),offline=false;
  const fetchPublic=async url=>{
    if(offline)throw new Error('offline');
    const value=String(url);
    if(value===`${origin}/rss`)return new Response(rss(),{status:200});
    if(value===`${origin}/sitemap.xml`)return new Response(sitemap,{status:200});
    if(value===postUrl)return new Response(html,{status:200});
    throw new Error(`unexpected ${value}`);
  };
  const server=createApp({root,checkGenerator:async()=>true,fetchPublic,updateAdapter:adapter?.(()=>html,value=>{html=value})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,boot=await (await fetch(`${base}/api/bootstrap`)).json();
  const request=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{'X-App-Token':boot.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  await request('/api/blogs/example/sync','POST');
  return {root,request,getHtml:()=>html,setHtml:value=>{html=value},setOffline:value=>{offline=value}};
}

const waitState=async(request,id,states)=>{for(let i=0;i<80;i++){const job=(await request(`/api/jobs/${id}`)).data;if(states.includes(job.update.phase))return job;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('update did not settle');};

test('deleted imported posts can be imported again, including with an old stale import record',async t=>{
  const {root,request}=await appFixture(t);
  const route='/api/blogs/example/import',key=`${origin}|${postUrl}`,mapFile=path.join(root,'library','imported-posts.json');
  const first=await request(route,'POST',{url:postUrl});assert.equal(first.status,201);
  assert.equal(JSON.parse(fs.readFileSync(mapFile))[key],first.data.id);
  assert.equal((await request(`/api/jobs/${first.data.id}`,'DELETE')).status,200);
  assert.equal(JSON.parse(fs.readFileSync(mapFile))[key],undefined);
  const second=await request(route,'POST',{url:postUrl});assert.equal(second.status,201);assert.equal(second.data.reused,false);
  assert.equal((await request(`/api/jobs/${second.data.id}`,'DELETE')).status,200);
  fs.writeFileSync(mapFile,JSON.stringify({[key]:second.data.id}));
  const recovered=await request(route,'POST',{url:postUrl});assert.equal(recovered.status,201);assert.equal(recovered.data.reused,false);
  assert.equal(JSON.parse(fs.readFileSync(mapFile))[key],recovered.data.id);
});

test('server imports once, reopens offline without overwriting edits, rejects other targets and applies repeated revisions to the same URL',async t=>{
  let calls=0;
  const adapter=(getHtml,setHtml)=>async({draft,target,beforeSubmit,checkRemote})=>{calls++;assert.equal(target.url,postUrl);await checkRemote();beforeSubmit();const replacement=draft.blocks.flatMap(block=>block.segments||[]).find(value=>value.startsWith('수정 문장'))||'기존 문장';setHtml(getHtml().replace(/(?:기존|수정) 문장/,replacement));return {url:postUrl,postId:'17',title:draft.title,verifiedAt:new Date().toISOString(),evidence:{public:true,body:true,images:true,samePost:true},uploaded:{}};};
  const {request,setOffline}=await appFixture(t,{adapter});
  assert.equal((await request('/api/blogs/other/import','POST',{url:postUrl})).status,409);
  assert.equal((await request('/api/blogs/example/import','POST',{url:'https://other.tistory.com/17'})).status,400);
  const imported=await request('/api/blogs/example/import','POST',{url:postUrl});assert.equal(imported.status,201);const id=imported.data.id;assert.equal(imported.data.existingPost.url,postUrl);
  const draft=structuredClone(imported.data.draft),rich=draft.blocks.find(block=>block.type==='rich'),segment=rich.segments.indexOf('기존 문장');rich.segments[segment]='수정 문장 1';
  const saved=await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:'로컬 수정'});assert.equal(saved.status,200);
  setOffline(true);const reopened=await request('/api/blogs/example/import','POST',{url:postUrl});setOffline(false);assert.equal(reopened.status,200);assert.equal(reopened.data.reused,true);assert.equal(reopened.data.draft.blocks.find(block=>block.type==='rich').segments[segment],'수정 문장 1');
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:saved.data.draftDigest})).status,409);
  assert.equal((await request(`/api/jobs/${id}/update`,'POST',{draftDigest:saved.data.draftDigest})).status,202);let done=await waitState(request,id,['updated','failed']);assert.equal(done.update.phase,'updated');assert.equal(done.update.url,postUrl);assert.equal(calls,1);
  assert.equal((await request(`/api/jobs/${id}/update`,'POST',{draftDigest:saved.data.draftDigest})).status,200);assert.equal(calls,1);
  const second=structuredClone(done.draft);second.blocks.find(block=>block.type==='rich').segments[segment]='수정 문장 2';const saved2=await request(`/api/jobs/${id}/draft`,'PUT',{draft:second,review:''});
  await request(`/api/jobs/${id}/update`,'POST',{draftDigest:saved2.data.draftDigest});done=await waitState(request,id,['updated','failed']);assert.equal(done.update.phase,'updated');assert.equal(calls,2);
});

test('remote conflicts stop before the adapter and explicit reimport preserves local changes with a durable backup',async t=>{
  let calls=0;const adapter=()=>async()=>{calls++;throw new Error('must not run');};const {request,root,setHtml}=await appFixture(t,{adapter});
  const imported=(await request('/api/blogs/example/import','POST',{url:postUrl})).data,id=imported.id,draft=structuredClone(imported.draft),rich=draft.blocks.find(block=>block.type==='rich'),index=rich.segments.indexOf('기존 문장');rich.segments[index]='내 로컬 문장';const saved=(await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:''})).data;
  setHtml(page('').replace('도입 문장','원격에서 바뀐 도입'));
  await request(`/api/jobs/${id}/update`,'POST',{draftDigest:saved.draftDigest});let state=await waitState(request,id,['stale','failed']);assert.equal(state.update.phase,'stale');assert.equal(calls,0);assert.equal(state.draft.blocks.find(block=>block.type==='rich').segments[index],'내 로컬 문장');
  const refreshed=await request(`/api/jobs/${id}/reimport`,'POST');assert.equal(refreshed.status,200);assert.equal(refreshed.data.update.phase,'idle');assert.ok(refreshed.data.draft.blocks.flatMap(block=>block.segments||[]).includes('내 로컬 문장'));
  const target=JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'existing-post.json')));assert.ok(fs.existsSync(target.lastConflictBackup));
  const backup=await request(`/api/jobs/${id}/conflict-backup`);assert.equal(backup.status,200);assert.ok(backup.data.draft.blocks.flatMap(block=>block.segments||[]).includes('내 로컬 문장'));
});

test('a failure after submit is uncertain and cannot auto retry',async t=>{
  let calls=0;const adapter=()=>async({beforeSubmit})=>{calls++;beforeSubmit();throw new Error('connection lost');};const {request}=await appFixture(t,{adapter});const imported=(await request('/api/blogs/example/import','POST',{url:postUrl})).data;
  await request(`/api/jobs/${imported.id}/update`,'POST',{draftDigest:imported.draftDigest});const state=await waitState(request,imported.id,['uncertain']);assert.equal(state.update.phase,'uncertain');assert.equal(calls,1);
  assert.equal((await request(`/api/jobs/${imported.id}/update`,'POST',{draftDigest:imported.draftDigest})).status,409);assert.equal(calls,1);
});
