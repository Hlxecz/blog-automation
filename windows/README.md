# Windows 실행·빌드

Windows 64비트와 Node.js 22 이상을 사용합니다. `desktop/`, `scripts/`, `web/`의 공통 기능 코드를 실행하며, 의존성과 설정은 저장소 루트에서 관리합니다.

## 소스로 실행

저장소 루트의 PowerShell에서 실행합니다.

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run desktop
```

`./windows/Start-App.ps1`도 같은 데스크톱 앱을 실행합니다. 처음 실행할 때 의존성과 기본 설정을 준비하며 기존 설정은 유지합니다. 실행 정책으로 스크립트가 차단되면 위 npm 명령을 사용하세요.

웹 개발 화면은 `./windows/Start-Web.ps1` 또는 기존 루트의 `./Start-App.ps1`로 엽니다. 티스토리 계정 연결·사진 발행·기존 글 수정은 데스크톱 앱을 사용합니다.

## EXE 빌드

```powershell
npm.cmd run build:exe
# 같은 명령: ./windows/Build-App.ps1
```

Windows에서 `windows/electron-builder.cjs` 설정을 읽고 `dist/<버전>/windows/`에 무설치 EXE, `SHA256SUMS.txt`, `release.json`을 만듭니다. 빌드 전에 [공통 검사](../README.md#검사)를 통과해야 합니다.

사진·초안·말투·로그인은 `%APPDATA%/H.Dev Studio/workspace`와 앱 전용 세션에 보관하며 EXE와 Git에 포함하지 않습니다. 개발 자료는 `H.Dev Studio Dev/workspace`로 분리합니다.

[사용 안내](../docs/USAGE.md) · [배포 관리](../docs/RELEASING.md) · [공통 소스 구조](../README.md#폴더-구조)
