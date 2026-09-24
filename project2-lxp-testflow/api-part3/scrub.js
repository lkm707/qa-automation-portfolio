#!/usr/bin/env node
/**
 * 리포트 민감정보 치환 — allure-results / htmlextra(reports/*.html) 안의 JWT·Bearer·비밀번호를 가린다.
 *
 * 로컬에서 `npm test` / run.sh 로 만든 리포트도 팀·담당자에게 공유되므로 CI(Jenkinsfile)와 같은 규칙을
 * 로컬 실행 끝에 적용한다. 로그인 요청 본문 {"password": "..."} 이 그대로 실리는 것이 주 대상이다.
 *   - JSON 문자열 값은 이스케이프(\" \\)까지 한 덩어리로 잡아 치환 후에도 JSON 이 깨지지 않게 한다.
 *   - htmlextra 는 본문을 HTML 이스케이프(&quot;password&quot;:&quot;...&quot;)하므로 그 형태도 잡는다.
 *   - Newman 환경 내보내기의 {"key": "vault:...", "value": "..."} 는 줄바꿈이 끼어 있어 \s* 로 잇는다.
 *
 * 사용법: node scripts/scrub.js <폴더|파일> [...]
 *   종료 코드: 0 = 전부 처리, 1 = 읽기/쓰기 실패 파일 있음(치환 안 된 파일이 남았을 수 있음 → 호출측은 리포트 공유를 막아야 한다)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MASK = '***REDACTED_TOKEN***';
const KEYS = 'access_token|refresh_token|id_token|download_token|session_token'
           + '|token|password|passwd|pw|secret|api_key|apikey|authorization|csrf_token';
// JSON 문자열 리터럴 본체: 이스케이프된 문자(\" \\ \n …)는 한 단위로 소비한다
const JSTR = '"(?:[^"\\\\]|\\\\.)*"';
const JWT    = /eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}/g;
const BEARER = /(Bearer[ ]+)[A-Za-z0-9._~+=/-]{16,}/gi;
// "password": "값"  (JSON / allure 첨부)
const KV     = new RegExp('("(?:' + KEYS + ')"\\s*:\\s*)' + JSTR, 'gi');
// &quot;password&quot;: &quot;값&quot;  (htmlextra 가 이스케이프한 본문. 값 안의 \&quot; 는 이스케이프된 따옴표)
const KV_ESC = new RegExp('(&quot;(?:' + KEYS + ')&quot;\\s*:\\s*)&quot;(?:\\\\&quot;|(?!&quot;).)*&quot;', 'gi');
// {"key": "vault:student_pw", "value": "값"} 형태(환경 내보내기). 줄바꿈·들여쓰기가 사이에 온다
const VAULT  = new RegExp('("key"\\s*:\\s*"vault:[^"]*"\\s*,\\s*"value"\\s*:\\s*)' + JSTR, 'g');
const EXT    = /[.](json|txt|xml|html|log)$/i;

function scrubText(s) {
  return s.replace(JWT, MASK)
          .replace(BEARER, (m, p1) => p1 + MASK)
          .replace(KV, (m, p1) => p1 + '"' + MASK + '"')
          .replace(KV_ESC, (m, p1) => p1 + '&quot;' + MASK + '&quot;')
          .replace(VAULT, (m, p1) => p1 + '"' + MASK + '"');
}

let files = 0, changed = 0, failed = [];
function walk(p) {
  let st;
  try { st = fs.statSync(p); } catch (e) { return; }   // 없는 경로는 대상 아님(예: 첫 실행에 reports/ 가 없음)
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    return;
  }
  if (!EXT.test(p)) return;
  files++;
  try {
    const s = fs.readFileSync(p, 'utf8');
    const out = scrubText(s);
    if (out !== s) { fs.writeFileSync(p, out); changed++; }
  } catch (e) {
    failed.push(p + ' (' + e.message + ')');
  }
}

if (require.main === module) {
  process.argv.slice(2).forEach(walk);
  console.log('[SCRUB] 검사 ' + files + '개 / 치환 ' + changed + '개' + (failed.length ? ' / 실패 ' + failed.length + '개' : ''));
  for (const f of failed) console.error('[SCRUB] 처리 실패: ' + f);
  process.exit(failed.length ? 1 : 0);
}
module.exports = { scrubText };
