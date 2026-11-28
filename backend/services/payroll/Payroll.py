"""급여관리 (메뉴: 급여입력 PAYROLL · 급여대장 PAYROLL_LEDGER(= PAYROLL 권한) · 내 급여현황 PAYROLL_MY).

테이블: pay_slip01t (한 행 = 회사 × 귀속월 × 직원) · pay_item01t (회사별로 쓰는 지급항목). 흐름은 세 단계뿐이다.
  1) 전월 불러오기 : 그달 재직자 행을 만든다. 지난달 행이 있으면 고정값(가족 수 · 기본급 · 고정수당 · 계좌)을 복사,
                     연장근무 · 상여 같은 변동분은 0. 공제는 자동 계산.
  2) 입력 · 저장   : 변동분을 넣으면 화면이 /calc 로 공제를 다시 계산해 채운다 (공제 칸은 직접 고칠 수 있다).
  3) 마감          : 그달 전체를 잠근다. 마감된 달만 직원 본인이 '내 급여현황'에서 본다. 마감취소하면 다시 고칠 수 있다.

회사 분리: 모든 조회 · 저장은 로그인한 사용자의 companyid 로만 한다 (모스코 관리자도 다른 회사 급여는 볼 수 없다).

계산 규칙 (요율이 바뀌면 아래 표만 고친다)
  - 비과세: 식대 · 자가운전보조금 · 보육수당 · 연구수당(연구원 등 대상자) 각 월 20만원까지
  - 국민연금 = 기본급(상 · 하한 적용, 천원 미만 절사) × 근로자 요율   ← 4대보험 보수월액 = 기본급 (따로 입력하지 않는다)
  - 건강보험 = 기본급 × 근로자 요율,  장기요양 = 건강보험료 × (장기요양요율 ÷ 건강보험요율)
  - 고용보험 = 과세 지급액 × 0.9%
  - 소득세   = 국세청 근로소득 간이세액표(과세 지급액 · 공제대상가족 수) − 자녀 공제, × 원천징수 비율(80/100/120%)
  - 지방소득세 = 소득세 × 10%
  - 모든 공제액은 10원 미만 절사
"""
import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import db as _db

KST = ZoneInfo("Asia/Seoul")
MENU_PAYROLL = "PAYROLL"
MENU_MY = "PAYROLL_MY"

PAY_FIELDS = ("pay_base", "pay_position", "pay_duty", "pay_overtime", "pay_bonus", "pay_leave", "pay_etc",
              "pay_meal", "pay_car", "pay_childcare", "pay_research")
DED_FIELDS = ("ded_pension", "ded_health", "ded_care", "ded_employ", "ded_income", "ded_local", "ded_etc")
BASIS_FIELDS = ("base_monthly", "family_cnt", "child_cnt", "tax_rate")
TEXT_FIELDS = ("bankname", "accountno", "remark")
# 전월 불러오기 때 복사하는 칸 (변동분 · 공제는 빼고)
COPY_FIELDS = BASIS_FIELDS + ("pay_base", "pay_position", "pay_duty", "pay_meal", "pay_car", "pay_childcare", "pay_research", "bankname", "accountno")
NONTAX_LIMIT = {"pay_meal": 200_000, "pay_car": 200_000, "pay_childcare": 200_000, "pay_research": 200_000}

# 4대보험 근로자 부담 요율 (귀속년도별). 장기요양은 (장기요양요율, 건강보험요율) 비율로 건강보험료에 곱한다.
INSURANCE_RATES = {
    2025: {"pension": 0.045, "health": 0.03545, "care": (0.9182, 7.09), "employ": 0.009},
    2026: {"pension": 0.0475, "health": 0.03595, "care": (0.9448, 7.19), "employ": 0.009},
}
# 국민연금 기준소득월액 상 · 하한 (적용 시작 귀속월 → (하한, 상한)) — 매년 7월에 바뀐다
PENSION_LIMITS = [("2025-07", 400_000, 6_370_000), ("2026-07", 410_000, 6_590_000)]
# 간이세액표 자녀 공제 (8세 이상 20세 이하): (적용 시작 귀속월, 1명, 2명, 3명부터 1명당 추가)
CHILD_CREDIT = [("2024-03", 12_500, 29_160, 25_000), ("2026-03", 20_830, 45_830, 33_330)]

