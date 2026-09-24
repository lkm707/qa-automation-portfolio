#!/usr/bin/env python3
"""단계별 HTML Dashboard(statistics.json)와 JTL을 비교해 TPS·Latency 변화와 변곡점 후보를 마크다운으로 뽑는다.
정상상태는 JTL의 allThreads 가 최대의 90% 이상으로 끊기지 않고 이어진 가장 긴 구간으로 잡는다.
변곡점 기준: A 평균 Latency ≥ --latency-ms, H ≥ --hard-ms, B TPS 효율 < --tps-eff, C p90 ≥ 기준단계 × --p90-ratio (≥ --p90-floor).

사용법: python scripts/compare_dashboards.py reports/step05 reports/step10 reports/step20 reports/step30 [--out reports/comparison.md]
"""
import argparse
import csv
import glob
import json
import math
import os
import re
import sys

from jtl_metrics import latency_stats

MIN_WINDOW_S = 20.0  # 정상상태 유지 구간이 이보다 짧으면 해당 단계 지표는 참고용
STEADY_RATIO = 0.9   # 정상상태 = 활성 스레드가 최대의 이 비율 이상으로 끊기지 않고 이어진 가장 긴 구간


def load_stats(d):
    with open(os.path.join(d, 'statistics.json'), encoding='utf-8') as f:
        return json.load(f)


def users_from_dir(d):
    m = re.search(r'step0*(\d+)', os.path.basename(os.path.normpath(d)))
    return int(m.group(1)) if m else None


