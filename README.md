# H.Dev Studio 0.3.4

표지 선택·업로드와 대표 이미지 확인

## 복원한 버전 기록

이 태그는 남아 있는 배포본에서 앱 소스를 추출해 복원한 기록입니다. 당시 개발 커밋을 복구한 것은 아닙니다. desktop/, scripts/, web/의 앱 코드는 배포본에서 복원하고 텍스트 줄바꿈을 LF로 정리했습니다. 공유를 위해 개인 블로그 기본 링크와 표시 이름을 공용 값으로 교체했으며 변경한 파일은 복원 기록의 redactions에 표시했습니다. 실행용 package 설정·잠금 파일·setup 명령과 공용 설정 예제는 저장소 정리 시 추가했습니다. 당시 테스트 소스는 배포본에 없어 포함하지 않았습니다. 개인정보가 포함된 설정과 말투 원문도 제외했습니다.

## 실행

Windows, Node.js 22 이상에서:

```powershell
npm ci
npm run setup
# tistory.config.json의 blogUrl과 style/profile.md를 준비합니다.
npm run desktop
```

이 버전 이후의 수정 사항은 포함하지 않습니다. 새 작업에는 main 브랜치의 최신 소스를 사용하세요. 원본 소스 해시는 docs/recovered-source.json에 기록했습니다.
