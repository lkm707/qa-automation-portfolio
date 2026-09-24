const fs = require('fs');
const path = require('path');

// 테스트 영상을 artifacts/videos/<TC번호>-<상태>.webm 으로 복사한다 (제목의 UI-TC-NN 또는 UI-TC-NN-M).
// 실행된 TC 는 영상이 없어도(브라우저가 뜨기 전 실패 등) 같은 TC 번호의 이전 영상을 먼저 지운다 — 지난 실행의 04-passed.webm 이
// 이번 실패 위에 남아 최신 결과로 오인되지 않게 한다. 영상이 없으면 <TC>-<상태>.no-video.txt 로 결과만 남긴다.
class JourneyVideoReporter {
  onTestEnd(test, result) {
    if (result.status === 'skipped') return;   // 실행하지 않은 TC 의 기존 영상은 그대로 둔다

    const tc = (test.title.match(/UI-TC-(\d{2}(?:-\d)?)/) || [null, 'UNKNOWN'])[1];
    const status = test.expectedStatus === 'failed' && result.status === 'failed' ? 'expected-failure' : result.status;
    const outputDir = path.resolve(__dirname, '..', 'artifacts', 'videos');
    fs.mkdirSync(outputDir, { recursive: true });
    for (const file of fs.readdirSync(outputDir)) {
      if (file.startsWith(`${tc}-`) && (file.endsWith('.webm') || file.endsWith('.no-video.txt'))) fs.unlinkSync(path.join(outputDir, file));
    }

    const video = result.attachments.find(attachment => attachment.contentType === 'video/webm' && attachment.path);
    if (!video || !fs.existsSync(video.path)) {
      const reason = result.error ? String(result.error.message || result.error).split('\n')[0] : '영상 첨부 없음';
      fs.writeFileSync(path.join(outputDir, `${tc}-${status}.no-video.txt`), `${new Date().toISOString()} ${test.title}\n상태: ${status}\n영상 없음: ${reason}\n`);
      return;
    }
    fs.copyFileSync(video.path, path.join(outputDir, `${tc}-${status}.webm`));
  }
}

module.exports = JourneyVideoReporter;
