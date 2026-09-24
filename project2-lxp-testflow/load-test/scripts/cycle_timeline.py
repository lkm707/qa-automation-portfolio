#!/usr/bin/env python3
"""JTL에서 스레드(가상 사용자)별 시험 사이클 타임라인을 뽑는다 — "동시 접속 학습자들의 테스트 사이클" 증거용.

완료 사이클 = 조회→입장→시작→응시→종료→재응시 6단계가 이 순서로 모두 success 인 사이클만 센다.
스레드→계정 매핑: JTL 에는 login_id 가 없다. CSV Data Set Config(Once Only 안)는 스레드당 1행을 보장할 뿐
행 배정 순서를 보장하지 않으므로 기본은 스레드명으로 표시한다. --accounts 를 주면 '스레드 N = CSV N행' 가정으로
계정명을 덧붙이되, 표에 추정임을 명시한다.

사용법: python scripts/cycle_timeline.py results/step30.jtl [--accounts data/accounts.csv] [--out reports/step30_cycles.md]
원본 JTL은 바꾸지 않는다. 계정은 이메일 앞부분만 표시한다.
종료 코드는 표 생성 성공 여부(0/2)만 뜻한다 — 실패 사이클이 있어도 0 이다. 합격 판정은 summarize_jtl.py 가 한다.
"""
import argparse
import csv
import re
import sys
from datetime import datetime

STEP_ORDER = ['0.', '1.', '2.', '3.', '4.', '5.']   # 라벨 접두어: 조회·입장·시작·응시·종료·재응시
ENTER, RESET = '1.', '5.'


def hms(ms):
    return datetime.fromtimestamp(ms / 1000).strftime('%H:%M:%S')


def thread_no(name):
    m = re.search(r'-(\d+)$', name or '')
    return int(m.group(1)) if m else None


def step_idx(label):
    for i, p in enumerate(STEP_ORDER):
        if label.startswith(p):
            return i
    return None


def is_full(cycle):
    """6단계가 순서대로 있고 전부 success 인 사이클."""
    return ([step_idx(r['label']) for r in cycle] == list(range(6))
            and all(r['success'] == 'true' for r in cycle))


