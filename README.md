# QA 자동화 포트폴리오 코드 · 이경민

엘리스 QA 자동화 엔지니어 트랙 6기(2026.05–09)에서 진행한 두 팀 프로젝트 가운데 **제가 맡아 작성한 코드**를 모은 저장소입니다.

| 폴더 | 프로젝트 | 내용 |
|---|---|---|
| [`project1-helpy-login`](project1-helpy-login) | 1차 · AI 헬피챗 UI 자동화 (4명 팀) | Selenium·pytest 로그인 자동화 29건, Page Object |
| [`project2-lxp-testflow/api-part3`](project2-lxp-testflow/api-part3) | 2차 · Elice LXP TestFlow (3명 팀) | Postman·Newman part3 컬렉션(공개본 49 TC), 실행·치환 스크립트 |
| [`project2-lxp-testflow/load-test`](project2-lxp-testflow/load-test) | 2차 | JMeter 시험 응시 6단계 부하 계획, JTL 판정·분석 스크립트 |
| [`project2-lxp-testflow/ui-e2e`](project2-lxp-testflow/ui-e2e) | 2차 | Playwright E2E 7개 흐름 10건 |

## 먼저 알려 드릴 것

- **발췌본입니다.** 팀 저장소(교육 과정 내부 GitLab)에서 제 담당 부분만 옮겼습니다. 팀 공용 설정(conftest, 환경 파일, CI)은 넣지 않아 이 저장소만으로는 실행되지 않습니다.
- **공개용으로 값을 바꿨습니다.**
  - 서버 주소는 `*.example.invalid`, 테스트 계정은 `example.com`, 클래스 ID는 `0000…`으로 바꿨고, 테스트 로직은 그대로입니다.
  - 비밀번호는 원래부터 Git에서 제외한 `.env`와 계정 CSV로만 다뤄 코드에 없고, 토큰은 실행 중 로그인 응답에서 받아 씁니다.
- **2차에서 발견한 결함의 재현 절차는 이 저장소에 싣지 않았습니다.** 대상 서비스에서 조치됐는지 확인하지 못했기 때문입니다. 그 결함을 확인하는 TC도 같은 이유로 뺐고, 운영 서버 대상 부하 계획은 실행하지 않은 초안이라 넣지 않았습니다. 1차의 이메일 길이 결함(TID 12)은 257자 이메일에 입력 안내 대신 서버 오류 문구가 뜨는 입력 검증 결함으로, 권한·개인정보와 관련이 없어 테스트와 설명을 남겼습니다.
- **테스트 대상은 교육 과정의 개발(dev) 환경**입니다. 부하 테스트는 최대 30명 하드리밋과 Kill Switch(5xx 1건 또는 60초 응답 1건이면 즉시 중단) 안에서만 돌렸습니다.
- **작성 비중**은 각 폴더 README에 적었습니다. 팀원이 고친 부분이 있는 파일은 그 사실을 밝혔습니다.
- **공개 후 한 번 더 검토했습니다(2026.09.24).** 코드와 어긋난 주석·문서(옮기면서 생긴 것과 원본부터 있던 것)를 바로잡고, 부하 실행 스크립트 `run-load.sh`의 인자 처리 버그 2건(앞자리 0이 붙은 인원 수, 상대 경로 계정 CSV)을 고쳤습니다. 테스트 판정 로직은 프로젝트에서 돌린 그대로 두었고, 다시 보며 찾은 한계는 해당 폴더 README(`project1-helpy-login`, `project2-lxp-testflow/ui-e2e`)에 적었습니다.
- **AI 도구 사용:** 코드는 Claude Code 같은 AI 코딩 도구를 함께 써서 작성했고, 무엇을 검증할지와 판정 기준, 결과 확인은 제가 했습니다.
- 열람 목적으로 공개합니다(별도 라이선스 없음).

## 한눈에 보는 대표 코드

- 과도기 오류 문구에 속지 않는 판정: [`settled_error_text()`](project1-helpy-login/pages/login_ui_page.py#L128)
- 로그인 성공을 아이콘과 도메인으로 교차 확인: [`wait_logged_in()`](project1-helpy-login/pages/main_page.py#L38)
- 5xx 1건 또는 60초 응답 1건이면 전체 중단하는 Kill Switch: [`exam_cycle.jmx`](project2-lxp-testflow/load-test/plans/exam_cycle.jmx#L56-L74)
- HTTP 200으로 오는 실패를 `_result.status`로 판정: [`exam_cycle.jmx`](project2-lxp-testflow/load-test/plans/exam_cycle.jmx#L211-L218)
- 부하 결과 판정(에러율·평균 Latency·샘플 수·중단 조건): [`summarize_jtl.py`](project2-lxp-testflow/load-test/scripts/summarize_jtl.py#L125)
- 일정 조회 실패를 ‘일정 없음’으로 통과시키지 않는 UI 판정: [`watchScheduleLookups()`](project2-lxp-testflow/ui-e2e/utils/flows.js#L387)
- 재응시 응답 본문의 `_result.status`까지 확인: [`flows.js`](project2-lxp-testflow/ui-e2e/utils/flows.js#L309)

## 연락처

lkm707@naver.com
