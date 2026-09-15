import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../scripts/server.mjs';
import { buildPreview } from '../scripts/blog.mjs';
import { articleBlocks } from '../web/draft-model.js';

const PNG = fs.readFileSync(new URL('./fixtures/redis-test.png', import.meta.url));
const draftFor = image => ({ title:'검증용 개발 기록', tags:['테스트'], blocks:[{ type:'paragraph', text:'관찰한 내용을 정리합니다.' },{ type:'image',file:image,alt:'가상 테스트 캡처',caption:'앱 검증 자료' }] });
async function fixture(t, generator = async()=>{throw new Error('테스트 생성 실패');}, publishAdapter = null) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tistory-app-test-'));
  fs.writeFileSync(path.join(root,'tistory.config.json'),JSON.stringify({blogUrl:'https://example.tistory.com',inbox:'inbox',output:'drafts',styleSamples:'style',styleProfile:'style.md'}));
  fs.writeFileSync(path.join(root,'style.md'),'테스트 문체');
  const server=createApp({root,generator,checkGenerator:async()=>true,publishAdapter});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const bootstrap=await (await fetch(`${url}/api/bootstrap`)).json();
  async function request(route,method='GET',body,headers={}) {
    const isBuffer=Buffer.isBuffer(body);
    const response=await fetch(url+route,{method,headers:{'X-App-Token':bootstrap.token,...(body&&!isBuffer?{'Content-Type':'application/json'}:{}),...headers},body:body?isBuffer?body:JSON.stringify(body):undefined});
    return { status:response.status, data:await response.json() };
  }
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('tistory-app-test-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const created=await request('/api/jobs','POST',{title:'테스트'});const id=created.data.id;
  const uploaded=await request(`/api/jobs/${id}/images?name=test.png`,'POST',PNG);
  assert.equal(uploaded.status,201);
  return {root,request,id,job:uploaded.data,bootstrap};
}
async function settled(request,id){
  for(let i=0;i<40;i++){const result=await request(`/api/jobs/${id}`);if(result.data.generation.phase!=='generating')return result.data;await new Promise(r=>setTimeout(r,10));}
  throw new Error('generation did not settle');
}

test('photos, notes and edited drafts persist across requests; snapshot order matches UI',async t=>{
  const {request,id,root,job}=await fixture(t);
  const second=await request(`/api/jobs/${id}/images?name=other.png`,'POST',PNG);
  const names=second.data.images.map(i=>i.name).reverse();
  assert.equal((await request(`/api/jobs/${id}`,'PUT',{title:'새 제목',notes:'사용자 메모',order:names})).status,200);
  const saved=await request(`/api/jobs/${id}/draft`,'PUT',{draft:draftFor(job.images[0].name),review:'검토 질문'});
  assert.equal(saved.status,200);assert.equal(saved.data.notes,'사용자 메모');
  const reloaded=(await request(`/api/jobs/${id}`)).data;
  assert.equal(reloaded.draft.title,'검증용 개발 기록');assert.equal(reloaded.review,'검토 질문');
  const meta=JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(meta.directory,'manifest.json'))).images.map(i=>i.name),names);
  await request(`/api/jobs/${id}`,'PUT',{title:'새 제목',notes:'사용자 메모',order:[names[0]]});
  assert.equal((await request(`/api/jobs/${id}`)).data.images.length,1);
  assert.ok(fs.existsSync(path.join(root,'inbox',id,'images',names[1])));
});

test('invalid files and cross-origin mutations are rejected',async t=>{
  const {request,id,job}=await fixture(t);
  assert.equal((await request(`/api/jobs/${id}/images`,'POST',Buffer.from('<script>test</script>'))).status,415);
  assert.equal((await request(`/api/jobs/${id}/images`,'POST',PNG,{'X-App-Token':'wrong'})).status,403);
  assert.equal((await request(`/api/jobs/${id}/images`,'POST',PNG,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await request(`/api/jobs/${id}`)).data.images.length,job.images.length);
});

test('invalid draft updates preserve the previously saved content',async t=>{
  const {request,id,job}=await fixture(t);
  const draft=draftFor(job.images[0].name);
  await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:''});
  const invalid=await request(`/api/jobs/${id}/draft`,'PUT',{draft:{...draft,blocks:[{type:'image',file:'../../outside.png',alt:'x'}]},review:''});
  assert.ok(invalid.status>=400);
  assert.deepEqual((await request(`/api/jobs/${id}`)).data.draft,draft);
});

