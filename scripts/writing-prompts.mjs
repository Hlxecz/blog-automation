import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeCategory, uncategorizedCategory } from '../web/draft-model.js';

export const writingExamples = [
  { id: 'news', name: 'AI 뉴스', prompt: '정확하고 간결한 뉴스 브리핑 말투로 씁니다.\n핵심 소식 → 발표 주체·날짜와 바뀐 점 → 기존 방식과 차이 → 개발자에게 미치는 영향 → 출처 순서로 구성합니다.\n확인된 발표 내용과 전망을 구분하고, 과장된 수식어와 근거 없는 성능 비교를 피합니다. 자료에 없는 최신 소식·발표일·가격은 만들지 않습니다. 개인 경험이나 회고를 억지로 넣지 않습니다.' },
  { id: 'insight', name: '인사이트', prompt: '독자와 생각을 나누는 차분한 존댓말로 씁니다.\n핵심 질문이나 관점 → 근거와 사례 → 다른 해석과 한계 → 독자가 적용할 판단 기준 순서로 전개합니다.\n사실과 해석을 구분하고, 단순 뉴스 요약보다 왜 의미가 있는지 설명합니다. 나의 의견·경험은 메모에 있는 범위만 반영하고 가상의 깨달음을 만들지 않습니다.' },
  { id: 'retrospective', name: '프로젝트 회고', prompt: '개발자가 자신의 선택을 돌아보는 솔직하고 담백한 존댓말로 씁니다.\n목표와 배경 → 주요 선택과 이유 → 실제 결과 → 잘된 점과 아쉬운 점 → 다음에 바꿀 점 순서로 구성합니다.\n메모에 있는 개인 경험을 중심으로 쓰고, 기술 목록만 나열하지 않습니다. 확인되지 않은 성과·수치·감정·팀의 반응은 만들지 않고 필요한 질문은 검토 메모에 남깁니다.' },
  { id: 'troubleshooting', name: '트러블슈팅', prompt: '같은 문제를 겪는 개발자가 따라갈 수 있도록 구체적이고 명확한 존댓말로 씁니다.\n증상과 실행 환경 → 재현 조건 → 시도한 방법과 관찰 → 확인된 원인 → 수정 내용 → 검증 결과와 남은 문제 순서로 구성합니다.\n실패한 시도와 해결된 방법을 구분하고 코드·오류·설정값을 정확히 설명합니다. 추정 원인을 확정하지 않으며 확인하지 않은 해결 성공을 주장하지 않습니다.' },
  { id: 'development', name: '개발 개념·사용법', prompt: '처음 배우는 개발자에게 설명하듯 친절한 존댓말로 씁니다.\n개념과 필요한 이유 → 작동 원리 → 작은 예제와 해설 → 선택 기준과 실용 팁 → 정리 순서로 구성합니다.\n용어를 먼저 풀어 설명하고 비교는 표, 절차는 목록을 사용합니다. 예제는 실제 실행 결과와 구분하고, 자료에 없는 개인 시행착오나 회고를 넣지 않습니다.' }
];

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const sameCategory = (a, b) => a?.blogUrl === b?.blogUrl && a?.id === b?.id && JSON.stringify(a?.path) === JSON.stringify(b?.path);

export function createWritingPrompts({ root, blogUrl }) {
  const origin = new URL(blogUrl).origin, file = path.join(root, 'style', 'category-prompts.json');
  function read() {
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { profiles: [] };
    if (!Array.isArray(data.profiles)) fail('카테고리 글쓰기 지침 파일을 확인해 주세요.');
    return data;
  }
  function state() {
    const data = read();
    return { blogUrl: origin, profiles: data.profiles.filter(item => item.category.blogUrl === origin), examples: writingExamples,
      revision: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
  }
  function save(value) {
    if (value.revision !== state().revision) fail('다른 창에서 지침을 수정했어요. 최신 저장본을 불러온 뒤 다시 저장해 주세요.', 409);
    let category;
    try { category = normalizeCategory(value.category, origin); } catch (error) { fail(error.message); }
    if (typeof value.prompt !== 'string' || value.prompt.length > 10000) fail('카테고리 지침은 10,000자 이하로 입력해 주세요.');
    const data = read(), prompt = value.prompt.trim();
    data.profiles = data.profiles.filter(item => item.category.blogUrl !== origin || item.category.id !== category.id);
    if (prompt) data.profiles.push({ category, prompt, updatedAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2)); fs.renameSync(temporary, file);
    return state();
  }
  function resolve(value) {
    const category = value ? normalizeCategory(value, origin) : uncategorizedCategory(origin);
    const profile = state().profiles.find(item => sameCategory(item.category, category));
    return { category, prompt: profile?.prompt || '' };
  }
  return { state, save, resolve };
}
