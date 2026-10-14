# H.Dev Studio

<p align="center">
  <img src="docs/assets/hero.png" width="100%" alt="개발 캡처와 메모를 글로 정리하는 H.Dev Studio 콘셉트 일러스트">
</p>

<p align="center">
  <strong>캡처에 담긴 개발 과정을, 내 말투의 티스토리 글로.</strong>
</p>

<p align="center">Windows x64 / macOS arm64·x64 · Codex / Claude Code CLI · Tistory</p>

개발 캡처와 메모를 분석해 초안을 만들고, 필요한 문단만 다듬어 검토한 뒤 티스토리에 발행하는 Windows와 macOS 데스크톱 앱입니다. 이미 발행한 글도 불러와 같은 주소에서 수정할 수 있습니다.

<p align="center">
  <a href="https://github.com/Hlxecz/blog-automation/releases/tag/v0.9.5"><strong>Windows 앱 다운로드</strong></a>
  · <a href="docs/FEATURES.md">기능과 실제 화면</a>
  · <a href="docs/USAGE.md">사용 안내</a>
  · <a href="CHANGELOG.md">변경 내역</a>
</p>

## 화면

![사진과 메모를 모으고 초안을 검토하는 H.Dev Studio 작업실](docs/assets/workspace.png)

[실제 화면으로 기능 자세히 보기 →](docs/FEATURES.md)

## 주요 기능

- 개발 캡처·메모·참고 링크를 함께 분석해 블로그 초안 생성
- Codex 또는 Claude Code CLI를 선택해 본인 계정으로 연결
- 기본 블로그 말투와 카테고리별 글쓰기 프롬프트 적용
- 한 칸·여러 칸·전체 선택 AI 글 다듬기와 되돌리기
- 문단·소제목·코드·사진·표의 드래그 이동과 중간 삽입
- 자동 목차, 팁·주의 상자, 표지와 GitHub 정보 카드
- 로그인한 티스토리 블로그·카테고리 연결과 공개 발행
- 공개 글을 작업실로 불러와 원문 형식으로 미리보고 같은 글 주소에 수정 반영
- 가져온 글을 로컬에서 삭제한 뒤에도 다시 가져오기, 앱 재실행 후 로그인 세션 재사용
- 사진·초안·편집 이력을 이 PC에 보관

## 사용 흐름

```text
캡처·메모 모으기 → 내 말투로 초안 만들기 → 필요한 칸만 수정
→ 미리보기로 검토 → 티스토리에 발행
```