test('failed regeneration keeps the existing draft even after materials change',async t=>{
  const {request,id,job}=await fixture(t);
  const draft=draftFor(job.images[0].name);
  await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:'기존 검토'});
  await request(`/api/jobs/${id}`,'PUT',{title:'변경된 주제',notes:'새로운 메모',order:job.images.map(i=>i.name)});
  assert.equal((await request(`/api/jobs/${id}/generate`,'POST')).status,202);
  const result=await settled(request,id);
  assert.equal(result.generation.phase,'error');assert.deepEqual(result.draft,draft);assert.equal(result.review,'기존 검토');
});

test('generation persists analysis and excludes flagged images; transfer stays pending',async t=>{
  const {request,id,job,root}=await fixture(t,async({directory})=>{
    const m=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
    return {draft:draftFor(m.images[0].name),analysis:'이미지 관찰',review:'사진 확인',sensitiveImages:[m.images[0].name]};
  });
  await request(`/api/jobs/${id}/generate`,'POST');const result=await settled(request,id);
  assert.equal(result.generation.phase,'done');assert.equal(result.analysis,'이미지 관찰');
  assert.equal(result.draft.blocks.filter(b=>b.type==='image').length,0);
  assert.ok(result.review.includes('test.png'));
  const transfer=await request(`/api/jobs/${id}/transfer`,'POST');assert.equal(transfer.status,200);assert.match(transfer.data.message,/아직 티스토리에 저장되지는/);
  const meta=JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(meta.directory,'transfer-request.json'))).status,'pending');
  assert.equal(fs.existsSync(path.join(meta.directory,'tistory-receipt.json')),false);
});

test('a running generation blocks overlapping writes and duplicate generation',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const {request,id,job}=await fixture(t,async()=>{await gate;return {draft:draftFor(job.images[0].name),analysis:'분석',review:'',sensitiveImages:[]};});
  await request(`/api/jobs/${id}/generate`,'POST');
  assert.equal((await request(`/api/jobs/${id}/generate`,'POST')).status,409);
  assert.equal((await request(`/api/jobs/${id}`,'PUT',{title:'겹친 변경',notes:'',order:[]})).status,409);
  assert.equal((await request(`/api/jobs/${id}`,'DELETE')).status,409);
  assert.equal((await request(`/api/jobs/${id}/covers?name=cover.png`,'POST',PNG)).status,409);
  finish();assert.equal((await settled(request,id)).generation.phase,'done');
});

test('publication API locks writes, deduplicates clicks, and returns the verified link',async t=>{
  let release, count=0;const gate=new Promise(resolve=>{release=resolve;});
  const {request,id,job,bootstrap}=await fixture(t,undefined,async({draft,beforeSubmit})=>{
    count++;await gate;beforeSubmit();return {url:'https://example.tistory.com/42',title:draft.title,verifiedAt:new Date().toISOString(),evidence:{public:true,body:true,images:true}};
  });
  assert.equal(bootstrap.canPublish,true);
  const saved=await request(`/api/jobs/${id}/draft`,'PUT',{draft:draftFor(job.images[0].name),review:''});
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:'old'})).status,409);
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:saved.data.draftDigest})).status,202);
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:saved.data.draftDigest})).status,200);
  assert.equal((await request(`/api/jobs/${id}/draft`,'PUT',{draft:draftFor(job.images[0].name),review:'changed'})).status,409);
  assert.equal((await request(`/api/jobs/${id}/generate`,'POST')).status,409);
  assert.equal((await request(`/api/jobs/${id}`,'DELETE')).status,409);
  release();
  let result;
  for(let i=0;i<50;i++){result=(await request(`/api/jobs/${id}`)).data;if(result.publication.phase==='published')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(result.publication.url,'https://example.tistory.com/42');assert.equal(count,1);
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:'anything'})).data.publication.phase,'published');
  assert.equal((await request(`/api/jobs/${id}`,'DELETE')).status,200);
  assert.equal(count,1); // Local deletion never invokes the remote adapter.
});