def main():
    ap = argparse.ArgumentParser(description='JTL → 스레드(계정)별 시험 사이클 타임라인')
    ap.add_argument('jtl')
    ap.add_argument('--accounts', help='스레드 번호 = CSV 행 번호 가정으로 계정명을 덧붙인다(추정, 표에 명시). 기본은 스레드명만')
    ap.add_argument('--out', help='마크다운 출력 파일')
    a = ap.parse_args()

    with open(a.jtl, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    http = [r for r in rows if not (r.get('responseMessage') or '').startswith('Number of samples in transaction')]
    if not http:
        print('HTTP 샘플이 없습니다:', a.jtl); return 2
    http.sort(key=lambda r: (int(r['timeStamp']), r['threadName']))

    accounts = {}
    if a.accounts:
        try:
            with open(a.accounts, encoding='utf-8-sig', newline='') as f:
                for i, r in enumerate(csv.DictReader(f), start=1):
                    accounts[i] = (r.get('login_id') or '').split('@')[0]
        except OSError as e:
            print(f'경고: 계정 CSV 를 읽지 못해 스레드명만 표시합니다: {e}', file=sys.stderr)

    by_thread = {}
    for r in http:
        by_thread.setdefault(r['threadName'], []).append(r)

    intervals = []   # 완료 사이클의 (입장 요청 시작, 재응시 응답 완료)
    lines, incomplete = [], []
    total_full = total_tried = 0
    for th in sorted(by_thread, key=lambda t: (thread_no(t) or 0, t)):
        rs = by_thread[th]
        n = thread_no(th)
        name = th if not accounts else f"{th} ({accounts.get(n, '?')})"
        # 사이클 분할: '0.' 라벨(조회)마다 새 사이클. 조회 이전 샘플(Auth)은 사이클에 넣지 않는다.
        cycles, cur = [], None
        for r in rs:
            if r['label'].startswith('0.'):
                cur = []; cycles.append(cur)
            elif cur is None:
                continue
            if step_idx(r['label']) is not None:
                cur.append(r)
        full = [c for c in cycles if is_full(c)]
        total_full += len(full); total_tried += len(cycles)
        fails = [f"{r['label'][:18]}({r['responseCode']})" for r in rs if r['success'] != 'true']
        first_enter = next((int(r['timeStamp']) for r in rs if r['label'].startswith(ENTER) and r['success'] == 'true'), None)
        last_reset = next((int(r['timeStamp']) + int(r['elapsed']) for r in reversed(rs)
                           if r['label'].startswith(RESET) and r['success'] == 'true'), None)
        durs = [(int(c[-1]['timeStamp']) + int(c[-1]['elapsed']) - int(c[0]['timeStamp'])) / 1000 for c in full]
        avg = f'{sum(durs) / len(durs):.1f}' if durs else '-'
        peak = max((int(r['allThreads']) for r in rs), default=0)
        for c in full:
            e = next(x for x in c if x['label'].startswith(ENTER))
            z = next(x for x in c if x['label'].startswith(RESET))
            intervals.append((int(e['timeStamp']), int(z['timeStamp']) + int(z['elapsed'])))
        if not cycles or len(full) != len(cycles) or fails:
            incomplete.append(th)
        lines.append(f"| {name} | {len(full)}/{len(cycles)} | {hms(first_enter) if first_enter else '-'} | "
                     f"{hms(last_reset) if last_reset else '-'} | {avg} | {peak} | {', '.join(fails) or '-'} |")

    # 입장 요청 시작 ~ 재응시 응답 완료 구간이 겹치는 최대 스레드 수(완료 사이클만).
    # 제출·종료 뒤 대기 시간도 포함되므로 교육자 화면의 '응시 중' 인원과 같은 개념이 아니다 — 별도로 해석한다.
    events = sorted([(s, 1) for s, _ in intervals] + [(e, -1) for _, e in intervals])
    cur = peak_span = 0; peak_at = None
    for t, d in events:
        cur += d
        if cur > peak_span:
            peak_span, peak_at = cur, t
    t0 = int(http[0]['timeStamp']); t1 = max(int(r['timeStamp']) + int(r['elapsed']) for r in http)
    peak_active = max(int(r['allThreads']) for r in http)

    out = [f'## 스레드(계정)별 시험 사이클 타임라인 — {a.jtl}', '',
           f'- 실행 {hms(t0)} ~ {hms(t1)} ({(t1 - t0) / 1000:.0f}초), 스레드 {len(by_thread)}개, '
           f'완료 사이클 {total_full}/{total_tried} (6단계 순서대로 전부 성공한 것만)',
           f'- JMeter 최대 동시 활성 스레드: **{peak_active}** (대기·조회·재응시 중 포함)',
           f'- 입장 요청 시작~재응시 응답 완료 구간의 최대 동시 진행 스레드: **{peak_span}**'
           + (f' ({hms(peak_at)} 시점)' if peak_at else '')
           + ' — 완료 사이클만 기준(실패·중단 사이클 제외). 제출·종료 후 대기까지 포함한 구간이므로 '
             '교육자 화면의 응시 현황 인원과 같은 값일 필요는 없다',
           f'- 불완전 사이클·실패 단계가 있는 스레드: {", ".join(incomplete) if incomplete else "없음"}', '']
    if accounts:
        out.append('- 계정명은 "스레드 N = accounts.csv N행" 가정에 따른 **추정**이다. JTL 에는 login_id 가 없고 CSV Data Set Config 는 '
                   '스레드당 1행만 보장할 뿐 배정 순서를 보장하지 않는다. 현재 산출물로는 계정 단위 대조가 불가능하므로 보고서에는 스레드 단위로 쓴다.')
        out.append('')
    out += ['| 스레드' + (' (계정, 추정)' if accounts else '') + ' | 완료/시도 사이클 | 첫 입장 | 마지막 재응시 | 완료 사이클 평균(s) | 최대 동시 활성 | 실패 단계 |',
            '|---|---:|---|---|---:|---:|---|'] + lines
    text = '\n'.join(out)
    print(text)
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
        print(f'\n(저장: {a.out})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
