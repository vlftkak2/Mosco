"""시트(원판) 계획의 로트 배정 · kg 정수 배부 (가공최적화 ④ 결과와 재고가공등록 초안이 같은 함수를 쓴다 → 숫자가 항상 같음).

로트 배정: 같은 창고 · 같은 규격 로트를 입고 순(오래된 것 먼저)으로 쓰고, 원판 패턴을 차례대로 로트에 나눠 담는다.
  → 로트마다 '쓰는 매수'와 '그 매수에서 나오는 품목별 매수'가 정해진다.
kg 배부 (로트마다):
  투입 = 그 로트를 다 쓰면 재고 중량 그대로, 일부면 재고 중량 × 쓰는 매수 ÷ 재고 매수 (소수 셋째 자리)
  생산 = 품목별 이론중량(폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000 × 매수)을 kg 정수로 (합계도 정수, 큰 나머지 순)
  로스 = 투입 − 생산 → 품목 생산 비율로 kg 정수 배부 (투입에 소수가 있으면 0.001 단위)
  이론중량 합계가 실제 투입보다 무거우면 투입을 이론 비율로 나누고 로스 0.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP

ONE = Decimal("1")
MILLI = Decimal("0.001")


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


def allocate(total, bases, step) -> list[Decimal]:
    """total 을 bases 비율로 step 단위로 나눈다 (합계 = total 정확히 · 남는 단위는 큰 나머지 순)."""
    total, step = _d(total), _d(step)
    bases = [_d(b) for b in bases]
    if not bases:
        return []
    base_sum = sum(bases)
    if base_sum <= 0:
        bases = [ONE] * len(bases)
        base_sum = Decimal(len(bases))
    units = int((total / step).to_integral_value(rounding=ROUND_FLOOR))
    raw = [Decimal(units) * b / base_sum for b in bases]
    floors = [int(r.to_integral_value(rounding=ROUND_FLOOR)) for r in raw]
    left = units - sum(floors)
    order = sorted(range(len(bases)), key=lambda i: (-(raw[i] - floors[i]), i))
    for i in order[:left]:
        floors[i] += 1
    out = [Decimal(f) * step for f in floors]
    # step 로 나눠떨어지지 않는 끝수는 첫 줄에 (합계 = total 유지)
    rest = total - sum(out)
    if rest and out:
        out[0] += rest
    return out


def split_lots(sheet_patterns: list[dict], lots: list[dict]) -> list[dict]:
    """원판 패턴을 로트에 차례대로 배정. sheet_patterns = [{sheets, columns:[{pieces:[[id, len], …]}]}]
    lots = [{sourcetype, sourceno, sourceline, qty, weight}] (쓰는 순서). 반환: 로트별 {lot, use, counts:{품목id: 매수}}"""
    queue = [{"lot": lot, "left": int(_d(lot.get("qty")).to_integral_value(rounding=ROUND_FLOOR)), "use": 0, "counts": {}} for lot in lots]
    i = 0
    for sp in sheet_patterns or []:
        per_sheet: dict = {}
        for col in sp.get("columns") or []:
            for piece in col.get("pieces") or []:
                key = piece[0] if isinstance(piece, (list, tuple)) else piece.get("id")
                per_sheet[key] = per_sheet.get(key, 0) + 1
        need = int(sp.get("sheets") or 0)
        while need > 0:
            if i >= len(queue):
                raise ValueError("계획 원판 매수가 로트 재고보다 많습니다.")
            slot = queue[i]
            take = min(need, slot["left"])
            if take <= 0:
                i += 1
                continue
            slot["left"] -= take
            slot["use"] += take
            need -= take
            for key, n in per_sheet.items():
                slot["counts"][key] = slot["counts"].get(key, 0) + n * take
    return [{"lot": q["lot"], "use": q["use"], "counts": q["counts"]} for q in queue if q["use"] > 0]


# 시트 · 판재 생산 kg 정수 처리 (False = 이론중량 그대로 · 소수 셋째 자리). 켜면 ④ 결과 · 재고가공등록이 함께 정수로 바뀐다
ROUND_PRODUCTION = False


def int_split(input_kg, theory) -> tuple[list[Decimal], list[Decimal]]:
    """투입 kg 와 품목별 이론중량 → (품목별 생산 kg 정수, 품목별 로스). 생산 + 로스 = 투입 정확히.
    이론 합계가 투입보다 무거우면 투입을 이론 비율로 나누고 로스 0."""
    input_kg = _d(input_kg)
    theory = [_d(x) for x in theory]
    if not theory:
        return [], []
    if sum(theory) > input_kg:
        step = ONE if ROUND_PRODUCTION and input_kg == input_kg.to_integral_value() else MILLI
        return allocate(input_kg, theory, step), [Decimal(0)] * len(theory)
    if not ROUND_PRODUCTION:
        # 생산 = 품목별 이론중량 (소수 셋째 자리), 로스 = 투입 − 생산 → 생산 비율로 0.001kg 단위 배부
        prods = [x.quantize(MILLI, rounding=ROUND_HALF_UP) for x in theory]
        return prods, allocate(input_kg - sum(prods), prods, MILLI)
    prod_total = sum(theory).to_integral_value(rounding=ROUND_HALF_UP)
    if prod_total > input_kg:
        prod_total = input_kg.to_integral_value(rounding=ROUND_FLOOR)
    prods = allocate(prod_total, theory, ONE)
    loss_total = input_kg - prod_total
    return prods, allocate(loss_total, prods, ONE if loss_total == loss_total.to_integral_value() else MILLI)


def lot_weights(lot: dict, use: int, pieces: list[dict], counts: dict, factor) -> dict:
    """로트 1개의 투입 · 품목별 생산 · 로스 (kg). pieces = 계획 품목 [{key, width, length}]."""
    qty, weight = _d(lot.get("qty")), _d(lot.get("weight"))
    use_d = Decimal(use)
    input_kg = weight if use_d >= qty else (weight * use_d / qty).quantize(MILLI, rounding=ROUND_HALF_UP) if qty > 0 else Decimal(0)
    rows = [p for p in pieces if counts.get(p["key"], 0) > 0]
    theory = [_d(p["width"]) * _d(p["length"]) * _d(factor) / Decimal(1_000_000) * counts[p["key"]] for p in rows]
    total_theory = sum(theory) if theory else Decimal(0)
    if not rows:
        return {"input": input_kg, "rows": [], "production": Decimal(0), "loss": input_kg}
    prods, losses = int_split(input_kg, theory)
    out = [{"key": p["key"], "width": p["width"], "length": p["length"], "qty": counts[p["key"]], "weight": w, "loss": l}
           for p, w, l in zip(rows, prods, losses)]
    return {"input": input_kg, "rows": out, "production": sum(prods), "loss": sum(losses)}


def plan_allocation(sheet_patterns: list[dict], pieces: list[dict], lots: list[dict], factor) -> dict:
    """계획 전체: 로트별 배정 + kg 정수 배부 + 품목별 합계 (④ 표시 · 재고가공등록 초안 공통)."""
    parts = []
    for part in split_lots(sheet_patterns, lots):
        kg = lot_weights(part["lot"], part["use"], pieces, part["counts"], factor)
        parts.append({**part, **kg})
    by_item: dict = {}
    for part in parts:
        for row in part["rows"]:
            item = by_item.setdefault(row["key"], {"weight": Decimal(0), "loss": Decimal(0)})
            item["weight"] += row["weight"]
            item["loss"] += row["loss"]
    return {"parts": parts, "input": sum((p["input"] for p in parts), Decimal(0)),
            "production": sum((p["production"] for p in parts), Decimal(0)), "loss": sum((p["loss"] for p in parts), Decimal(0)),
            "by_item": by_item}