test('deleting a job removes all original photos, snapshots and history while preserving other jobs', async t => {
  const {request,id,root,job} = await fixture(t);
  const neighbor = (await request('/api/jobs','POST',{title:'남겨둘 글'})).data;
  const original = job.images[0].name;
  await request(`/api/jobs/${id}/covers?name=cover.png`,'POST',PNG);
  const second = (await request(`/api/jobs/${id}/images?name=extra.png`,'POST',PNG)).data.images[1].name;
  await request(`/api/jobs/${id}/draft`,'PUT',{draft:draftFor(original),review:'첫 초안'});
  await request(`/api/jobs/${id}/draft`,'PUT',{draft:draftFor(original),review:'편집 이력'});
  const meta = JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json')));
  const older = path.join(root,'drafts',id,'older-input','publication','old-attempt');
  fs.mkdirSync(older,{recursive:true}); fs.writeFileSync(path.join(older,'photo.png'),PNG);
  await request(`/api/jobs/${id}`,'PUT',{title:'삭제할 글',notes:'',order:[original]});
  assert.ok(fs.existsSync(path.join(root,'inbox',id,'images',second)));
  assert.ok(fs.readdirSync(path.join(meta.directory,'history')).length);
  const files = directory => fs.readdirSync(directory,{withFileTypes:true}).reduce((n,entry) => n + (entry.isDirectory() ? files(path.join(directory,entry.name)) : fs.statSync(path.join(directory,entry.name)).size),0);
  const expected = files(path.join(root,'inbox',id)) + files(path.join(root,'drafts',id));
  assert.equal((await request('/api/jobs')).data.find(j=>j.id===id).storageBytes,expected);
  assert.equal((await request(`/api/jobs/${id}`,'DELETE',undefined,{'X-App-Token':'wrong'})).status,403);
  assert.equal((await request(`/api/jobs/${id}`,'DELETE',undefined,{Origin:'https://attacker.example'})).status,403);
  const deleted = await request(`/api/jobs/${id}`,'DELETE');
  assert.equal(deleted.status,200); assert.equal(deleted.data.deletedBytes,expected);
  assert.equal(fs.existsSync(path.join(root,'inbox',id)),false);
  assert.equal(fs.existsSync(path.join(root,'drafts',id)),false);
  assert.equal((await request(`/api/jobs/${id}`)).status,404);
  assert.equal((await request(`/api/jobs/${id}`,'DELETE')).status,404);
  assert.deepEqual((await request('/api/jobs')).data.map(j=>j.id),[neighbor.id]);
  assert.equal(fs.readFileSync(path.join(root,'style.md'),'utf8'),'테스트 문체');
});

test('cover uploads and selection preserve body edits and original input, survive reload, and publish an immutable copy', async t => {
  let sent;
  const {request,id,root,job} = await fixture(t,undefined,async request=> {
    sent = request;
    assert.ok(fs.readFileSync(path.join(request.directory,'images',request.draft.cover)).equals(PNG));
    request.beforeSubmit();
    return {url:'https://example.tistory.com/42',title:request.draft.title,verifiedAt:new Date().toISOString(),evidence:{public:true,body:true,images:true,cover:true}};
  });
  const draft = draftFor(job.images[0].name);
  const before = (await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:'사용자 검토'})).data;
  assert.equal((await request(`/api/jobs/${id}/covers`,'POST',Buffer.from('not an image'))).status,415);
  const uploaded = (await request(`/api/jobs/${id}/covers?name=표지.png`,'POST',PNG)).data;
  const cover = uploaded.coverImages[0].name;
  assert.equal(uploaded.images.length,1); assert.equal(uploaded.changed,false);
  assert.equal(uploaded.coverImages[0].label,'표지.png');
  const selected = (await request(`/api/jobs/${id}/draft`,'PUT',{draft:{...draft,cover},review:'사용자 검토'})).data;
  assert.equal(selected.draft.cover,cover); assert.deepEqual(selected.draft.blocks,draft.blocks);
  assert.notEqual(selected.draftDigest,before.draftDigest); assert.equal(selected.review,'사용자 검토');
  const reloaded = (await request(`/api/jobs/${id}`)).data;
  assert.equal(reloaded.draft.cover,cover); assert.equal(reloaded.changed,false);
  const directory = JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json'))).directory;
  const manifest = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  assert.equal(manifest.images.length,1); assert.equal(manifest.coverImages[0].name,cover);
  assert.deepEqual(buildPreview(reloaded.draft,manifest).usedImages,[cover,job.images[0].name]);
  assert.ok(fs.readFileSync(path.join(directory,'preview.html'),'utf8').indexOf(cover) < fs.readFileSync(path.join(directory,'preview.html'),'utf8').indexOf(job.images[0].name));
  const originalManifest = fs.readFileSync(path.join(directory,'manifest.json'),'utf8');
  assert.equal((await request(`/api/jobs/${id}/draft`,'PUT',{draft:{...draft,cover:'../../outside.png'},review:''})).status,400);
  assert.equal(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'),originalManifest);
  assert.equal((await request(`/api/jobs/${id}`)).data.draft.cover,cover);
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:before.draftDigest})).status,409);
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:selected.draftDigest})).status,202);
  for(let i=0;i<50 && !sent;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(sent.draft.cover,cover);
  for(let i=0;i<50 && (await request(`/api/jobs/${id}`)).data.publication.phase!=='published';i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await request(`/api/jobs/${id}`)).data.publication.phase,'published');
  const reset = (await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:''})).data;
  assert.equal(reset.draft.cover,undefined); assert.deepEqual(reset.draft.blocks,draft.blocks);
  assert.deepEqual(buildPreview(reset.draft,JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')))).usedImages,[job.images[0].name]);
});

