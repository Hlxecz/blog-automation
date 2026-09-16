import test from 'node:test';
import assert from 'node:assert/strict';
import { notionPageId, notionArticle, readNotionPage } from '../scripts/notion-public.mjs';
import { collectReferences } from '../scripts/references.mjs';

const id='11111111-2222-3333-4444-555555555555';
const url='https://example.notion.site/Guide-'+id.replace(/-/g,'')+'?pvs=74';
function block(id,type,text,content=[],props={}) {
  return {value:{value:{id,type,alive:true,properties:{title:[[text]],...props},content},role:'reader'}};
}

test('public Notion IDs are parsed without accepting lookalike hosts',()=>{
  assert.equal(notionPageId(url),id);
  assert.equal(notionPageId('https://www.notion.so/Guide-'+id),id);
  for(const value of ['https://notion.site.evil.com/'+id,'http://example.notion.site/'+id,'https://example.notion.site/login'])assert.throws(()=>notionPageId(value));
});

test('Notion reader follows all cursors and loads nested collapsed children in page order',async()=>{
  const requests=[];
  const article=await readNotionPage(url,async(endpoint,body)=>{
    requests.push(body); assert.equal(endpoint,'https://example.notion.site/api/v3/loadCachedPageChunkV2');
    if(body.page.id===id && !body.cursor.stack.length)return {dedupeSessionId:'public-session',recordMap:{block:{[id]:block(id,'page','공개 가이드',['intro','toggle','table','end','child-page']),intro:block('intro','text','앞부분 설명'),toggle:block('toggle','sub_sub_header','접힌 프롬프트',['code','nested'])}},cursors:[{stack:[[{id,index:3}]]}]};
    if(body.page.id===id){assert.equal(body.dedupeSessionId,'public-session');return {recordMap:{block:{table:block('table','table','',['row']),row:block('row','table_row','',[],{left:[['기능']],right:[['Ctrl + E']]}),end:block('end','text','마지막 정리'),unrelated:block('unrelated','text','포함하면 안 되는 자료'),'child-page':block('child-page','page','별도 문서',['not-requested'])}},cursors:[]};}
    assert.equal(body.dedupeSessionId,undefined);
    if(body.page.id==='toggle')return {recordMap:{block:{code:block('code','code','if (ready) {\n  start();\n}',[],{language:[['javascript']]}),nested:block('nested','toggle','중첩 토글',['deep'])}},cursors:[]};
    assert.equal(body.page.id,'nested');return {recordMap:{block:{deep:block('deep','text','중첩 토글의 실제 본문')}},cursors:[]};
  });
  assert.equal(requests.length,4);assert.equal(article.title,'공개 가이드');
  for(const expected of ['  start();','기능 | Ctrl + E','중첩 토글의 실제 본문','마지막 정리'])assert.ok(article.text.includes(expected));
  assert.ok(article.text.indexOf('접힌 프롬프트')<article.text.indexOf('기능 | Ctrl + E'));
  assert.ok(!article.text.includes('포함하면 안 되는'));assert.equal(article.truncated,false);
});

test('Notion never reports private, missing or looping content as read',async()=>{
  await assert.rejects(readNotionPage(url,async()=>({recordMap:{block:{}},cursors:[]})),/접근/);
  await assert.rejects(readNotionPage(url,async()=>({recordMap:{block:{[id]:block(id,'page','문서',['missing'])}},cursors:[]})),/다음 부분/);
  await assert.rejects(readNotionPage(url,async()=>({recordMap:{block:{}},cursors:[{stack:[1]}]})),/다음 부분/);
  assert.throws(()=>notionArticle({[id]:block(id,'page','문서',['missing'])},id),/일부/);
  const [result]=await collectReferences([{url}],async()=>{throw new Error('Must not use empty HTML shell');},undefined,async()=>{throw new Error('노션 공개 본문에 접근하지 못했습니다.');});
  assert.equal(result.status,'unavailable');assert.equal(result.text,'');
});

test('Notion retains long documents and clearly marks the length limit',()=>{
  const article=notionArticle({[id]:block(id,'page','문서',['text']),text:block('text','text','가'.repeat(61000))},id);
  assert.equal(article.text.length,60000);assert.ok(article.sourceCharacters>60000);assert.equal(article.truncated,true);
});
