# H.Dev Studio

개발 캡처와 메모로 내 말투의 초안을 만들고, 편집·미리보기 후 티스토리에 발행하는 Windows 앱입니다.

## 주요 기능

- 사진 업로드, 순서 변경, 작업 메모
- 로그인된 Codex CLI를 통한 이미지 분석과 초안 생성
- 제목·본문·태그 편집과 미리보기
- 기존 사진에서 표지 선택 또는 별도 표지 업로드
- 로컬 초안 보관, 용량 확인, 글 단위 삭제
- 여러 티스토리 블로그의 공개 글 목록과 로그인된 글 관리 화면
- 검토 후 **티스토리에 발행** 버튼으로 사진 업로드부터 공개 게시까지 실행

현재 버전은 [package.json](package.json)에서 관리합니다. [버전별 변경 내역](CHANGELOG.md)과 [자세한 사용법](docs/USAGE.md)을 참고하세요.

저장소: [Hlxecz/blog-automation](https://github.com/Hlxecz/blog-automation) · [버전 태그](https://github.com/Hlxecz/blog-automation/tags). `v0.3.0`부터 `v0.3.4`까지는 남아 있던 배포본의 소스를 복원한 기록입니다. 복원 범위는 [소스 이력 안내](docs/HISTORY.md)에 정리했습니다.

## 개발 실행

Windows 64비트, Node.js 22 이상이 필요합니다.

```powershell
npm ci
npm run setup
```

생성된 `tistory.config.json`의 `blogUrl`에 내 블로그 주소를 입력하고, `style/profile.md`에 말투 지침을 준비합니다. 기본 템플릿은 특정 사용자의 글을 분석한 프로필이 아닙니다. `setup`을 다시 실행해도 기존 설정은 보존합니다.

각 사용자는 자신의 티스토리 계정과 Codex CLI 계정으로 로그인합니다. 글 목록에 다른 블로그를 추가하는 것만으로 발행 대상이 바뀌지는 않습니다. 발행 대상은 `blogUrl`입니다.

```powershell
npm start          # 웹 개발 화면
npm run desktop    # Electron 앱: 티스토리 발행 지원
```

AI 생성은 이 PC에 설치하고 로그인한 **OpenAI Codex CLI**를 사용합니다. 별도 API 키는 연결하지 않았습니다. 사진·메모·말투 지침을 OpenAI에 전송하고 Codex 계정 사용량을 사용합니다.

## 검사와 배포용 EXE

```powershell
npm run release:check
npm test
npm run test:desktop
npm run build:exe
```

배포용 파일은 `dist/<버전>/`에 생성합니다. 같은 버전의 EXE가 있으면 덮어쓰지 않습니다. 개발 중 확인은 `npm run desktop`을 사용하고, EXE는 배포할 때 만듭니다.

**로컬 EXE는 최신 버전 하나만 보관합니다.** 버전별 소스는 Git 커밋과 태그로 관리하며, 필요할 때 해당 버전을 내려받아 다시 빌드합니다. 사용자 사진·초안은 빌드 정리 대상에 포함하지 않습니다.

버전 올리기, 배포 파일 확인, GitHub 등록 절차는 [버전·배포 관리](docs/RELEASING.md)에 정리했습니다.

## 문서와 구조

| 위치 | 내용 |
| --- | --- |
| [사용 안내](docs/USAGE.md) | 설치, AI, 표지, 보관·삭제, 발행 상태와 검증 한계 |
| [변경 내역](CHANGELOG.md) | 버전별 기능·수정 이력 |
| [버전·배포 관리](docs/RELEASING.md) | 버전 규칙, EXE, GitHub 업로드 절차 |
| [글쓰기 규칙](docs/WRITING.md) | 캡처 분석, 말투 참고, 초안 형식 |
| [작업 지침](AGENTS.md) | 에이전트의 작업 범위와 자료 보호 |
| `desktop/` | Electron 앱과 티스토리 편집기 연결 |
| `web/` | 사진·초안 편집과 미리보기 화면 |
| `scripts/` | 로컬 API, AI 생성, 보관, 발행, 초기 설정·빌드 |
| `config/` | 저장소에 공유하는 기본 설정 템플릿 |
| `test/`, `validation/` | 자동 검사와 외부 발행 없는 편집기 검증 |
| `.github/workflows/` | Windows 검사와 수동 EXE 빌드 |

## 자료와 저장소

사진·초안·말투 원문·개인 설정·로그·로그인 자료·EXE는 `.gitignore`로 제외합니다. 공유할 설정은 `config/`의 예제를 수정하세요. EXE를 GitHub에 배포할 때는 저장소 코드에 넣지 않고 Releases에 첨부합니다.

개인 사용 중인 EXE에는 빌드 당시의 블로그 주소와 말투 기본값이 들어 있을 수 있습니다. 다른 사람에게 배포할 EXE는 새로 내려받은 소스와 공용 템플릿으로 빌드하거나 GitHub의 **Build Windows EXE** 작업으로 만드세요. 받은 사람은 앱의 **자료 폴더 열기**에서 `tistory.config.json`의 `blogUrl`을 자신의 주소로 바꾸고 앱을 다시 실행합니다.

앱 자료는 기본적으로 `%APPDATA%/H.Dev Studio/workspace`에 보관합니다. 메뉴 **작업실 → 자료 폴더 열기**에서 실제 위치를 확인할 수 있습니다. EXE 교체 후에도 자료를 유지하며, 티스토리 로그인은 앱을 다시 실행할 때 필요합니다.

GitHub용 자동 검사·수동 빌드 설정을 포함합니다. 공개 Release를 자동으로 만들지는 않습니다.
