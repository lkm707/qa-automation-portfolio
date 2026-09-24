// 시험 시나리오의 같은 PC 중복 실행 방지. 잠금은 test-results 밖에 둔다.
// 종료된 프로세스의 잠금은 15분 뒤에만 회수한다. 다른 PC와의 충돌은 막지 못한다.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const STALE_MS = 15 * 60 * 1000;
const RELEASE_GUARD_RETRIES = 4;
const RELEASE_GUARD_DELAY_MS = 25;
const guardWait = new Int32Array(new SharedArrayBuffer(4));

function acquireExamLock(lectureId) {
  const lockDir = path.resolve(__dirname, '..', '.locks');
  const lockPath = path.join(lockDir, `exam-${lectureId}.lock`);
  const guardPath = `${lockPath}.guard`;
  fs.mkdirSync(lockDir, { recursive: true });
  const busy = (pid, ageMs) => new Error(`시험 시나리오가 다른 실행에서 진행 중이거나 잠금이 남아 있습니다 (PID: ${pid ?? '알 수 없음'}, 잠금 나이: ${Math.max(0, Math.floor(ageMs / 1000))}초): ${lockPath}`);

  // 확인부터 생성/회수/해제까지 직렬화한다. 잠금 경로가 비는 순간에도 다른 실행은 진입하지 못한다.
  const withGuard = (action, retries = 0) => {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.mkdirSync(guardPath);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (attempt >= retries) {
          throw new Error(`시험 잠금을 다른 실행이 갱신 중입니다: ${guardPath}. 모든 실행을 종료해도 남아 있으면 이 guard 디렉터리를 수동으로 제거하세요.`);
        }
        // 다른 프로세스의 짧은 갱신이 끝나도록 기다린다. 해제의 guard 충돌만 재시도한다.
        Atomics.wait(guardWait, 0, 0, RELEASE_GUARD_DELAY_MS);
      }
    }
    try { return action(); }
    finally { fs.rmdirSync(guardPath); }
  };

  const readOwner = () => {
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  };
  const isAlive = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; } // 권한 오류 등은 살아 있을 수 있으므로 회수하지 않는다.
  };
  const token = randomUUID();
  withGuard(() => {
    let ageMs = null;
    try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (ageMs !== null) {
      const owner = readOwner();
      if (ageMs <= STALE_MS || isAlive(owner?.pid)) throw busy(owner?.pid, ageMs);
      fs.unlinkSync(lockPath);
    }
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
    } catch (error) {
      fs.unlinkSync(lockPath);
      throw error;
    } finally {
      fs.closeSync(fd);
    }
  });

  let released = false;
  return () => {
    if (released) return;
    withGuard(() => {
      const owner = readOwner();
      // PID가 같아도 다른 획득에서 만든 잠금이면 건드리지 않는다. 확인과 삭제도 같은 guard 안에서 한다.
      if (owner?.pid === process.pid && owner.token === token) fs.unlinkSync(lockPath);
      released = true;
    }, RELEASE_GUARD_RETRIES);
  };
}

module.exports = { acquireExamLock };
