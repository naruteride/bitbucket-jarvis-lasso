# Bitbucket Jarvis Lasso

로컬 브라우저 패널에서 Bitbucket PR 생성/머지와 Jarvis 빌드/배포 요청을 순서대로 실행하는 작은 Node.js 앱입니다.

## 실행

1. `start.bat`을 더블클릭합니다.
2. 첫 실행에서 전용 Chrome/Edge 프로필이 열리면 Bitbucket/Jarvis SSO 로그인을 직접 완료합니다.
3. 패널에서 프로젝트, 브랜치, PR 처리 여부, WAS/WEB 대상, 빌드/배포 모드를 선택하고 실행합니다.

비밀번호나 토큰은 저장하지 않습니다. 최근 브랜치, 마지막 선택값, 브라우저 실행 경로만 `data/state.json`에 저장됩니다.

## 로그인 프로필

이 앱은 평소 사용하는 Chrome 프로필이 아니라 `data/browser-profile` 전용 프로필을 사용합니다. 일반 Chrome에 Atlassian/Jarvis 로그인이 되어 있어도 자동화 창에는 공유되지 않습니다.

처음 실행하거나 세션이 만료되면 자동화 창에서 직접 로그인한 뒤 다시 실행하세요. 실패 시에는 현재 화면을 확인하고 로그인할 수 있도록 브라우저 창을 닫지 않습니다. 같은 서버 프로세스에서 다시 실행하면 남겨둔 자동화 창을 재사용합니다.

## 개발 명령

```powershell
npm.cmd install
npm.cmd test
npm.cmd start
```

PowerShell 실행 정책 때문에 `npm` 대신 `npm.cmd`를 사용합니다.

## 범위

- 대상 브랜치는 `develop` 고정입니다.
- Jarvis는 빌드/배포 요청 접수 신호까지만 확인합니다.
- WAS와 WEB을 둘 다 선택하면 WEB을 먼저 실행합니다.
- 단계별 대기시간은 패널에서 설정하며 기본값은 1초입니다.
- 브랜치 목록 자동 조회와 최종 빌드 완료 폴링은 v1 범위 밖입니다.
