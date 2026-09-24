#!/usr/bin/env bash
# 시험 사이클 부하 테스트 단계 실행: jmeter non-GUI → .jtl + HTML Dashboard → summarize_jtl.py 판정
# 사용법: ./scripts/run-load.sh <인원 1~30> [rampup 90~120, 기본 90]   (5 → 10 → 20 → 30 순으로 실행)
#   LOAD_ACCOUNTS_CSV=/abs/path/accounts_24.csv → 지정 CSV(예: 특정 계정 1행)로 실행
# 대상 override(필요할 때만): LOAD_ORG LOAD_COURSE_ID LOAD_LECTURE_ID LOAD_QUIZ_ID LOAD_HOST_ACCOUNT LOAD_HOST_ORG
set -euo pipefail
cd "$(dirname "$0")/.."   # load-test(원본 part2_load_test) 기준

USERS="${1:?단계 인원 수를 주세요 (예: 5 / 10 / 20 / 30)}"
RAMPUP="${2:-90}"

# 인원 가드: 1~30
case "$USERS" in
  ''|*[!0-9]*) echo "인원 수는 양의 정수여야 합니다: $USERS"; exit 1 ;;
esac
USERS=$((10#$USERS))   # 공개 후 수정: 앞자리 0 제거. printf '%02d' 가 08·09를 8진수 오류로, 010을 step08로 처리하던 문제
[ "$USERS" -lt 1 ]  && { echo "인원 수는 1 이상이어야 합니다: $USERS"; exit 1; }
[ "$USERS" -gt 30 ] && { echo "최대 30명까지만 허용합니다: $USERS"; exit 1; }

# rampup 가드: 90~120초
case "$RAMPUP" in
  ''|*[!0-9]*) echo "rampup은 양의 정수(초)여야 합니다: $RAMPUP"; exit 1 ;;
esac
if [ "$RAMPUP" -lt 90 ] || [ "$RAMPUP" -gt 120 ]; then
  echo "rampup은 90~120초 범위여야 합니다: $RAMPUP"; exit 1
fi

STEP="step$(printf '%02d' "$USERS")"
# jmeter 탐색: 환경변수 JMETER > PATH > scoop(Windows) 순
if [ -z "${JMETER:-}" ]; then
  if command -v jmeter >/dev/null 2>&1; then JMETER="jmeter"
  elif [ -x "$HOME/scoop/shims/jmeter" ]; then JMETER="$HOME/scoop/shims/jmeter"
  else echo "jmeter를 찾을 수 없습니다. PATH에 추가하거나 JMETER=/path/to/jmeter 로 지정하세요"; exit 1
  fi
fi

# 계정 CSV: LOAD_ACCOUNTS_CSV 가 있으면 그 파일만, 없으면 data/accounts.csv. 실제로 쓸 파일 하나만 검사한다.
CSV="${LOAD_ACCOUNTS_CSV:-data/accounts.csv}"
[ -f "$CSV" ] || { echo "계정 CSV 없음: $CSV (data/accounts.csv 배치 필요, 커밋 금지)"; exit 1; }
# 계정 수 가드: 행이 인원보다 적으면 남는 스레드가 <EOF> 계정으로 로그인을 반복해 에러율을 오염시킨다 (example 복사만 하고 안 채운 경우)
ACCOUNTS="$(($(grep -c . "$CSV") - 1))"
[ "$ACCOUNTS" -ge "$USERS" ] || { echo "$CSV 계정 수($ACCOUNTS)가 인원($USERS)보다 적습니다"; exit 1; }

mkdir -p results reports

# 같은 단계를 다시 돌려도 이전 결과를 지우지 않는다. 생성 시각을 붙여 history/ 로 옮긴다 (Kill Switch 중단 뒤 재실행 등 1차 결과도 보고서 근거가 된다)
if [ -e "results/$STEP.jtl" ] || [ -e "reports/$STEP" ]; then
  if [ -e "results/$STEP.jtl" ]; then STAMP="$(date -r "results/$STEP.jtl" +%Y%m%d-%H%M%S)"; else STAMP="$(date -r "reports/$STEP" +%Y%m%d-%H%M%S)"; fi
  mkdir -p results/history reports/history
  [ -e "results/$STEP.jtl" ] && mv "results/$STEP.jtl" "results/history/${STEP}_$STAMP.jtl"
  [ -e "reports/$STEP" ]     && mv "reports/$STEP"     "reports/history/${STEP}_$STAMP"
  echo "이전 결과 보관: results/history/${STEP}_$STAMP.jtl / reports/history/${STEP}_$STAMP"
fi

EXTRA=()
[ -n "${LOAD_ORG:-}" ]          && EXTRA+=("-Jorg=$LOAD_ORG")
[ -n "${LOAD_COURSE_ID:-}" ]    && EXTRA+=("-Jcourse_id=$LOAD_COURSE_ID")
[ -n "${LOAD_LECTURE_ID:-}" ]   && EXTRA+=("-Jlecture_id=$LOAD_LECTURE_ID")
[ -n "${LOAD_QUIZ_ID:-}" ]      && EXTRA+=("-Jquiz_id=$LOAD_QUIZ_ID")
[ -n "${LOAD_HOST_ACCOUNT:-}" ] && EXTRA+=("-Jaccount_api=$LOAD_HOST_ACCOUNT")
[ -n "${LOAD_HOST_ORG:-}" ]     && EXTRA+=("-Jorg_api=$LOAD_HOST_ORG")
# 계정 CSV 교체(특정 계정만 쓰는 스모크 등). 존재·행 수는 위에서 load-test/ 기준으로 검사했다.
# 공개 후 수정: JMeter는 상대 경로를 plans/ 기준으로 풀므로, 상대 경로면 ../ 를 붙여 검사한 파일과 같은 파일을 넘긴다
if [ -n "${LOAD_ACCOUNTS_CSV:-}" ]; then
  case "$CSV" in /*|[A-Za-z]:*) ;; *) CSV="../$CSV" ;; esac
  EXTRA+=("-Jaccounts_csv=$CSV")
fi

# APDEX satisfied 1s / tolerated 4s
"$JMETER" -n -t plans/exam_cycle.jmx \
  -Jusers="$USERS" -Jrampup="$RAMPUP" \
  -Jjmeter.reportgenerator.apdex_satisfied_threshold=1000 \
  -Jjmeter.reportgenerator.apdex_tolerated_threshold=4000 \
  ${EXTRA[@]+"${EXTRA[@]}"} \
  -l "results/$STEP.jtl" -e -o "reports/$STEP"

echo "완료: results/$STEP.jtl"

# 합격 판정 (Latency 기준)
SUMMARY_STATUS=0
PY="$(command -v python3 || command -v python || true)"
if [ -n "$PY" ]; then
  if "$PY" scripts/summarize_jtl.py "results/$STEP.jtl" --users "$USERS"; then
    SUMMARY_STATUS=0
  else
    SUMMARY_STATUS=$?
    echo "  합격 판정 실패(종료 코드 $SUMMARY_STATUS). 위 출력 확인"
  fi
else
  SUMMARY_STATUS=2
  echo "  (python 없음 — 합격 판정은 scripts/summarize_jtl.py 를 별도 실행)"
fi
echo "리포트: reports/$STEP/index.html"
exit "$SUMMARY_STATUS"
