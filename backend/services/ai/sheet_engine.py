"""시트 가공 계산 엔진 (시안 STEEL119 시트가공 v5 SheetEngine 을 그대로 옮김, 순수 함수 · DB 비의존).

모델: 원판(W×L)을 "열(column)"로 먼저 가르고(길이방향 절단), 각 열을 제품 길이로 자른다(2단 기요틴).
  - 열 폭 합계:   Σcw + (열수-1)·kw ≤ Wn (= W − 폭 여유) · kw = 0
  - 열 길이 합계: Σlen + (개수-1)·k ≤ Lc (= L)
  - 중량 = 폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000 (kg, mm 입력 · 코일 길이 샤링과 같은 식)
  - 길이 여유 a: 제품 1장 절단 길이 = 제품 길이 + a → Σ(길이 + a) ≤ L.
    k = a, Lc = L − a 로 두면 위 열 길이 조건(Σlen + (개수-1)·k ≤ Lc)과 정확히 같다. a = 0 이면 시안과 같음.
env = {"W", "L", "k", "kw", "Wn", "Lc", "t", "f"}  (f = 두께 × 비중 + 도금상수)
item / scope 원소 = {"id", "w", "l", "q"}  (id: 발주 품목 = 정수 순번, 가공 후보 = "x0", "x1" …)
"""
from __future__ import annotations

import threading
from math import ceil, floor

EPS = 1e-9
ENUM_CAP = 150_000      # 열 패턴 나열 방문 노드 상한 (시안과 같음)
K3_STEP_CAP = 400_000   # 패턴 3종 조합 탐색 반복 상한 (Python 응답 시간 보호용 안전장치)


def kg_env(env: dict, w: float, l: float) -> float:
    """원판 · 제품 이론중량 = 폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000."""
    return w * l * env["f"] / 1e6


def too_long_text(env: dict, length: float, where: str = "이 방향 원판 길이") -> str:
    a = env.get("k") or 0.0
    if a > EPS:
        return f"제품 길이 {fmt_num(length)}mm + 길이 여유 {fmt_num(a)}mm가 {where} {fmt_num(env['L'])}mm보다 김"
    return f"제품 길이 {fmt_num(length)}mm가 {where} {fmt_num(env['Lc'])}mm보다 김"


def cols_fit(cw: float, env: dict) -> int:
    return 0 if cw > env["Wn"] + EPS else int(floor((env["Wn"] + env.get("kw", 0.0) + EPS) / (cw + env.get("kw", 0.0))))


def per_col(length: float, lc: float, k: float) -> int:
    return 0 if length > lc + EPS else int(floor((lc + k + EPS) / (length + k)))


def enum_patterns(items: list[dict], lc: float, k: float, cap: int = ENUM_CAP) -> list[dict]:
    """한 열에 들어갈 (제품별 개수) 조합 중 더 넣을 수 없는 조합(극대 패턴)을 모두 나열. 채운 길이가 긴 순."""
    n = len(items)
    res, cur = [], [0] * n
    max_cnt = [min(it["q"], per_col(it["l"], lc, k)) for it in items]
    nodes = 0

    def dfs(i, s, m):
        nonlocal nodes
        nodes += 1
        if nodes > cap:
            return
        if i == n:
            if not m:
                return
            for j in range(n):
                if cur[j] < items[j]["q"] and s + items[j]["l"] + m * k <= lc + EPS:
                    return   # 더 넣을 수 있으면 극대 아님
            res.append({"n": cur[:], "m": m, "S": s, "value": s + m * k})
            return
        for c in range(max_cnt[i] + 1):
            s2, m2 = s + c * items[i]["l"], m + c
            if m2 and s2 + (m2 - 1) * k > lc + EPS:
                break
            cur[i] = c
            dfs(i + 1, s2, m2)
        cur[i] = 0

    dfs(0, 0.0, 0)
    res.sort(key=lambda p: -p["value"])   # 안정 정렬 (시안 Array.sort 와 같은 순서)
    return res


