#!/bin/zsh -l
set -e
cd "${0:A:h}/.."
# --all 옵션으로 Apple Silicon과 Intel 파일을 함께 만듭니다.
exec npm run build:mac -- "$@"
