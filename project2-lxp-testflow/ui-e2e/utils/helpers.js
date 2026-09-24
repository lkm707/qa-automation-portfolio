const path = require('path');
const { test, expect } = require('@playwright/test');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const CLASSROOM = '00000000-0000-0000-0000-000000000000';
const COURSE_ID = 731;      // SANDBOX
const LECTURE_ID = 1585;    // 01 TEST
const home = `/classrooms/${CLASSROOM}`;

function creds(role) {
  const id = role === 'educator' ? process.env.LXP_EDU_ID : process.env.LXP_STUDENT_ID;
  const pw = role === 'educator' ? process.env.LXP_EDU_PW : process.env.LXP_STUDENT_PW;
  if (!id || !pw) throw new Error(`.env에 ${role} 계정이 없습니다 (project2-lxp-testflow/.env)`);
  return { id, pw };
}

// 계정값(이메일·비밀번호)은 fill 로 넣지 않는다. Playwright 1.6x 는 fill 액션의 단계 제목을 `Fill "값"` 으로 만들어
// HTML 리포트(내장 zip)에 값이 평문으로 남는다(실측). evaluate 로 값을 주입하면 단계 제목은 `Evaluate locator(...)` 뿐이고
// 인자는 리포트·list 출력·에러 메시지 어디에도 기록되지 않는다(trace 를 켜면 evaluate 인자가 trace.zip 에 남으므로 trace 는 끈 채로 둔다).
// React 류 controlled input 은 네이티브 setter 로 값을 넣고 input/change 이벤트를 쏴야 상태에 반영된다.
async function setValueQuietly(locator, value) {
  await locator.evaluate((el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

// 클래스 홈으로 가면 로그인 화면으로 넘어간다. URL 대기는 폴링(toHaveURL)으로 한다 — 계정 페이지가 signin 안에서
// 한 번 더 이동하면 waitForURL 이 끊긴다. 직전에 다른 계정으로 로그인했으면 기억된 계정 화면이 떠서 전체 폼을 열어야 한다.
async function login(page, role = 'student') {
  const { id, pw } = creds(role);
  const roleName = role === 'educator' ? '교육자' : '학습자';
  await test.step(`${roleName}: 클래스 주소 접속 → 로그인 화면 이동 확인`, async () => {
    await page.goto(home);
    await expect(page).toHaveURL(/accounts\/signin/, { timeout: 15_000 });
  });
  const emailBox = page.locator('input[type="email"]');
  const other = page.getByText('다른 계정으로 로그인', { exact: false });
  await test.step('로그인 화면 → 이메일 입력칸 준비(기억된 계정 화면이면 ‘다른 계정으로 로그인’ 클릭)', async () => {
    await emailBox.or(other).first().waitFor({ state: 'visible', timeout: 15_000 });
    if (!(await emailBox.isVisible().catch(() => false))) {
      await other.first().click();
      await emailBox.waitFor({ state: 'visible', timeout: 15_000 });
    }
  });
  await test.step(`${roleName}: 로그인 폼 → 정상 이메일·비밀번호 입력 (값은 리포트에 기록하지 않음)`, async () => {
    await setValueQuietly(emailBox, id);
    await setValueQuietly(page.locator('input[type="password"]'), pw);
  });
  await test.step('로그인 폼 → ‘로그인’ 버튼 클릭', async () => {
    await page.locator('button[type="submit"]').click();
  });
  await test.step(`${roleName}: 클래스 홈 → URL과 ‘안녕하세요’ 환영 문구 확인`, async () => {
    await expect(page).toHaveURL(new RegExp(home.replace(/\//g, '\\/')), { timeout: 30_000 });
    await page.getByRole('heading', { name: /안녕하세요/ }).waitFor();
  });
}

module.exports = { CLASSROOM, COURSE_ID, LECTURE_ID, home, login, setValueQuietly };
