#!/usr/bin/env bash
# 공개본 안내: 팀 저장소 구조(part1_api_automation/{collections,environments,scripts}) 기준 원본입니다. 환경 파일(environments/)과 리포트 생성 스크립트(scripts/report.sh)는 넣지 않았고 scrub.js 는 이 파일과 같은 폴더에 있어, 이 저장소에서는 그대로 실행되지 않습니다.
# 팀 통합 실행: collections/partN_collection.json 을 짝 environments/partN_env.json 과 함께
# 순차 실행 → 공용 allure-results 에 누적 → 통합 Allure 리포트(164 TC) 생성
#
# 사용법:
#   LXP_STUDENT_ID=... LXP_STUDENT_PW=... LXP_EDU_ID=... LXP_EDU_PW=... ./scripts/run-all.sh   (보통 리포 루트 .env 로 준다)
#
# 팀원은 collections/ 와 environments/ 에 partN_collection.json / partN_env.json 을
# 넣기만 하면 자동으로 잡혀 실행된다.
set -euo pipefail
cd "$(dirname "$0")/.."   # part1_api_automation 기준

# 리포 루트의 node_modules/.bin 을 PATH 앞에 둔다.
#   allure 리포터는 리포 루트에 설치돼 있어, 전역 newman 만 PATH 에 있으면
#   -r 에 allure 를 줘도 조용히 무시되고 allure-results 가 비어 나온다.
export PATH="$PWD/../node_modules/.bin:$PATH"

# 리포 루트에 .env 가 있으면 자동 로드 (LXP_STUDENT_PW 등)
if [ -f ../.env ]; then set -a; . ../.env; set +a; fi

: "${LXP_STUDENT_PW:?LXP_STUDENT_PW 필요 (../.env 또는 환경변수)}"
: "${LXP_EDU_PW:?LXP_EDU_PW 필요 (../.env 또는 환경변수)}"

# allure-results 초기화 (이전 실행 결과 섞임 방지)
rm -rf allure-results reports
mkdir -p allure-results reports

shopt -s nullglob
found=0
for c in collections/*_collection.json; do
  n="$(basename "$c" _collection.json)"        # part3 추출
  env="environments/${n}_env.json"
  if [ ! -f "$env" ]; then
    echo "⚠ 짝 환경 파일 없음: $env  → $c 건너뜀"
    continue
  fi
  found=$((found+1))
  echo "▶ [$n] 실행: $c  (env: $env)"
  # 일부 TC가 실패해도 다음 컬렉션 계속 실행
  # --export-environment: 컬렉션이 남긴 KILL_SWITCH_TRIPPED 를 읽기 위한 임시 파일 (토큰이 들어 있으므로 확인 즉시 삭제)
  envout="reports/.${n}_env_out.json"
  newman run "$c" -e "$env" \
    --env-var "student_id=${LXP_STUDENT_ID:-}" \
    --env-var "edu_id=${LXP_EDU_ID:-}" \
    --env-var "vault:student_pw=$LXP_STUDENT_PW" \
    --env-var "vault:edu_pw=$LXP_EDU_PW" \
    --delay-request 150 \
    -r cli,allure,htmlextra \
    --reporter-htmlextra-export "reports/${n}.html" \
    --export-environment "$envout" \
    || echo "  ⚠ [$n] 일부 실패(계속 진행) — 통합 리포트에서 확인"
  # 5xx Kill Switch (project2 README '공유 dev 서버를 지키려고 넣은 장치'): 컬렉션 스크립트가 5xx 를 보고 KILL_SWITCH_TRIPPED 를 남기면
  # 남은 컬렉션은 서버를 더 치지 않는다. 컬렉션 안에서는 setNextRequest(null) 로 이미 멈춰 있다.
  tripped_code="$(node -e '
    try { const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
          const v = (e.values || []).find(x => x.key === "KILL_SWITCH_TRIPPED");
          process.stdout.write(v && v.value ? String(v.value) : ""); } catch (err) {}' "$envout" 2>/dev/null || true)"
  rm -f "$envout"
  if [ -n "$tripped_code" ]; then
    echo "🛑 [$n] 서버 ${tripped_code} 감지 — Kill Switch 발동. 남은 컬렉션 실행을 중단합니다 (담당자 보고 필요)"
    tripped=1
    break
  fi
done

if [ "$found" -eq 0 ]; then
  echo "실행할 컬렉션이 없습니다. collections/partN_collection.json 을 넣어주세요."
  exit 1
fi

# 로컬 산출물도 공유되므로 CI 와 같은 규칙으로 민감정보(비밀번호·JWT·Bearer)를 가린다.
#   로그인 요청 본문의 비밀번호가 allure-results 첨부와 htmlextra 본문에 그대로 실리기 때문.
#   치환에 실패한 파일이 있으면 공유용 리포트를 만들지 않는다 — 가려지지 않은 리포트가 나가는 것이 리포트가 없는 것보다 나쁘다.
if ! node ./scripts/scrub.js allure-results reports; then
  echo "🛑 민감정보 치환 실패 — allure-results/reports 에 계정 정보가 남았을 수 있어 통합 리포트를 생성하지 않습니다. 위 파일을 확인한 뒤 report.sh 를 따로 실행하세요."
  exit 3
fi

echo "▶ 통합 Allure 리포트 생성 ($found개 컬렉션)"
./scripts/report.sh

# Kill Switch 로 중단된 실행은 리포트는 남기되 실패 코드(2)로 끝낸다 (호출하는 쪽이 정상 완료와 구분하도록. 팀 Jenkinsfile 은 `|| true` 로 호출해 빌드 상태에는 반영되지 않았다)
if [ "${tripped:-0}" = 1 ]; then
  echo "🛑 5xx Kill Switch 로 중단된 실행입니다. 리포트는 실행된 부분까지만 담고 있습니다."
  exit 2
fi
