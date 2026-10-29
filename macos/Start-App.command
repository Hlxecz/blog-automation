#!/bin/zsh -l
set -e
cd "${0:A:h}/.."
if ! command -v npm >/dev/null || ! command -v node >/dev/null; then
  print 'Node.js 22 이상을 설치한 뒤 다시 실행해 주세요: https://nodejs.org/en/download'
  read '?Enter를 누르면 닫습니다. '
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 이상이 필요합니다."); process.exit(1); }'
if [[ ! -d node_modules/electron ]]; then npm ci; fi
npm run setup
exec npm run desktop
