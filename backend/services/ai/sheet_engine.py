"""시트 가공 계산 엔진 (시안 STEEL119 시트가공 v5 SheetEngine 을 그대로 옮김, 순수 함수 · DB 비의존).

모델: 원판(W×L)을 "열(column)"로 먼저 가르고(길이방향 절단), 각 열을 제품 길이로 자른다(2단 기요틴).
  - 열 폭 합계:   Σcw + (열수-1)·k ≤ Wn (= W − 폭 여유)
  - 열 길이 합계: Σlen + (개수-1)·k ≤ Lc (= L)
  - 중량 = 폭 × 길이 × 두께 × 7.85e-6 (kg, mm 입력)
  - 절단 간격 k · 끝단 여유는 0 (시안과 같음)
env = {"W", "L", "k", "Wn", "Lc", "t"}
item / scope 원소 = {"id", "w", "l", "q"}  (id: 발주 품목 = 정수 순번, 가공 후보 = "x0", "x1" …)
"""
from __future__ import annotations

from math import ceil, floor

RHO = 7.85e-6
EPS = 1e-9
ENUM_CAP = 150_000      # 열 패턴 나열 방문 노드 상한 (시안과 같음)
K3_STEP_CAP = 400_000   # 패턴 3종 조합 탐색 반복 상한 (Python 응답 시간 보호용 안전장치)


def kg_of(w: float, l: float, t: float) -> float:
    return w * l * t * RHO


def cols_fit(cw: float, env: dict) -> int:
    return 0 if cw > env["Wn"] + EPS else int(floor((env["Wn"] + env["k"] + EPS) / (cw + env["k"])))


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
    """발주 전체를 채우는 최소 열 수: 패턴 1~3종 반복 조합(정확 탐색) + 탐욕 보정."""
    total = sum(it["q"] * (it["l"] + k) for it in items)
    lb = int(ceil(total / (lc + k) - 1e-9))
    pats = enum_patterns(items, lc, k) if pats is None else pats
    if not pats:
        return None
    need = [it["q"] for it in items]
    count = len(items)
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
                lim = best["N"] if best else lb * 2 + 2
                for m1 in range(1, lim):
                    m2, ok = 0, True
                    for i in range(count):
                        rem = need[i] - m1 * pa["n"][i]
                        if rem > 0:
                            if not pb["n"][i]:
                                ok = False
                                break
                            m2 = max(m2, int(ceil(rem / pb["n"][i])))
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
                    m1 = 1
                    while m1 < best["N"] and not stop:
                        m2 = 1
                        while m1 + m2 < best["N"]:
                            steps += 1
                            m3, ok = 0, True
                            for i in range(count):
                                rem = need[i] - m1 * pa["n"][i] - m2 * pb["n"][i]
                                if rem > 0:
                                    if not pc["n"][i]:
                                        ok = False
                                        break
                                    m3 = max(m3, int(ceil(rem / pc["n"][i])))
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
    while any(r > 0 for r in rem) and guard < 2000:
        guard += 1
        bp, bv = None, -1.0
        for p in pats[:400]:
            v = sum(min(p["n"][i], max(0, rem[i])) * (items[i]["l"] + k) for i in range(count))
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
    t = env["t"]
    plan["sheets"] = sheets
    plan["produced"] = produced
    plan["scope"] = scope
    plan["input_kg"] = sheets * kg_of(env["W"], env["L"], t)
    plan["ordered_kg"] = sum(o["q"] * kg_of(o["w"], o["l"], t) for o in scope)
    plan["produced_kg"] = sum(produced[o["id"]] * kg_of(o["w"], o["l"], t) for o in scope)
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


