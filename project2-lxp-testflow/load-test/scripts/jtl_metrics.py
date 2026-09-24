"""요약·단계 비교에서 함께 쓰는 보수적 Latency 집계. 원본 JTL은 바꾸지 않는다."""
import math


def milliseconds(row, column):
    value = float(row.get(column, ''))
    if not math.isfinite(value) or value < 0:
        raise ValueError(f'{column}은 유한한 0 이상의 ms 값이어야 합니다: {value}')
    return value


def latency_stats(rows):
    raw, adjusted = [], []
    fallback = 0
    for row in rows:
        elapsed = milliseconds(row, 'elapsed')
        value = row.get('Latency', '')
        latency = milliseconds(row, 'Latency') if value and value.strip() else None
        if latency is not None:
            raw.append(latency)
        failed = row.get('success', '').strip().lower() != 'true'
        # Latency 누락과 실패 샘플의 0ms를 평균에서 빼거나 빠른 응답으로 세지 않는다.
        # 정상 응답의 유효한 0ms는 유지한다. 실패의 0ms는 elapsed로 보수적으로 판정한다.
        use_elapsed = latency is None or (failed and latency == 0)
        adjusted.append(elapsed if use_elapsed else latency)
        fallback += int(use_elapsed)
    return {
        'lat_avg': sum(adjusted) / len(adjusted) if adjusted else 0.0,
        'lat_raw_avg': sum(raw) / len(raw) if raw else None,
        'lat_fallback': fallback,
    }
