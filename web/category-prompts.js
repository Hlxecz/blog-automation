import { selectableCategories, categoryLabel } from './draft-model.js';

const $ = id => document.getElementById(id);
const key = category => JSON.stringify(category);

export function initCategoryPrompts({ api, toast, getCategories, refreshCategories, onSaved, isBusy }) {
  let saved, selected, saving = false, loading = false;
  const edits = new Map(), undo = new Map();
  const profile = category => saved?.profiles.find(item => key(item.category) === key(category))?.prompt || '';
  function choices() {
    const items = new Map();
    for (const category of [...(getCategories()?.items || []), ...(saved?.profiles || []).map(item => item.category), ...[...edits.values()].map(item => item.category)]) items.set(key(category), category);
    return new Map(selectableCategories([...items.values()], saved.blogUrl).map(category => [key(category), category]));
  }
  function controls() {
    const disabled = !selected || saving || loading, dirty = selected && edits.has(key(selected));
    for (const id of ['category-prompt', 'prompt-example', 'apply-prompt-example', 'clear-category-prompt']) $(id).disabled = disabled;
    $('prompt-category').disabled = saving || loading;
    $('save-category-prompt').disabled = disabled || !dirty;
    $('prompt-category-refresh').disabled = saving || loading || isBusy() || !getCategories()?.canRead;
    $('prompt-category-refresh').textContent = loading ? '불러오는 중…' : '카테고리 불러오기';
    $('category-prompt-state').textContent = saving ? '저장 중…' : edits.size ? `미저장 ${edits.size}개 카테고리` : '저장된 지침';
    $('category-prompt-count').textContent = `${$('category-prompt').value.length.toLocaleString()} / 10,000자`;
    $('undo-category-prompt').hidden = !selected || !undo.has(key(selected));
    $('undo-category-prompt').disabled = disabled;
    $('reload-category-prompt').disabled = saving || loading;
  }
  function remember() {
    if (!selected) return;
    const prompt = $('category-prompt').value, id = key(selected), previous = edits.get(id);
    if (prompt === profile(selected)) edits.delete(id);
    else edits.set(id, { category: selected, prompt, revision: previous?.revision || saved.revision });
    controls();
  }
  function render() {
    const items = choices(), select = $('prompt-category');
    if (!items.has(key(selected))) selected = [...items.values()].find(item => item.id !== '0') || [...items.values()][0];
    select.replaceChildren();
    if (!items.size) select.add(new Option('먼저 카테고리를 불러오세요', ''));
    for (const [id, category] of items) {
      const current = category.id === '0' || getCategories()?.items.some(item => key(item) === id);
      select.add(new Option(`${current ? '' : '저장된 분류: '}${categoryLabel(category, [...items.values()])}`, id));
    }
    if (selected) select.value = key(selected);
    $('category-prompt').value = selected ? edits.get(key(selected))?.prompt ?? profile(selected) : '';
    $('prompt-category-help').textContent = !getCategories()?.items.length ? '카테고리를 불러오면 Java, C, PHP 등 글을 넣을 분류별로 지침을 설정할 수 있어요.'
      : selected?.id !== '0' && !getCategories()?.items.some(item => key(item) === key(selected)) ? '이 분류가 현재 목록에 없어요. 목록을 불러와 이름과 상위 분류를 확인해 주세요.'
      : `${selected.path.join(' / ')}에만 적용합니다. 하위 분류가 있는 상위 항목은 목록에서 생략해요.`;
    controls();
  }
  $('category-prompt').oninput = remember;
  $('prompt-category').onchange = () => {
    selected = choices().get($('prompt-category').value); $('reload-category-prompt').hidden = true; render();
  };
  function replaceText(value) {
    if (!selected || saving || loading) return;
    undo.set(key(selected), $('category-prompt').value); $('category-prompt').value = value; remember(); $('category-prompt').focus();
  }
  $('apply-prompt-example').onclick = () => {
    const example = saved?.examples.find(item => item.id === $('prompt-example').value);
    if (example) replaceText(example.prompt);
  };
  $('clear-category-prompt').onclick = () => replaceText('');
  $('undo-category-prompt').onclick = () => {
    if (!selected || !undo.has(key(selected))) return;
    $('category-prompt').value = undo.get(key(selected)); undo.delete(key(selected)); remember();
  };
  $('save-category-prompt').onclick = async () => {
    const edit = selected && edits.get(key(selected));
    if (!edit || saving) return;
    saving = true; controls();
    try {
      const next = await api('/api/writing-prompts', { method: 'PUT', json: edit });
      // Local edits in other categories can keep going if their saved text did not change.
      for (const item of edits.values()) {
        const nextPrompt = next.profiles.find(value => key(value.category) === key(item.category))?.prompt || '';
        if (item.revision === saved.revision && nextPrompt === profile(item.category)) item.revision = next.revision;
      }
      saved = next; edits.delete(key(selected)); undo.delete(key(selected)); $('reload-category-prompt').hidden = true;
      onSaved(next); render(); toast(edit.prompt.trim() ? '이 카테고리의 글쓰기 지침을 저장했어요.' : '이 카테고리는 기본 블로그용 프롬프트를 사용해요.');
    } catch (error) { if (error.status === 409) $('reload-category-prompt').hidden = false; toast(error.message, true); }
    finally { saving = false; controls(); }
  };
  $('reload-category-prompt').onclick = async () => {
    if (!selected || saving) return;
    try {
      const next = await api('/api/writing-prompts');
      undo.set(key(selected), $('category-prompt').value); edits.delete(key(selected)); saved = next;
      $('reload-category-prompt').hidden = true; onSaved(next); render();
      toast('최신 저장본을 불러왔어요. 되돌리기로 편집 중이던 내용을 복원할 수 있어요.');
    } catch (error) { toast(error.message, true); }
  };
  $('prompt-category-refresh').onclick = async () => {
    if (loading || saving || isBusy()) return;
    loading = true; controls();
    try { await refreshCategories(); render(); } catch (error) { toast(error.message, true); }
    finally { loading = false; controls(); }
  };
  return { isDirty: () => edits.size > 0, async open(category) {
    const next = await api('/api/writing-prompts');
    if (!saved || !edits.size) { saved = next; onSaved(next); }
    const examples = $('prompt-example');
    if (!examples.options.length) for (const item of saved.examples) examples.add(new Option(item.name, item.id));
    if (category) selected = category;
    render();
  } };
}