def plan_mixed(env: dict, scope: list[dict], variant: str = "min", cache: dict | None = None) -> dict:
    """같은 폭 혼합: 'min' = 원판 최소 · 발주수량 정확히 / 'repeat' = 패턴 1종 반복(초과 생산 허용)."""
    w = scope[0]["w"]
    ncol = cols_fit(w, env)
    if ncol < 1:
        return invalid(f"제품 폭 {_num(w)}mm가 원판 사용 폭 {_num(env['Wn'])}mm보다 넓음")
    too_long = next((o for o in scope if o["l"] > env["Lc"] + EPS), None)
    if too_long:
        return invalid(f"제품 길이 {_num(too_long['l'])}mm가 원판 사용 길이 {_num(env['Lc'])}mm보다 김")
    items = [{"id": o["id"], "l": o["l"], "q": o["q"], "w": o["w"]} for o in scope]
    cache = {} if cache is None else cache
    ckey = (env["Lc"], env["k"], tuple((it["l"], it["q"]) for it in items))
    if ckey not in cache:
        pats = enum_patterns(items, env["Lc"], env["k"])
        cache[ckey] = (pats, solve_columns(items, env["Lc"], env["k"], pats))
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
            if x * (a["cw"] + env["k"]) + y * (b["cw"] + env["k"]) > env["Wn"] + env["k"] + EPS:
                continue
            cap = x * a["n"] + y * b["n"]
            if cap > 0 and (best is None or cap > best["cap"] or (cap == best["cap"] and x + y < best["x"] + best["y"])):
                best = {"x": x, "y": y, "cap": cap}
    if best is None:
        if o["w"] > env["Wn"] + EPS and o["l"] > env["Wn"] + EPS:
            why = f"제품 폭·길이가 모두 원판 사용 폭 {_num(env['Wn'])}mm보다 큼"
        elif o["l"] > env["Lc"] + EPS and o["w"] > env["Lc"] + EPS:
            why = f"제품이 원판 사용 길이 {_num(env['Lc'])}mm보다 큼"
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
                    extra_kg += sp["sheets"] * kg_of(e["w"], e["l"], env["t"])
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
        o = scope[0]
        a, m, b = plan_single(env, o, "A"), plan_single(env, o, "mix"), plan_single(env, o, "B")
        if not any(p["valid"] for p in (a, m, b)):
            return {"error": a.get("reason") or m.get("reason") or b.get("reason")}
        if hist_ok and hist["counts"].get(o["id"], 0) > 0:
            h = plan_manual(env, [o], [hist["counts"][o["id"]]])
            if h["valid"]:
                h["source"] = hist.get("source")
            add(h, f"과거 가공이력 {hist.get('source') or ''}".strip())
        add(a, "")
        add(m, "열별 방향 혼합")
        add(b, "제품 회전")
    seen, uniq = set(), []
    for p in (with_extras(p, env, extras) for p in lst):
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


def env_of(raw_w: float, raw_l: float, t: float, orientation: str, side: float) -> dict:
    """'90도 회전' = 원판을 돌려 놓고 자른다: 가로/세로 역할을 바꿔 계산. 폭 여유는 열을 늘어놓는 방향에서 뺀다."""
    w, l = (raw_w, raw_l) if orientation == "NORMAL" else (raw_l, raw_w)
    return {"W": w, "L": l, "k": 0.0, "Wn": w - max(0.0, side), "Lc": l, "t": t}


def coil_shear(coil_w: float, coil_kg: float, t: float, side: float, orders: list[dict], extras: list[dict]) -> dict | None:
    """시트 발주를 현재고 코일에서 길이로 잘라 만든다 (시안 시트가공 수정본 coilCalc · 최적화 없음).

    폭 방향 줄 수 = ⌊(코일 폭 − 폭 여유) ÷ 제품 폭⌋. 발주 목록 순서대로 남은 코일 길이 안에서 채우고,
    부족이 하나도 없을 때만 가공 후보 길이(긴 것부터)로 남는 코일을 채운다. 줄이 1개도 안 나오는 품목이 있으면 None."""
    usable = coil_w - max(0.0, side)
    lanes_of = lambda w: int(floor(usable / w + 1e-9)) if w > 0 else 0
    if not orders or coil_kg <= 0 or any(lanes_of(o["w"]) < 1 for o in orders):
        return None
    per_mm = kg_of(coil_w, 1, t)
    rem = coil_kg / per_mm
    used_mm = out_kg = short_mm = 0.0
    rows = []
    for o in orders:
        ln = lanes_of(o["w"])
        need_n = int(ceil(o["q"] / ln))
        n = min(need_n, int(floor(rem / o["l"] + 1e-9)))
        length = n * o["l"]
        prod = n * ln
        rem -= length
        used_mm += length
        out_kg += kg_of(o["w"], o["l"], t) * prod
        short_mm += (need_n - n) * o["l"]
        rows.append({"o": o, "lanes": ln, "cuts": n, "len": length, "prod": prod, "short": max(0, o["q"] - prod)})
    ex_rows = []
    if not short_mm:
        for e in sorted(extras, key=lambda x: -x["l"]):
            ln = lanes_of(e["w"])
            n = int(floor(rem / e["l"] + 1e-9)) if ln >= 1 else 0
            if n > 0:
                length = n * e["l"]
                rem -= length
                used_mm += length
                out_kg += kg_of(e["w"], e["l"], t) * n * ln
                ex_rows.append({"e": e, "lanes": ln, "cuts": n, "len": length, "prod": n * ln})
    in_kg = used_mm * per_mm
    return {"rows": rows, "ex_rows": ex_rows, "used_mm": used_mm, "input_kg": in_kg, "produced_kg": out_kg,
            "scrap_kg": max(0.0, in_kg - out_kg), "yield_pct": 100 * out_kg / in_kg if in_kg else 0.0,
            "remain_mm": rem, "remain_kg": rem * per_mm, "short_mm": short_mm, "short_kg": short_mm * per_mm,
            "short_pcs": sum(r["short"] for r in rows), "per_mm": per_mm}