test('an existing body photo becomes the first image without duplication or loss of its caption', async t => {
  const {request,id,root,job} = await fixture(t);
  const second = (await request(`/api/jobs/${id}/images?name=second.png`,'POST',PNG)).data.images[1].name;
  const draft = {...draftFor(job.images[0].name),cover:second};
  draft.blocks.push({type:'paragraph',text:'중간 설명'},{type:'image',file:second,alt:'결과',caption:'사용자 사진 설명'});
  const saved = await request(`/api/jobs/${id}/draft`,'PUT',{draft,review:''});
  assert.equal(saved.status,200);
  const ordered = articleBlocks(saved.data.draft);
  assert.deepEqual(ordered[0],draft.blocks[3]);
  assert.equal(ordered.filter(b=>b.type==='image').length,2);
  assert.deepEqual(saved.data.draft.blocks,draft.blocks);
  const directory = JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json'))).directory;
  const manifest = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  assert.equal(manifest.coverImages,undefined);
  assert.deepEqual(buildPreview(draft,manifest).usedImages,[second,job.images[0].name]);
  fs.appendFileSync(path.join(directory,'images',second),'changed');
  assert.equal((await request(`/api/jobs/${id}/publish`,'POST',{draftDigest:saved.data.draftDigest})).status,409);
});

test('regeneration keeps the user cover across changed material snapshots and drops a newly flagged cover', async t => {
  let flagged = [];
  const {request,id,root,job} = await fixture(t,async()=>({draft:draftFor(job.images[0].name),analysis:'분석',review:'',sensitiveImages:flagged}));
  const uploaded = (await request(`/api/jobs/${id}/covers?name=cover.png`,'POST',PNG)).data;
  const cover = uploaded.coverImages[0].name;
  await request(`/api/jobs/${id}/draft`,'PUT',{draft:{...draftFor(job.images[0].name),cover},review:''});
  const before = JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json'))).directory;
  await request(`/api/jobs/${id}`,'PUT',{title:'변경',notes:'새 메모',order:job.images.map(i=>i.name)});
  await request(`/api/jobs/${id}/generate`,'POST');
  const result = await settled(request,id);
  assert.equal(result.generation.phase,'done'); assert.equal(result.draft.cover,cover);
  const after = JSON.parse(fs.readFileSync(path.join(root,'inbox',id,'app.json'))).directory;
  assert.notEqual(after,before); assert.ok(fs.existsSync(path.join(after,'images',cover)));
  flagged = [cover];
  await request(`/api/jobs/${id}/generate`,'POST');
  const blocked = await settled(request,id);
  assert.equal(blocked.draft.cover,undefined); assert.match(blocked.review,/cover.png/);
});

test('deletion ignores saved draft paths and rejects junctions before removing any data', async t => {
  const {request,id,root,job} = await fixture(t);
  await request(`/api/jobs/${id}/draft`,'PUT',{draft:draftFor(job.images[0].name),review:''});
  const external = path.join(root,'keep'); fs.mkdirSync(external); fs.writeFileSync(path.join(external,'keep.txt'),'보존');
  const link = path.join(root,'drafts',id,'external-link'); fs.symlinkSync(external,link,'junction');
  assert.equal((await request(`/api/jobs/${id}`,'DELETE')).status,409);
  assert.ok(fs.existsSync(path.join(root,'inbox',id,'images',job.images[0].name)));
  assert.equal(fs.readFileSync(path.join(external,'keep.txt'),'utf8'),'보존');
  fs.unlinkSync(link);
  const metaFile = path.join(root,'inbox',id,'app.json');
  fs.writeFileSync(metaFile,JSON.stringify({title:'깨진 경로',directory:external}));
  assert.equal((await request(`/api/jobs/${id}`,'DELETE')).status,200);
  assert.equal(fs.readFileSync(path.join(external,'keep.txt'),'utf8'),'보존');
  assert.equal((await request('/api/jobs/%2e%2e%5cskip','DELETE')).status,400);
});
