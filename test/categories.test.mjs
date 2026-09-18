import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categoriesFromEditor, normalizeCategory, selectableCategories, categoryLabel } from '../web/draft-model.js';
import { createCategories } from '../scripts/categories.mjs';
import { verifyPublishedHtml } from '../scripts/publication.mjs';

const blogUrl = 'https://example.tistory.com';
const raw = [{ id:'0',label:'카테고리 없음' },{ id:'10',label:'Language' },{ id:'11',label:'- Java' },{ id:'20',label:'Study' },{ id:'21',label:'- Java' }];
const items = categoriesFromEditor(raw, blogUrl);
test('category choices unify uncategorized, omit parents, and distinguish duplicate leaf names', () => {
  const standalone = { blogUrl, id:'30', path:['회고'] };
  const source = [...items, standalone, {...standalone,blogUrl:'https://other.tistory.com',id:'40'}];
  const before = structuredClone(source), choices = selectableCategories(source, blogUrl);
  assert.deepEqual(choices.map(item => item.id), ['0','11','21','30']);
  assert.deepEqual(choices.map(item => categoryLabel(item, choices)), ['카테고리 없음','Java (Language)','Java (Study)','회고']);
  assert.deepEqual(choices[1].path, ['Language','Java']);
  assert.deepEqual(selectableCategories([], blogUrl), [items[0]]);
  assert.deepEqual(selectableCategories([items[0],items[0]], blogUrl), [items[0]]);
  assert.equal(categoryLabel(items[2], [items[0],items[2]]), 'Java');
  assert.deepEqual(source, before);
});

test('editor category IDs preserve parent paths and reject incomplete or malformed lists', () => {
  assert.deepEqual(items[2], { blogUrl, id:'11',path:['Language','Java'] });
  assert.deepEqual(items[4].path, ['Study','Java']);
  assert.throws(() => categoriesFromEditor(raw.slice(2), blogUrl), /상위/);
  assert.throws(() => categoriesFromEditor(raw.slice(1), blogUrl), /없음/);
  assert.throws(() => categoriesFromEditor([...raw,raw[1]], blogUrl), /중복/);
  for (const value of [{...items[2],id:'11" onclick="bad'},{...items[2],blogUrl:'https://other.tistory.com'},{...items[2],blogUrl:'https://example.tistory.com.evil.test'},{...items[2],path:['']},{...items[0],path:['Java']}]) assert.throws(() => normalizeCategory(value, blogUrl));
});

test('category cache survives restart and failed refresh, with concurrent and cross-blog reads isolated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'hdev-category-store-'));
  try {
    let fail = false, release;
    const store = createCategories({root,blogUrl,reader:async()=>{if(fail)throw new Error('로그인 창이 닫혔습니다.');if(release)await new Promise(resolve=>{release=resolve;});return items;}});
    assert.deepEqual(store.state().items,[]);
    assert.deepEqual((await store.refresh()).items,items);
    const saved = fs.readFileSync(path.join(root,'library/categories.json'),'utf8');
    fail=true;await assert.rejects(store.refresh(),/로그인/);assert.equal(store.isRunning(),false);
    assert.equal(fs.readFileSync(path.join(root,'library/categories.json'),'utf8'),saved);
    assert.deepEqual(createCategories({root,blogUrl}).state().items,items);
    assert.deepEqual(createCategories({root,blogUrl:'https://other.tistory.com'}).state().items,[]);
    await assert.rejects(createCategories({root,blogUrl}).refresh(),/데스크톱/);
    fail=false;release=true;const pending=store.refresh();assert.equal(store.isRunning(),true);
    await assert.rejects(store.refresh(),/불러오는 중/);release();await pending;
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('public category verification requires the article category path, including the parent', () => {
  const draft={title:'카테고리 검증',tags:[],blocks:[{type:'paragraph',text:'본문'}],category:items[2]};
  const html=category=>`<meta property="og:title" content="카테고리 검증"><h1>카테고리 검증</h1>${category}<p>본문</p>`;
  assert.equal(verifyPublishedHtml(html('<a class="category" href="/category/Language/Java">Language/Java</a>'),draft,{}),true);
  assert.equal(verifyPublishedHtml(html('<a class="category" href="/category/Study/Java">Study/Java</a>'),draft,{}),false);
  assert.equal(verifyPublishedHtml(html('<nav><a href="/category/Language/Java">Language/Java</a></nav>'),draft,{}),false);
  assert.equal(verifyPublishedHtml(html('<a class="category" href="https://other.tistory.com/category/Language/Java">Language/Java</a>'),draft,{}),false);
  assert.equal(verifyPublishedHtml(html(''),{...draft,category:items[0]},{}),true);
  assert.equal(verifyPublishedHtml(html('<a class="category" href="/category/Language/Java">Language/Java</a>'),{...draft,category:items[0]},{}),false);
  assert.equal(verifyPublishedHtml(html(''),{...draft,category:undefined},{}),true);
});
