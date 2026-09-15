# 버전·배포 관리

## 무엇을 보관하나

- **소스 코드:** Git 커밋으로 변경 이력을 보관합니다.
- **EXE:** 로컬에는 최신 버전 하나만 보관합니다. 중요한 배포 파일은 필요할 때 GitHub Releases에 남길 수 있습니다.
- **테스트 빌드:** 계속 누적할 필요가 없습니다. 개발 중에는 `npm run desktop`으로 확인합니다.
- **사진과 초안:** 앱 자료 폴더에서 별도로 관리합니다. 저장소나 배포 파일의 버전 관리 대상이 아닙니다.

빌드 도구는 기존 EXE와 사용자 자료를 자동 삭제하지 않습니다. 오래된 빌드를 정리할 때는 해당 EXE가 실행 중이 아닌지 확인하고, 버전별 폴더 안의 `win-unpacked` 등 중간 산출물도 함께 정리할 수 있습니다. 모든 과거 EXE를 유지해야 변경 이력을 알 수 있는 것은 아닙니다.

## 버전 규칙

`package.json`의 `version`이 기준입니다. `package-lock.json`과 `CHANGELOG.md`에도 같은 버전을 사용합니다.

| 변경 | 예시 |
| --- | --- |
| 오류 수정 | `0.3.4` → `0.3.5` |
| 새 기능 묶음 | `0.3.4` → `0.4.0` |
| 정식 배포 전 확인 | `0.4.0-rc.1` |

작업 중 내역은 `CHANGELOG.md`의 `Unreleased`에 적습니다. 이미 배포한 버전의 EXE를 같은 이름으로 교체하지 않습니다. 개발 단계의 작은 수정마다 EXE를 만들거나 버전을 올릴 필요는 없습니다.

## 다음 버전 만들기

1. 작업을 마치고 변경 규모에 따라 버전을 올립니다. 아래는 패치 버전 예시입니다.

   ```powershell
   npm version patch --no-git-tag-version
   ```

2. `CHANGELOG.md`의 `Unreleased` 내용을 `## [새 버전] - YYYY-MM-DD` 항목으로 옮깁니다.
3. 검사 후 배포용 EXE를 만듭니다.

   ```powershell
   npm ci
   npm run setup
   npm run release:check
   npm test
   npm run test:desktop
   npm run build:exe
   ```

생성 파일:

```text
dist/<버전>/
  HDev-Studio-<버전>-win-x64.exe
  SHA256SUMS.txt
  release.json
```

`SHA256SUMS.txt`는 파일 내용이 바뀌었는지 비교하는 체크섬입니다. `release.json`에는 버전, 파일명, 크기와 체크섬을 기록합니다. 이미 있는 EXE의 확인 파일만 만들려면 `npm run release:checksums`를 실행합니다.

빌드에는 현재 로컬 `tistory.config.json`과 말투 프로필이 기본값으로 포함됩니다. 다른 사람에게 공유할 기본 앱은 새로 내려받은 소스에서 `npm run setup`으로 만든 공용 템플릿을 사용하거나, 아래 GitHub 수동 빌드로 만드세요. 사진·초안·로그인 자료는 빌드 대상에 포함하지 않습니다.

EXE 실행, 사진 업로드, 초안 열기·편집·표지, 자료 폴더 열기를 확인한 뒤 배포합니다. 자동 검증은 실제 블로그에 테스트 글을 발행하지 않습니다. 티스토리 화면 변경 등 실제 계정에서 확인하지 못한 항목은 배포 설명에 적습니다.

## GitHub에 다음 변경 올리기

저장소는 [Hlxecz/blog-automation](https://github.com/Hlxecz/blog-automation)이며 현재 공개 상태입니다. `origin`은 이 저장소를 가리킵니다. `v0.3.0`~`v0.3.4`는 배포본의 앱 소스에서 복원한 태그입니다. [복원 범위](HISTORY.md)를 확인하세요.

이 프로젝트 폴더 자체를 Git 저장소로 사용합니다. `git rev-parse --show-toplevel`이 드라이브 루트나 다른 프로젝트를 가리키면 먼저 위치를 확인합니다. Git의 소유권 검사를 피하려고 드라이브 전체를 신뢰하도록 설정하지 않습니다.

다음 변경을 검사한 뒤 아래 순서로 확인합니다.

```powershell
git status --short
git add .
git diff --cached --stat
git diff --cached --name-only
git diff --cached
```

사진·초안·개인 설정·말투 원문·로그·EXE가 포함되지 않았는지 확인한 뒤 실행합니다. 커밋 메시지는 실제 변경 내용을 적습니다.

```powershell
git commit -m "Describe the change"
git push origin main
```

공개 저장소의 재사용을 허용하려면 원하는 라이선스를 정해 `LICENSE`를 추가합니다. 현재는 라이선스를 임의로 지정하지 않았습니다.

## GitHub 검사와 배포

- **Windows checks:** `main`에 push하거나 PR을 만들면 설정 초기화, 버전 검사, Node 테스트와 Electron 편집기 검증을 실행합니다.
- **Build Windows EXE:** Actions 화면에서 수동으로 실행합니다. 같은 검사를 거쳐 EXE와 확인 파일을 다운로드 가능한 산출물로 보관합니다. 산출물은 14일 후 만료됩니다.
- 두 작업은 저장소 읽기 권한을 사용합니다. GitHub Release나 태그를 자동 생성하지 않습니다. 실행 결과는 저장소의 Actions 화면에서 확인합니다.

새 버전을 배포할 때는 **실제로 빌드한 소스 커밋**에 `v<버전>` 태그를 붙여 푸시합니다. 필요하면 해당 태그의 GitHub Release에 EXE·`SHA256SUMS.txt`·`release.json`을 첨부하고 변경 내역과 검증 범위를 적습니다. 이미 있는 태그를 덮어쓰지 않습니다. 이전 EXE의 소스가 없으면 현재 코드에 과거 버전 태그를 붙이지 않습니다.

워크플로는 공식 [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [upload-artifact](https://github.com/actions/upload-artifact)를 사용합니다.
