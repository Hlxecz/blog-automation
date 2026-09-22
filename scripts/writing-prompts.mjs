import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeCategory, uncategorizedCategory } from '../web/draft-model.js';

export const writingExamples = [
  { id: 'news', name: 'AI 뉴스', prompt: `목표와 말투
개발자가 바뀐 점과 자신에게 필요한 영향을 빠르게 파악하도록 간결한 존댓말로 씁니다. 첫 문단에서 누가, 언제, 무엇을 발표했고 어떤 변화가 핵심인지 설명합니다. 제목도 제품명과 실제 변화를 중심으로 붙입니다.

전개
핵심 소식 → 주요 변화와 이전 방식의 차이 → 사용 가능한 대상·시점·조건 → 개발 업무에 미치는 영향 → 확인할 원문 순서로 전개하되 자료가 있는 항목만 씁니다. 기능을 나열하는 데 그치지 말고 어떤 작업에 도움이 되는지 연결합니다. 여러 소식은 독자의 용도별로 묶고, 비교 기준이 같을 때만 표를 사용합니다.

근거와 표현
공식 발표 사실, 발표자의 주장, 작성자의 해석을 문장 안에서 구분합니다. 정식 출시·미리보기·연구 시연·향후 계획을 섞지 않습니다. 성능 수치는 출처에 있는 비교 대상과 측정 조건을 함께 적고, 조건이 없으면 우월하다고 단정하지 않습니다. 발표일과 글 작성일을 구분하고 오늘·최근보다 확인된 날짜를 씁니다. 가격·지원 지역·버전·공개 일정은 제공 자료에 있을 때만 적습니다.

마무리와 점검
독자가 지금 확인하거나 시도할 수 있는 일과 아직 확인되지 않은 점을 짧게 정리합니다. 실제로 제공·확인된 출처의 링크를 관련 주장 가까이에 둡니다. 과장된 홍보 문구, 직접 써봤다는 가상 경험, 억지 회고는 넣지 않습니다. 외부 자료를 못 읽었으면 읽은 척하지 말고 검토 사항으로 남깁니다. 글 다듬기에서는 선택한 칸의 표현만 개선하고 뉴스나 출처를 새로 만들지 않습니다.` },
  { id: 'insight', name: '인사이트', prompt: `목표와 말투
독자와 하나의 질문을 함께 풀어가는 차분한 존댓말로 씁니다. 시작에서 실제로 겪을 수 있는 문제와 이 글이 제시할 관점을 분명히 합니다. 추상적인 시대 이야기나 당연한 당위로 서론을 늘리지 않습니다.

전개
핵심 질문 → 관점 → 구체적인 근거·사례 → 그 근거가 관점을 뒷받침하는 이유 → 다른 해석과 적용 한계 → 독자의 판단 기준으로 이어갑니다. 한 문단에는 하나의 주장만 담고, 사례 뒤에는 왜 중요한지 설명합니다. 서로 다른 상황을 비교한다면 조건과 비교 축을 먼저 맞춥니다. 원인과 결과의 연결이 확인되지 않았으면 가능성으로 표현합니다.

근거와 표현
관찰한 사실과 작성자의 의견을 구분합니다. 메모에 있는 고민과 의견은 살리되 다른 블로그의 경험을 나의 경험처럼 바꾸지 않습니다. 주장을 약하게 만드는 조건이나 반례가 자료에 있으면 함께 다룹니다. 모든 상황에 통하는 정답처럼 말하지 말고 어떤 환경에서 유용한 판단인지 범위를 좁힙니다. 새로운 주장·사례·수치를 채우려고 자료를 지어내지 않습니다.

마무리와 점검
독자가 비슷한 선택을 할 때 확인할 질문이나 기준을 남깁니다. 다음 행동은 자료에서 도출할 수 있는 범위로 제안하고 이미 실행한 성과처럼 쓰지 않습니다. 소제목은 해당 절의 구체적인 질문이나 요점을 보여주고, 표·목록은 비교나 판단을 쉽게 할 때만 사용합니다. 근거가 부족하면 빈 항목을 억지로 채우지 말고 검토 사항에 남깁니다. 글 다듬기에서는 원래의 관점과 경험을 유지합니다.` },
  { id: 'retrospective', name: '프로젝트 회고', prompt: `목표와 말투
개발자가 당시의 조건과 선택을 돌아보는 솔직하고 담백한 존댓말로 씁니다. 도입에서 무엇을 만들었는지, 왜 필요했는지, 내가 맡은 범위를 자료에 있는 만큼 밝힙니다. 감정과 개인 경험은 작성자의 메모에 있는 내용만 사용합니다.

전개
목표·배경·제약 → 중요한 선택과 대안 → 구현 중 관찰과 대응 → 실제 결과 → 유지할 점과 다음에 바꿀 점 순서로 구성합니다. 모든 작업을 일기처럼 나열하지 말고 결과에 영향을 준 결정에 집중합니다. 각 결정은 당시 문제, 고려한 대안, 선택 기준, 감수한 단점이 이어지게 설명합니다. 사후에 알게 된 사실을 처음부터 알고 있었던 것처럼 쓰지 않습니다.

근거와 표현
개인의 기여와 팀의 작업을 구분하고 도구·기술 이름만 나열하지 않습니다. 전후 변화는 같은 조건의 기록이 있을 때 비교합니다. 수치가 없으면 확인된 동작이나 관찰로 결과를 설명하며 개선율·사용자 반응·팀의 대화를 만들지 않습니다. 아쉬운 점은 사람에 대한 평가보다 과정·제약·판단의 문제로 설명합니다. 다른 블로그의 성과나 사건을 작성자의 경험으로 가져오지 않습니다.

마무리와 점검
잘된 점에는 다음에도 유지할 이유를, 아쉬운 점에는 다시 한다면 바꿀 행동을 붙입니다. 다음 행동은 제안인지 확정된 계획인지 구분하고 자료에 없는 담당자·기한을 배정하지 않습니다. 무조건적인 성장·성공 서사나 감사 인사를 덧붙이지 않습니다. 회고에 필요한 경험이 부족하면 질문을 검토 사항에 남기고 짧게 마칩니다. 글 다듬기에서도 사건·역할·결과는 유지합니다.` },
  { id: 'troubleshooting', name: '트러블슈팅', prompt: `목표와 말투
같은 문제를 겪는 개발자가 자신의 상황과 비교하고 해결 과정을 따라갈 수 있도록 구체적인 존댓말로 씁니다. 시작에서 증상, 발생 조건과 영향, 현재 해결 여부를 짧게 보여줍니다. 오류 문구·환경·버전은 제공 자료 그대로 적고 모르는 값은 채우지 않습니다.

전개
증상과 기대 동작 → 실행 환경·재현 조건 → 가설별 시도와 관찰 → 확인된 원인 → 수정 내용과 이유 → 같은 조건의 검증 → 남은 문제·재발 방지 순서로 씁니다. 시도가 많으면 가설·변경·관찰·판단으로 묶어 성공과 실패를 구분합니다. 실패한 시도는 원인을 좁히는 데 도움이 된 것만 남깁니다.

근거와 표현
원인으로 판단한 로그·코드·화면 등의 근거를 해당 설명 가까이에 둡니다. 관찰, 추정, 확인된 원인을 구분하고 임시 우회와 근본 수정을 같은 해결책처럼 쓰지 않습니다. 변경한 부분과 그것이 증상을 바꾸는 이유를 연결합니다. 코드·오류·파일명·설정값은 정확히 보존하며 비밀 값은 노출하지 않습니다. 원본 자료에 없는 재현 과정이나 실패 경험을 새로 만들지 않습니다.

마무리와 점검
검증은 어떤 조건에서 무엇을 확인했고 결과가 어땠는지 적습니다. 실행하지 않은 테스트는 제안으로 표시하고 해결 성공을 주장하지 않습니다. 특정 기기나 환경에서만 확인했다면 그 범위를 밝힙니다. 미해결이면 남은 가설과 다음 확인을 쓰고 결론을 꾸미지 않습니다. 예방책은 확인된 원인과 연결되는 것만 제안합니다. 글 다듬기에서는 해결 절차·명령·수치를 변경하거나 실행한 것처럼 표현하지 않습니다.` },
  { id: 'development', name: '개발 개념·사용법', prompt: `목표와 말투
처음 배우는 개발자에게 옆에서 설명하듯 친절하고 명확한 존댓말로 씁니다. 시작에서 이 개념이 필요한 상황과 읽고 나면 할 수 있는 일을 보여줍니다. 전문 용어는 처음 나올 때 쉬운 뜻을 붙이고, 비유는 실제 원리를 설명하는 보조 수단으로 사용합니다.

전개
필요한 이유와 한 문장 정의 → 동작 원리 → 작은 예제 → 실행 흐름과 결과 해설 → 대안과 선택 기준 → 주의점과 핵심 정리 순서로 전개합니다. 독자가 이미 알아야 할 전제나 버전 의존성이 자료에 있으면 먼저 밝힙니다. 예제는 한 번에 한 개념에 집중하고 입력, 중요한 처리, 출력을 연결합니다. 코드만 길게 붙이지 말고 읽어야 할 부분과 그 이유를 설명합니다.

근거와 표현
실제로 실행한 결과, 설명을 위한 예시, 예상 동작을 구분합니다. 제공 코드·명령·식별자를 임의로 바꾸지 않습니다. 새 예제를 작성하도록 요청받은 경우에도 실행했다고 주장하지 않습니다. 비교는 같은 기준의 표로, 따라 하는 절차는 순서 있는 목록으로 정리합니다. 방법마다 적합한 조건과 한계를 설명하고 무조건적인 성능 우열을 만들지 않습니다. 캡처 설명은 무엇을 보아야 하는지 짚고 보이지 않는 내용을 추측하지 않습니다.

마무리와 점검
핵심 원리와 실제 선택 기준을 짧게 연결해 마칩니다. 자료에 없는 학습 일화·시행착오·회고를 덧붙이지 않습니다. 소제목과 표는 이해에 도움이 되는 만큼만 쓰고 모든 글에 같은 개수의 절·이모지·팁을 강제하지 않습니다. 글 다듬기에서는 선택한 칸의 설명만 개선하며 코드나 실행 결과를 새로 만들지 않습니다.` }
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
