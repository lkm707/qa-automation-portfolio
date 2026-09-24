// UI E2E 시나리오 1~7 (ui_scenarios.md). 각 테스트는 빈 세션에서 로그인부터 시작해 사용자 흐름 하나를 UI로만 수행한다.
const { test, expect } = require('@playwright/test');
const { home, COURSE_ID, LECTURE_ID, login, setValueQuietly } = require('../utils/helpers');
const { acquireExamLock } = require('../utils/lock');
const {
  sidebar, openArticle, openWrite, enterCourse, selectExam, toListView, createScheduleViaUi, editScheduleViaUi, deleteScheduleViaUi,
  logout, addComment, fillArticleAndSave, takeExam, retakeExam, ensureExamNotStarted,
  expectArticleAbsent, expectScheduleAbsent, expectScheduleOnDay, deleteArticleViaUiIfExists, deleteScheduleViaUiIfExists, todayYmd,
  watchScheduleLookups,
} = require('../utils/flows');

const stamp = `${Date.now()}-${process.pid}`;
const LOGIN_MISMATCH = '이메일 또는 비밀번호가 일치하지 않습니다.';   // 틀린 비밀번호와 없는 계정에 같은 문구

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 300_000 });

async function openSignin(page) {
  await test.step('클래스 주소 접속 → 로그인 화면과 이메일 입력칸 확인', async () => {
    await page.goto(home);
    await expect(page).toHaveURL(/accounts\/signin/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
}

// 실패한 테스트가 남긴 데이터를 새 세션에서 지운다. 성공한 테스트는 스스로 지우므로 실패했을 때만 연다.
async function withCleanupPage(browser, testInfo, role, fn) {
  if (testInfo.status === testInfo.expectedStatus) return;
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, locale: 'ko-KR', viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  try {
    await login(page, role);
    await fn(page);
  } finally {
    await context.close();
  }
}

// 1. 학습자 정상 로그인
test('UI-TC-01 학습자 정상 로그인: 로그인 → 클래스 홈·환영 문구·클래스 메뉴 → 로그아웃 → 재접근 차단', { tag: '@S1' }, async ({ page }) => {
  await login(page);
  await test.step('클래스 홈 본문·왼쪽 사이드바 → 환영 문구·학습자 메뉴 4개·관리 메뉴 미노출 확인', async () => {
    await expect(page.getByRole('heading', { name: /안녕하세요, .+님/ })).toBeVisible();
    const links = page.getByRole('complementary').getByRole('link', { name: /클래스 홈|학습 과목|수업 일정|게시판/ });
    await expect(links).toHaveCount(4);
    for (const name of ['클래스 홈', '학습 과목', '수업 일정', '게시판']) {
      await expect(page.getByRole('complementary').getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('complementary').getByRole('link', { name: /구성원|설정|관리|편집/ })).toHaveCount(0);
  });

  await logout(page);
  await test.step('로그아웃 후 클래스 주소 재접속 → 로그인 화면·비밀번호 입력칸으로 접근 차단 확인', async () => {
    await page.goto(home);
    await expect(page).toHaveURL(/accounts\/signin/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});

// 2. 로그인 실패 — 케이스마다 독립 세션. 2-1만 실계정으로 실패 로그인 1회를 일으킨다.
test.describe('2. 로그인 실패', () => {
  test('UI-TC-02-1 틀린 비밀번호: 불일치 안내, 클래스 홈으로 이동하지 않음', { tag: '@S2' }, async ({ page }) => {
    await openSignin(page);
    await test.step('로그인 폼 → 정상 이메일·틀린 비밀번호 입력 (실계정 이메일은 리포트에 기록하지 않음)', async () => {
      const id = process.env.LXP_STUDENT_ID;
      if (!id) throw new Error('.env에 LXP_STUDENT_ID가 없습니다 (project2-lxp-testflow/.env)');
      await setValueQuietly(page.locator('input[type="email"]'), id);   // 실계정 → evaluate 주입
      await page.locator('input[type="password"]').fill('wrong-password-1');   // 가짜 값이라 fill 로 남아도 무방
    });
    await test.step('로그인 폼 → ‘로그인’ 버튼 클릭', async () => {
      await page.locator('button[type="submit"]').click();
    });
    await test.step('로그인 화면 → ‘이메일 또는 비밀번호가 일치하지 않습니다.’ 표시·현재 화면 유지 확인', async () => {
      await expect(page.getByText(LOGIN_MISMATCH)).toBeVisible();
      await expect(page).toHaveURL(/accounts\/signin/);
    });
  });

  test('UI-TC-02-2 존재하지 않는 계정: 틀린 비밀번호와 같은 문구(계정 존재 여부 미노출)', { tag: '@S2' }, async ({ page }) => {
    await openSignin(page);
    await test.step('로그인 폼 → 존재하지 않는 이메일·임의 비밀번호 입력', async () => {
      await page.locator('input[type="email"]').fill('nobody_zz@example.com');
      await page.locator('input[type="password"]').fill('wrong-password-1');
    });
    await test.step('로그인 폼 → ‘로그인’ 버튼 클릭', async () => {
      await page.locator('button[type="submit"]').click();
    });
    await test.step('로그인 화면 → 틀린 비밀번호와 동일한 불일치 안내·현재 화면 유지 확인', async () => {
      await expect(page.getByText(LOGIN_MISMATCH)).toBeVisible();
      await expect(page).toHaveURL(/accounts\/signin/);
    });
  });

  test('UI-TC-02-3 입력 형식 오류: 이메일 형식·비밀번호 길이 안내(제출 전 즉시 검증)', { tag: '@S2' }, async ({ page }) => {
    await openSignin(page);
    await test.step('로그인 폼 → 이메일 형식에 맞지 않는 값·8자리 미만 비밀번호 입력', async () => {
      await page.locator('input[type="email"]').fill('not-an-email');
      await page.locator('input[type="password"]').fill('x');
    });
    await test.step('로그인 폼의 입력 오류 안내 → 이메일 형식·비밀번호 길이 경고 확인', async () => {
      await expect(page.getByText('잘못된 이메일 형식입니다.')).toBeVisible();
      await expect(page.getByText('비밀번호는 8자리 이상 입력해주세요.')).toBeVisible();
    });
  });

  // 빈 칸 제출은 브라우저 required 검증이 막는다. 말풍선 문구는 브라우저·언어 설정에 따라 다르고 DOM에 없으므로
  // 포커스 이동·valueMissing·로그인 요청 미전송으로 판정한다.
  test('UI-TC-02-4 필수값 누락: 전체·이메일·비밀번호 누락 시 제출 차단', { tag: '@S2' }, async ({ page }) => {
    const loginPosts = [];
    page.on('request', r => { if (r.method() === 'POST' && /login/.test(r.url())) loginPosts.push(r.url()); });
    const cases = [
      { name: '전체 누락', email: '', pw: '', expectFocus: 'email' },
      { name: '이메일 누락', email: '', pw: 'wrong-password-1', expectFocus: 'email' },
      { name: '비밀번호 누락', email: 'nobody_zz@example.com', pw: '', expectFocus: 'password' },
    ];
    for (const c of cases) {
      await test.step(`로그인 필수값 검증: ${c.name}`, async () => {
        await openSignin(page);
        const emailBox = page.locator('input[type="email"]');
        const pwBox = page.locator('input[type="password"]');
        await test.step('로그인 폼 → 누락 조건에 맞춰 이메일·비밀번호 입력칸 설정', async () => {
          await emailBox.fill(c.email);
          await pwBox.fill(c.pw);
        });
        await test.step('로그인 폼 → ‘로그인’ 버튼 클릭', async () => {
          loginPosts.length = 0;
          await page.locator('button[type="submit"]').click();
        });
        const target = c.expectFocus === 'email' ? emailBox : pwBox;
        await test.step('첫 빈 입력칸 → 포커스·필수 입력 안내 확인, 로그인 요청 미전송·현재 화면 유지 확인', async () => {
          await expect(target).toBeFocused();
          await expect.poll(() => target.evaluate(el => el.validity.valueMissing)).toBe(true);
          await expect.poll(() => target.evaluate(el => el.validationMessage.length > 0)).toBe(true);
          await expect(page).toHaveURL(/accounts\/signin/);
          expect(loginPosts, '빈 칸인데 로그인 요청이 전송됨').toHaveLength(0);
        });
      });
    }
  });
});

// 3. 과목 학습 확인 (읽기 전용)
test('UI-TC-03 과목 학습 확인: 과목 진입 → 차시 목록·상세 → 학습 현황·학습맵 → 새로고침 후 유지', { tag: '@S3' }, async ({ page }) => {
  await login(page);
  await enterCourse(page, COURSE_ID);
  await test.step('과목 본문의 탭 메뉴 → 탭 4개 확인 → ‘과목 소개’ 클릭 → 소개 URL 확인', async () => {
    await expect(page.getByRole('tab')).toHaveCount(4);
    await page.getByRole('tab', { name: '과목 소개' }).click();
    await expect(page).toHaveURL(/\/info/);
  });

  await test.step('과목 본문의 탭 메뉴 → ‘수업 목록’ 클릭 → 수업 수·진도 표시 확인', async () => {
    await page.getByRole('tab', { name: '수업 목록' }).click();
    await expect(page.getByText(/수업 \d+개/)).toBeVisible();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
  });
  await test.step('수업 목록 본문 → ‘모두 펼치기’ 클릭 → 차시의 응시 기간 또는 응시 완료 정보 확인', async () => {
    await page.getByRole('button', { name: '모두 펼치기' }).click();
    await expect(page.getByText(/응시 기간|에 응시 완료했습니다/).first()).toBeVisible();   // 시험 상태(4번이 바꿈)에 따라 둘 중 하나
  });

  await test.step('과목 본문의 탭 메뉴 → ‘학습 현황’ 클릭 → 현황 URL·학습 진행률 확인', async () => {
    await page.getByRole('tab', { name: '학습 현황' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/학습 진행률/).first()).toBeVisible();
  });

  await test.step('과목 본문의 탭 메뉴 → ‘학습맵’ 클릭 → 학습맵 URL·TEST 표시 확인', async () => {
    await page.getByRole('tab', { name: '학습맵' }).click();
    await expect(page).toHaveURL(/\/roadmap/);
    await expect(page.getByText('TEST', { exact: true }).first()).toBeVisible();
  });

  await test.step('학습맵 화면 새로고침 → 같은 URL·SANDBOX 제목·TEST 표시 유지 확인', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/roadmap/);
    await expect(page.getByRole('heading', { name: 'SANDBOX' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('TEST', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });
});

// 4. 시험 응시·재응시. 전제: 01 TEST 의 '테스트 셀프 재응시 허용'이 켜져 있다.
// 부하 테스트(part2)의 시험 사이클(입장 → 시작 → 제출 → 종료 → 재응시 초기화)과 같은 흐름을 UI로 수행하고, 응시 전 상태로 끝낸다.
test.describe('4. 시험 응시·재응시', () => {
  let releaseExamLock;
  test.beforeEach(() => { releaseExamLock = acquireExamLock(LECTURE_ID); });
  test.afterEach(() => {
    if (!releaseExamLock) return;
    releaseExamLock();
    releaseExamLock = undefined;
  });

  test('UI-TC-04 시험: 응시·제출·종료 → 테스트 재응시 → 응시 전 복귀', { tag: '@S4' }, async ({ page }) => {
    await login(page);
    await enterCourse(page, COURSE_ID);
    const exam = await selectExam(page, home, COURSE_ID, LECTURE_ID);
    await ensureExamNotStarted(page, exam);   // 이전 실행이 중간에 끊겨 응시 완료로 남았으면 먼저 되돌린다
    await takeExam(page, exam);
    await retakeExam(page, exam);
  });
});

// 5. 학습자 게시판 CRUD
test.describe('5. 학습자 게시판 CRUD', () => {
  const title = `[UI자동화] 작성 ${stamp}`;
  const editedTitle = `[UI자동화] 수정 ${stamp}`;
  const createdBody = 'UI 자동화가 작성한 본문입니다.';
  const editedBody = 'UI 자동화가 수정한 본문입니다.';
  const comment = `UI 자동화 댓글 ${stamp}`;
  test.afterEach(async ({ browser }, testInfo) => {
    await withCleanupPage(browser, testInfo, 'student', async (page) => {
      for (const t of [title, editedTitle]) await deleteArticleViaUiIfExists(page, home, t);
    });
  });

  test('UI-TC-05 게시판: 작성 → 새로고침 확인 → 댓글 → 수정 → 새로고침 확인 → 삭제', { tag: '@S5' }, async ({ page }) => {
    await login(page);
    await test.step('왼쪽 사이드바 → ‘게시판’ 클릭 → 본문의 ‘글쓰기’ 버튼 확인', async () => {
      await sidebar(page, '게시판').click();
      await expect(page.getByRole('button', { name: '글쓰기' })).toBeVisible();
    });

    // 저장 후 화면(상세/목록)이 일정치 않아 폼 닫힘으로 저장 완료를 판정하고 목록에서 다시 찾는다.
    // 상세 화면의 본문 불일치는 soft로 기록만 하고 새로고침 검증까지 진행한다(요청 content·상세 화면·새로고침 결과를 함께 비교).
    // useInnerText로 보이는 글자만 비교하고, 실패 시 실제 화면 본문이 리포트에 남는다.
    const openFromList = async (t, body) => {
      await test.step('게시판 목록 주소로 이동 → 제목 검색·게시글 열기 → 상세 제목·본문 확인', async () => {
        await page.goto(`${home}/articles`);
        await page.getByPlaceholder('제목 검색').fill(t);
        await openArticle(page, t);
        await expect(page.getByRole('heading', { name: t })).toBeVisible();
        await expect.soft(page.getByRole('main'), '상세 화면에 입력 본문 없음').toContainText(body, { useInnerText: true });
      });
    };
    const reloadAndCheck = async (t, body) => {
      await test.step('게시글 상세 화면 새로고침 → 제목·본문 유지 확인', async () => {
        await page.reload();
        await expect(page.getByRole('heading', { name: t })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('main'), '새로고침 후 입력 본문 없음').toContainText(body, { useInnerText: true, timeout: 15_000 });
      });
    };
    const kebab = () => page.getByRole('button', { name: 'more' }).first();   // 댓글에도 케밥이 있어 첫 번째(게시글)

    await openWrite(page);
    await fillArticleAndSave(page, { title, body: createdBody });
    await openFromList(title, createdBody);
    await reloadAndCheck(title, createdBody);

    await addComment(page, comment);
    await test.step('게시글 상세의 댓글 영역 → 댓글 수 1개 확인 → 새로고침 후 댓글 유지 확인', async () => {
      await expect(page.getByRole('button', { name: /댓글 1/ })).toBeVisible();
      await page.reload();
      await expect(page.getByText(comment)).toBeVisible({ timeout: 30_000 });
    });

    await test.step('게시글 상세의 더 보기 버튼 → ‘게시글 수정’ 클릭', async () => {
      await kebab().click();
      await page.getByText('게시글 수정', { exact: true }).click();
    });
    await fillArticleAndSave(page, { title: editedTitle, body: editedBody, existingBody: createdBody });
    await openFromList(editedTitle, editedBody);
    await reloadAndCheck(editedTitle, editedBody);

    await test.step('게시글 상세의 더 보기 버튼 → ‘게시글 삭제’ → 확인 대화상자의 ‘삭제’ 클릭', async () => {
      await kebab().click();
      await page.getByText('게시글 삭제', { exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
    });
    await expectArticleAbsent(page, home, editedTitle);
  });
});

// 6. 교육자 일정 CRUD
test.describe('6. 교육자 일정 CRUD', () => {
  const summary = `[UI자동화] 교육자 일정 ${stamp}`;
  const editedSummary = `[UI자동화] 교육자 일정 수정 ${stamp}`;
  const ymd = todayYmd();
  test.afterEach(async ({ browser }, testInfo) => {
    await withCleanupPage(browser, testInfo, 'educator', async (page) => {
      for (const s of [summary, editedSummary]) await deleteScheduleViaUiIfExists(page, s);
    });
  });

  test('UI-TC-06 교육자 일정: 관리 메뉴 확인 → 생성 → 수정 → 새로고침 확인 → 삭제', { tag: '@S6' }, async ({ page }) => {
    await login(page, 'educator');
    await test.step('교육자 클래스 홈 → 환영 문구·왼쪽 사이드바의 ‘구성원’·‘설정’ 메뉴 확인', async () => {
      await expect(page.getByRole('heading', { name: /안녕하세요, .+님/ })).toBeVisible();
      await expect(page.getByRole('complementary').getByRole('link', { name: '구성원', exact: true })).toBeVisible();
      await expect(page.getByRole('complementary').getByRole('link', { name: '설정', exact: true })).toBeVisible();
    });

    await createScheduleViaUi(page, summary, ymd);
    await editScheduleViaUi(page, summary, editedSummary);

    await test.step('수업 일정 화면 새로고침 → 목록 보기로 전환 → 수정한 제목 유지 확인', async () => {
      await page.reload();   // 새로고침하면 달력 보기로 돌아온다
      await toListView(page);
      await expect(page.getByText(editedSummary, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    });

    await deleteScheduleViaUi(page, editedSummary);
  });
});

// 7. 역할 간 일정 연계
test.describe('7. 역할 간 일정 연계', () => {
  const summary = `[UI자동화] 연계 일정 ${stamp}`;
  const ymd = todayYmd();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${ymd}T12:00:00`).getDay()];
  const dayPattern = new RegExp(`(^|[^0-9])${Number(ymd.split('-')[2])}\\s*${weekday}요일`);   // 목록 보기 날짜 머리글, 예: "4금요일"
  test.afterEach(async ({ browser }, testInfo) => {
    await withCleanupPage(browser, testInfo, 'educator', async (page) => { await deleteScheduleViaUiIfExists(page, summary); });
  });

  test('UI-TC-07 역할 연계: 교육자 일정 생성 → 학습자 캘린더에 제목·날짜 → 교육자 삭제 → 학습자 화면에서 제거', { tag: '@S7' }, async ({ page }) => {
    await login(page, 'educator');
    await createScheduleViaUi(page, summary, ymd);
    await logout(page, home);

    await login(page, 'student');
    await test.step('학습자: 왼쪽 사이드바 ‘수업 일정’ → 목록 보기 → 교육자가 만든 일정의 제목·날짜 확인', async () => {
      await sidebar(page, '수업 일정').click();
      await toListView(page);
      await expectScheduleOnDay(page, summary, dayPattern);   // 오늘 날짜 그룹 안에 있어야 한다
    });
    await logout(page, home);

    await login(page, 'educator');
    await test.step('교육자: 왼쪽 사이드바 ‘수업 일정’ → 목록 보기 → 생성한 연계 일정 삭제', async () => {
      await sidebar(page, '수업 일정').click();
      await toListView(page);
      await deleteScheduleViaUi(page, summary);
    });
    await logout(page, home);

    await login(page, 'student');
    await test.step('학습자: 왼쪽 사이드바 ‘수업 일정’ → 목록 보기 → 일정 조회 성공 확인 → 교육자가 삭제한 일정의 미노출 확인', async () => {
      const lookups = watchScheduleLookups(page);   // 조회가 실패해도 화면은 빈 목록처럼 보이므로 조회 성공을 먼저 확인한다
      await sidebar(page, '수업 일정').click();
      await toListView(page);
      await expectScheduleAbsent(page, summary, lookups);
    });
  });
});
