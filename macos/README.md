# macOS 실행·빌드

Apple Silicon(`arm64`)과 Intel(`x64`) Mac을 지원합니다. Node.js 22 이상을 준비하고 `desktop/`, `scripts/`, `web/`의 공통 기능 코드를 실행합니다.

## 소스로 실행

저장소 루트의 터미널에서 실행합니다.

```sh
npm ci
npm run setup
npm run desktop
```

Finder에서 `macos/Start-App.command`를 열어 같은 개발 앱을 실행할 수 있습니다. 처음 실행할 때 의존성과 기본 설정을 준비하며 기존 설정은 유지합니다. 기존 루트 `Start-App.command`도 이 파일로 연결됩니다.

## DMG·ZIP 빌드

```sh
npm run build:mac      # 현재 Mac의 CPU
npm run build:mac:all  # Apple Silicon과 Intel 모두
# 같은 명령: ./macos/Build-App.command 또는 ./macos/Build-App.command --all
```

Mac에서 `macos/electron-builder.cjs` 설정을 읽고 `dist/<버전>/macos/`에 CPU별 DMG·ZIP, `SHA256SUMS.txt`, `release.json`을 만듭니다. 빌드 전에 [공통 검사](../README.md#검사)를 통과해야 합니다.

DMG를 열어 **H.Dev Studio.app**을 응용 프로그램 폴더로 옮깁니다. 서명·공증 없이 만든 앱은 첫 실행 때 시스템 설정 → 개인정보 보호 및 보안에서 허용이 필요할 수 있습니다.

자료는 `~/Library/Application Support/H.Dev Studio/workspace`, 개발 자료는 `H.Dev Studio Dev/workspace`에 보관합니다. 사진·초안·말투·로그인은 앱 배포 파일과 Git에 포함하지 않습니다. 창을 닫아도 Dock에 남으며 아이콘으로 작업실을 다시 열고 `⌘Q`로 완전히 종료합니다.

[사용 안내와 AI 설치](../docs/USAGE.md#mac에서-ai-연결) · [배포 관리](../docs/RELEASING.md) · [공통 소스 구조](../README.md#폴더-구조)
