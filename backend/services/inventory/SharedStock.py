"""타사 재고현황 (재고 > 재고관리 · 플랫폼 운영사 001 · 모스코 계정 전용)

재고 공개에 동의한(서면 계약) 고객사의 재고를 모스코가 본다: 지금 재고 + 월말 재고 추이 · 월별 입고 / 판매 출고.
  - 대상: company01t.stock_open_yn = 'Y' 이고 이용 상태가 ACTIVE 인 고객사 (001 제외)
  - 보여 주는 것: 회사명(company01t) · 품목 · 재질 · 표면 · 규격 · 수량 · 중량 · 입고일 · 재고 일수
  - 빼는 것: 창고 · 단가 · 원가 · 매입처 · 전표번호 (서버가 아예 내려보내지 않는다)
  - 월말 재고 = 그 달까지의 수불(기초 ST + 입고 IN − 출고 OUT) 누계 → 현재고 합계와 같다 (재고이동 · 가공 포함)
  - 달 경계는 한국 시간(KST)
화면: frontend/src/pages/inventory/SharedStock.jsx, API: routes/inventory/SharedStock_routes.py
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import db as _shared_db

KST = ZoneInfo("Asia/Seoul")
TREND_MONTHS = 12
EXPORT_LIMIT = 20000

_OPEN_COMPANY_SQL = """c.companyid <> '001' AND c.stock_open_yn = 'Y' AND UPPER(COALESCE(c.company_status, '')) = 'ACTIVE'"""


def _add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def _num(value) -> float:
    return float(value or 0)


def _series(flow: dict, months: list[date]) -> dict:
    """월별 (net, 입고, 판매 출고) → 최근 12개월 월말 재고 · 입고 · 판매 출고 배열."""
    running = sum(net for month, (net, _i, _o) in flow.items() if month < months[0])
    ending, inbound, outbound = [], [], []
    for month in months:
        net, inb, out = flow.get(month, (0.0, 0.0, 0.0))
        running += net
        ending.append(round(running, 3))
        inbound.append(inb)
        outbound.append(out)
    return {"ending": ending, "inbound": inbound, "outbound": outbound}


def _sum_series(parts: list[dict], size: int) -> dict:
    return {key: [round(sum(part[key][i] for part in parts), 3) for i in range(size)] for key in ("ending", "inbound", "outbound")}


MAX_TREND_MONTHS = 36


def summary(companyid: str = "", date_from: date | None = None, date_to: date | None = None,
            item_search: str = "", material_search: str = "", surface_search: str = "",
            product_search: str = "", thickness: str = "", width: str = "", length: str = "") -> dict:
    """공개 고객사 재고 추이 (기간의 월별 월말 재고 · 입고 · 판매 출고, 기본 최근 12개월 · 최대 36개월).
    회사 × 품명 단위로 계산해 두 가지로 묶는다: 고객사별(펼치면 품명별) · 품명별(펼치면 고객사별).
    품명별 월말 재고도 현재고와 같다 (가공으로 품명이 바뀌면 원래 품명에서 빠지고 새 품명으로 들어감)."""
    current = datetime.now(KST).date().replace(day=1)
    last = (date_to or current).replace(day=1)
    first = (date_from or _add_months(last, -(TREND_MONTHS - 1))).replace(day=1)
    if first > last:
        first, last = last, first
    count = min((last.year - first.year) * 12 + last.month - first.month + 1, MAX_TREND_MONTHS)
    months = [_add_months(last, offset) for offset in range(-(count - 1), 1)]
    size = len(months)
    # 지난달 대비를 첫 달(한 달만 조회해도)에서도 보이게, 기간 바로 전 달까지 계산하고 마지막에 떼어 낸다 (before)
    calc_months = [_add_months(months[0], -1), *months]
    calc_size = size + 1
    # 품명 · 강종 · 표면 조건 (현재고 · 수불 둘 다 같은 칸으로 거른다)
    extra, extra_params = [], []
    for column, value in (("itemname", item_search), ("materialname", material_search), ("surfacename", surface_search)):
        if value.strip():
            extra.append(f"{column} ILIKE %s")
            extra_params.append(_like(value.strip()))
    if item_search.strip():   # 품명 칸은 품목코드도 찾는다
        extra[0] = "(itemname ILIKE %s OR itemcode ILIKE %s)"
        extra_params.insert(1, _like(item_search.strip()))
    if product_search.strip():
        extra.append("productname ILIKE %s")
        extra_params.append(_like(product_search.strip()))
    for column, value in (("thickness", thickness), ("width", width), ("length", length)):   # 숫자 일부로 찾기 (예: 1.2 → 1.200)
        if value.strip():
            extra.append(f"CAST({column} AS TEXT) ILIKE %s")
            extra_params.append(_like(value.strip()))
    extra_sql = "".join(f" AND {clause}" for clause in extra)
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        company_sql = " AND c.companyid = %s" if companyid.strip() else ""
        cursor.execute(f"""SELECT c.companyid, c.companyname, c.stock_open_date FROM company01t c
                           WHERE {_OPEN_COMPANY_SQL}{company_sql} ORDER BY c.companyname, c.companyid""",
                       [companyid.strip()] if companyid.strip() else [])
        companies = [{"companyid": r[0], "companyname": r[1] or "", "stock_open_date": r[2]} for r in cursor.fetchall()]
        ids = [c["companyid"] for c in companies]
        stock, flows = {}, {}
        if ids:
            cursor.execute(
                """SELECT companyid, COALESCE(NULLIF(BTRIM(itemname), ''), '(품명 없음)'), COUNT(*), COALESCE(SUM(weight), 0)
                   FROM currentstock01t WHERE companyid = ANY(%s) AND weight > 0""" + extra_sql + """ GROUP BY 1, 2""",
                (ids, *extra_params),
            )
            stock = {(r[0], r[1]): {"lots": r[2], "weight": _num(r[3])} for r in cursor.fetchall()}
            cursor.execute(
                """SELECT companyid, COALESCE(NULLIF(BTRIM(itemname), ''), '(품명 없음)'), date_trunc('month', iniodate)::date AS month,
                          SUM(CASE WHEN iniotype IN ('IN', 'ST') THEN COALESCE(weight, 0)
                                   WHEN iniotype = 'OUT' THEN -COALESCE(weight, 0) ELSE 0 END) AS net,
                          COALESCE(SUM(weight) FILTER (WHERE iniokind = 'IN'), 0) AS inbound,
                          COALESCE(SUM(weight) FILTER (WHERE iniokind = 'OUT'), 0) AS outbound
                   FROM iniop01t WHERE companyid = ANY(%s) AND iniodate IS NOT NULL AND iniodate < %s""" + extra_sql + """
                   GROUP BY 1, 2, 3""",
                (ids, _add_months(last, 1), *extra_params),
            )
            for companyid, itemname, month, net, inbound, outbound in cursor.fetchall():
                flows.setdefault((companyid, itemname), {})[month] = (_num(net), _num(inbound), _num(outbound))

    names = {c["companyid"]: c["companyname"] for c in companies}
    # 재고 공개 동의일(서면) 이전 달의 추이는 보여 주지 않는다 (동의 범위 밖의 이력). 월말 재고 누계는 전체 이력으로 계산한 뒤 가린다.
    open_months = {c["companyid"]: c["stock_open_date"].replace(day=1) for c in companies if c["stock_open_date"]}
    # 회사 × 품명 칸 (지금 재고가 있거나 최근 12개월에 움직임이 있는 것만)
    cells = []
    for key in set(stock) | set(flows):
        companyid, itemname = key
        series = _series(flows.get(key, {}), calc_months)
        open_month = open_months.get(companyid)
        if open_month:
            for index, month in enumerate(calc_months):
                if month < open_month:
                    for series_key in ("ending", "inbound", "outbound"):
                        series[series_key][index] = 0.0
        now = stock.get(key, {"lots": 0, "weight": 0.0})
        if now["weight"] <= 0 and not any(any(series[k]) for k in series):
            continue
        cells.append({"companyid": companyid, "companyname": names.get(companyid, ""), "itemname": itemname,
                      "weight": now["weight"], "lots": now["lots"], **series})

    def node(base: dict, parts: list[dict], child_key: str) -> dict:
        series = _sum_series(parts, calc_size) if parts else {k: [0.0] * calc_size for k in ("ending", "inbound", "outbound")}
        children = sorted(({**part} for part in parts), key=lambda row: (-row["weight"], row[child_key]))
        return {**base, **series, "weight": sum(p["weight"] for p in parts), "lots": sum(p["lots"] for p in parts),
                "children": [{"key": part[child_key], "name": part[child_key] if child_key == "itemname" else part["companyname"],
                              "weight": part["weight"], "lots": part["lots"],
                              "ending": part["ending"], "inbound": part["inbound"], "outbound": part["outbound"]} for part in children]}

    # 회사별 · 품명별 칸 묶음을 한 번에 만든다 (회사 · 품명마다 전체 칸을 다시 훑지 않음). 묶음 안 순서는 cells 순서 그대로.
    cells_by_company, cells_by_item = {}, {}
    for cell in cells:
        cells_by_company.setdefault(cell["companyid"], []).append(cell)
        cells_by_item.setdefault(cell["itemname"], []).append(cell)

    company_rows = []
    for c in companies:
        parts = cells_by_company.get(c["companyid"], [])
        row = node({**c, "items": sum(1 for p in parts if p["weight"] > 0)}, parts, "itemname")
        company_rows.append(row)
    if extra:   # 품명 · 강종 · 규격 같은 조건을 걸었으면 그 조건의 재고 · 움직임이 없는 회사는 빼고 보여 준다
        company_rows = [row for row in company_rows if row["children"]]
    company_rows.sort(key=lambda row: (-row["weight"], row["companyname"]))

    item_rows = []
    for itemname in sorted(cells_by_item):
        parts = cells_by_item[itemname]
        item_rows.append(node({"itemname": itemname, "company_count": sum(1 for p in parts if p["weight"] > 0)}, parts, "companyid"))
    item_rows.sort(key=lambda row: (-row["weight"], row["itemname"]))

    def strip(row: dict) -> dict:
        row["before"] = {key: row[key][0] for key in ("ending", "inbound", "outbound")}
        for key in ("ending", "inbound", "outbound"):
            row[key] = row[key][1:]
        return row

    for row in company_rows + item_rows:
        strip(row)
        for child in row["children"]:
            strip(child)

    def total(key, index):
        return sum(row[key][index] for row in company_rows)

    return {
        "months": [m.strftime("%Y-%m") for m in months], "current_month": current.strftime("%Y-%m"),
        "summary": {
            "company_count": len(company_rows), "stocked_count": sum(1 for row in company_rows if row["weight"] > 0),
            "item_count": sum(1 for row in item_rows if row["weight"] > 0),
            "weight": sum(row["weight"] for row in company_rows),
            "prev_weight": sum(row["ending"][-2] if size > 1 else row["before"]["ending"] for row in company_rows),
            "lots": sum(row["lots"] for row in company_rows),
            "inbound": total("inbound", -1) if company_rows else 0, "outbound": total("outbound", -1) if company_rows else 0,
        },
        "trend": [{"month": m.strftime("%Y-%m"), "ending": total("ending", i), "inbound": total("inbound", i),
                   "outbound": total("outbound", i)} for i, m in enumerate(months)] if company_rows else [],
        "companies": company_rows,
        "items": item_rows,
    }


def _like(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def items(companyid: str = "", sourcetype: str = "", date_from: date | None = None, date_to: date | None = None,
          item_search: str = "", product_search: str = "", material_search: str = "", surface_search: str = "",
          page: int = 1, page_size: int = 50, export: bool = False,
          thickness: str = "", width: str = "", length: str = "", grouped: bool = False) -> dict:
    """현재고현황과 같은 로트 목록 (공개 고객사 전체 또는 한 회사). 창고 · 매입처 · 단가 · 원가 · 전표번호는 내려보내지 않는다."""
    where = [_OPEN_COMPANY_SQL, "s.weight > 0"]
    params: list = []
    if companyid.strip():
        where.append("s.companyid = %s")
        params.append(companyid.strip())
    # 재고구분 · 기간(입고일자): 상세는 그 로트만, 규격별 합계는 그런 로트가 하나라도 있는 줄만 고르고 숫자는 줄 전체(지금 재고 전부)
    pick, pick_params = [], []
    kind = sourcetype.strip().upper()
    if kind in {"OPENING", "INBOUND", "PROCESS", "TRANSFER"}:
        pick.append("COALESCE(s.stockkind, s.sourcetype) = %s")
        pick_params.append(kind)
    if date_from:
        pick.append("COALESCE(o.receiptdate, s.receiptdate) >= %s")
        pick_params.append(date_from)
    if date_to:
        pick.append("COALESCE(o.receiptdate, s.receiptdate) <= %s")
        pick_params.append(date_to)
    if not grouped:
        where += pick
        params += pick_params
    if item_search.strip():
        where.append("(s.itemcode ILIKE %s OR s.itemname ILIKE %s)")
        params += [_like(item_search.strip())] * 2
    for column, value in (("productname", product_search), ("materialname", material_search), ("surfacename", surface_search)):
        if value.strip():
            where.append(f"s.{column} ILIKE %s")
            params.append(_like(value.strip()))
    # 두께 · 폭 · 길이: 현재고현황과 같이 숫자 일부로 찾기 (예: 1.2 → 1.200)
    for column, value in (("thickness", thickness), ("width", width), ("length", length)):
        if value.strip():
            where.append(f"CAST(s.{column} AS TEXT) ILIKE %s")
            params.append(_like(value.strip()))
    base = f"""FROM currentstock01t s
               JOIN company01t c ON c.companyid = s.companyid
               LEFT JOIN currentstock01t o
                 ON s.originno IS NOT NULL AND o.companyid = s.companyid
                AND o.sourcetype = s.origintype AND o.sourceno = s.originno AND o.sourceline = s.originline
               LEFT JOIN codemaster01t q ON q.companyid = s.companyid AND q.groupcode = 'QTY' AND q.code = s.qtyunit
               WHERE {" AND ".join(where)}"""
    limit = EXPORT_LIMIT if export else page_size
    offset = 0 if export else (page - 1) * page_size
    with _shared_db.connect() as connection, connection.cursor() as cursor:
        if grouped:
            # 규격별 합계: 같은 고객사 · 품명 · 강종 · 표면 · 두께 · 폭 · 길이 · 수량단위는 한 줄 (로트 수 · 수량 · 중량 합계)
            grouped_sql = f"""SELECT s.companyid, c.companyname, COALESCE(s.itemname, '') AS itemname, COALESCE(s.materialname, '') AS materialname,
                                     COALESCE(s.surfacename, '') AS surfacename, s.thickness, s.width, s.length,
                                     COALESCE(NULLIF(q.code_name, ''), s.qtyunit) AS qtyunit,
                                     COUNT(*) AS lots, COALESCE(SUM(s.qty), 0) AS qty, COALESCE(SUM(s.weight), 0) AS weight,
                                     MIN(COALESCE(o.receiptdate, s.receiptdate)) AS first_date,   -- 최초 입고일 (최장 재고일수의 기준)
                                     MAX(COALESCE(o.receiptdate, s.receiptdate)) AS last_date,
                                     MAX((now() AT TIME ZONE 'Asia/Seoul')::date - COALESCE(o.receiptdate, s.receiptdate)) AS max_days
                              {base}
                              GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
                              {("HAVING BOOL_OR(" + " AND ".join(pick) + ")") if pick else ""}"""
            grouped_params = [*params, *pick_params]
            # 합계 (보이는 줄 전체): 줄 수 · 로트 수 · 중량 · 고객사 수 · 고객사별
            cursor.execute(f"SELECT companyid, COUNT(*), COALESCE(SUM(lots), 0), COALESCE(SUM(weight), 0) FROM ({grouped_sql}) g GROUP BY companyid", grouped_params)
            sums = cursor.fetchall()
            company_totals = {r[0]: {"count": r[2], "weight": _num(r[3])} for r in sums}
            group_total = sum(r[1] for r in sums)
            total = sum(r[2] for r in sums)
            total_weight = sum(_num(r[3]) for r in sums)
            company_count = len(sums)
            cursor.execute(f"""{grouped_sql}
                               ORDER BY c.companyname, 3, s.thickness, s.width, s.length, 4, 5
                               LIMIT %s OFFSET %s""", [*grouped_params, limit, offset])
            columns = [col[0] for col in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            for row in rows:
                row["rowkey"] = "|".join(str(row[key]) for key in ("companyid", "itemname", "materialname", "surfacename", "thickness", "width", "length", "qtyunit"))
        else:
          # 회사별 건수 · 중량 → 전체 합계
          cursor.execute(f"SELECT s.companyid, COUNT(*), COALESCE(SUM(s.weight), 0) {base} GROUP BY s.companyid", params)
          company_totals = {r[0]: {"count": r[1], "weight": _num(r[2])} for r in cursor.fetchall()}
          total = sum(v["count"] for v in company_totals.values())
          total_weight = sum(v["weight"] for v in company_totals.values())
          company_count = len(company_totals)
          cursor.execute(
              f"""SELECT s.companyid, c.companyname, COALESCE(s.stockkind, s.sourcetype) AS stockkind,
                         COALESCE(o.receiptdate, s.receiptdate) AS receiptdate,
                         s.itemcode, s.itemname, s.materialname, s.surfacename, s.myrtle, s.thickness, s.width, s.length,
                         s.qty, s.weight, s.productname, s.originalqty, s.originalweight,
                         COALESCE(NULLIF(q.code_name, ''), s.qtyunit) AS qtyunit,   -- 수량단위는 코드명 (그 회사 공통코드)
                         ((now() AT TIME ZONE 'Asia/Seoul')::date - COALESCE(o.receiptdate, s.receiptdate)) AS days,
                         s.companyid || ':' || s.sourcetype || ':' || s.sourceno || ':' || s.sourceline AS rowkey   -- 전표번호는 회사마다 같을 수 있어 회사 코드까지
                  {base}
                  ORDER BY c.companyname, COALESCE(o.receiptdate, s.receiptdate), s.sourceno, s.sourceline
                  LIMIT %s OFFSET %s""",
              [*params, limit, offset],
          )
          columns = [col[0] for col in cursor.description]
          rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
          group_total = None
        cursor.execute(f"""SELECT c.companyid, c.companyname FROM company01t c WHERE {_OPEN_COMPANY_SQL} ORDER BY c.companyname, c.companyid""")
        companies = [{"companyid": r[0], "companyname": r[1] or ""} for r in cursor.fetchall()]
    return {"items": rows, "total": total if group_total is None else group_total, "lot_total": total,
            "total_weight": _num(total_weight), "company_count": company_count,
            "company_totals": company_totals, "companies": companies, "page": 1 if export else page, "page_size": limit,
            "truncated": export and (total if group_total is None else group_total) > EXPORT_LIMIT}
