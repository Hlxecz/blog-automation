# H.Dev Studio

<p align="center">
  <img src="docs/assets/hero.png" width="100%" alt="개발 캡처와 메모를 글로 정리하는 H.Dev Studio 콘셉트 일러스트">
</p>

<p align="center">
  <strong>캡처에 담긴 개발 과정을, 내 말투의 티스토리 글로.</strong>
</p>

<p align="center">Windows x64 · Codex / Claude Code CLI · Tistory</p>

개발 캡처와 메모를 분석해 초안을 만들고, 필요한 문단만 다듬어 검토한 뒤 티스토리에 발행하는 Windows 데스크톱 앱입니다.

<p align="center">
  <a href="https://github.com/Hlxecz/blog-automation/releases/tag/v0.8.0"><strong>Windows 앱 다운로드</strong></a>
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
- 사진·초안·편집 이력을 이 PC에 보관

## 사용 흐름

```text
캡처·메모 모으기 → 내 말투로 초안 만들기 → 필요한 칸만 수정
→ 미리보기로 검토 → 티스토리에 발행
```

처음 실행한 PC에서는 **티스토리 로그인**으로 발행할 블로그를 연결하고, **도움말 · AI 연결**에서 Codex 또는 Claude Code를 선택합니다. 자세한 순서는 [사용 안내](docs/USAGE.md)를 확인하세요.

## 다운로드

[H.Dev Studio 0.8.0](https://github.com/Hlxecz/blog-automation/releases/tag/v0.8.0)에서 `HDev-Studio-0.8.0-win-x64.exe`를 받습니다. Windows 64비트용 무설치 실행 파일입니다.

Windows에서 처음 받은 서명되지 않은 앱은 Microsoft Defender SmartScreen 안내가 나타날 수 있습니다. 배포 파일의 무결성은 Release에 함께 제공되는 `SHA256SUMS.txt`로 확인할 수 있습니다.

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

사용자 사진·초안·말투·계정 설정은 앱 자료 폴더에 저장하며 Git과 배포 EXE에 포함하지 않습니다. 기본 위치는 `%APPDATA%/H.Dev Studio/workspace`입니다.

## 개발 실행

Windows 64비트와 Node.js 22 이상이 필요합니다.

```powershell
npm ci
npm run setup
npm run desktop
```

`npm start`는 브라우저 개발 화면, `npm run desktop`은 티스토리 연결을 포함한 Electron 앱을 실행합니다. 배포용 EXE는 개발 확인을 마친 뒤 `npm run build:exe`로 만듭니다.

## 검사

```powershell
npm run release:check
npm test
npm run test:desktop
npm run test:categories
npm run test:writing
npm run test:account
npm run test:refine
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