_TABLE = json.loads((Path(__file__).with_name("income_tax_table.json")).read_text(encoding="utf-8"))
_ROWS = _TABLE["rows"]            # [이상(천원), 미만(천원), 가족 1~11명 세액]
_AT_10000 = _TABLE["at_10000"]    # 월급여 1,000만원일 때 가족 1~11명 세액


def _today() -> date:
    return datetime.now(KST).date()


def _floor10(value: float) -> int:
    value = round(value, 4)   # 3,550,000 × 0.009 = 31949.999… 같은 소수 오차를 먼저 없앤다
    return int(value // 10 * 10) if value > 0 else 0


def _has(user: dict, menuid: str) -> bool:
    return (user.get("companyid") == "001" and user.get("authority") == "MASTER") or menuid in (user.get("menuids") or ())


def _require(user: dict, menuid: str = MENU_PAYROLL, what: str = "급여관리"):
    if not _has(user, menuid):
        raise PermissionError(f"{what} 권한이 없습니다.")


def _check_ym(payym: str) -> str:
    text = str(payym or "").strip()
    try:
        year, month = (int(x) for x in text.split("-"))
        if not (2000 <= year <= 2100 and 1 <= month <= 12):
            raise ValueError
    except ValueError as error:
        raise ValueError("귀속년월을 확인해 주세요 (예: 2026-05).") from error
    return f"{year:04d}-{month:02d}"


def _prev_ym(payym: str) -> str:
    year, month = (int(x) for x in payym.split("-"))
    return f"{year - 1:04d}-12" if month == 1 else f"{year:04d}-{month - 1:02d}"


def _month_range(payym: str) -> tuple[date, date]:
    year, month = (int(x) for x in payym.split("-"))
    first = date(year, month, 1)
    last = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return first, date.fromordinal(last.toordinal() - 1)


def _pick(periods: list, payym: str):
    """(시작 귀속월, ...) 목록에서 payym 에 적용되는 것 (없으면 가장 이른 것)."""
    found = periods[0]
    for period in periods:
        if period[0] <= payym:
            found = period
    return found


# ── 계산 ───────────────────────────────────────────────────────────
def taxable_pay(slip: dict) -> int:
    """과세 지급액 = 지급 합계 − 비과세(식대 · 자가운전 · 보육 · 연구 각 20만원까지)."""
    total = 0
    for field in PAY_FIELDS:
        amount = int(slip.get(field) or 0)
        limit = NONTAX_LIMIT.get(field)
        total += max(0, amount - limit) if limit else amount
    return total


def table_tax(monthly: int, family: int) -> int:
    """간이세액표 세액 (자녀 공제 · 비율 적용 전). 가족 11명 초과는 표의 규칙대로 1명당 (10명 − 11명) 차이만큼 더 뺀다."""
    family = max(1, int(family or 1))

    def by_family(values: list) -> int:
        if family <= 11:
            return values[family - 1]
        return max(0, values[10] - (values[9] - values[10]) * (family - 11))

    thousand = monthly // 1000
    if thousand < 770:
        return 0
    if thousand < 10_000:
        for row in _ROWS:
            if row[0] <= thousand < row[1]:
                return by_family(row[2:])
        return 0
    base = by_family(_AT_10000)
    if monthly == 10_000_000:
        return base
    over = monthly - 10_000_000
    if monthly <= 14_000_000:
        return int(base + over * 0.98 * 0.35 + 25_000)
    if monthly <= 28_000_000:
        return int(base + 1_397_000 + (monthly - 14_000_000) * 0.98 * 0.38)
    if monthly <= 30_000_000:
        return int(base + 6_610_600 + (monthly - 28_000_000) * 0.98 * 0.40)
    if monthly <= 45_000_000:
        return int(base + 7_394_600 + (monthly - 30_000_000) * 0.40)
    if monthly <= 87_000_000:
        return int(base + 13_394_600 + (monthly - 45_000_000) * 0.42)
    return int(base + 31_034_600 + (monthly - 87_000_000) * 0.45)


def income_tax(payym: str, monthly: int, family: int, children: int, rate: int) -> int:
    tax = table_tax(monthly, family)
    _, one, two, extra = _pick(CHILD_CREDIT, payym)
    children = max(0, int(children or 0))
    credit = 0 if children == 0 else one if children == 1 else two + extra * (children - 2)
    tax = max(0, tax - credit)
    return _floor10(tax * (int(rate or 100) / 100))


def calc_deductions(payym: str, slip: dict) -> dict:
    """공제 자동 계산 (기타공제는 그대로 둔다). 국민연금 · 건강보험은 기본급 기준 (기본급이 없으면 과세 지급액)."""
    payym = _check_ym(payym)
    year = int(payym[:4])
    rates = INSURANCE_RATES.get(year) or INSURANCE_RATES[max(INSURANCE_RATES) if year > max(INSURANCE_RATES) else min(INSURANCE_RATES)]
    taxable = taxable_pay(slip)
    if sum(int(slip.get(f) or 0) for f in PAY_FIELDS) <= 0:
        # 지급이 없는 달(무급휴직 등)은 보험료 · 세금도 떼지 않는다
        return {**{f: 0 for f in DED_FIELDS}, "ded_etc": int(slip.get("ded_etc") or 0)}
    basis = int(slip.get("pay_base") or 0) or taxable
    _, low, high = _pick(PENSION_LIMITS, payym)
    pension_basis = min(max(basis, low), high) // 1000 * 1000 if basis > 0 else 0
    health = _floor10(basis * rates["health"])
    care_rate, health_rate = rates["care"]
    tax = income_tax(payym, taxable, slip.get("family_cnt") or 1, slip.get("child_cnt") or 0, slip.get("tax_rate") or 100)
    return {
        "ded_pension": _floor10(pension_basis * rates["pension"]),
        "ded_health": health,
        "ded_care": _floor10(health * care_rate / health_rate),
        "ded_employ": _floor10(taxable * rates["employ"]),
        "ded_income": tax,
        "ded_local": _floor10(tax * 0.1),
        "ded_etc": int(slip.get("ded_etc") or 0),
    }


def _totals(slip: dict) -> dict:
    pay = sum(int(slip.get(f) or 0) for f in PAY_FIELDS)
    ded = sum(int(slip.get(f) or 0) for f in DED_FIELDS)
    return {"pay_total": pay, "ded_total": ded, "net_pay": pay - ded, "taxable": taxable_pay(slip)}


# ── 입력값 정리 ─────────────────────────────────────────────────────
def _clean(data: dict) -> dict:
    out = {}
    for field in PAY_FIELDS + DED_FIELDS + ("base_monthly",):
        try:
            value = int(round(float(data.get(field) or 0)))
        except (TypeError, ValueError) as error:
            raise ValueError("금액은 숫자로 입력해 주세요.") from error
        if field != "pay_etc" and field != "ded_etc" and value < 0:
            raise ValueError("금액은 0 이상으로 입력해 주세요 (기타지급 · 기타공제만 음수 가능).")
        if abs(value) > 10_000_000_000:
            raise ValueError("금액이 너무 큽니다.")
        out[field] = value
    try:
        out["family_cnt"] = int(data.get("family_cnt") or 1)
        out["child_cnt"] = int(data.get("child_cnt") or 0)
        out["tax_rate"] = int(data.get("tax_rate") or 100)
    except (TypeError, ValueError) as error:
        raise ValueError("공제대상가족 수 · 자녀 수는 숫자로 입력해 주세요.") from error
    if not 1 <= out["family_cnt"] <= 20:
        raise ValueError("공제대상가족 수는 본인 포함 1~20명입니다.")
    if not 0 <= out["child_cnt"] <= out["family_cnt"] - 1:
        raise ValueError("자녀 수는 공제대상가족 수(본인 포함)보다 1명 이상 적어야 합니다.")
    if out["tax_rate"] not in (80, 100, 120):
        raise ValueError("원천징수 비율은 80 · 100 · 120% 중에서 고릅니다.")
    out["base_monthly"] = out["pay_base"]   # 보수월액 칸은 기록용: 항상 기본급과 같다
    for field, size in (("bankname", 50), ("accountno", 50), ("remark", 200)):
        out[field] = str(data.get(field) or "").strip()[:size]
    return out


# ── DB ─────────────────────────────────────────────────────────────
_SLIP_COLS = ", ".join(("s.payym", "s.useremail", "s.paydate") + tuple(f"s.{f}" for f in BASIS_FIELDS + PAY_FIELDS + DED_FIELDS + TEXT_FIELDS) + ("s.closeyn",))
_USER_COLS = """COALESCE(u.username, s.useremail) AS username, COALESCE(u.empno, '') AS empno, COALESCE(u.team, '') AS team,
                COALESCE(u.position, '') AS position, COALESCE(u.worktype, 'REGULAR') AS worktype, u.birthdate, u.hiredate, u.retiredate"""


def _rows(cursor) -> list:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _out(row: dict) -> dict:
    item = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in row.items()}
    item.update(_totals(row))
    return item