def solve_columns(items: list[dict], lc: float, k: float, pats: list[dict] | None = None):
    """발주 전체를 채우는 최소 열 수: 패턴 1~3종 반복 조합(정확 탐색) + 탐욕 보정.

    K=2 · K=3 · 탐욕 반복문은 속도를 위해 패턴 개수 벡터를 지역 변수로 꺼내 쓴다.
    방문 순서 · steps 계산 · 종료 조건은 원래 구현과 같아 결과도 같다."""
    total = sum(it["q"] * (it["l"] + k) for it in items)
    lb = int(ceil(total / (lc + k) - 1e-9))
    pats = enum_patterns(items, lc, k) if pats is None else pats
    if not pats:
        return None
    need = [it["q"] for it in items]
    count = len(items)
    rng = range(count)
    # 정수 수량이면 ceil(a / b) 대신 정수 나눗셈 -(-a // b) (같은 값, 훨씬 빠름)
    int_need = all(isinstance(q, int) for q in need)

    def cdiv(a, b):
        return -(-a // b) if int_need else int(ceil(a / b))
    best = None

    def consider(lst):
        nonlocal best
        total_cols = sum(x["m"] for x in lst)
        if best is None or total_cols < best["N"] or (total_cols == best["N"] and len(lst) < len(best["list"])):
            best = {"N": total_cols, "list": lst}

    # K=1 : 한 패턴만 반복
    for p in pats[:120]:
        if any(q > 0 and p["n"][i] == 0 for i, q in enumerate(need)):
            continue
        m = 0
        for i, q in enumerate(need):
            if q > 0:
                m = max(m, int(ceil(q / p["n"][i])))
        consider([{"p": p, "m": m}])

    def cover(lst):
        return all(sum(x["m"] * x["p"]["n"][i] for x in lst) >= q for i, q in enumerate(need))

    # K=2
    if best is None or best["N"] > lb:
        pool = pats[:40]
        done = False
        for a in range(len(pool)):
            for b in range(a + 1, len(pool)):
                pa, pb = pool[a], pool[b]
                na, nb = pa["n"], pb["n"]
                lim = best["N"] if best else lb * 2 + 2
                for m1 in range(1, lim):
                    m2, ok = 0, True
                    for i in rng:
                        rem = need[i] - m1 * na[i]
                        if rem > 0:
                            nbi = nb[i]
                            if not nbi:
                                ok = False
                                break
                            t = cdiv(rem, nbi)
                            if t > m2:
                                m2 = t
                    if not ok:
                        continue
                    if m2 < 1:
                        m2 = 0
                    if m1 + m2 < lim:
                        consider([{"p": pa, "m": m1}, {"p": pb, "m": m2}] if m2 else [{"p": pa, "m": m1}])
                    if best and best["N"] == lb:
                        break
                if best and best["N"] == lb:
                    done = True
                    break
            if done:
                break
    # K=3
    if best and best["N"] > lb and count >= 3:
        pool = pats[:26]
        steps = 0
        stop = False
        for a in range(len(pool)):
            for b in range(a + 1, len(pool)):
                for c in range(b + 1, len(pool)):
                    pa, pb, pc = pool[a], pool[b], pool[c]
                    na, nb, nc = pa["n"], pb["n"], pc["n"]
                    m1 = 1
                    while m1 < best["N"] and not stop:
                        ra = [need[i] - m1 * na[i] for i in rng]   # m1 고정 동안 같은 값
                        m2 = 1
                        while m1 + m2 < best["N"]:
                            steps += 1
                            m3, ok = 0, True
                            for i in rng:
                                rem = ra[i] - m2 * nb[i]
                                if rem > 0:
                                    nci = nc[i]
                                    if not nci:
                                        ok = False
                                        break
                                    t = cdiv(rem, nci)
                                    if t > m3:
                                        m3 = t
                            if ok and m1 + m2 + m3 < best["N"]:
                                consider([{"p": pa, "m": m1}, {"p": pb, "m": m2}, {"p": pc, "m": m3}] if m3
                                         else [{"p": pa, "m": m1}, {"p": pb, "m": m2}])
                            if best["N"] == lb or steps > K3_STEP_CAP:
                                stop = True
                                break
                            m2 += 1
                        m1 += 1
                    if stop:
                        break
                if stop:
                    break
            if stop:
                break
    # 탐욕 보정 (패턴 종류 제한 없음)
    rem = need[:]
    tally: dict = {}
    guard = 0
    unit = [items[i]["l"] + k for i in rng]
    top = [(p, p["n"]) for p in pats[:400]]
    while any(r > 0 for r in rem) and guard < 2000:
        guard += 1
        bp, bv = None, -1.0
        pos = [max(0, r) for r in rem]
        for p, n in top:
            v = sum(min(n[i], pos[i]) * unit[i] for i in rng)
            if v > bv + EPS:
                bv, bp = v, p
        if bp is None or bv <= 0:
            break
        for i in range(count):
            rem[i] -= bp["n"][i]
        key = tuple(bp["n"])
        if key in tally:
            tally[key]["m"] += 1
        else:
            tally[key] = {"p": bp, "m": 1}
    if not any(r > 0 for r in rem):
        lst = list(tally.values())
        if cover(lst):
            consider(lst)
    if best is None:
        return None
    return {"N": best["N"], "LB": lb, "list": best["list"], "at_lower_bound": best["N"] == lb}


def trim_to_exact(cols_counts: list[list[int]], items: list[dict]) -> list[list[int]]:
    """초과분을 뒤쪽 열부터 빼서 발주수량과 정확히 맞춘다."""
    over = [sum(c[i] for c in cols_counts) - it["q"] for i, it in enumerate(items)]
    for i in range(len(items)):
        ci = len(cols_counts) - 1
        while ci >= 0 and over[i] > 0:
            r = min(over[i], cols_counts[ci][i])
            cols_counts[ci][i] -= r
            over[i] -= r
            ci -= 1
    return [c for c in cols_counts if any(x > 0 for x in c)]


def piece_order(items: list[dict]) -> list[int]:
    """열 안 절단 순서: 긴 규격부터 놓되 가장 긴 규격은 맨 끝 (시안 pieceOrder 와 같음)."""
    longest = items[0]
    for it in items[1:]:
        if it["l"] > longest["l"]:
            longest = it
    order = list(range(len(items)))

    def key(i):
        it = items[i]
        return (1, 0.0) if it["id"] == longest["id"] else (0, -it["l"])
    return sorted(order, key=key)


def make_column(counts: list[int], items: list[dict], orient: str = "A") -> dict:
    pieces = []
    for i in piece_order(items):
        it = items[i]
        pieces += [{"id": it["id"], "len": it["l"], "wid": it["w"]} for _ in range(counts[i])]
    return {"orient": orient, "cw": items[0]["w"], "pieces": pieces}


def finish_plan(plan: dict, env: dict, scope: list[dict]) -> dict:
    produced = {o["id"]: 0 for o in scope}
    sheets = 0
    for sp in plan["sheet_patterns"]:
        sheets += sp["sheets"]
        for col in sp["columns"]:
            for p in col["pieces"]:
                produced[p["id"]] = produced.get(p["id"], 0) + sp["sheets"]
    plan["sheets"] = sheets
    plan["produced"] = produced
    plan["scope"] = scope
    plan["input_kg"] = sheets * kg_env(env, env["W"], env["L"])
    plan["ordered_kg"] = sum(o["q"] * kg_env(env, o["w"], o["l"]) for o in scope)
    plan["produced_kg"] = sum(produced[o["id"]] * kg_env(env, o["w"], o["l"]) for o in scope)
    plan["excess_kg"] = max(0.0, plan["produced_kg"] - plan["ordered_kg"])
    plan["scrap_kg"] = max(0.0, plan["input_kg"] - plan["produced_kg"])
    plan["scrap_pct"] = 100 * plan["scrap_kg"] / plan["input_kg"] if plan["input_kg"] else 0.0
    plan["yield_pct"] = 100 * plan["produced_kg"] / plan["input_kg"] if plan["input_kg"] else 0.0
    plan["delta"] = {o["id"]: produced[o["id"]] - o["q"] for o in scope}
    plan["valid"] = sheets > 0
    return plan


def invalid(reason: str) -> dict:
    return {"valid": False, "reason": reason, "sheet_patterns": [], "sheets": 0}


def _col_key(col: dict) -> str:
    return "|".join(f"{p['id']}:{p['len']:g}" for p in col["pieces"])


def chunk_to_sheets(cols: list[dict], ncol: int) -> list[dict]:
    """열 목록 → 원판 1장(ncol 열)씩 묶고, 같은 배치끼리 매수를 합친다."""
    groups: dict = {}
    for start in range(0, len(cols), ncol):
        cs = cols[start:start + ncol]
        key = "/".join(_col_key(c) for c in cs)
        if key in groups:
            groups[key]["sheets"] += 1
        else:
            groups[key] = {"sheets": 1, "columns": cs}
    return sorted(groups.values(), key=lambda g: -g["sheets"])


def _num(v: float) -> str:
    return f"{round(v, 1):g}"


# 열 패턴 탐색 결과는 (열 길이, 절단 간격, 품목 길이·수량)만으로 정해진다 → 요청 사이에도 재사용.
# 원자재 후보를 바꿔 고를 때마다 후보표 전체를 다시 계산하므로, 두 번째 선택부터는 거의 즉시 끝난다.
# 결과(pats, sol)는 읽기 전용으로만 쓴다 (plan_mixed 는 개수 벡터를 복사해서 고친다).
_SOLVE_CACHE: dict = {}
_SOLVE_CACHE_LOCK = threading.Lock()
_SOLVE_CACHE_MAX = 512


def _solve_cached(ckey, items: list[dict], lc: float, k: float):
    with _SOLVE_CACHE_LOCK:
        hit = _SOLVE_CACHE.get(ckey)
    if hit is not None:
        return hit
    pats = enum_patterns(items, lc, k)
    value = (pats, solve_columns(items, lc, k, pats))
    with _SOLVE_CACHE_LOCK:
        if len(_SOLVE_CACHE) >= _SOLVE_CACHE_MAX:
            _SOLVE_CACHE.clear()
        _SOLVE_CACHE[ckey] = value
    return value


def plan_mixed(env: dict, scope: list[dict], variant: str = "min", cache: dict | None = None) -> dict:
    """같은 폭 혼합: 'min' = 원판 최소 · 발주수량 정확히 / 'repeat' = 패턴 1종 반복(초과 생산 허용)."""
    w = scope[0]["w"]
    ncol = cols_fit(w, env)
    if ncol < 1:
        return invalid(f"제품 폭 {fmt_num(w)}mm가 이 방향 원판 폭 {fmt_num(env['Wn'])}mm보다 큼")
    too_long = next((o for o in scope if o["l"] > env["Lc"] + EPS), None)
    if too_long:
        return invalid(too_long_text(env, too_long["l"]))
    items = [{"id": o["id"], "l": o["l"], "q": o["q"], "w": o["w"]} for o in scope]
    cache = {} if cache is None else cache
    ckey = (env["Lc"], env["k"], tuple((it["l"], it["q"]) for it in items))
    if ckey not in cache:
        cache[ckey] = _solve_cached(ckey, items, env["Lc"], env["k"])
    pats, sol = cache[ckey]
    if not sol:
        return invalid("배치 가능한 패턴이 없음")
    lb_sheets = int(ceil(sol["LB"] / ncol))
    if variant == "repeat":
        best = None
        for p in pats[:120]:
            if any(it["q"] > 0 and not p["n"][i] for i, it in enumerate(items)):
                continue
            m = 0
            for i, it in enumerate(items):
                m = max(m, int(ceil(it["q"] / p["n"][i])))
            sheets = int(ceil(m / ncol))
            total_cols = sheets * ncol
            over = sum((total_cols * p["n"][i] - it["q"]) * it["l"] for i, it in enumerate(items))
            if best is None or sheets < best["sheets"] or (sheets == best["sheets"] and over < best["over"]):
                best = {"p": p, "sheets": sheets, "N": total_cols, "over": over}
        if best is None:
            return invalid("모든 규격을 포함하는 반복 패턴이 없음")
        cols = [make_column(best["p"]["n"], items) for _ in range(best["N"])]
        plan = {"kind": "mixed", "variant": variant, "ncol": ncol, "lb_sheets": lb_sheets,
                "sheet_patterns": chunk_to_sheets(cols, ncol), "pattern_count": 1}
        return finish_plan(plan, env, scope)
    counts = []
    for x in sol["list"]:
        counts += [x["p"]["n"][:] for _ in range(x["m"])]
    counts = trim_to_exact(counts, items)
    # 같은 개수 벡터끼리 붙게 정렬 (패턴 변경 횟수 최소화) - 시안 localeCompare 내림차순과 같은 문자열 비교
    counts.sort(key=lambda c: ",".join(str(v) for v in c), reverse=True)
    cols = [make_column(c, items) for c in counts]
    plan = {"kind": "mixed", "variant": variant, "ncol": ncol, "lb_sheets": lb_sheets,
            "sheet_patterns": chunk_to_sheets(cols, ncol), "at_lower_bound": sol["at_lower_bound"]}
    plan["pattern_count"] = len(plan["sheet_patterns"])
    return finish_plan(plan, env, scope)


def plan_single(env: dict, o: dict, mode: str = "A") -> dict:
    """단일 규격: 'A' 기본방향 / 'B' 제품 90° 회전 / 'mix' 열별 방향 혼합."""
    a = {"cw": o["w"], "len": o["l"], "n": per_col(o["l"], env["Lc"], env["k"])}
    b = {"cw": o["l"], "len": o["w"], "n": per_col(o["w"], env["Lc"], env["k"])}
    max_x = 0 if mode == "B" else cols_fit(a["cw"], env)
    max_y = 0 if mode == "A" else cols_fit(b["cw"], env)
    best = None
    for x in range(max_x + 1):
        for y in range(max_y + 1):
            if not x and not y:
                continue
            kw = env.get("kw", 0.0)   # 폭 방향 간격 (길이 여유 k 와 별개)
            if x * (a["cw"] + kw) + y * (b["cw"] + kw) > env["Wn"] + kw + EPS:
                continue
            cap = x * a["n"] + y * b["n"]
            if cap > 0 and (best is None or cap > best["cap"] or (cap == best["cap"] and x + y < best["x"] + best["y"])):
                best = {"x": x, "y": y, "cap": cap}
    if best is None:
        if o["w"] > env["Wn"] + EPS and o["l"] > env["Wn"] + EPS:
            why = f"제품 폭·길이가 모두 원판 사용 폭 {_num(env['Wn'])}mm보다 큼"
        elif o["l"] > env["Lc"] + EPS and o["w"] > env["Lc"] + EPS:
            why = (f"제품 + 길이 여유 {_num(env['k'])}mm가 원판 길이 {_num(env['L'])}mm보다 큼" if env.get("k", 0) > EPS
                   else f"제품이 원판 사용 길이 {_num(env['Lc'])}mm보다 큼")
        else:
            why = "원판에 배치할 수 없음"
        return invalid(why)

    def mk(orient, n):
        side = a if orient == "A" else b
        return {"orient": orient, "cw": side["cw"], "pieces": [{"id": o["id"], "len": side["len"], "wid": side["cw"]} for _ in range(n)]}
    template = [mk("A", a["n"]) for _ in range(best["x"])] + [mk("B", b["n"]) for _ in range(best["y"])]
    # 마지막 원판도 전체 패턴으로 가공 (남는 제품은 초과 생산)
    sps = [{"sheets": int(ceil(o["q"] / best["cap"])), "columns": template}]
    plan = {"kind": "single", "mode": mode, "x": best["x"], "y": best["y"], "cap": best["cap"], "ncol": best["x"] + best["y"],
            "lb_sheets": int(ceil(o["q"] / best["cap"])), "sheet_patterns": sps, "pattern_count": 1}
    return finish_plan(plan, env, [o])


def plan_single_multi(env: dict, scope: list[dict], cache: dict | None = None) -> dict:
    """단독절단 · 여러 품목: 품목끼리 섞지 않고 품목마다 따로 계산(plan_single 'A')해 합친다.
    패턴은 품목마다 1개, 총 원판 = 품목별 필요 원판의 합. 마지막 원판도 같은 패턴 → 초과는 생산(▲ 초과)으로 집계.
    같은 조건의 혼합절단 원판 수(mixed_sheets)를 함께 돌려준다 (절감 안내용)."""
    sps, lb = [], 0
    for o in scope:
        one = plan_single(env, o, "A")
        if not one["valid"]:
            return invalid(f"{fmt_num(o['w'])} × {fmt_num(o['l'])} 품목: {one.get('reason')}")
        lb += one.get("lb_sheets") or one["sheets"]
        sps += [{**sp, "item": o["id"]} for sp in one["sheet_patterns"]]
    plan = {"kind": "single_multi", "mode": "A", "ncol": max(len(sp["columns"]) for sp in sps), "lb_sheets": lb,
            "sheet_patterns": sps, "pattern_count": len(sps)}
    plan = finish_plan(plan, env, scope)
    mixed = plan_mixed(env, scope, "min", cache)
    plan["mixed_sheets"] = mixed["sheets"] if mixed.get("valid") else None
    return plan


def plan_manual(env: dict, scope: list[dict], counts: list[int]) -> dict:
    """열당 개수를 직접 지정해 반복 (과거 가공이력). 부족 · 초과가 생길 수 있다."""
    w = scope[0]["w"]
    ncol = cols_fit(w, env)
    if ncol < 1:
        return invalid("제품 폭이 원판 사용 폭보다 넓음")
    items = [{"id": o["id"], "l": o["l"], "q": o["q"], "w": o["w"]} for o in scope]
    m = sum(counts)
    if not m:
        return invalid("한 개 이상의 규격을 지정해 주세요")
    s = sum(c * items[i]["l"] for i, c in enumerate(counts))
    if s + (m - 1) * env["k"] > env["Lc"] + EPS:
        return invalid("열 길이 한도를 초과함")
    sheets = 1
    for i, it in enumerate(items):
        if counts[i] > 0:
            sheets = max(sheets, int(ceil(it["q"] / (counts[i] * ncol))))
    cols = [make_column(counts, items) for _ in range(sheets * ncol)]
    plan = {"kind": "mixed", "variant": "manual", "ncol": ncol, "lb_sheets": sheets,
            "sheet_patterns": chunk_to_sheets(cols, ncol), "pattern_count": 1}
    return finish_plan(plan, env, scope)


def with_extras(plan: dict, env: dict, extras: list[dict]) -> dict:
    """가공 후보(발주 외 길이)를 열의 남는 길이에 긴 것부터 채우고 '후보 생산'으로 따로 집계."""
    if not extras or plan.get("kind") != "mixed":
        return plan
    ex = sorted(extras, key=lambda e: -e["l"])
    produced = dict(plan["produced"])
    for e in ex:
        produced[e["id"]] = 0
    extra_kg = 0.0
    sps = []
    for sp in plan["sheet_patterns"]:
        columns = []
        for col in sp["columns"]:
            pieces = list(col["pieces"])
            used = sum(p["len"] for p in pieces) + max(0, len(pieces) - 1) * env["k"]
            for e in ex:
                while True:
                    add = e["l"] + (env["k"] if pieces else 0)
                    if used + add > env["Lc"] + 1e-9:
                        break
                    pieces.append({"id": e["id"], "len": e["l"], "wid": e["w"]})
                    used += add
                    produced[e["id"]] += sp["sheets"]
                    extra_kg += sp["sheets"] * kg_env(env, e["w"], e["l"])
            columns.append({**col, "pieces": pieces})
        sps.append({**sp, "columns": columns})
    out = {**plan, "sheet_patterns": sps, "produced": produced, "extra_list": ex, "extra_kg": extra_kg}
    out["produced_kg"] = plan["produced_kg"] + extra_kg
    out["excess_kg"] = plan["excess_kg"] + extra_kg
    out["scrap_kg"] = max(0.0, plan["input_kg"] - out["produced_kg"])
    out["scrap_pct"] = 100 * out["scrap_kg"] / plan["input_kg"] if plan["input_kg"] else 0.0
    out["yield_pct"] = 100 - out["scrap_pct"]
    out["delta"] = dict(plan["delta"])
    for e in ex:
        out["delta"][e["id"]] = produced[e["id"]]
    return out


def _best_fill(rest: float, lens: list[tuple], k: float, has_pieces: bool, node_cap: int = 20_000) -> list:
    """남는 길이 rest 에 lens[(id, len, wid)] 를 (개수 제한 없이) 넣어 남는 길이가 가장 작아지는 조합. 같으면 적은 칸."""
    lens = sorted(lens, key=lambda x: -x[1])
    best = {"rest": rest, "pick": []}
    nodes = 0

    def dfs(i, left, pick, first):
        nonlocal nodes
        nodes += 1
        if left < best["rest"] - 1e-9 or (abs(left - best["rest"]) <= 1e-9 and len(pick) < len(best["pick"])):
            best["rest"], best["pick"] = left, list(pick)
        if i >= len(lens) or nodes > node_cap or best["rest"] <= 1e-9:
            return
        item = lens[i]
        add = item[1] + (0 if first else k)
        if add <= left + 1e-9:
            pick.append(item)
            dfs(i, left - add, pick, False)   # 같은 길이를 또 넣어 볼 수 있음
            pick.pop()
        dfs(i + 1, left, pick, first)

    dfs(0, rest, [], not has_pieces)
    return best["pick"]


def fill_rest(plan: dict, env: dict) -> dict:
    """혼합절단: 원판 수는 그대로 두고 열마다 남는 길이에 같은 그룹 제품을 더 채운다 (남는 길이가 가장 작아지는 조합).
    더 나온 수량은 초과 생산(▲ N매 초과)으로 집계하고 로스로 계산하지 않는다. 과거 가공이력 안(manual)은 그대로 둔다."""
    if plan.get("kind") != "mixed" or plan.get("variant") == "manual" or not plan.get("scope"):
        return plan
    lens = [(o["id"], o["l"], o["w"]) for o in plan["scope"]]
    produced = dict(plan["produced"])
    added_kg = 0.0
    sps = []
    for sp in plan["sheet_patterns"]:
        columns = []
        for col in sp["columns"]:
            pieces = list(col["pieces"])
            used = sum(p["len"] for p in pieces) + max(0, len(pieces) - 1) * env["k"]
            pick = _best_fill(env["Lc"] - used, lens, env["k"], bool(pieces))
            for pid, length, wid in pick:
                pieces.append({"id": pid, "len": length, "wid": wid, "fill": True})
                produced[pid] = produced.get(pid, 0) + sp["sheets"]
                added_kg += sp["sheets"] * kg_env(env, wid, length)
            columns.append({**col, "pieces": pieces})
        sps.append({**sp, "columns": columns})
    if added_kg <= 0:
        return plan
    # 채운 뒤 배치가 같아진 패턴은 하나로 합친다 (매수 합산)
    merged: dict = {}
    for sp in sps:
        key = "/".join(_col_key(c) for c in sp["columns"])
        if key in merged:
            merged[key]["sheets"] += sp["sheets"]
        else:
            merged[key] = {**sp}
    sps = sorted(merged.values(), key=lambda g: -g["sheets"])
    out = {**plan, "sheet_patterns": sps, "produced": produced, "filled_kg": added_kg, "pattern_count": len(sps)}
    out["produced_kg"] = plan["produced_kg"] + added_kg
    out["excess_kg"] = plan.get("excess_kg", 0.0) + added_kg
    out["scrap_kg"] = max(0.0, plan["input_kg"] - out["produced_kg"])
    out["scrap_pct"] = 100 * out["scrap_kg"] / plan["input_kg"] if plan["input_kg"] else 0.0
    out["yield_pct"] = 100 * out["produced_kg"] / plan["input_kg"] if plan["input_kg"] else 0.0
    out["delta"] = {**plan["delta"], **{o["id"]: produced[o["id"]] - o["q"] for o in plan["scope"]}}
    return out


def col_desc(col: dict) -> str:
    groups: dict = {}
    for p in col["pieces"]:
        groups[p["len"]] = groups.get(p["len"], 0) + 1
    return " + ".join(f"{fmt_num(length)}×{n}" for length, n in groups.items())


def sp_desc(sp: dict) -> str:
    """원판 1장 구성 (같은 열은 묶어서 '(n열)')."""
    groups: dict = {}
    for c in sp["columns"]:
        d = col_desc(c)
        groups[d] = groups.get(d, 0) + 1
    return " / ".join(d + (f" ({n}열)" if len(groups) > 1 or n > 1 else "") for d, n in groups.items())


def fmt_num(v: float) -> str:
    """화면 표시용 숫자 (천 단위 쉼표, 소수 첫째 자리까지)."""
    text = f"{round(v, 1):,.1f}"
    return text[:-2] if text.endswith(".0") else text


def plans_for(env: dict, mode: str, scope: list[dict], extras: list[dict], hist: dict | None, cache: dict) -> dict:
    """한 원판 · 한 절단방향의 후보 안들. hist = {"counts": {품목id: 열당 개수}, "source": …}"""
    lst = []

    def add(p, tag):
        if p and p.get("valid"):
            p["tag"] = tag
            lst.append(p)
        return p

    hist_ok = bool(hist and hist.get("counts") and any(n > 0 for n in hist["counts"].values())
                   and all(n == 0 or any(o["id"] == i for o in scope) for i, n in hist["counts"].items()))
    if mode == "MIXED":
        base = plan_mixed(env, scope, "min", cache)
        if not base["valid"]:
            return {"error": base["reason"]}
        if hist_ok:
            h = plan_manual(env, scope, [hist["counts"].get(o["id"], 0) for o in scope])
            if h["valid"]:
                h["source"] = hist.get("source")
            add(h, f"과거 가공이력 {hist.get('source') or ''}".strip())
        add(base, "")
        add(plan_mixed(env, scope, "repeat", cache), "패턴 반복")
    else:
        # 절단방향(기본 · 90도 회전)마다 제품을 돌리지 않고 그 방향 그대로 놓는 안 하나만 만든다.
        # (열별 제품 회전 · 제품 회전 안은 만들지 않는다: 회전된 원판에서 제품을 다시 돌리면 기본 방향과 같은 배치가 된다)
        # 품목이 여러 개면 절단방향은 공통 · 한 품목이라도 이 방향에 못 놓으면 이 방향은 배치 불가
        for o in scope:
            if o["w"] > env["Wn"] + EPS:
                return {"error": f"제품 폭 {fmt_num(o['w'])}mm가 이 방향 원판 폭 {fmt_num(env['Wn'])}mm보다 큼"}
            if o["l"] > env["Lc"] + EPS:
                return {"error": too_long_text(env, o["l"])}
        if len(scope) > 1:
            add(plan_single_multi(env, scope, cache), "")
            return _uniq_plans(lst, env, extras)
        o = scope[0]
        a = plan_single(env, o, "A")
        if not a["valid"]:
            return {"error": a.get("reason")}
        if hist_ok and hist["counts"].get(o["id"], 0) > 0:
            h = plan_manual(env, [o], [hist["counts"][o["id"]]])
            if h["valid"]:
                h["source"] = hist.get("source")
            add(h, f"과거 가공이력 {hist.get('source') or ''}".strip())
        add(a, "")
    return _uniq_plans(lst, env, extras)


def _uniq_plans(lst: list[dict], env: dict, extras: list[dict]) -> dict:
    seen, uniq = set(), []
    # 가공 후보(사용자가 넣은 길이)를 먼저 채우고, 그래도 남는 길이에 같은 그룹 제품을 더 채운다 (혼합절단만)
    for p in (fill_rest(with_extras(p, env, extras), env) for p in lst):
        key = f"{p['sheets']}|{p['scrap_kg']:.2f}|" + "#".join(sp_desc(sp) for sp in p["sheet_patterns"])
        if key not in seen:
            seen.add(key)
            uniq.append(p)
    return {"plans": uniq[:2], "all": uniq}


def is_hist(p: dict) -> bool:
    return str(p.get("tag") or "").startswith("과거")


def orient_best(result: dict, mode: str) -> dict | None:
    """방향별 대표안: 단독절단은 제품 폭을 그 방향에 그대로 놓는 안(A형) 우선, 혼합절단은 로스중량이 가장 적은 안."""
    if result.get("error"):
        return None
    rest = [p for p in result["all"] if not is_hist(p)]
    if mode == "SINGLE":
        a = next((p for p in rest if p.get("mode") == "A"), None)
        if a:
            return a
    if rest:
        return sorted(rest, key=lambda p: (p["scrap_kg"], p["sheets"]))[0]
    return result["all"][0] if result["all"] else None


def env_of(raw_w: float, raw_l: float, t: float, orientation: str, side: float,
           allow: float = 0.0, sg: float = 7.85, coat: float = 0.0) -> dict:
    """'90도 회전' = 원판을 돌려 놓고 자른다: 가로/세로 역할을 바꿔 계산. 폭 여유는 열을 늘어놓는 방향에서 뺀다.
    길이 여유(allow)는 제품 1장마다 절단 길이에 더한다 → k = allow, Lc = L − allow (모듈 설명 참고)."""
    w, l = (raw_w, raw_l) if orientation == "NORMAL" else (raw_l, raw_w)
    a = max(0.0, allow or 0.0)
    return {"W": w, "L": l, "k": a, "kw": 0.0, "Wn": w - max(0.0, side), "Lc": l - a, "t": t, "f": t * sg + coat}


def coil_shear(coil_w: float, coil_kg: float, t: float, side: float, orders: list[dict], extras: list[dict],
               sg: float = 7.85, coat: float = 0.0, allow: float = 0.0, one_shot: bool = False, process_kg: float | None = None) -> dict | None:
    """시트 발주를 현재고 코일에서 길이로 잘라 만든다 (코일 길이 샤링 · 최적화 없음).

    코일 단중(kg/m) = 코일 폭 × (두께 × 비중 + 도금상수) ÷ 1,000 · 제품 이론중량 = 폭 × 길이 × (두께 × 비중 + 도금상수) ÷ 1,000,000
    폭 방향 줄 수 = ⌊(코일 폭 − 폭 여유) ÷ 제품 폭⌋ · 1장 절단 길이 = 제품 길이 + 길이 여유
    가공중량: 원샷 = 코일 전량 / 일부 = 입력값 (없으면 주문 소요 중량). 가공 길이 안에서 발주 순서대로 채우고,
    남는 길이는 가공 후보(긴 것부터) → 마지막 규격 순으로 더 자른다(초과). 줄이 1개도 안 나오는 품목이 있으면 None."""
    usable = coil_w - max(0.0, side)
    lanes_of = lambda w: int(floor(usable / w + 1e-9)) if w > 0 else 0
    if not orders or coil_kg <= 0 or any(lanes_of(o["w"]) < 1 for o in orders):
        return None
    factor = t * sg + coat                    # kg / (m² · mm 두께 반영)
    per_m = coil_w * factor / 1000            # 코일 단중 kg/m
    piece_kg = lambda w, l: w * l * factor / 1e6
    cut_m = lambda l: (l + max(0.0, allow)) / 1000
    total_m = coil_kg / per_m
    need_m = sum(int(ceil(o["q"] / lanes_of(o["w"]))) * cut_m(o["l"]) for o in orders)
    if one_shot:
        proc_kg = coil_kg
    else:
        proc_kg = need_m * per_m if process_kg is None or process_kg <= 0 else float(process_kg)   # 기본 = 주문 소요 중량 (원중량 · 소수 유지)
        proc_kg = min(proc_kg, coil_kg)
    proc_m = proc_kg / per_m
    rem = proc_m
    rows, out_kg, short_m = [], 0.0, 0.0
    for o in orders:
        ln = lanes_of(o["w"])
        need_n = int(ceil(o["q"] / ln))
        n = min(need_n, int(floor(rem / cut_m(o["l"]) + 1e-9)))
        rem -= n * cut_m(o["l"])
        short_m += (need_n - n) * cut_m(o["l"])
        rows.append({"o": o, "lanes": ln, "cuts": n, "over_cuts": 0, "len_m": n * cut_m(o["l"]), "over_m": 0.0})
    ex_rows = []
    if not short_m:
        for e in sorted(extras, key=lambda x: -x["l"]):        # 가공 후보 길이 먼저
            ln = lanes_of(e["w"])
            n = int(floor(rem / cut_m(e["l"]) + 1e-9)) if ln >= 1 else 0
            if n > 0:
                rem -= n * cut_m(e["l"])
                ex_rows.append({"e": e, "lanes": ln, "cuts": n, "len_m": n * cut_m(e["l"]), "prod": n * ln})
        last = rows[-1]                                          # 그래도 남으면 마지막 규격을 더 자른다 (▲ 초과)
        extra_n = int(floor(rem / cut_m(last["o"]["l"]) + 1e-9))
        if extra_n > 0:
            rem -= extra_n * cut_m(last["o"]["l"])
            last["over_cuts"] = extra_n
            last["over_m"] = extra_n * cut_m(last["o"]["l"])
    for r in rows:
        o = r["o"]
        r["prod"] = (r["cuts"] + r["over_cuts"]) * r["lanes"]
        r["short"] = max(0, o["q"] - r["prod"])
        r["over"] = max(0, r["prod"] - o["q"])
        out_kg += piece_kg(o["w"], o["l"]) * r["prod"]
    out_kg += sum(piece_kg(x["e"]["w"], x["e"]["l"]) * x["prod"] for x in ex_rows)
    used_m = proc_m - rem
    keep_kg = max(0.0, coil_kg - proc_kg)
    return {"rows": rows, "ex_rows": ex_rows, "per_m": per_m, "factor": factor, "sg": sg, "coat": coat, "allow": allow,
            "one_shot": one_shot, "total_m": total_m, "need_m": need_m, "need_kg": need_m * per_m,
            "process_m": proc_m, "input_kg": proc_kg, "used_m": used_m, "tail_m": rem,
            "produced_kg": out_kg, "scrap_kg": max(0.0, proc_kg - out_kg), "yield_pct": 100 * out_kg / proc_kg if proc_kg else 0.0,
            "keep_kg": keep_kg, "keep_m": keep_kg / per_m, "short_m": short_m, "short_kg": short_m * per_m,
            "short_pcs": sum(r["short"] for r in rows), "lanes_ok": True}