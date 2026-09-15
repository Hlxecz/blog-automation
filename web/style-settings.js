const $ = id => document.getElementById(id);

export function initStyleSettings({ api, toast, onSaved }) {
  let saved, analysis, dirty = false, saving = false, starting = false, timer, appliedId, previous;
  const inputs = [1,2,3].map(i => $(`style-url-${i}`));
  const urls = () => inputs.map(input => input.value.trim()).filter(Boolean);
  function controls() {
    const running = starting || analysis?.phase === 'running';
    $('analyze-style').disabled = running || saving || !urls().length;
    $('analyze-style').lastChild.textContent = running ? ' 말투를 분석하고 있어요…' : ' 블로그 말투 분석하기';
    $('save-style').disabled = saving || !dirty || !$('style-profile').value.trim();
    $('style-profile').disabled = saving;
    inputs.forEach(input => { input.disabled = saving || running; });
    $('style-save-state').textContent = saving ? '저장 중…' : dirty ? '수정 중 · 저장 필요' : '저장된 말투';
    $('style-character-count').textContent = `${$('style-profile').value.length.toLocaleString()} / 20,000자`;
    $('apply-style-result').disabled = saving || appliedId === analysis?.id;
    $('undo-style-result').disabled = saving;
  }
  function markDirty() { dirty = true; controls(); }
  inputs.forEach(input => { input.oninput = markDirty; });
  $('style-profile').oninput = markDirty;
  function renderAnalysis(next) {
    const newResult = analysis?.id !== next.id;
    analysis = next;
    if (newResult) { previous = undefined; $('undo-style-result').hidden = true; }
    $('style-analysis-status').textContent = next.message || '블로그를 분석하거나 오른쪽에 말투 지침을 직접 적어주세요.';
    $('style-analysis-status').classList.toggle('error', next.phase === 'error');
    $('style-result').hidden = next.phase !== 'done';
    $('style-result-text').textContent = next.profile || '';
    $('style-warnings').replaceChildren(...(next.warnings || []).map(message => { const li = document.createElement('li'); li.textContent = message; return li; }));
    const sources = next.phase === 'done' ? next.sources : saved?.sources || [];
    $('style-evidence').hidden = !sources.length;
    $('style-source-list').replaceChildren(...sources.map(source => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = source.title || source.url;
      li.append(a, document.createTextNode(` · ${new Date(source.readAt).toLocaleDateString('ko-KR')}`)); return li;
    }));
    controls();
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const state = await api('/api/style'); renderAnalysis(state.analysis);
        if (state.analysis.phase === 'running') poll();
        else toast(state.analysis.message, state.analysis.phase === 'error');
      } catch { $('style-analysis-status').textContent = '앱 연결을 다시 확인하고 있어요. 분석한 결과는 앱에 보관됩니다.'; poll(); }
    }, 1800);
  }
  $('style-analyze-form').onsubmit = async event => {
    event.preventDefault();
    if (starting || analysis?.phase === 'running') return;
    starting = true; controls();
    try {
      const state = await api('/api/style/analyze', { method: 'POST', json: { urls: urls() } });
      appliedId = undefined; renderAnalysis(state.analysis); poll();
    } catch (e) { toast(e.message, true); }
    finally { starting = false; controls(); }
  };
  $('apply-style-result').onclick = () => {
    if (analysis?.phase !== 'done' || saving) return;
    previous = { profile: $('style-profile').value, appliedId, urls: inputs.map(input => input.value) };
    $('style-profile').value = analysis.profile; appliedId = analysis.id;
    inputs.forEach((input, index) => { input.value = analysis.urls[index] || ''; });
    $('undo-style-result').hidden = false; markDirty();
    $('style-profile').focus(); toast('분석 결과를 지침에 가져왔어요. 다듬은 뒤 말투 저장을 눌러주세요.');
  };
  $('undo-style-result').onclick = () => {
    if (!previous || saving) return;
    $('style-profile').value = previous.profile; appliedId = previous.appliedId;
    inputs.forEach((input, i) => { input.value = previous.urls[i]; });
    previous = undefined; $('undo-style-result').hidden = true; markDirty();
  };
  $('reload-style').onclick = async () => {
    if (saving) return;
    try {
      const state = await api('/api/style');
      previous = { profile: $('style-profile').value, appliedId, urls: inputs.map(input => input.value) };
      saved = state; appliedId = undefined; $('style-profile').value = saved.profile;
      inputs.forEach((input, i) => { input.value = saved.urls[i] || ''; });
      dirty = false; $('reload-style').hidden = true;
      // Keep local edits recoverable even after resolving a second-window conflict.
      $('undo-style-result').hidden = false; $('style-result').hidden = false;
      controls(); toast('최신 저장본을 불러왔어요. 되돌리기로 방금 편집한 지침을 복원할 수 있어요.');
    } catch (e) { toast(e.message, true); }
  };
  $('save-style').onclick = async () => {
    if (saving || !saved) return;
    if (!inputs.every(input => input.reportValidity())) return;
    saving = true; controls();
    try {
      saved = await api('/api/style', { method: 'PUT', json: { profile: $('style-profile').value, urls: urls(), revision: saved.revision, analysisId: appliedId } });
      $('style-profile').value = saved.profile; dirty = false; appliedId = undefined; previous = undefined;
      $('undo-style-result').hidden = true; onSaved(saved.profile); toast('말투를 저장했어요. 다음 초안을 만들 때 적용합니다.');
    } catch (e) { if (e.status === 409) $('reload-style').hidden = false; toast(e.message, true); }
    finally { saving = false; controls(); }
  };
  return { isDirty: () => dirty, async open() {
    const state = await api('/api/style');
    if (!saved || !dirty) {
      saved = state; $('style-profile').value = state.profile;
      inputs.forEach((input, index) => { input.value = state.urls[index] || ''; });
    }
    renderAnalysis(state.analysis);
    if (state.analysis.phase === 'running') poll();
  } };
}