def _is_closed(cursor, companyid: str, payym: str) -> bool:
    """그달이 마감됐는지. 그달 행을 잠가 마감(set_close)과 동시에 고치는 일을 막는다 (트랜잭션 끝까지)."""
    cursor.execute("SELECT closeyn FROM pay_slip01t WHERE companyid = %s AND payym = %s FOR UPDATE", (companyid, payym))
    return any(row[0] == "Y" for row in cursor.fetchall())


def _active_users(cursor, companyid: str, payym: str) -> list:
    """그달 재직자: 계정 사용 중 + 입사일 ≤ 말일 + (퇴사일 없음 또는 ≥ 1일)."""
    first, last = _month_range(payym)
    cursor.execute(
        """SELECT email, username, COALESCE(empno, '') AS empno, COALESCE(team, '') AS team, COALESCE(position, '') AS position
             FROM user01t
            WHERE companyid = %s AND UPPER(COALESCE(useyn, 'N')) = 'Y'
              AND (hiredate IS NULL OR hiredate <= %s) AND (retiredate IS NULL OR retiredate >= %s)
            ORDER BY empno NULLS LAST, username""",
        (companyid, last, first),
    )
    return _rows(cursor)


def list_slips(user: dict, payym: str) -> dict:
    """급여입력 · 급여대장: 그달 급여 목록 + 아직 급여가 없는 재직자(추가 후보)."""
    _require(user)
    companyid, payym = user["companyid"], _check_ym(payym)
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT {_SLIP_COLS}, {_USER_COLS}
                  FROM pay_slip01t s
                  LEFT JOIN user01t u ON u.companyid = s.companyid AND u.email = s.useremail
                 WHERE s.companyid = %s AND s.payym = %s
                 ORDER BY COALESCE(u.empno, '') = '', u.empno, u.username""",
            (companyid, payym),
        )
        items = [_out(r) for r in _rows(cursor)]
        have = {i["useremail"] for i in items}
        candidates = [u for u in _active_users(cursor, companyid, payym) if u["email"] not in have]
        cursor.execute("SELECT MAX(payym) FROM pay_slip01t WHERE companyid = %s AND payym < %s", (companyid, payym))
        last_ym = cursor.fetchone()[0]
        enabled = _enabled_items(cursor, companyid)
    return {"payym": payym, "closed": any(i["closeyn"] == "Y" for i in items), "items": items,
            "candidates": candidates, "last_payym": last_ym, "today": _today().isoformat(), "pay_items": enabled}


# ── 지급항목 설정 (pay_item01t) ──────────────────────────────────────
def _enabled_items(cursor, companyid: str) -> list:
    """회사가 쓰는 지급항목 (PAY_FIELDS 순서). 설정 행이 없으면 모두, 기본급은 항상."""
    cursor.execute("SELECT itemkey, useyn FROM pay_item01t WHERE companyid = %s", (companyid,))
    saved = dict(cursor.fetchall())
    return [f for f in PAY_FIELDS if f == "pay_base" or saved.get(f, "Y") == "Y"]


def save_items(user: dict, keys: list) -> dict:
    """지급항목 설정 저장: keys = 쓰는 항목. 모든 지급항목 행을 Y/N 으로 맞춘다."""
    _require(user)
    companyid = user["companyid"]
    unknown = [k for k in keys if k not in PAY_FIELDS]
    if unknown:
        raise ValueError("알 수 없는 지급항목입니다.")
    use = set(keys) | {"pay_base"}
    with _db.connect() as connection, connection.cursor() as cursor:
        for field in PAY_FIELDS:
            cursor.execute(
                """INSERT INTO pay_item01t (companyid, companyname, itemkey, useyn, created_by)
                   VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s)
                   ON CONFLICT (companyid, itemkey)
                   DO UPDATE SET useyn = EXCLUDED.useyn, updatedat = CURRENT_TIMESTAMP, updated_by = EXCLUDED.created_by
                   WHERE pay_item01t.useyn IS DISTINCT FROM EXCLUDED.useyn""",
                (companyid, companyid, field, "Y" if field in use else "N", user.get("email")),
            )
        enabled = _enabled_items(cursor, companyid)
    return {"pay_items": enabled}


def period_ledger(user: dict, from_ym: str, to_ym: str) -> dict:
    """기간 급여대장: 시작월 ~ 끝월의 년-월별 급여 줄. 귀속월 범위로 조회해 PK 인덱스를 탄다."""
    _require(user)
    companyid = user["companyid"]
    from_ym, to_ym = _check_ym(from_ym), _check_ym(to_ym)
    if from_ym > to_ym:
        raise ValueError("시작월이 끝월보다 늦습니다.")
    span = (int(to_ym[:4]) - int(from_ym[:4])) * 12 + int(to_ym[5:]) - int(from_ym[5:]) + 1
    if span > 36:
        raise ValueError("한 번에 36개월까지 조회할 수 있습니다.")
    with _db.connect() as connection, connection.cursor() as cursor:
        # 년-월별 급여 줄 (귀속월 → 사원번호 순) — 화면이 월마다 소계를 붙인다
        cursor.execute(
            f"""SELECT {_SLIP_COLS}, {_USER_COLS}
                  FROM pay_slip01t s
                  LEFT JOIN user01t u ON u.companyid = s.companyid AND u.email = s.useremail
                 WHERE s.companyid = %s AND s.payym BETWEEN %s AND %s
                 ORDER BY s.payym, COALESCE(u.empno, '') = '', u.empno, u.username""",
            (companyid, from_ym, to_ym),
        )
        items = [_out(r) for r in _rows(cursor)]
        # 기간 안 귀속월별 마감 여부 (급여가 있는 달만)
        cursor.execute(
            """SELECT payym, BOOL_AND(closeyn = 'Y') FROM pay_slip01t
                WHERE companyid = %s AND payym BETWEEN %s AND %s GROUP BY payym ORDER BY payym""",
            (companyid, from_ym, to_ym),
        )
        months = [{"payym": ym, "closed": bool(closed)} for ym, closed in cursor.fetchall()]
        enabled = _enabled_items(cursor, companyid)
    return {"from_ym": from_ym, "to_ym": to_ym, "span": span, "items": items, "months": months, "pay_items": enabled}


def calc(user: dict, payym: str, data: dict) -> dict:
    _require(user)
    slip = _clean(data)
    result = calc_deductions(payym, slip)
    return {**result, **_totals({**slip, **result})}


def generate(user: dict, payym: str, paydate: date) -> dict:
    """전월 불러오기: 급여가 없는 재직자 행을 만든다. 가장 가까운 지난 급여(없으면 가장 가까운 뒤 달 급여)의 고정값을 복사한다."""
    _require(user)
    companyid, payym = user["companyid"], _check_ym(payym)
    with _db.connect() as connection, connection.cursor() as cursor:
        if _is_closed(cursor, companyid, payym):
            raise ValueError(f"{payym} 급여는 마감되었습니다. 마감취소 후 불러오세요.")
        cursor.execute("SELECT useremail FROM pay_slip01t WHERE companyid = %s AND payym = %s", (companyid, payym))
        have = {r[0] for r in cursor.fetchall()}
        targets = [u for u in _active_users(cursor, companyid, payym) if u["email"] not in have]
        if not targets:
            return {"created": 0, "copied": 0}
        # 직원마다 가장 가까운 급여: 이번 달 이전 것이 있으면 그것, 없으면 이후 가장 가까운 달 (지난 급여를 거꾸로 입력할 때)
        cursor.execute(
            f"""SELECT DISTINCT ON (useremail) useremail, {', '.join(COPY_FIELDS)}
                  FROM pay_slip01t
                 WHERE companyid = %s AND payym <> %s AND useremail = ANY(%s)
                 ORDER BY useremail, (payym > %s), CASE WHEN payym < %s THEN payym END DESC, payym""",
            (companyid, payym, [u["email"] for u in targets], payym, payym),
        )
        prev = {r["useremail"]: r for r in _rows(cursor)}
        copied = 0
        for target in targets:
            base = prev.get(target["email"])
            slip = {f: 0 for f in PAY_FIELDS + DED_FIELDS}
            slip.update({"base_monthly": 0, "family_cnt": 1, "child_cnt": 0, "tax_rate": 100, "bankname": "", "accountno": "", "remark": ""})
            if base:
                copied += 1
                slip.update({f: base[f] for f in COPY_FIELDS})
            year, month = payym.split("-")
            slip["remark"] = f"{year}년 {int(month)}월 급여"
            slip["base_monthly"] = slip["pay_base"]
            if base:
                slip.update(calc_deductions(payym, slip))
            _insert(cursor, user, payym, target["email"], paydate, slip)
    return {"created": len(targets), "copied": copied}


_WRITE_FIELDS = BASIS_FIELDS + PAY_FIELDS + DED_FIELDS + TEXT_FIELDS


def _insert(cursor, user: dict, payym: str, email: str, paydate: date, slip: dict):
    cursor.execute(
        f"""INSERT INTO pay_slip01t (companyid, companyname, payym, useremail, paydate, {', '.join(_WRITE_FIELDS)}, created_by)
            VALUES (%s, (SELECT companyname FROM company01t WHERE companyid = %s), %s, %s, %s, {', '.join(['%s'] * len(_WRITE_FIELDS))}, %s)""",
        (user["companyid"], user["companyid"], payym, email, paydate, *[slip[f] for f in _WRITE_FIELDS], user.get("email")),
    )


def _upsert(cursor, user: dict, payym: str, email: str, paydate: date, slip: dict) -> bool:
    """한 명 저장 (있으면 고치고 없으면 추가). 새로 만들었으면 True."""
    sets = ", ".join(f"{f} = %s" for f in _WRITE_FIELDS)
    cursor.execute(
        f"""UPDATE pay_slip01t SET paydate = %s, {sets}, updatedat = CURRENT_TIMESTAMP, updated_by = %s
             WHERE companyid = %s AND payym = %s AND useremail = %s""",
        (paydate, *[slip[f] for f in _WRITE_FIELDS], user.get("email"), user["companyid"], payym, email),
    )
    if cursor.rowcount:
        return False
    _insert(cursor, user, payym, email, paydate, slip)
    return True


def _company_emails(cursor, companyid: str) -> set:
    cursor.execute("SELECT email FROM user01t WHERE companyid = %s", (companyid,))
    return {r[0] for r in cursor.fetchall()}


def save(user: dict, payym: str, email: str, paydate: date, data: dict) -> dict:
    """한 명 저장 (없으면 추가). 공제는 화면이 보낸 값 그대로 (자동 계산 후 고친 값 포함)."""
    return save_bulk(user, payym, paydate, [{"useremail": email, "slip": data}]) and {"payym": _check_ym(payym), "useremail": email}


def save_bulk(user: dict, payym: str, paydate: date, rows: list) -> dict:
    """여러 명 한 번에 저장 (목록에서 바로 입력). 한 명이라도 잘못되면 모두 저장하지 않는다."""
    _require(user)
    companyid, payym = user["companyid"], _check_ym(payym)
    if not rows:
        raise ValueError("저장할 급여가 없습니다.")
    if len(rows) > 1000:
        raise ValueError("한 번에 1,000명까지 저장할 수 있습니다.")
    cleaned = []
    for row in rows:
        email = str(row.get("useremail") or "").strip()
        try:
            cleaned.append((email, _clean(row.get("slip") or {})))
        except ValueError as error:
            raise ValueError(f"{email}: {error}") from error
    with _db.connect() as connection, connection.cursor() as cursor:
        if _is_closed(cursor, companyid, payym):
            raise ValueError(f"{payym} 급여는 마감되었습니다. 마감취소 후 고칠 수 있습니다.")
        emails = _company_emails(cursor, companyid)
        missing = [e for e, _ in cleaned if e not in emails]
        if missing:
            raise LookupError("직원을 찾을 수 없습니다.")
        for email, slip in cleaned:
            _upsert(cursor, user, payym, email, paydate, slip)
    return {"payym": payym, "saved": len(cleaned)}


def delete(user: dict, payym: str, email: str) -> dict:
    _require(user)
    companyid, payym = user["companyid"], _check_ym(payym)
    with _db.connect() as connection, connection.cursor() as cursor:
        if _is_closed(cursor, companyid, payym):
            raise ValueError(f"{payym} 급여는 마감되었습니다. 마감취소 후 삭제할 수 있습니다.")
        cursor.execute("DELETE FROM pay_slip01t WHERE companyid = %s AND payym = %s AND useremail = %s", (companyid, payym, email))
        if cursor.rowcount == 0:
            raise LookupError("삭제할 급여가 없습니다.")
    return {"deleted": 1}


def set_close(user: dict, payym: str, close: bool) -> dict:
    """마감 / 마감취소: 그달 전체."""
    _require(user)
    companyid, payym = user["companyid"], _check_ym(payym)
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """UPDATE pay_slip01t SET closeyn = %s, updatedat = CURRENT_TIMESTAMP, updated_by = %s
                WHERE companyid = %s AND payym = %s""",
            ("Y" if close else "N", user.get("email"), companyid, payym),
        )
        count = cursor.rowcount
        if count == 0:
            raise ValueError(f"{payym} 급여가 없습니다.")
    return {"payym": payym, "closed": close, "count": count}


def my_slips(user: dict) -> dict:
    """내 급여현황: 마감된 내 급여만 (최근 달부터)."""
    _require(user, MENU_MY, "내 급여현황")
    companyid, email = user["companyid"], user.get("email")
    with _db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT {_SLIP_COLS}, {_USER_COLS}, COALESCE(s.companyname, '') AS companyname
                  FROM pay_slip01t s
                  LEFT JOIN user01t u ON u.companyid = s.companyid AND u.email = s.useremail
                 WHERE s.companyid = %s AND s.useremail = %s AND s.closeyn = 'Y'
                 ORDER BY s.payym DESC""",
            (companyid, email),
        )
        items = [_out(r) for r in _rows(cursor)]
    # 명세서에 필요 없는 칸은 빼고 내려준다
    for item in items:
        item.pop("retiredate", None)
    return {"items": items}
