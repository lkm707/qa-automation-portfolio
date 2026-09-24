# Part 2 — 시험 사이클 부하 테스트 (JMeter)

> 공개본 안내: 팀 저장소의 `part2_load_test/`를 옮긴 것입니다. 서버 주소가 예시 값이라 그대로는 실행되지 않습니다.

학습자를 5→10→20→30명으로 늘리며 시험 응시 사이클의 에러율·Latency·TPS를 재고, 평균 Latency가 1초를 넘기 시작하는 인원(변곡점)을 찾는다.
교육 과정이 정한 부하 하드리밋과 과제 요구사항(30명 동시 접속에서 에러율 1% 미만, 평균 1초 이내 목표)을 따른다.

## 규칙
- 최대 30명, 한 번에 30 금지. 플랜이 `min(30, users)`로 캡하고 스크립트는 1\~30만 받는다.
- 요청마다 3\~5초 대기, Loop 3회, Ramp-up 90\~120초(기본 90). 단계당 약 3분.
- 오류 발생 시 Thread Group의 `Stop Test Now`로 전체를 중단한다(HTTP 오류·타임아웃·assertion 실패 포함). 별도 Kill Switch도 5xx 또는 elapsed/Latency 60초 이상 응답에서 전체를 중단한다. 타임아웃 connect 5초 / response 60초, 재시도 없음.
- 팀당 1명이 지정 슬롯에 수동 실행한다. CI에는 넣지 않는다.

## 준비
1. JMeter 5.6.x(`jmeter` PATH 또는 `JMETER=` 지정), Python 3
2. `data/accounts.csv`: `accounts.csv.example`을 복사해 `login_id,password` 30행 (커밋 금지)
3. 30개 계정이 course 731에 학습자로 등록돼 있을 것
4. lecture 1585의 "테스트 셀프 재응시 허용"이 ON인지 확인. 프로젝트 공통 전제(part3 TC-EX-05-01·UI 4번도 ON 기준)이므로 끝나도 끄지 않는다

## 시나리오
`course/get → test/enter → test/start → quiz/response/add → test/stop → test/reset/by_self` × Loop 3.
가이드의 4단계에 start를 넣은 것은 start 없이 stop을 호출하면 `in_progress_test`로 실패하기 때문이다(dev 실측).
모든 단계는 `_result.status == ok`로 검증한다. org-api는 실패도 HTTP 200이라 상태코드만으로는 판정할 수 없다.

```
Test Plan  (UDV: org, course_id, lecture_id, quiz_id, account_api, org_api — -J로 override)
└── Thread Group  min(30, users) · ramp-up · Loop 3
    ├── Kill Switch (JSR223 Listener)
    ├── HTTP Request Defaults / HTTP Header Manager (Bearer)
    ├── Once Only Controller
    │   ├── CSV Data Set Config (accounts.csv, 스레드당 1행)
    │   └── Auth → access_token
    └── Transaction Controller "시험 사이클"
        └── 0~5 샘플러, 각각 Assert + Think Time 3~5s
```
CSV Data Set Config는 Once Only 안에 둔다. Thread Group 직속이면 루프마다 행을 소모해 30행으로 30명 × 3루프를 채우지 못한다.


## 실행
```bash
./scripts/run-load.sh 1      # 스모크: 1명 × Loop 3 (약 1.5분). Loop 는 플랜에 3으로 고정
./scripts/run-load.sh 5      # 이어서 10, 20, 30
python scripts/compare_dashboards.py reports/step05 reports/step10 reports/step20 reports/step30 --out reports/comparison.md
python scripts/cycle_timeline.py results/step30.jtl --out reports/step30_cycles.md   # 스레드별 완료 사이클(6단계 순서대로 성공)·동시 진행 구간. --accounts 는 추정 매핑
```
대상을 바꿀 때는 `LOAD_ORG LOAD_COURSE_ID LOAD_LECTURE_ID LOAD_QUIZ_ID LOAD_HOST_ACCOUNT LOAD_HOST_ORG`, 계정 CSV는 `LOAD_ACCOUNTS_CSV`(절대 경로) 환경변수. 특정 계정 하나만 쓰려면 그 행만 담은 CSV를 `data/accounts_<이름>.csv`로 만들어 지정한다(git 제외).

## 결과
- `results/stepNN.jtl`: 원시 결과. 실행 직후 `summarize_jtl.py`가 설정 인원 기준으로 판정한다 (합격선 에러율 1% 미만·평균 Latency 60초 이내, 목표 1초 이내). 결과에 나타나지 않은 사용자가 있으면 미실행으로 FAIL이다.
- `reports/stepNN/index.html`: HTML Dashboard.
- `reports/comparison.md`: 4단계 비교와 변곡점 후보. 정상상태는 활성 스레드가 최대의 90% 이상으로 끊기지 않고 이어진 가장 긴 구간으로 잡고, 실제 최대·평균 동시 인원을 함께 적는다 (대기 3\~5초 때문에 설정 인원보다 작다).
- 샘플 수가 설정 인원 × 19(HTTP)와 다르면 스레드가 중간에 죽은 것이므로 먼저 원인을 본다.
- 요약과 단계 비교는 Latency 누락(컬럼 없음·빈 칸) 또는 실패 샘플의 0ms를 해당 샘플의 `elapsed`로 보수적으로 대체한다. 정상 응답의 0ms와 기록된 양수 Latency는 유지한다. 판정용 보정 평균·원본 평균(누락 제외)·대체 건수를 함께 표시하며, 원본 JTL은 바꾸지 않는다. 요약의 `latFix`는 HTTP 전체·단계별 건수, 비교 표는 정상상태 구간의 건수다.
- `run-load.sh`는 요약 판정의 종료 코드를 그대로 반환한다(PASS 0, FAIL 1, 빈 결과 2). Python이 없어 판정하지 못한 경우도 2로 종료한다. 리포트 경로는 실패 때도 출력한다.
- 같은 단계를 다시 돌리면 이전 결과는 지우지 않고 생성 시각을 붙여 `results/history/stepNN_<시각>.jtl`, `reports/history/stepNN_<시각>/`로 옮긴다. 최신 실행이 `stepNN`이고, 비교는 대표 실행의 `stepNN` 폴더로 한다. Kill Switch로 중단된 1차 결과도 이렇게 남는다.
- `results/`·`reports/`는 재생성 산출물이라 git에 올리지 않는다. 제출용 결과(단계별 JTL·HTML Dashboard·비교표·캡처)는 결과 보고서와 함께 별도 증거 폴더로 묶어 제출한다.

## 중단과 복구
Kill Switch가 발동하거나 `Ctrl+C`로 멈추면 일부 계정이 시험 상태 5(입장)·10(시작)·20(완료)에 남는다.
교육자 계정으로 `POST lecture/test/reset/`에 `lecture_id`와 `user_ids`(JSON 배열 문자열, 예: `[<학생 user id>]`)를 넣어 일괄 reset 한다(9/9 실측: 학생 상태 5→0).
학생 id는 `course/user/list/?course_id=731&is_for_tutoring=false&offset=0&count=100`(두 파라미터 필수, count는 100 이하)의 `users[].id`, 또는 학습자 본인 토큰의 `user/get/` 응답 `user.id`로 확인한다.
셀프 재응시 허용 설정은 공통 전제이므로 그대로 둔다.