def percentile(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def steady_from_jtl(path, ratio=STEADY_RATIO, hard_ms=60000.0):
    """JTL에서 정상상태 구간의 TPS/RT를 계산한다.
    최대치가 처음·마지막 관측된 사이를 통째로 잡으면, 시작·종료가 겹쳐 활성 수가 오르내리는 구간까지 '유지'로 세어
    유지 시간과 TPS가 부풀려진다. 그래서 활성 수가 최대의 ratio 이상인 샘플이 시간순으로 끊기지 않고 이어진 가장 긴 구간만 쓴다."""
    with open(path, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    http = [r for r in rows if not (r.get('responseMessage') or '').startswith('Number of samples in transaction')]
    if not http or 'allThreads' not in http[0]:
        return None
    http.sort(key=lambda r: int(r['timeStamp']))
    peak = max(int(r['allThreads']) for r in http)
    thr = max(1, math.ceil(peak * ratio))
    span = lambda run: int(run[-1]['timeStamp']) - int(run[0]['timeStamp'])
    best, cur = None, None
    for r in http:
        if int(r['allThreads']) >= thr:
            cur = cur or []
            cur.append(r)
        else:
            if cur and (best is None or span(cur) > span(best)):
                best = cur
            cur = None
    if cur and (best is None or span(cur) > span(best)):
        best = cur
    win = best or []
    acts = [int(r['allThreads']) for r in win]
    secs = span(win) / 1000.0 if win else 0.0
    life = {}
    for r in http:
        t = int(r['timeStamp']); e = int(r['elapsed']); th = r['threadName']
        a, b = life.get(th, (t, t + e)); life[th] = (min(a, t), max(b, t + e))
    avg_life = sum(b - a for a, b in life.values()) / len(life) / 1000.0
    ela = [float(r['elapsed']) for r in win]
    # 중단 조건 샘플(실행 전체 기준) — 요약기(summarize_jtl.py)와 같은 Kill Switch 기준. 1건이라도 있으면 그 단계는 합격 아님.
    kill_5xx = sum(1 for r in http if re.match(r'5\d\d$', (r.get('responseCode') or '').strip()))
    kill_slow = sum(1 for r in http
                    if max(float(r['elapsed']), float(r['Latency']) if (r.get('Latency') or '').strip() else 0.0) >= hard_ms)
    return {
        'kill_5xx': kill_5xx, 'kill_slow': kill_slow,
        'peak': peak, 'thr': thr, 'act_min': min(acts) if acts else 0, 'act_max': max(acts) if acts else 0,
        'act_avg': (sum(acts) / len(acts)) if acts else 0.0,
        'window_s': secs, 'n': len(win), 'threads': len(life), 'avg_life_s': avg_life,
        'tps': (len(win) / secs) if secs > 0 else 0.0,
        'avg': (sum(ela) / len(ela)) if ela else 0.0,
        **latency_stats(win),
        'p90': percentile(ela, 0.90),
        'err_pct': (sum(1 for r in win if r['success'] != 'true') * 100.0 / len(win)) if win else 0.0,
    }


def main():
    ap = argparse.ArgumentParser(description='HTML Dashboard 단계 비교 → TPS-지연 상관관계·변곡점')
    ap.add_argument('dirs', nargs='+', help='대시보드 폴더들 (statistics.json 포함), 인원 오름차순')
    ap.add_argument('--users', help='폴더 순서대로 인원 수, 예: 5,10,20,30 (생략 시 폴더명 stepNN에서 추출)')
    ap.add_argument('--jtl-dir', default='results', help='같은 이름의 .jtl을 찾을 폴더 (기본 results)')
    ap.add_argument('--latency-ms', type=float, default=1000.0, help='목표 평균 Latency (이슈티켓, 기본 1000ms)')
    ap.add_argument('--hard-ms', type=float, default=60000.0, help='합격선 평균 Latency (과정 하드리밋, 기본 60000ms)')
    ap.add_argument('--error-pct', type=float, default=1.0, help='합격선 에러율 상한 %% (기본 1, 대시보드 전체 에러율 기준)')
    ap.add_argument('--tps-eff', type=float, default=0.8)
    ap.add_argument('--p90-ratio', type=float, default=2.0)
    ap.add_argument('--p90-floor', type=float, default=500.0)
    ap.add_argument('--think-s', type=float, default=4.0, help='이론 TPS 계산용 think time(초) — 플랜 타이머 평균(대기 3~5초 → 4.0)')
    ap.add_argument('--out', help='마크다운 출력 파일')
    a = ap.parse_args()

    dirs = []
    for d in a.dirs:
        dirs.extend(sorted(glob.glob(d)) if any(c in d for c in '*?[') else [d])
    # 요청한 단계 폴더에 statistics.json 이 없으면 조용히 빼지 않는다 — 빠진 단계로 "병목 미관측" 결론이 나오면 안 된다.
    missing_dirs = [d for d in dirs if not os.path.isfile(os.path.join(d, 'statistics.json'))]
    dirs = [d for d in dirs if os.path.isfile(os.path.join(d, 'statistics.json'))]
    for d in missing_dirs:
        print(f'경고: statistics.json 없음 — 이 단계는 비교에서 빠집니다(실행 안 됨 또는 대시보드 미생성): {d}', file=sys.stderr)
    if not dirs:
        print('statistics.json 이 있는 폴더가 없습니다'); return 2
    if a.users:
        users = [int(x) for x in a.users.split(',')]
        if len(users) != len(dirs):
            print('--users 개수와 폴더 개수가 다릅니다'); return 2
    else:
        users = [users_from_dir(d) for d in dirs]
        if any(u is None for u in users):
            print('폴더명에서 인원을 읽을 수 없습니다. --users 5,10,20,30 형식으로 지정하세요'); return 2

    rows = []
    for d, u in zip(dirs, users):
        s = load_stats(d); t = s['Total']
        jtl = os.path.join(a.jtl_dir, os.path.basename(os.path.normpath(d)) + '.jtl')
        st = steady_from_jtl(jtl, hard_ms=a.hard_ms) if os.path.isfile(jtl) else None
        rows.append({'dir': d, 'users': u, 'n': t['sampleCount'], 'err_pct': t['errorPct'], 'avg': t['meanResTime'],
                     'p90': t['pct1ResTime'], 'p95': t['pct2ResTime'], 'p99': t['pct3ResTime'], 'max': t['maxResTime'],
                     'tps': t['throughput'], 'labels': {k: v for k, v in s.items() if k != 'Total'}, 'st': st})
    rows.sort(key=lambda r: r['users'])
    has_steady = all(r['st'] for r in rows)
    base = rows[0]

    def active(r):
        return r['st']['act_avg'] if has_steady else r['users']   # 이론 TPS 는 정상상태 평균 활성 인원 기준

    def tps(r):
        return r['st']['tps'] if has_steady else r['tps']

    def avg(r):
        return r['st']['avg'] if has_steady else r['avg']

    def p90(r):
        return r['st']['p90'] if has_steady else r['p90']

    def lat(r):
        # 티켓 합격 기준은 Latency(첫 바이트). JTL이 있으면 정상상태 평균 Latency, 없으면 대시보드 평균 응답시간(elapsed, 보수적)으로 대체
        return r['st']['lat_avg'] if has_steady else r['avg']

    base_rt_s = avg(base) / 1000.0
    out = ['## 단계별 대시보드 비교 (statistics.json 추출)', '']
    out.append('| 설정 인원 | 샘플 | 에러% | 대시보드 TPS | 평균 RT | p90 | p95 | p99 | max |')
    out.append('|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for r in rows:
        out.append(f"| {r['users']} | {r['n']} | {r['err_pct']:.2f} | {r['tps']:.2f} | {r['avg']:.0f} | {r['p90']:.0f} | {r['p95']:.0f} | {r['p99']:.0f} | {r['max']:.0f} |")
    out.append('')
    out.append('- 대시보드 TPS는 램프업·꼬리 구간을 포함한 전체 평균이라 단계별 램프업(90→120s)이 다르면 인원당 TPS가 희석된다. '
               '변곡점 판정은 아래 정상상태 지표로 한다.')
    out.append('')
    if has_steady:
        out.append(f'## 정상상태 지표 — 활성 스레드가 최대의 {STEADY_RATIO:.0%} 이상으로 이어진 가장 긴 구간 (JTL allThreads)')
        out.append('')
        out.append('| 설정 인원 | 최대 동시 활성 | 정상상태 활성(최소~평균~최대) | 유지 구간(s) | 스레드 수명(s) | 정상상태 TPS | 이론 TPS(기준RT) | TPS 효율 | 평균 RT | 보정 평균 Latency | 원본 평균 Latency | elapsed 대체 건수 | p90 | 에러% | 판정 |')
        out.append('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
    else:
        out.append('## 판정 (JTL이 없어 대시보드 Total 기준 — 램프업 희석 주의)')
        out.append('')
        out.append('| 설정 인원 | TPS | 이론 TPS(기준RT) | TPS 효율 | 평균 RT | p90 | 판정 |')
        out.append('|---:|---:|---:|---:|---:|---:|---|')
    knee = None
    design_warn = []
    failed = []   # 합격선 미달 단계 — 이 단계들은 성능 결론(변곡점 없음·선형 구간)의 근거가 될 수 없다
    for r in rows:
        act = active(r)
        theo = act / (base_rt_s + a.think_s) if (base_rt_s + a.think_s) > 0 else 0.0
        eff = (tps(r) / theo) if theo else 0.0
        short = has_steady and r['st']['window_s'] < MIN_WINDOW_S
        reasons = []
        # 합격선은 실행 전체 기준(대시보드 Total 에러율) — 정상상태 구간만 보면 램프업 중 실패가 빠진다
        if r['err_pct'] >= a.error_pct:
            reasons.append(f"E 합격선 초과 에러율 {r['err_pct']:.2f}% ≥ {a.error_pct}% (FAIL)")
            failed.append(r)
        if lat(r) >= a.hard_ms:
            reasons.append(f"H 합격선 초과 평균Latency {lat(r):.0f}ms ≥ {a.hard_ms:.0f} (FAIL)")
            if r not in failed: failed.append(r)
        if r['st'] and (r['st']['kill_5xx'] or r['st']['kill_slow']):
            reasons.append(f"K 중단 조건 샘플 5xx {r['st']['kill_5xx']}건·{a.hard_ms / 1000:.0f}초 이상 {r['st']['kill_slow']}건 (FAIL)")
            if r not in failed: failed.append(r)
        if lat(r) >= a.latency_ms:
            reasons.append(f"A 평균Latency {lat(r):.0f}ms ≥ {a.latency_ms:.0f}")
        if r is not base and not short and eff < a.tps_eff:
            reasons.append(f"B TPS효율 {eff:.2f} < {a.tps_eff}")
        if r is not base and p90(base) > 0 and p90(r) >= a.p90_ratio * p90(base) and p90(r) >= a.p90_floor:
            reasons.append(f"C p90 {p90(r):.0f}ms ≥ {a.p90_ratio}×기준({p90(base):.0f})")
        verdict = '변곡점 후보: ' + '; '.join(reasons) if reasons else ('기준' if r is base else '선형 구간')
        if short:
            verdict += f' ⚠유지구간 {r["st"]["window_s"]:.0f}s<{MIN_WINDOW_S:.0f}s (참고용)'
        if reasons and knee is None:
            knee = (r, reasons)
        if has_steady:
            st = r['st']
            raw_lat = f"{st['lat_raw_avg']:.0f}" if st['lat_raw_avg'] is not None else '-'
            if st['peak'] < r['users']:
                design_warn.append(f"{r['users']}명 단계: 최대 동시 활성 {st['peak']}명, 스레드 수명 {st['avg_life_s']:.0f}s < 램프업 — 설정 인원이 동시에 몰린 적이 없음")
            out.append(f"| {r['users']} | {st['peak']} | {st['act_min']}~{st['act_avg']:.1f}~{st['act_max']} | {st['window_s']:.0f} | {st['avg_life_s']:.0f} | "
                       f"{st['tps']:.2f} | {theo:.2f} | {eff:.2f} | "
                       f"{st['avg']:.0f} | {st['lat_avg']:.0f} | {raw_lat} | {st['lat_fallback']} | {st['p90']:.0f} | {st['err_pct']:.2f} | {verdict} |")
        else:
            out.append(f"| {r['users']} | {r['tps']:.2f} | {theo:.2f} | {eff:.2f} | {r['avg']:.0f} | {r['p90']:.0f} | {verdict} |")
    out.append('')
    out.append('- 판정에는 보정 평균 Latency를 사용한다. Latency 누락 또는 실패 샘플의 0ms는 해당 elapsed로 대체하고, 정상 응답의 0ms는 유지한다. '
               '원본 평균은 기록된 Latency만 집계(누락 제외)하며, 대체 건수는 정상상태 구간 기준이다. 원본 JTL은 변경하지 않는다.')
    out.append(f'- 정상상태 = 활성 스레드가 최대의 {STEADY_RATIO:.0%} 이상인 샘플이 시간순으로 끊기지 않고 이어진 가장 긴 구간. '
               '최대치의 첫·마지막 관측 사이를 통째로 잡으면 시작·종료가 겹쳐 활성 수가 오르내리는 구간까지 유지로 세어 TPS 와 유지 시간이 부풀려진다.')
    out.append(f'- 이론 TPS(기준RT) = 정상상태 평균 활성 인원 ÷ (기준단계 평균RT {avg(base):.0f}ms + think {a.think_s:.1f}s): 응답시간이 기준 수준을 유지할 때 나와야 할 처리량(Little의 법칙).')
    out.append(f'- TPS 효율 = 실제 ÷ 이론. 1.0 근처면 서버가 인원 증가를 그대로 소화, {a.tps_eff} 미만이면 응답 지연으로 처리량 손실 = 병목.')
    out.append(f'- 변곡점 기준: A 평균 Latency ≥ {a.latency_ms:.0f}ms(이슈티켓 목표 "1초 이내"가 깨지는 지점; JTL 없으면 elapsed 대체) / B TPS 효율 < {a.tps_eff} / C p90 ≥ {a.p90_ratio}× 기준단계 and ≥ {a.p90_floor:.0f}ms. 합격선은 별도: H 평균 Latency ≥ {a.hard_ms:.0f}ms(과정 하드리밋)면 FAIL')
    out.append('')
    if design_warn:
        out.append('**설계 경고 (동시성 미달)**')
        for w in design_warn:
            out.append('- ' + w)
        out.append('- 원인: 스레드 수명 = loop 3 × 6단계 × (think + RT) 이 램프업(90~120s)보다 짧아 앞 스레드가 끝난 뒤 뒤 스레드가 시작됨. '
                   'think time(3~5s)·loop(≤3)·램프업(90~120s)은 개발가이드 하드리밋이라 늘릴 수 없음 → 램프업을 하한 90s로 두어 겹침을 최대화하고, 보고서에는 설정 인원이 아니라 실제 최대 동시 활성 인원을 명시할 것.')
        out.append('')
    if missing_dirs:
        out.append('**단계 누락** — 요청한 폴더 중 statistics.json 이 없어 비교에서 빠진 단계: ' + ', '.join(missing_dirs)
                   + '. 4단계가 모두 있을 때까지 이 비교는 부분 결과다.')
        out.append('')
    if failed:
        out.append('**합격선 미달 단계: ' + ', '.join(f"{r['users']}명" for r in failed) + '** — 에러율·평균 Latency 가 과정 하드리밋을 넘었거나 중단 조건 샘플(5xx·60초 이상)이 있다. '
                   '이 단계는 "병목 미관측"의 근거가 될 수 없으며, 원인(5xx·타임아웃·미등록 계정 등)을 먼저 확인해야 한다.')
        out.append('')
    if knee:
        r, reasons = knee
        out.append(f"**변곡점 지표: {r['users']}명 단계** — " + '; '.join(reasons))
        out.append('')
        out.append(f"### {r['users']}명 단계 API별 응답시간 (대시보드, 기준 {base['users']}명 대비)")
        out.append('')
        out.append('| API 단계 | 평균 RT 기준→해당(ms) | 배율 | p90 해당(ms) | 에러% |')
        out.append('|---|---:|---:|---:|---:|')
        for lb, v in r['labels'].items():
            b = base['labels'].get(lb); bavg = b['meanResTime'] if b else 0.0
            ratio = (v['meanResTime'] / bavg) if bavg else 0.0
            out.append(f"| {lb} | {bavg:.0f}→{v['meanResTime']:.0f} | {ratio:.1f}× | {v['pct1ResTime']:.0f} | {v['errorPct']:.2f} |")
    elif missing_dirs:
        out.append(f"**변곡점 지표: 판정 보류** — 비교된 {len(rows)}개 단계에서는 변곡점이 없었으나 단계가 누락돼 전체 결론을 내릴 수 없다.")
    else:
        out.append(f"**변곡점 지표: 측정 범위({rows[0]['users']}~{rows[-1]['users']}명) 내 변곡점 없음** — 평균 RT가 합격선 아래이고 TPS가 이론값을 따라감(선형 구간). "
                   '보고서에는 "최대 단계까지 병목 미관측, 다음 증설 단계에서 재측정 필요"로 서술.')
    out.append('')
    out.append('보고서 첨부 그래프(각 대시보드 index.html → Charts): Response Times Over Time, Transactions Per Second, '
               'Response Time Percentiles Over Time, Active Threads Over Time — 인원 증가 시점과 RT 상승 시점이 겹치는지 보인다.')
    text = '\n'.join(out)
    print(text)
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
        print(f'\n(저장: {a.out})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
