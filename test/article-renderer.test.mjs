import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { articleBlocks } from '../web/draft-model.js';
import { renderArticleContent } from '../web/article-renderer.js';
import { buildPreview } from '../scripts/blog.mjs';
import { publicationHtml, verifyPublishedHtml } from '../scripts/publication.mjs';

const draft = { title:'문서 디자인 확인', tags:[], blocks:[
  {type:'paragraph',text:'도입입니다.'},
  {type:'heading',text:'비교할 내용'},
  {type:'paragraph',text:'💡 팁 | 같은 기준으로 비교하기\n설명 <원문>을 확인합니다.\n두 번째 줄입니다.'},
  {type:'table',headers:['기능','쓰는 상황'],rows:[['A','처음 시작'],['B','반복 작업']]},
  {type:'heading',text:'비교할 내용'},
  {type:'paragraph',text:'⚠ 주의 | 필요한 파일만 보관하기\n보관 필요성을 확인하세요.'},
  {type:'code',text:'const value = "💡 코드 안의 글자는 그대로";'}
] };
const manifest = {images:[]};

test('existing paragraphs become callouts without changing their text, order, or saved draft', () => {
  const original = structuredClone(draft);
  const app = load(renderArticleContent(articleBlocks(draft), {inlineStyles:false}), null, false);
  const exported = load(buildPreview(draft,manifest).body, null, false);
  assert.equal(app('[style]').length,0, 'App HTML must keep its strict style CSP');
  assert.equal(exported('.hdev-tip').length,1);
  assert.equal(exported('.hdev-warning').length,1);
  assert.equal(exported('.hdev-tip .hdev-callout-title').text(),'💡 팁 | 같은 기준으로 비교하기');
  assert.equal(exported('.hdev-tip br').length,1);
  assert.equal(exported('.hdev-tip').text().replace(/\s/g,''),draft.blocks[2].text.replace(/\s/g,''));
  assert.equal(app.root().text(),exported.root().text());
  assert.equal(exported('pre code').text(),draft.blocks.at(-1).text);
  assert.deepEqual(draft,original);
});

test('TOC comes before the cover/body and links to distinct headings, including duplicate titles', () => {
  const withCover={...draft,cover:'cover.png',blocks:[...draft.blocks,{type:'image',file:'cover.png',alt:'표지'}]};
  const $=load(buildPreview(withCover,{images:[{name:'cover.png'}]}).body,null,false);
  assert.equal($.root().children().first().attr('data-hdev-toc'),'true');
  assert.equal($.root().children().eq(1).prop('tagName'),'FIGURE');
  assert.deepEqual($('h2').map((_,el)=>$(el).attr('id')).get(),['hdev-section-1','hdev-section-2']);
  for(const link of $('.hdev-toc a').toArray()) assert.equal($($(link).attr('href')).text(),$(link).find('span').first().text());
  assert.equal(load(renderArticleContent([{type:'paragraph',text:'작성 중인 글'}]),null,false)('.hdev-toc').length,0);
});

test('published markup carries its own design; skin mode only omits the additional TOC', () => {
  const normal=load(publicationHtml(draft,manifest,{}),null,false);
  const skin=load(publicationHtml(draft,manifest,{}, {includeToc:false}),null,false);
  assert.equal(normal('.hdev-toc').length,1);
  assert.equal(skin('.hdev-toc').length,0);
  assert.match(skin('.hdev-tip').attr('style'),/border-left:4px solid/);
  assert.match(skin('.hdev-warning').attr('style'),/background:#fff8ed/);
  assert.equal(skin('th[scope="col"]').length,2);
  assert.ok(skin('.hdev-row-odd').attr('style').includes('background:'));
  assert.equal(skin('h2').length,2);
});

test('article text cannot inject HTML/styles, and a TOC cannot substitute for a missing heading during verification', () => {
  const unsafe={title:'안전한 제목',tags:[],blocks:[
    {type:'heading',text:'<img src=x onerror=alert(1)>'},
    {type:'paragraph',text:'💡 팁 | <script>alert(1)</script>\n<style>body{display:none}</style>'}
  ]};
  const $=load(publicationHtml(unsafe,manifest,{}),null,false);
  assert.equal($('img,script,style').length,0);
  assert.ok($('.hdev-callout-body').text().includes('<style>'));
  const page=body=>`<html><head><meta property="og:title" content="안전한 제목"></head><body>${body}</body></html>`;
  assert.equal(verifyPublishedHtml(page($.html()),unsafe,{}),true);
  $('h2').remove();
  assert.equal(verifyPublishedHtml(page($.html()),unsafe,{}),false);
});
