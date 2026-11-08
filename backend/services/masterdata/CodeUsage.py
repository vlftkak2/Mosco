"""Usage checks that block deleting master codes still referenced by documents / stock.

A code that is in use must be switched to 사용중지 (use_yn = 'N') instead of being deleted: deleting it would
break later validation (e.g. transferring stock out of a deleted warehouse) and a re-created code with the same
value would silently re-bind old stock and documents to a new meaning.
"""

# (label, table, columns) - every column that stores the code (any column matching counts the row once)
_ITEM_USAGE = [
    ("기초재고", "StandStock01t", ("itemcode",)),
    ("입고", "Inbound02t", ("itemcode",)),
    ("출고", "Outbound02t", ("itemcode",)),
    ("현재고", "CurrentStock01t", ("itemcode",)),
    ("재고수불", "Iniop01t", ("itemcode",)),
    ("재고이전", "inoutmove02t", ("itemcode",)),
    ("가공", "Process02t", ("itemcode",)),
    ("가공공정", "ItemProcessrule01t", ("itemcode",)),
]
_STOCK_TABLES = [
    ("기초재고", "StandStock01t"), ("입고", "Inbound02t"), ("출고", "Outbound02t"), ("현재고", "CurrentStock01t"),
    ("재고수불", "Iniop01t"), ("재고이전", "inoutmove02t"), ("가공", "Process02t"),
]
_CODE_USAGE = {
    # inoutmove02t has no warehouse column (the header has from/to) and Process02t keeps it as sourcewarehousecode
    "WAREHOUSE": [(label, table, ("warehousecode",)) for label, table in _STOCK_TABLES if table not in ("inoutmove02t", "Process02t")] + [
        ("가공", "Process01t", ("warehousecode",)),
        ("가공", "Process02t", ("sourcewarehousecode",)),
        ("재고이전", "inoutmove01t", ("fromwarehousecode", "towarehousecode")),
    ],
    "QTY": [(label, table, ("qtyunit",)) for label, table in _STOCK_TABLES],
    "PRICE_UNIT": [(label, table, ("unit",)) for label, table in _STOCK_TABLES if table != "inoutmove02t"],
    "MATERIAL": [(label, table, ("materialcode",)) for label, table in _STOCK_TABLES],
    "SURFACE": [(label, table, ("surfacecode",)) for label, table in _STOCK_TABLES],
    "PROCESS": [("가공공정", "ItemProcessrule01t", ("processid",)), ("가공", "Process02t", ("processid",))],
    "SHAPE": [("품목코드", "ItemCode01t", ("itemtypecode",)), ("가공공정", "ItemProcessrule01t", ("itemtypecode",))],
    "OTHER_COST": [("입고 기타비용", "Inbound03t", ("costcode",)), ("출고 기타비용", "Outbound03t", ("costcode",))],
    "BANK": [("거래처", "customer01t", ("bankcode",)), ("수금지급", "ReceiptPayment02t", ("custodybank",))],
    # JOB (직위구분) is not stored on any document.
}
# Some screens store the code NAME instead of the code (e.g. stock quantity units): match both.
_MATCH_NAME_TOO = {"QTY", "PRICE_UNIT", "BANK"}


def _count_usage(cursor, companyid, usage, tokens):
    """tokens: list of (code, token). Returns {code: {label: count}}."""
    found: dict[str, dict[str, int]] = {}
    if not tokens:
        return found
    codes = [code for code, _ in tokens]
    values = [token for _, token in tokens]
    for label, table, columns in usage:
        match = " OR ".join(f"t.{column} = v.token" for column in columns)
        cursor.execute(
            f"""SELECT v.code, COUNT(DISTINCT t.ctid)
                FROM {table} t
                JOIN unnest(%s::text[], %s::text[]) AS v(code, token) ON ({match})
                WHERE t.companyid = %s
                GROUP BY v.code""",
            (codes, values, companyid),
        )
        for code, count in cursor.fetchall():
            if count:
                labels = found.setdefault(code, {})
                labels[label] = labels.get(label, 0) + int(count)
    return found


def _message(found, names, title):
    parts = []
    for code, labels in list(found.items())[:5]:
        name = names.get(code) or ""
        where = ", ".join(f"{label} {count:,}건" for label, count in labels.items())
        parts.append(f"{code}{f'({name})' if name and name != code else ''}: {where}")
    more = f" 외 {len(found) - 5}개" if len(found) > 5 else ""
    return (f"사용 중인 {title}는 삭제할 수 없습니다. 삭제 대신 '사용중지'로 변경해 주세요. "
            + " / ".join(parts) + more)


def item_code_usage_error(cursor, companyid: str, itemcodes: list[str]) -> str | None:
    """Return an error message when any of the items is referenced, else None."""
    codes = list(dict.fromkeys(str(code).strip() for code in itemcodes if str(code or "").strip()))
    if not codes:
        return None
    found = _count_usage(cursor, companyid, _ITEM_USAGE, [(code, code) for code in codes])
    if not found:
        return None
    cursor.execute("SELECT itemcode, itemname FROM ItemCode01t WHERE companyid = %s AND itemcode = ANY(%s)", (companyid, list(found)))
    names = {code: name for code, name in cursor.fetchall()}
    return _message(found, names, "품목코드")


def common_code_usage_error(cursor, companyid: str, groupcode: str, codes: list[str]) -> str | None:
    """Return an error message when any of the codes of `groupcode` is referenced, else None."""
    usage = _CODE_USAGE.get(groupcode)
    codes = list(dict.fromkeys(str(code).strip() for code in codes if str(code or "").strip()))
    if not usage or not codes:
        return None
    cursor.execute(
        "SELECT code, code_name FROM CodeMaster01t WHERE companyid = %s AND groupcode = %s AND code = ANY(%s)",
        (companyid, groupcode, codes),
    )
    names = {str(code): str(name or "") for code, name in cursor.fetchall()}
    tokens = [(code, code) for code in codes]
    if groupcode in _MATCH_NAME_TOO:
        tokens += [(code, names[code]) for code in codes if names.get(code) and names[code] != code]
    found = _count_usage(cursor, companyid, usage, tokens)
    if not found:
        return None
    return _message(found, names, "공통코드")
