import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { normalizeGitHubCard, renderGitHubCard, renderArticleContent } from '../web/article-renderer.js';
import { buildPreview } from '../scripts/blog.mjs';
import { publicationHtml, verifyPublishedHtml } from '../scripts/publication.mjs';

const card={icon:'📚',categoryLabel:'Java Collection',topic:'Stack & Deque',sourceLabel:'Problem Source',url:'https://github.com/example/java/tree/main/Chapter_2/Step2/src',linkText:'GitHub - Java (Chapter 2 / Step 2 - 3)',description:'LIFO 구조인 스택의 개념과 사용법, 그리고 현대적인 대체제인 Deque를 알아봅니다.'};
const draft={title:'Stack과 Deque',tags:[],cover:'cover.png',githubCard:card,blocks:[{type:'heading',text:'스택의 동작'},{type:'paragraph',text:'스택은 마지막에 넣은 데이터를 먼저 꺼냅니다.'},{type:'image',file:'cover.png',alt:'스택 캡처',caption:'캡처 설명'}]};
const manifest={images:[{name:'cover.png'}]};
const uploaded={'cover.png':'<figure><img src="https://cdn.example.com/cover.png"></figure>'};

test('GitHub card sits immediately after the TOC in preview and publication, preserving cover order',()=>{
  for (const body of [buildPreview(draft,manifest).body,publicationHtml(draft,manifest,uploaded)]) {
    const $=load(body,null,false);
    assert.equal($('[data-hdev-toc]').next().attr('data-hdev-github-card'),'true');
    assert.equal($('.hdev-github-card').next().prop('tagName'),'FIGURE');
    assert.equal($('.hdev-github-card').length,1);
    assert.equal($('.hdev-github-topic').text(),card.topic);
    assert.equal($('.hdev-github-link').attr('href'),card.url);
    assert.equal($('.hdev-github-link').attr('target'),'_blank');
    assert.match($('.hdev-github-link').attr('rel'),/noopener/);
    assert.match($('.hdev-github-card').attr('style'),/background-color:#f6f8fa/);
  }
  assert.deepEqual(draft.blocks.map(b=>b.type),['heading','paragraph','image']);
});

test('skin TOCs and documents without headings keep the card at the start of article content',()=>{
  const $=load(publicationHtml(draft,manifest,uploaded,{includeToc:false}),null,false);
  assert.equal($('[data-hdev-toc]').length,0);
  assert.equal($.root().children().first().attr('data-hdev-github-card'),'true');
  const plain=load(renderArticleContent([{type:'paragraph',text:'내용'}],{githubCard:card,inlineStyles:false}),null,false);
  assert.equal(plain('.hdev-github-card').next().text(),'내용');
  assert.equal(plain('[style]').length,0);
  assert.equal(load(renderArticleContent(draft.blocks),null,false)('.hdev-github-card').length,0);
});

test('card fields are escaped and only valid HTTPS hyperlinks are accepted',()=>{
  const $=load(renderGitHubCard({...card,topic:'<script>window.bad=true</script>',linkText:'<img src=x onerror=alert(1)>',description:'" & <tag>\n다음 줄'}),null,false);
  assert.equal($('script,img,tag').length,0);
  assert.equal($('.hdev-github-topic').text(),'<script>window.bad=true</script>');
  assert.equal($('.hdev-github-description br').length,1);
  for (const url of ['javascript:alert(1)','data:text/html,test','http://github.com/example','https://user:secret@github.com','[https://github.com](https://github.com)']) {
    assert.throws(()=>renderGitHubCard({...card,url}),/https/);
  }
  assert.throws(()=>renderGitHubCard({...card,topic:' '}),/주제/);
  assert.throws(()=>renderGitHubCard({...card,description:'x'.repeat(1001)}),/1000/);
  assert.equal(normalizeGitHubCard({...card,categoryLabel:'Java Collection: '}).categoryLabel,'Java Collection');
});

test('publication verification requires both the info card text and its actual hyperlink',()=>{
  const html=`<html><head><meta property="og:title" content="${draft.title}"><meta property="og:image" content="https://cdn.example.com/cover.png"></head><body>${publicationHtml(draft,manifest,uploaded)}</body></html>`;
  assert.equal(verifyPublishedHtml(html,draft,uploaded),true);
  const wrongLink=load(html);wrongLink('.hdev-github-link').attr('href','https://github.com/elsewhere');
  assert.equal(verifyPublishedHtml(wrongLink.html(),draft,uploaded),false);
  const missing=load(html);missing('.hdev-github-card').remove();
  assert.equal(verifyPublishedHtml(missing.html(),draft,uploaded),false);
  const changed=load(html);changed('.hdev-github-description').text('다른 설명');
  assert.equal(verifyPublishedHtml(changed.html(),draft,uploaded),false);
});
