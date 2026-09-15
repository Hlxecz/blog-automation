const guides = {
  codex: { name: 'Codex', company: 'OpenAI', account: 'Codex를 사용할 수 있는 본인의 ChatGPT 계정',
    install: 'npm.cmd install -g @openai/codex@latest', login: 'codex.cmd login', check: 'codex.cmd login status',
    prerequisite: 'Node.js 22 이상을 설치한 뒤 새 PowerShell 창을 열어 주세요.',
    docs: 'https://developers.openai.com/codex/cli/', update: 'npm.cmd install -g @openai/codex@latest' },
  claude: { name: 'Claude Code', company: 'Anthropic', account: 'Claude Code를 사용할 수 있는 본인의 Claude 계정',
    install: 'winget install Anthropic.ClaudeCode', login: 'claude auth login', check: 'claude auth status',
    prerequisite: 'Windows PowerShell에서 설치하세요. 설치 후 새 터미널을 열어 주세요.',
    docs: 'https://code.claude.com/docs/en/setup', update: 'winget upgrade Anthropic.ClaudeCode' }
};
export const connectionMessage = ai => ({
  connected: `${guides[ai?.provider]?.name || 'Codex'} 연결됨`,
  missing: 'CLI를 찾지 못했어요 · 설치가 필요해요',
  login_required: 'CLI 설치됨 · 로그인이 필요해요',
  timeout: '연결 확인 시간이 초과됐어요',
  error: '연결 상태를 확인하지 못했어요',
  checking: '연결을 확인하고 있어요…'
}[ai?.status] || 'AI 연결을 확인해 주세요');

export function createAIHelp({ api, modal, toast, onChanged, getAI }) {
  return async function openAIHelp() {
    const box = document.createElement('div'); box.className = 'ai-help';
    box.innerHTML = `<p class="ai-intro">초안 작성과 말투 분석에 사용할 AI를 선택하세요.<br>이 PC에 설치한 CLI에 본인 계정으로 로그인하면 연결됩니다.</p>
      <fieldset class="ai-options"><legend>사용할 AI</legend>
        <label><input type="radio" name="ai-provider" value="codex"><span><strong>Codex</strong><small>OpenAI · ChatGPT 계정</small></span></label>
        <label><input type="radio" name="ai-provider" value="claude"><span><strong>Claude Code</strong><small>Anthropic · Claude 계정</small></span></label>
      </fieldset>
      <div class="ai-connection"><span id="ai-connection-status" role="status"></span><button id="ai-recheck" class="button secondary">연결 다시 확인</button></div>
      <div id="ai-guide"></div>
      <details class="ai-faq"><summary>연결이 안 될 때</summary><p>설치 후 H.Dev Studio를 완전히 종료하고 다시 열어 주세요. Windows용 CLI를 설치해야 이 EXE에서 찾을 수 있어요. WSL 안에만 설치한 CLI는 연결되지 않습니다.</p><p>명령을 찾을 수 없다면 설치 안내의 PATH 설정을 확인하세요. 오래된 CLI는 아래 명령으로 업데이트한 뒤 다시 연결해 주세요.</p><div id="ai-update"></div><p>연결 확인은 로그인 상태를 확인합니다. 실제 AI 작업에는 인터넷 연결과 사용 가능한 계정 한도가 필요해요.</p></details>
      <p class="ai-privacy">사진·메모·말투 지침과 분석할 공개 글 본문은 선택한 AI 제공사로 전송되며, 해당 계정의 요금·사용량 정책이 적용됩니다. 앱에서 비밀번호나 API 키를 입력받지 않습니다.</p>`;
    let state = getAI() || { provider: 'codex', status: 'checking' }, pending = false;
    const radios = [...box.querySelectorAll('[name="ai-provider"]')];
    const status = box.querySelector('#ai-connection-status'), recheck = box.querySelector('#ai-recheck');
    function command(text, label) {
      const row = document.createElement('div'); row.className = 'ai-command';
      const code = document.createElement('code'); code.textContent = text;
      const copy = document.createElement('button'); copy.className = 'button secondary'; copy.textContent = '복사'; copy.setAttribute('aria-label', `${label} 명령 복사`);
      copy.onclick = async () => { try { await navigator.clipboard.writeText(text); toast('명령을 복사했어요. PowerShell에 붙여넣으세요.'); } catch { toast('명령을 선택해 직접 복사해 주세요.', true); } };
      row.append(code, copy); return row;
    }
    function render() {
      for (const radio of radios) { radio.checked = radio.value === state.provider; radio.disabled = pending; }
      recheck.disabled = pending;
      status.textContent = pending ? '연결을 확인하고 있어요…' : connectionMessage(state);
      status.dataset.status = pending ? 'checking' : state.status;
      const guide = guides[state.provider], steps = document.createElement('ol'); steps.className = 'ai-steps';
      for (const [title, description, cmd] of [
        ['CLI 설치', guide.prerequisite, guide.install],
        ['내 계정으로 로그인', `${guide.account}으로 브라우저에서 로그인하세요. 이미 설치하고 로그인했다면 이 단계는 건너뛰세요.`, guide.login],
        ['연결 확인', '아래 명령으로 로그인 상태를 확인하고 위의 ‘연결 다시 확인’을 누르세요.', guide.check]
      ]) {
        const li = document.createElement('li'), heading = document.createElement('strong'), p = document.createElement('p');
        heading.textContent = title; p.textContent = description; li.append(heading, p, command(cmd, title)); steps.append(li);
      }
      const link = document.createElement('a'); link.href = guide.docs; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${guide.name} 공식 설치 안내 ↗`;
      const guideBox = box.querySelector('#ai-guide'); guideBox.replaceChildren(steps, link);
      if (state.provider === 'codex') {
        const node = document.createElement('a'); node.href = 'https://nodejs.org/en/download'; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.textContent = 'Node.js 다운로드 ↗'; guideBox.append(node);
      } else {
        const note = document.createElement('p'); note.className = 'ai-image-note'; note.textContent = 'Claude Code로 분석할 사진은 한 장당 5MB 이하로 준비해 주세요.'; guideBox.append(note);
      }
      box.querySelector('#ai-update').replaceChildren(command(guide.update, '업데이트'));
    }
    async function update(provider) {
      if (pending) return;
      const previous = state; pending = true; state = { provider, status: 'checking' }; render();
      try {
        state = await api('/api/ai', { method: 'PUT', json: { provider } }); onChanged(state);
      } catch (error) { state = previous; toast(error.message, true); }
      finally { pending = false; render(); }
    }
    radios.forEach(radio => { radio.onchange = () => update(radio.value); });
    recheck.onclick = () => update(state.provider);
    render(); modal('도움말 · AI 연결', box);
    pending = true; render();
    try { state = await api('/api/ai'); onChanged(state); }
    catch (error) { toast(error.message, true); }
    finally { pending = false; render(); }
  };
}