처음 실행한 PC에서는 **티스토리 로그인**으로 발행할 블로그를 연결하고, **도움말 · AI 연결**에서 Codex 또는 Claude Code를 선택합니다. 자세한 순서는 [사용 안내](docs/USAGE.md)와 [실제 블로그 사용 방법 글](https://hlxecz.tistory.com/30)을 확인하세요.

이미 올린 글은 **티스토리 글 → 작업실에서 수정**으로 가져옵니다. 문장과 표·주의 상자를 확인하고 **기존 글에 수정 반영**을 누르면 새 글을 만들지 않고 원래 주소에 저장합니다. 로컬 보관함에서 삭제한 글은 다시 가져올 수 있습니다.

## 다운로드

[H.Dev Studio 0.9.5](https://github.com/Hlxecz/blog-automation/releases/tag/v0.9.5)에서 `HDev-Studio-0.9.5-win-x64.exe`를 받습니다. Windows 64비트용 무설치 실행 파일입니다.

Windows에서 처음 받은 서명되지 않은 앱은 Microsoft Defender SmartScreen 안내가 나타날 수 있습니다. 배포 파일의 무결성은 Release에 함께 제공되는 `SHA256SUMS.txt`로 확인할 수 있습니다.

## Mac에서 사용하기

macOS 지원은 **0.10.0** 소스부터 포함됩니다. Apple Silicon(M1 이상)은 `arm64`, Intel Mac은 `x64` 파일을 사용합니다. 기존 Windows 0.9.5 Release에는 Mac 파일이 없습니다.

Node.js 22 이상을 설치한 뒤 터미널에서 실행합니다.

```sh
npm ci
npm run setup
npm run desktop
```

Finder 실행용 앱을 만들려면 Mac에서 `npm run build:mac`을 실행합니다. `dist/0.10.0/macos/HDev-Studio-0.10.0-mac-<CPU>.dmg`를 열어 **H.Dev Studio.app**을 응용 프로그램 폴더로 옮깁니다. 서명·공증 인증서 없이 빌드한 파일은 macOS가 실행을 제한할 수 있습니다. 직접 빌드한 파일임을 확인한 뒤 시스템 설정 → 개인정보 보호 및 보안에서 허용합니다.

사진·메모·참고자료, AI 초안과 부분 다듬기, 카테고리·말투 설정, 표지·목차·GitHub 카드, 티스토리 로그인·사진 발행·기존 글 수정은 Windows와 같은 코드를 사용합니다. AI 설치 명령은 Mac용으로 표시하며 Homebrew·기본 설치·Node 버전 관리자 경로를 탐색합니다. 창을 닫아도 앱은 Dock에 남고, Dock 아이콘을 클릭하면 같은 작업실을 다시 엽니다. 완전히 종료하려면 `⌘Q`를 사용합니다.

## 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| 데스크톱 | Electron 44, Chromium |
| 화면 | HTML, CSS, JavaScript |
| 로컬 서버·자동화 | Node.js 22 |
| AI 연결 | Codex CLI, Claude Code CLI |
| 본문 분석 | Cheerio |
| 발행 대상 | Tistory 편집 화면 |
| 자동 검사 | Node Test Runner, Electron UI 검증, GitHub Actions |

사용자 사진·초안·말투·계정 설정은 앱 자료 폴더에 저장하며 Git과 배포 앱에 포함하지 않습니다. Windows 기본 위치는 `%APPDATA%/H.Dev Studio/workspace`, macOS는 `~/Library/Application Support/H.Dev Studio/workspace`입니다.

## 폴더 구조

```text
blog-automation/
├─ desktop/                 # 공통 Electron 창·티스토리 연결
├─ scripts/                 # 공통 AI·자료 보관·API·발행 처리
├─ web/                     # 공통 작업실·편집·미리보기
├─ config/                  # 공유용 기본 설정과 말투
├─ windows/                 # Windows 실행·빌드 스크립트와 설정
├─ macos/                   # macOS 실행·빌드 스크립트와 설정
├─ test/ · validation/      # 공통 자동 검사와 모의 편집기
└─ dist/<버전>/
   ├─ windows/              # Windows EXE·체크섬 (로컬 빌드 결과)
   └─ macos/                # Mac DMG·ZIP·체크섬 (로컬 빌드 결과)
```

작업실과 기능 코드를 한 번 수정하면 두 운영체제에 적용됩니다. 운영체제에 따른 CLI 경로·메뉴·창 동작은 공통 코드에서 처리하고 실행·빌드 설정과 안내를 두 폴더에 나눴습니다. 의존성과 버전은 루트의 `package.json`·`package-lock.json`에서 함께 관리합니다.

| 운영체제 | 소스 실행 | 빌드 | 결과 위치 |
| --- | --- | --- | --- |
| [Windows 안내](windows/README.md) | `windows/Start-App.ps1` | `npm run build:exe` | `dist/<버전>/windows/` |
| [macOS 안내](macos/README.md) | `macos/Start-App.command` | `npm run build:mac` | `dist/<버전>/macos/` |

`dist/`와 개인 자료는 Git에 올리지 않습니다. 기존 Windows 다운로드는 0.9.5 Release이며, 0.10.0 Mac 파일은 소스로 빌드하거나 수동 빌드 워크플로의 산출물로 받을 수 있습니다.

## 개발 실행

Windows 64비트 또는 macOS와 Node.js 22 이상이 필요합니다.

```powershell
npm ci
npm run setup
npm run desktop
```

`npm start`는 브라우저 개발 화면, `npm run desktop`은 티스토리 연결을 포함한 Electron 앱을 실행합니다. 배포용 Windows EXE는 `npm run build:exe`, Mac DMG·ZIP은 `npm run build:mac`으로 만듭니다. macOS의 모든 CPU용 파일은 `npm run build:mac:all`로 빌드합니다.

## 검사

```powershell
npm run release:check
npm test
npm run test:desktop
npm run test:categories
npm run test:writing
npm run test:setup
npm run test:account
npm run test:refine
npm run test:existing
# macOS 추가 검사: npm run test:lifecycle
```

자동 검사는 임시 자료와 모의 편집기를 사용하며 실제 티스토리에 테스트 글을 발행하지 않습니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [기능과 실제 화면](docs/FEATURES.md) | 부분 글 수정, 중간 삽입, 미리보기, 말투 설정 |
| [사용 안내](docs/USAGE.md) | 설치부터 티스토리 발행까지 |
| [변경 내역](CHANGELOG.md) | 버전별 추가 기능과 수정 |
| [트러블슈팅](docs/TROUBLESHOOTING.md) | 제작 과정의 문제·원인·해결 |
| [글쓰기 규칙](docs/WRITING.md) | 캡처 분석과 초안 작성 기준 |
| [프롬프트 조사](docs/WRITING-PROMPT-RESEARCH.md) | 카테고리별 예시의 참고 근거 |
| [버전·배포 관리](docs/RELEASING.md) | 검사, EXE 빌드, GitHub 배포 절차 |
| [소스 이력](docs/HISTORY.md) | 복원한 과거 버전의 범위 |

저장소: [Hlxecz/blog-automation](https://github.com/Hlxecz/blog-automation)
