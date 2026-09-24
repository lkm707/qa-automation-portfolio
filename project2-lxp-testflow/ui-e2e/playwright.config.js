// UI E2E 시나리오 1~7 (@S1~@S7). 계정은 리포 루트의 .env 에서 읽는다.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 300_000,
  workers: 1,            // 공용 dev 서버 배려: 브라우저 세션 1개, 순차 실행
  retries: 0,            // 상태 변경·실패 로그인을 통째로 재실행하지 않는다
  reporter: [['list'], ['html', { open: 'never' }], ['./utils/video-reporter.js']],
  use: {
    baseURL: 'https://web.example.invalid',
    headless: true,
    viewport: { width: 1280, height: 720 },
    locale: 'ko-KR',
    video: 'on',
    screenshot: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
