// 시나리오가 공유하는 UI 동작. 화면 조작과 판정을 한곳에 모아 같은 셀렉터·대기 규칙을 쓴다.
const { test, expect, errors } = require('@playwright/test');

const sidebar = (page, name) => page.getByRole('complementary').getByRole('link', { name, exact: true });

// 게시판 목록은 로드 직후 ?page=1 로 한 번 더 렌더된다. 그 전에 클릭하면 무반응이므로 상세 URL이 될 때까지 재시도한다.
async function openArticle(page, title) {
  return test.step("게시판 본문 → 검색된 게시글 제목 클릭 → 상세 화면 확인", async () => {
    await page.waitForURL(/\/articles(\?.*)?$/);
    const listUrl = page.url();
    const row = page.getByRole('main').getByRole('row').filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      if (!/\/articles(\?.*)?$/.test(page.url())) await page.goto(listUrl);
      await expect(row).toBeVisible({ timeout: 5_000 });
      await row.getByRole('listitem').first().click();
      await expect(page).toHaveURL(/\/articles\/\d+/, { timeout: 3_000 });
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
  });
}

async function openWrite(page) {
  return test.step("게시판 본문 → ‘글쓰기’ 클릭 → 작성 화면 확인", async () => {
    await page.waitForURL(/\/articles(\?.*)?$/);
    await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible();
    await expect(async () => {
      await page.getByRole('button', { name: '글쓰기' }).click();
      await page.waitForURL(/\/articles\/write/, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
  });
}

async function enterCourse(page, courseId) {
  await test.step('왼쪽 사이드바 → ‘학습 과목’ 클릭', async () => {
    await sidebar(page, '학습 과목').click();
  });
  await test.step('본문 → ‘학습 과목 목록’ 표시 확인', async () => {
    await expect(page.getByRole('heading', { name: '학습 과목 목록' })).toBeVisible();   // 홈 위젯의 SANDBOX 오클릭 방지
  });
  await test.step('본문 과목 목록 → ‘SANDBOX’ 클릭', async () => {
    await page.getByText('SANDBOX', { exact: true }).first().click();
  });
  await test.step('과목 화면 → SANDBOX 제목·URL·‘수업 목록’ 탭 표시 확인', async () => {
    await expect(page).toHaveURL(new RegExp(`/courses/${courseId}/`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'SANDBOX' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '수업 목록' })).toBeVisible();
  });
  // 과목에 들어가면 앱이 약 0.4초 뒤 최근 차시(/lectures/<id>)로 한 번 더 이동한다(과목 진입 후 자동 이동을 3회 모두 확인).
  // 그 전에 탭을 누르면 클릭 결과가 자동 이동에 덮여 실패하므로, 이동이 끝난 뒤에 돌려준다. 이동하지 않는 과목이면 5초 뒤 그대로 진행.
  await test.step('과목 화면 → 최근 차시로의 자동 이동이 끝날 때까지 대기', async () => {
    try {
      await page.waitForURL(new RegExp(`/courses/${courseId}/lectures/\\d+`), { timeout: 5_000 });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;   // 타임아웃만 허용. 브라우저 종료 등 다른 오류는 이 단계에서 실패로 남긴다
      test.info().annotations.push({ type: 'note', description: `과목 ${courseId}: 최근 차시 자동 이동 미관측(5초), 현재 URL ${page.url()}` });
    }
  });
}

// 두 번째 토글이 목록 보기다. 이미 목록이면 다시 누르지 않는다(정리할 제목이 여러 개일 수 있다).
async function toListView(page) {
  return test.step("수업 일정 화면 → 달력·목록 전환 버튼으로 목록 보기 선택", async () => {
    await expect(page.getByRole('button', { name: '오늘' })).toBeVisible({ timeout: 15_000 });
    const main = page.locator('main');
    const listToggle = main.locator('button[aria-pressed]').nth(1);
    await expect(listToggle).toBeVisible();
    if (await listToggle.getAttribute('aria-pressed') !== 'true') await listToggle.click();
    await expect(listToggle).toHaveAttribute('aria-pressed', 'true');
    // 날짜 문구는 달력에도 있어 로딩 완료 신호로 사용할 수 없다. 빈 목록에도 .fc-list는 존재한다.
    await expect(main.locator('.fc-list')).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole('progressbar')).toHaveCount(0, { timeout: 30_000 });
  });
}

// 최근 차시와 무관하게 지정 주소로 이동하고, 01 TEST 영역만 응시 대상으로 반환한다.
async function selectExam(page, home, courseId, lectureId) {
  return test.step(`과목의 ‘01 TEST’ 차시 주소로 이동 → 차시 ${lectureId}·시험 영역 확인`, async () => {
    const url = `${home}/courses/${courseId}/lectures/${lectureId}`;
    const urlPattern = new RegExp(`${url}/?(?:[?#].*)?$`);
    const resultURLPattern = new RegExp(`/courses/${courseId}/lectures/${lectureId}/lecturepages/all/?(?:[?#].*)?$`);
    await page.goto(url);
    await expect(page).toHaveURL(urlPattern);
    const summary = page.getByRole('button', { name: /^01\s+TEST(?:\s|$)/ });
    await expect(summary).toBeVisible({ timeout: 30_000 });
    const card = summary.locator('..');   // 01 TEST의 Accordion: 제목과 해당 차시의 상세 영역
    // 응시 전 '테스트 시작하기' / 응시 완료 '테스트 재응시' / 응시 중(이전 실행이 시작 뒤 끊김) '테스트 이어하기' — 셋 다 ensureExamNotStarted 가 응시 전으로 맞춘다
    await expect(card.getByRole('button', { name: /^(테스트 시작하기|테스트 재응시|테스트 이어하기)$/ }).first()).toBeVisible({ timeout: 30_000 });
    return { card, url, urlPattern, resultURLPattern };
  });
}

async function createScheduleViaUi(page, summary, ymd) {
  return test.step("왼쪽 사이드바 ‘수업 일정’ → ‘만들기’ → 제목·날짜 입력 → ‘저장’ → 목록 표시 확인", async () => {
    const [year, month, day] = ymd.split('-');
    const mdy = `${month}/${day}/${year}`;
    await sidebar(page, '수업 일정').click();
    await expect(page.getByRole('button', { name: '오늘' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '만들기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('제목 추가').fill(summary);
    const dateInputs = dialog.getByPlaceholder('MM/DD/YYYY');
    await dateInputs.first().fill(mdy);
    await dateInputs.last().fill(mdy);
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await toListView(page);
    await expect(page.getByText(summary).first()).toBeVisible({ timeout: 10_000 });
  });
}

async function editScheduleViaUi(page, currentSummary, editedSummary) {
  return test.step("일정 목록 → 일정 클릭 → 연필 아이콘 → 제목 수정·저장 → 변경 확인", async () => {
    await page.getByText(currentSummary, { exact: true }).first().click();
    await page.getByTestId('pen-to-squareIcon').click();
    const editHeading = page.getByText('수업 일정 수정', { exact: true });
    await expect(editHeading).toBeVisible();
    const titleInput = page.getByPlaceholder('제목 추가');
    await expect(titleInput).toHaveValue(currentSummary, { timeout: 15_000 });
    await titleInput.fill(editedSummary);
    await page.locator('button').filter({ hasText: /^저장$/ }).last().click();
    await expect(editHeading).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(editedSummary, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });
}

// 다이얼로그 전환 중 첫 클릭이 씹혀 삭제 요청이 안 나가는 경우가 있어, 요청이 관찰되지 않을 때만 한 번 더 누른다.
// 요청이 나간 뒤에는 응답이 무엇이든 다시 누르지 않는다(실패 응답을 재클릭으로 덮지 않기 위함).
async function deleteScheduleViaUi(page, summary) {
  return test.step("일정 목록 → 일정 클릭 → 휴지통 아이콘 → 삭제 확인 대화상자의 ‘삭제’ → 제거 확인", async () => {
    await page.getByText(summary, { exact: true }).first().click();
    await page.getByTestId('trashIcon').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('이 일정을 삭제하시겠습니까?')).toBeVisible();

    const isDelete = (req) => req.method() === 'DELETE' && /\/schedule\//.test(req.url());
    let sent = null;
    for (let attempt = 1; attempt <= 2 && !sent; attempt++) {
      const waiting = page.waitForRequest(isDelete, { timeout: 3_000 });
      waiting.catch(() => {});
      await dialog.getByRole('button', { name: '삭제', exact: true }).click();
      sent = await waiting.catch(() => null);
    }
    if (!sent) throw new Error(`일정 삭제 버튼을 두 번 눌렀지만 삭제 요청이 나가지 않음: "${summary}"`);
    const res = await sent.response();
    expect(res, `일정 삭제 요청에 응답이 없음(네트워크 실패: ${sent.failure()?.errorText ?? '원인 미상'}) — 재클릭하지 않음`).not.toBeNull();
    expect(res.status(), `일정 삭제 요청 실패 (HTTP ${res.status()}) — 재클릭하지 않음`).toBeLessThan(400);
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(summary, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
}

// 목록 보기에서 일정이 해당 날짜 머리글 아래에 있는지 본다. 제목과 날짜를 따로 찾으면 다른 날짜의 일정도 통과하므로,
// 화면 텍스트에서 그 날짜 머리글과 다음 머리글 사이 구간에 제목이 있는지로 판정한다.
async function expectScheduleOnDay(page, summary, dayPattern) {
  return test.step("수업 일정 목록 본문 → 오늘 날짜 머리글 아래에 일정 제목이 있는지 확인", async () => {
    await expect(page.getByText(summary, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(async () => {
      const text = await page.locator('main').innerText();
      dayPattern.lastIndex = 0;   // g 플래그 정규식이 와도 항상 처음부터 찾는다
      const head = dayPattern.exec(text);
      expect(head, `날짜 머리글 ${dayPattern} 없음`).not.toBeNull();
      const from = head.index + head[0].length;
      const nextHead = /(^|[^0-9])\d{1,2}\s*[월화수목금토일]요일/g;
      nextHead.lastIndex = from;
      const next = nextHead.exec(text);
      const section = text.slice(from, next ? next.index : undefined);
      expect(section, `"${summary}"이(가) 머리글 ${head[0].trim()} 그룹 안에 없음`).toContain(summary);
    }).toPass({ timeout: 10_000 });
  });
}

// home 을 주면 헤더가 안정적인 클래스 홈으로 먼저 이동한다(상세 화면에는 작성자 아이콘도 있다)
async function logout(page, home) {
  if (home) {
    await test.step('클래스 홈으로 이동 → 프로필을 열기 전 환영 문구 확인', async () => {
      await page.goto(home);
      await expect(page.getByRole('heading', { name: /안녕하세요/ })).toBeVisible();
    });
  }
  await test.step('상단 오른쪽 프로필 아바타 클릭 → 계정 메뉴 열기', async () => {
    await page.locator('[data-testid="PersonIcon"]').first().click();
  });
  await test.step('프로필 메뉴 → ‘로그아웃’ 클릭 → 로그인 화면 이동 확인', async () => {
    await page.getByText('로그아웃', { exact: true }).click();
    await expect(page).toHaveURL(/accounts\/signin/, { timeout: 15_000 });
  });
}

async function addComment(page, text) {
  return test.step("게시글 상세의 댓글 영역 → 댓글 입력 → ‘등록’ 클릭 → 댓글 표시 확인", async () => {
    await page.getByPlaceholder('댓글을 입력하세요.').click();
    await page.keyboard.type(text);
    await page.getByRole('button', { name: '등록' }).click();
    await expect(page.getByText(text)).toBeVisible();
  });
}

// 본문 에디터(Lexical)는 글자가 보인 뒤에도 잠시(입력 후 요청 본문 비교로 실측 60~100ms) 폼 상태 반영이 늦어, 그 안에 저장하면 옛 본문이 전송된다.
// 폼 상태를 볼 신호가 없어 입력 뒤 500ms 정착 대기(고정 대기 원칙의 예외)를 두고 저장은 한 번만 누른다.
// 저장 요청은 막거나 재시도하지 않고 관찰만 한다. content 파트 불일치는 soft 단언으로 기록만 하고
// 폼 닫힘과 호출측의 새로고침 검증까지 진행한 뒤 실패가 확정된다(화면 본문·요청 content·저장 결과를 함께 비교하기 위함).
const SAVE_SETTLE_MS = 500;

function requestContent(postData) {   // 저장 요청은 multipart, content 파트만 뽑는다(형식이 바뀌면 JSON도 시도)
  const m = /name="content"\r?\n(?:[^\r\n]*\r?\n)*?\r?\n([\s\S]*?)\r?\n--/.exec(postData);
  if (m) return m[1];
  try { return JSON.parse(postData).content ?? null; } catch { return null; }
}

async function fillArticleAndSave(page, { title, body, existingBody }) {
  return test.step("게시글 작성·수정 폼 → 제목·본문 입력 → ‘저장’ 클릭 → 저장 요청·폼 닫힘 확인", async () => {
    const editing = existingBody !== undefined;
    const titleBox = page.getByPlaceholder('제목 *');
    await expect(titleBox).toBeVisible({ timeout: 15_000 });
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toBeEditable({ timeout: 15_000 });
    const save = page.getByRole('button', { name: '저장' });

    if (editing) {
      await expect(editor).toHaveText(existingBody, { timeout: 15_000 });   // 기존 본문이 뒤늦게 주입되므로 그 뒤에 입력
    } else if (title !== undefined) {
      await titleBox.fill(title);
    }

    await expect(async () => {   // 에디터가 덜 준비된 채 입력하면 유실되므로 전체 선택 후 교체로 재시도
      await editor.click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(body);
      await expect(editor).toHaveText(body);
      await expect(save).toBeEnabled({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });

    if (editing && title !== undefined) await titleBox.fill(title);

    await page.waitForTimeout(SAVE_SETTLE_MS);
    const editorText = await editor.innerText();
    const sent = page.waitForRequest((req) => req.method() === 'POST' && /board\/article\//.test(req.url()), { timeout: 10_000 });
    sent.catch(() => {});   // 클릭이 예외로 끝나 아래 await에 이르지 못해도 미처리 거부를 남기지 않는다
    await save.click();
    let req;
    try {
      req = await sent;
    } catch {
      throw new Error(`저장 요청이 10초 안에 나가지 않음 | 에디터: "${editorText}"`);
    }
    const content = requestContent(req.postData() || '');
    expect.soft(content ?? '', `저장 요청 content에 입력 본문 없음 | 에디터: "${editorText}" | content 앞부분: "${(content ?? '(파트 없음)').slice(0, 120)}"`).toContain(body);
    await expect(titleBox).toBeHidden({ timeout: 20_000 });
  });
}

// 시작하기 → 동의 → 시작 → 답 선택 → 제출 → 종료 → LXP 복귀. 동의 전·확인 전 버튼 비활성도 함께 본다.
async function takeExam(page, exam) {
  await test.step('과목의 시험 영역 → ‘테스트 시작하기’ 클릭 → 시험 안내 화면 확인', async () => {
    await expect(page, '응시 전에 지정 차시 URL 확인').toHaveURL(exam.urlPattern);
    const startBtn = exam.card.getByRole('button', { name: '테스트 시작하기', exact: true });
    await expect(startBtn).toBeVisible({ timeout: 30_000 });
    await startBtn.click();
    await page.waitForURL(/testroom.*\/test\/onboard/, { timeout: 30_000 });
    await expect(page.getByText('테스트 정보 및 유의 사항을 확인해 주세요')).toBeVisible();
  });
  await passOnboarding(page);
  await finishExam(page, exam);
}

// 유의사항 동의 → 테스트 시작 → 문항 표시
async function passOnboarding(page) {
  await test.step('시험 유의사항 화면 → 동의 전 ‘다음’ 비활성 확인 → 체크 후 ‘다음’ 클릭', async () => {
    await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByText('모든 응시 준비가 완료되었습니다')).toBeVisible();
  });
  await test.step('응시 준비 화면 → ‘테스트 시작’ 클릭 → 문항 표시 확인', async () => {
    await page.getByRole('button', { name: '테스트 시작', exact: true }).click();
    await page.waitForURL(/\/test\/lecturepage\//);
    await expect(page.getByText('Untitled Quiz')).toBeVisible();
  });
}

// 문항 화면부터: 답 선택 → 제출 → 종료 → LXP 복귀(응시 완료). takeExam 과 응시 중 복구가 함께 쓴다.
async function finishExam(page, exam) {
  await test.step('시험 문항 영역 → ‘Correct’ 보기 선택 → ‘제출’ 클릭 → 제출 완료 확인', async () => {
    await page.locator('label').filter({ hasText: /^Correct$/ }).click();   // 커스텀 라디오, Incorrect 와 구분해 정확 매칭
    await page.getByRole('button', { name: '제출', exact: true }).click();
    await expect(page.getByText('제출 완료')).toBeVisible();
  });
  await test.step('시험 화면 → ‘테스트 종료’ 클릭 → 종료 확인 대화상자·동의 전 버튼 비활성 확인', async () => {
    await page.getByRole('button', { name: '테스트 종료' }).first().click();
    await expect(page.getByText('테스트를 종료하면 답안 제출이 불가능합니다')).toBeVisible();
    await expect(page.getByRole('button', { name: '테스트 종료' }).last()).toBeDisabled();
  });
  await test.step('종료 확인 대화상자 → 동의 체크 → ‘테스트 종료’ 클릭 → 종료 문구 확인', async () => {
    await page.getByRole('checkbox').last().check();
    await page.getByRole('button', { name: '테스트 종료' }).last().click();
    await expect(page.getByText('테스트가 종료되었습니다')).toBeVisible({ timeout: 15_000 });
  });
  await test.step('시험 종료 화면 → ‘다음’ 클릭 → LXP 복귀·응시 완료 표시 확인', async () => {
    await page.getByRole('button', { name: '다음' }).click();
    await page.waitForURL(exam.resultURLPattern, { timeout: 30_000 });
    await expect(page.getByText('테스트 응시 완료')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/제출 완료/).first()).toBeVisible();
  });
}

// 재응시 버튼은 org-api lecture/test/reset/by_self 를 호출한다. org-api 는 실패도 HTTP 200 으로 주고 본문 _result.status 로 알리므로
// (part2 JMeter 판정과 같은 규칙) 화면 버튼만 보지 않고 상태코드와 본문을 함께 확인한다.
const isResetResponse = response => response.request().method() === 'POST' && /\/lecture\/test\/reset\/by_self\/?$/.test(new URL(response.url()).pathname);
async function expectResetOk(response) {
  expect(response.status(), '재응시 요청 실패 — 다시 클릭하지 않음').toBeLessThan(400);
  const failure = await response.finished();
  if (failure) throw failure;
  const body = await response.json().catch(() => null);
  const result = body && body._result;
  expect(result && result.status, `재응시 응답 본문 _result.status 가 ok 가 아님: ${JSON.stringify(result ?? body).slice(0, 200)}`).toBe('ok');
}

// 완료 화면의 '테스트 재응시' → 응시 전 복귀. 교육자 설정 '테스트 셀프 재응시 허용'이 켜져 있어야 한다.
async function retakeExam(page, exam) {
  return test.step("시험 완료 화면 오른쪽 아래 → ‘테스트 재응시’ 클릭 → 재응시 응답(_result.status=ok) → ‘테스트 시작하기’ 표시 확인", async () => {
    await expect(page, '재응시 전에 지정 차시의 학습 뷰어 URL 확인').toHaveURL(exam.resultURLPattern);
    const retake = page.getByRole('button', { name: '테스트 재응시', exact: true });
    await expect(retake, "'테스트 재응시' 버튼 없음 — 교육자 설정 '테스트 셀프 재응시 허용'이 켜져 있는지 확인").toBeVisible({ timeout: 15_000 });
    const resetResponse = page.waitForResponse(isResetResponse, { timeout: 15_000 });
    resetResponse.catch(() => {});   // 클릭이 예외로 끝나도 미처리 거부를 남기지 않는다.
    await retake.click();
    await expectResetOk(await resetResponse);
    await expect(page).toHaveURL(exam.resultURLPattern);
    await expect(page.getByRole('button', { name: '테스트 시작하기', exact: true })).toBeVisible({ timeout: 30_000 });
  });
}

// 과목 화면에서는 재응시 응답이 끝난 뒤 한 번만 새로고침한다. 처리 중 새로고침으로 요청을 끊지 않는다.
// 이전 실행이 시작 뒤 끊겨 '응시 중'으로 남았으면(dev 실측: 카드가 '테스트 이어하기'를 보이고 클릭 시 문항 화면으로 바로 감)
// 이어하기 → 제출 → 종료 → 재응시로 마저 끝내 응시 전으로 되돌린다. API 로 상태를 바꾸지 않는다.
async function ensureExamNotStarted(page, exam) {
  return test.step("과목의 시험 영역 → 응시 전 상태 확인(응시 완료면 ‘테스트 재응시’, 응시 중이면 ‘테스트 이어하기’로 마저 끝낸 뒤 재응시)", async () => {
    await expect(page, '시험 상태 변경 전에 지정 차시 URL 확인').toHaveURL(exam.urlPattern);
    const start = exam.card.getByRole('button', { name: '테스트 시작하기', exact: true });
    const retake = exam.card.getByRole('button', { name: '테스트 재응시', exact: true });
    const resume = exam.card.getByRole('button', { name: '테스트 이어하기', exact: true });
    await expect(start.or(retake).or(resume).first(), "'테스트 시작하기'·'테스트 재응시'·'테스트 이어하기' 모두 없음 — 셀프 재응시 허용 설정과 차시 상태를 확인").toBeVisible({ timeout: 30_000 });
    if (await start.isVisible()) return;
    if (await resume.isVisible()) {
      await test.step('응시 중 복구: ‘테스트 이어하기’ 클릭 → 문항 화면(유의사항이 다시 나오면 동의 후 시작)', async () => {
        await resume.click();
        await page.waitForURL(/testroom/, { timeout: 30_000 });
        if (/\/test\/onboard/.test(page.url())) await passOnboarding(page);
        await page.waitForURL(/\/test\/lecturepage\//, { timeout: 30_000 });
      });
      await finishExam(page, exam);
      await retakeExam(page, exam);
      await test.step('응시 중 복구: 지정 차시 주소로 복귀 → ‘테스트 시작하기’ 확인', async () => {
        await page.goto(exam.url);
        await expect(page).toHaveURL(exam.urlPattern);
        await expect(start).toBeVisible({ timeout: 30_000 });
      });
      return;
    }
    const resetResponse = page.waitForResponse(isResetResponse, { timeout: 15_000 });
    resetResponse.catch(() => {});   // 클릭이 예외로 끝나도 미처리 거부를 남기지 않는다.
    await retake.first().click();
    await expectResetOk(await resetResponse);
    await page.reload();
    await expect(page).toHaveURL(exam.urlPattern);
    await expect(start).toBeVisible({ timeout: 30_000 });
  });
}

// 검색 결과가 그려지기 전의 '행 0개'를 통과로 오인하지 않도록 '결과 없음' 문구를 먼저 기다린다
async function expectArticleAbsent(page, home, title) {
  return test.step("게시판 목록 → 삭제한 제목 검색 → ‘등록된 게시글이 없습니다’·검색 결과 0건 확인", async () => {
    await page.goto(`${home}/articles`);
    await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder('제목 검색').fill(title);
    await expect(page.getByRole('main')).toContainText('등록된 게시글이 없습니다', { timeout: 30_000 });
    await expect(page.getByRole('main').getByRole('row').filter({ hasText: title })).toHaveCount(0);
  });
}

// 일정 목록 보기는 /schedule 외에 /schedule/ics·/schedule/count 로도 데이터를 받는다. 이 중 하나라도 실패하면 화면은
// '예정된 수업 일정이 없습니다'를 그려 빈 목록과 구분되지 않는다(dev 실측: 503 응답에도 .fc-list 표시·progressbar 0).
// 그래서 '일정이 없다'고 판정하는 곳은 사이드바 클릭 전에 감시를 걸고, 판정 직전에 조회 실패가 있었는지 먼저 본다.
function watchScheduleLookups(page) {
  const errors = [];
  const isLookup = request => request.method() === 'GET' && /^\/schedule(\/|$)/.test(new URL(request.url()).pathname);
  const onResponse = response => {
    if (isLookup(response.request()) && response.status() >= 400) errors.push(new Error(`일정 목록 조회 실패: HTTP ${response.status()} ${new URL(response.url()).pathname}`));
  };
  const onRequestFailed = request => {
    if (isLookup(request)) errors.push(new Error(`일정 목록 조회 실패: ${request.failure()?.errorText ?? '네트워크 오류'} ${new URL(request.url()).pathname}`));
  };
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  return {
    errors,
    stop() { page.off('response', onResponse); page.off('requestfailed', onRequestFailed); },
    assertOk() { if (errors.length) throw errors[0]; },
  };
}

// 날짜 문구 대신 실제 목록 영역과 로딩 표시로 준비 여부를 확인한다(빈 목록도 허용). lookups 는 사이드바 클릭 전에 watchScheduleLookups 로 만든 감시.
async function expectScheduleAbsent(page, summary, lookups) {
  return test.step("수업 일정 목록 본문 → 일정 조회 성공·날짜 목록 로딩 확인 후 삭제한 일정 제목이 없는지 확인", async () => {
    const main = page.locator('main');
    if (lookups) { lookups.stop(); lookups.assertOk(); }
    await expect(main.locator('.fc-list')).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole('progressbar')).toHaveCount(0, { timeout: 30_000 });
    await expect(main.locator('.fc-list').getByText(summary, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  });
}

// 실패로 남은 게시글 정리. 로그인된 새 세션에서 호출하며 있었으면 true
async function deleteArticleViaUiIfExists(page, home, title) {
  return test.step("실패 후 정리: 게시판 목록에서 테스트 글 검색 → 남아 있으면 더 보기·게시글 삭제", async () => {
    await page.goto(`${home}/articles`);
    await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible({ timeout: 30_000 });
    // 검색 결과는 /article?filter_title= 응답으로 다시 그려진다. 응답 전에는 검색 전 목록의 행이 그대로 보이고 재렌더 중 잠깐 행 0개가 되므로
    // (dev 실측 약 0.2초) 응답을 받은 뒤 판정한다. 조회 실패는 '없음'으로 보지 않는다. '등록된 게시글이 없습니다'는 반응형 중복으로 숨은 요소가
    // 하나 더 있어 보이는 것만 센다.
    const isSearch = response => response.request().method() === 'GET' && /\/article$/.test(new URL(response.url()).pathname)
      && decodeURIComponent(new URL(response.url()).search).includes(title);
    const searched = page.waitForResponse(isSearch, { timeout: 30_000 });
    searched.catch(() => {});
    await page.getByPlaceholder('제목 검색').fill(title);
    const searchResponse = await searched;
    expect(searchResponse.status(), `게시글 검색 실패 (HTTP ${searchResponse.status()}) — 남은 글 여부를 판정할 수 없음`).toBeLessThan(400);
    const row = page.getByRole('main').getByRole('row').filter({ hasText: title });
    const empty = page.getByRole('main').getByText('등록된 게시글이 없습니다').filter({ visible: true });
    await expect(row.or(empty).first()).toBeVisible({ timeout: 30_000 });
    if (!(await row.count())) return false;
    await openArticle(page, title);
    await page.getByRole('button', { name: 'more' }).first().click();
    await page.getByText('게시글 삭제', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
    await expectArticleAbsent(page, home, title);
    return true;
  });
}

// 실패로 남은 일정 정리. 교육자로 로그인된 새 세션에서 호출하며 있었으면 true
async function deleteScheduleViaUiIfExists(page, summary) {
  return test.step("실패 후 정리: 왼쪽 ‘수업 일정’ → 목록 보기 → 남은 테스트 일정 삭제", async () => {
    // UI가 보낸 조회(/schedule, /schedule/ics, /schedule/count)만 관찰한다. 조회 실패를 빈 목록으로 간주해 정리를 건너뛰지 않는다.
    const lookups = watchScheduleLookups(page);
    try {
      await sidebar(page, '수업 일정').click();
      await toListView(page);
      lookups.assertOk();
      const item = page.locator('main .fc-list').getByText(summary, { exact: true });
      if (await item.count() === 0) return false;
      await expect(item).toBeVisible({ timeout: 20_000 });
      await deleteScheduleViaUi(page, summary);
      return true;
    } catch (error) {
      throw lookups.errors[0] ?? error;
    } finally {
      lookups.stop();
    }
  });
}

function todayYmd() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

module.exports = {
  sidebar, openArticle, openWrite, enterCourse, selectExam, toListView, createScheduleViaUi, editScheduleViaUi, deleteScheduleViaUi,
  logout, addComment, fillArticleAndSave, takeExam, retakeExam, ensureExamNotStarted,
  expectArticleAbsent, expectScheduleAbsent, expectScheduleOnDay, deleteArticleViaUiIfExists, deleteScheduleViaUiIfExists, todayYmd,
  watchScheduleLookups,
};
