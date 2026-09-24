#!/usr/bin/env python3
"""JTL 결과를 합격선(에러율 1% 미만·평균 Latency 60초 이내)과 목표(평균 Latency 1초 이내)로 판정한다.
기대 샘플 수 users×(1+loops×steps)와 대조하고, Transaction 샘플은 따로 집계한다.

사용법: python scripts/summarize_jtl.py results/step30.jtl [--users 30 --hard-ms 60000 --latency-ms 1000 --error-pct 1 --loops 3 --steps 6]
--users 를 주면 기대 샘플 수와 미실행 사용자 판정을 설정 인원 기준으로 한다(결과에 나타난 스레드 수로 세면 통째로 빠진 사용자를 놓친다).
"""
import argparse
import csv
import re
import sys

from jtl_metrics import latency_stats, milliseconds


def percentile(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def stats(rows):
    n = len(rows)
    err = sum(1 for r in rows if r.get('success', '').strip().lower() != 'true')
    ela = [milliseconds(r, 'elapsed') for r in rows]
    return {
        'n': n,
        'err': err,
        'err_pct': (err * 100.0 / n) if n else 0.0,
        **latency_stats(rows),
        'ela_avg': (sum(ela) / len(ela)) if ela else 0.0,
        'ela_p90': percentile(ela, 0.90),
        'ela_max': max(ela) if ela else 0.0,
    }


def main():
    ap = argparse.ArgumentParser(description='JTL → 이슈티켓 합격 판정')
    ap.add_argument('jtl')
    ap.add_argument('--users', type=int, default=None, help='설정 인원(-Jusers). 주면 기대 샘플 수·미실행 사용자를 설정값 기준으로 판정')
    ap.add_argument('--hard-ms', type=float, default=60000.0, help='합격선 평균 Latency 상한 (과정 하드리밋, 기본 60000ms)')
    ap.add_argument('--latency-ms', type=float, default=1000.0, help='목표 평균 Latency (이슈티켓, 기본 1000ms)')
    ap.add_argument('--error-pct', type=float, default=1.0, help='에러율 상한 %% (기본 1)')
    ap.add_argument('--loops', type=int, default=3, help='Loop 횟수 (기본 3)')
    ap.add_argument('--steps', type=int, default=6, help='루프당 HTTP 단계 수 (기본 6: 조회·입장·시작·응시·종료·재응시)')
    a = ap.parse_args()

    with open(a.jtl, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        print('샘플이 없습니다:', a.jtl)
        return 2

    if 'Latency' not in rows[0]:
        print('경고: Latency 컬럼이 없어 elapsed로 대신 계산합니다 (jmeter.save.saveservice.latency=true 확인)')

    is_tx = lambda r: (r.get('responseMessage') or '').startswith('Number of samples in transaction')
    http = [r for r in rows if not is_tx(r)]
    tx = [r for r in rows if is_tx(r)]

    observed = len({r['threadName'] for r in http if r.get('threadName')})
    users = a.users if a.users else observed   # 설정 인원이 있으면 그 기준. 결과에 나타난 스레드만 세면 통째로 빠진 사용자를 놓친다
    expected = users * (1 + a.loops * a.steps)
    missing = users - observed

    labels = []
    for r in http:
        if r['label'] not in labels:
            labels.append(r['label'])

    print(f"파일: {a.jtl}")
    if missing > 0:
        user_note = f"  <-- 미실행 사용자 {missing}명: 결과에 나타나지 않은 스레드가 있음"
    elif missing < 0:
        user_note = f"  <-- 설정 인원보다 스레드가 {-missing}개 많음: --users 값이나 결과 파일 확인"
    else:
        user_note = ""
    print(f"스레드(사용자) 수: 관측 {observed}" + (f" / 설정 {a.users}" if a.users else " (설정 인원 미지정 — 관측값 기준)") + user_note)
    print(f"HTTP 샘플: {len(http)} (기대 {expected} = {users}×(1+{a.loops}×{a.steps}))"
          + ("" if len(http) == expected else "  <-- 샘플 수 불일치: 죽은 스레드/조기 중단 의심, 에러율 신뢰 불가"))
    if tx:
        print(f"사이클(Transaction) 샘플: {len(tx)} (기대 {users * a.loops})")
    print()
    print('avgLat=판정용 보정 평균, rawLat=기록된 Latency 평균(누락 제외), latFix=elapsed 대체 건수')
    print('Latency 누락 또는 실패 샘플의 0ms는 elapsed로 대체합니다. 정상 응답의 0ms는 유지합니다.')
    hdr = f"{'label':42} {'n':>5} {'err':>4} {'err%':>6} {'avgLat':>8} {'rawLat':>8} {'latFix':>6} {'avgElp':>8} {'p90Elp':>8} {'maxElp':>8}"
    print(hdr)
    print('-' * len(hdr))
    worst = None
    for lb in labels:
        s = stats([r for r in http if r['label'] == lb])
        flag = ''
        if s['lat_avg'] >= a.hard_ms or s['err_pct'] >= a.error_pct:
            flag = '  <-- 합격선 초과'
        elif s['lat_avg'] >= a.latency_ms:
            flag = '  <-- 목표(1초) 초과'
        raw_lat = f"{s['lat_raw_avg']:.0f}" if s['lat_raw_avg'] is not None else '-'
        print(f"{lb[:42]:42} {s['n']:>5} {s['err']:>4} {s['err_pct']:>6.2f} {s['lat_avg']:>8.0f} {raw_lat:>8} {s['lat_fallback']:>6} {s['ela_avg']:>8.0f} {s['ela_p90']:>8.0f} {s['ela_max']:>8.0f}{flag}")
        if worst is None or s['lat_avg'] > worst[1]:
            worst = (lb, s['lat_avg'])
    for lb in sorted({r['label'] for r in tx}):
        s = stats([r for r in tx if r['label'] == lb])
        print(f"{('[사이클] ' + lb)[:42]:42} {s['n']:>5} {s['err']:>4} {s['err_pct']:>6.2f} {'-':>8} {'-':>8} {'-':>6} {s['ela_avg']:>8.0f} {s['ela_p90']:>8.0f} {s['ela_max']:>8.0f}")

    # 중단 조건 샘플 — 플랜의 Kill Switch 와 같은 기준(5xx 1건, 또는 60초 이상 1건).
    # 평균·에러율에 묻혀 PASS 가 되지 않도록 건수로 따로 판정한다 (570건 중 500 1건이면 에러율 0.18% 라 평균만 보면 통과다).
    def is_5xx(r):
        return bool(re.match(r'5\d\d$', (r.get('responseCode') or '').strip()))
    def is_slow(r):
        v = (r.get('Latency') or '').strip()
        lat = milliseconds(r, 'Latency') if v else 0.0
        return max(milliseconds(r, 'elapsed'), lat) >= a.hard_ms
    kill_5xx = [r for r in http if is_5xx(r)]
    kill_slow = [r for r in http if is_slow(r)]
    kill = kill_5xx + [r for r in kill_slow if r not in kill_5xx]

    o = stats(http)
    print('-' * len(hdr))
    raw_lat = f"{o['lat_raw_avg']:.0f}" if o['lat_raw_avg'] is not None else '-'
    print(f"{'전체(HTTP)':42} {o['n']:>5} {o['err']:>4} {o['err_pct']:>6.2f} {o['lat_avg']:>8.0f} {raw_lat:>8} {o['lat_fallback']:>6} {o['ela_avg']:>8.0f} {o['ela_p90']:>8.0f} {o['ela_max']:>8.0f}")
    print()
    ok_err = o['err_pct'] < a.error_pct
    ok_hard = o['lat_avg'] < a.hard_ms
    ok_goal = o['lat_avg'] < a.latency_ms
    ok_cnt = len(http) == expected and missing == 0
    ok_kill = not kill
    print(f"합격선(과정 하드리밋): 에러율 {o['err_pct']:.2f}% {'<' if ok_err else '>='} {a.error_pct}% [{'OK' if ok_err else 'FAIL'}] | "
          f"평균 Latency {o['lat_avg']:.0f}ms {'<' if ok_hard else '>='} {a.hard_ms:.0f}ms [{'OK' if ok_hard else 'FAIL'}] | "
          f"샘플 수·사용자 수 [{'OK' if ok_cnt else 'FAIL'}] | "
          f"중단 조건 샘플 {len(kill)}건(5xx {len(kill_5xx)}·{a.hard_ms / 1000:.0f}초 이상 {len(kill_slow)}) [{'OK' if ok_kill else 'FAIL'}]")
    if kill:
        print('  중단 조건 샘플 (Kill Switch 기준 — 1건이라도 있으면 이 단계는 FAIL, 담당자 보고 대상):')
        for r in kill[:10]:
            print(f"    {r.get('label', '')[:40]:40} thread={r.get('threadName', '')} code={r.get('responseCode', '')} "
                  f"elapsed={r.get('elapsed', '')}ms msg={(r.get('responseMessage') or '')[:60]}")
        if len(kill) > 10:
            print(f"    ... 외 {len(kill) - 10}건")
    print(f"목표(이슈티켓):        평균 Latency {o['lat_avg']:.0f}ms {'<' if ok_goal else '>='} {a.latency_ms:.0f}ms [{'달성' if ok_goal else '미달 — 변곡점 후보'}]")
    if worst:
        print(f"가장 느린 단계(평균 Latency): {worst[0]} {worst[1]:.0f}ms")
    verdict = ok_err and ok_hard and ok_cnt and ok_kill
    if verdict:
        print('결과: PASS' + (' (목표 1초 달성)' if ok_goal else ' (합격선 안, 목표 1초 미달 — 이 단계가 변곡점 후보)'))
    elif not ok_kill:
        print('결과: FAIL (중단 조건 샘플 존재 — 5xx 또는 60초 이상 응답. 평균이 좋아도 이 단계는 합격 아님)')
    else:
        print('결과: FAIL (합격선 초과 또는 샘플 수 불일치 — 단계별 표 확인)')
    return 0 if verdict else 1


if __name__ == '__main__':
    sys.exit(main())
