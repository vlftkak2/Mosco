"""타사 재고현황 확인용 데이터 (2026-11-24) - 002 · 003 · 004 고객사.
각 회사에 기준정보(공통코드 · 품목 · 거래처)를 만들고, 매입 · 가공 · 재고이동 · 매출을 5건씩 '저장 함수'로 넣는다
(현재고 · 수불이 화면에서 등록한 것과 똑같이 맞물림). 끝으로 재고 공개를 '공개'로 바꾼다.
만든 것은 demo_seed/created_stockshare_20261124.json 에 기록 → cleanup_stockshare_20261124.py 가 그대로 지운다.
"""
import datetime as dt
import json
import random
import sys
from decimal import Decimal, ROUND_HALF_UP

sys.path.insert(0, 'c:/Mosco/backend')
sys.stdout.reconfigure(encoding='utf-8')
import db  # noqa: E402
from services.inbound import InboundRegister as IN  # noqa: E402
from services.inoutmove import inoutmoveRegister as MOVE  # noqa: E402
from services.outbound import OutboundRegister as OUT  # noqa: E402
from services.process import ItemProcessRegister as PROC  # noqa: E402

ACTOR = 'stockshare-demo'
LOG = 'c:/Mosco/demo_seed/created_stockshare_20261124.json'
COMPANIES = {  # 회사: (매입 규모 배수, 공개 동의일)
    '002': (1.6, dt.date(2025, 11, 20)),
    '003': (1.0, dt.date(2025, 11, 25)),
    '004': (0.6, dt.date(2025, 12, 1)),
}
ROUND_DATES = [dt.date(2025, 12, 4), dt.date(2026, 2, 9), dt.date(2026, 5, 11), dt.date(2026, 8, 5), dt.date(2026, 10, 13)]
ITEMS = [  # itemcode, itemname, 강종코드, 표면코드, 두께, 폭, 길이(시트), kg단가
    ('29', 'EGI COIL', '268', '', '0.800', '1140', None, 1030),
    ('10', 'CCGI COIL', '79', '48', '0.700', '1219', None, 1500),
    ('31', 'EGI SKELP', '268', '51', '1.000', '212', None, 1080),
    ('30', 'EGI SHEET', '268', '100', '1.200', '1025', '1752', 1150),
    ('11', 'CCGI SHEET', '79', '58', '0.500', '892', '1407', 1440),
    ('138', None, '280', '47', '0.780', '1210', None, 1340),   # 이름은 001 품목명 그대로 복사
]
CUSTOMERS = [  # 코드, 이름, 역할
    ('DM-S1', '대한철강상사', 'supplier'), ('DM-S2', '신성스틸', 'supplier'),
    ('DM-B1', '동양금속', 'buyer'), ('DM-B2', '한성철강', 'buyer'), ('DM-P1', '삼일가공', 'processor'),
]
WAREHOUSES = [('DM-W1', '본사창고'), ('DM-W2', '제2창고')]

random.seed(20261124)
try:
    created = json.load(open(LOG, encoding='utf-8'))   # 중간에 멈췄으면 이어서 넣는다
except FileNotFoundError:
    created = {}


def D(value, q='1'):
    return Decimal(str(value)).quantize(Decimal(q), rounding=ROUND_HALF_UP)


def save_log():
    json.dump(created, open(LOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)


def stock(cid, day, warehouse=None):
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT sourcetype, sourceno, sourceline, itemcode, itemname, qty, weight, receiptdate, warehousecode, stockkind, length
               FROM currentstock01t WHERE companyid = %s AND COALESCE(weight, 0) > 0 AND COALESCE(qty, 0) > 0 AND receiptdate <= %s
                 AND (%s::varchar IS NULL OR warehousecode = %s::varchar)
               ORDER BY receiptdate, sourceno, sourceline""",
            (cid, day, warehouse, warehouse),
        )
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def setup_master(cid, cname, log):
    with db.connect() as conn, conn.cursor() as cur:
        # 공통코드: 단가기준 · 수량단위 · 강종 · 표면 · 공정은 001 에서 복사, 창고는 새로
        cur.execute("""SELECT groupcode, groupname, code, code_name, sort_order FROM codemaster01t WHERE companyid='001' AND (
                         groupcode IN ('PRICE_UNIT', 'QTY')
                         OR (groupcode = 'MATERIAL' AND code IN ('268', '280', '79'))
                         OR (groupcode = 'SURFACE' AND code IN ('47', '48', '51', '58', '100'))
                         OR (groupcode = 'PROCESS' AND code IN ('1', '2', '3')))""")
        codes = cur.fetchall()
        cur.execute("SELECT groupname FROM codemaster01t WHERE companyid='001' AND groupcode='WAREHOUSE' LIMIT 1")
        wh_group = (cur.fetchone() or ['창고'])[0]
        codes += [('WAREHOUSE', wh_group, code, name, i + 1) for i, (code, name) in enumerate(WAREHOUSES)]
        for groupcode, groupname, code, name, sort_order in codes:
            cur.execute("""INSERT INTO codemaster01t (companyid, companyname, groupcode, groupname, code, code_name, sort_order, use_yn, created_by)
                           SELECT %s, %s, %s, %s, %s, %s, %s, 'Y', %s
                           WHERE NOT EXISTS (SELECT 1 FROM codemaster01t WHERE companyid=%s AND groupcode=%s AND code=%s)""",
                        (cid, cname, groupcode, groupname, code, name, sort_order, ACTOR, cid, groupcode, code))
            if cur.rowcount:
                log['codes'].append([groupcode, code])
        # 품목: 001 품목코드 · 이름 복사
        cur.execute("SELECT itemcode, itemname, itemtypecode, itemtypecodenm FROM itemcode01t WHERE companyid='001' AND itemcode = ANY(%s)",
                    ([it[0] for it in ITEMS],))
        for itemcode, itemname, typecode, typename in cur.fetchall():
            cur.execute("""INSERT INTO itemcode01t (companyid, companyname, itemcode, itemname, itemtypecode, itemtypecodenm, use_yn, created_by)
                           SELECT %s, %s, %s, %s, %s, %s, 'Y', %s
                           WHERE NOT EXISTS (SELECT 1 FROM itemcode01t WHERE companyid=%s AND itemcode=%s)""",
                        (cid, cname, itemcode, itemname, typecode, typename, ACTOR, cid, itemcode))
            if cur.rowcount:
                log['items'].append(itemcode)
        # 거래처
        for code, name, _role in CUSTOMERS:
            cur.execute("""INSERT INTO customer01t (companyid, companyname, customercode, customername, useyn, createdby)
                           SELECT %s, %s, %s, %s, 'Y', %s
                           WHERE NOT EXISTS (SELECT 1 FROM customer01t WHERE companyid=%s AND customercode=%s)""",
                        (cid, cname, code, name, ACTOR, cid, code))
            if cur.rowcount:
                log['customers'].append(code)
        cur.execute("SELECT code, code_name FROM codemaster01t WHERE companyid=%s AND groupcode IN ('MATERIAL','SURFACE')", (cid,))
        names = dict(cur.fetchall())
        cur.execute("SELECT itemcode, itemname FROM itemcode01t WHERE companyid=%s", (cid,))
        item_names = dict(cur.fetchall())
    return names, item_names


def run_company(cid, scale, open_date):
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT companyname, stock_open_yn, stock_open_date FROM company01t WHERE companyid=%s", (cid,))
        cname, open_yn, open_dt = cur.fetchone()
    log = created.setdefault(cid, {'codes': [], 'items': [], 'customers': [], 'docs': [],
                                   'stock_open_before': [open_yn, open_dt]})
    code_names, item_names = setup_master(cid, cname, log)
    cust = {code: name for code, name, _ in CUSTOMERS}
    suppliers = [c for c, _, r in CUSTOMERS if r == 'supplier']
    buyers = [c for c, _, r in CUSTOMERS if r == 'buyer']
    processor = next(c for c, _, r in CUSTOMERS if r == 'processor')
    w1, w2 = WAREHOUSES

    done = len(log['docs'])   # 이미 넣은 단계 수 (차례마다 4단계)
    for k, base_day in enumerate(ROUND_DATES):
        day = base_day + dt.timedelta(days=int(cid) % 3)
        step0 = k * 4
        if done >= step0 + 4:
            continue
        # 1) 매입: 2줄 (코일 1 + 다른 품목 1)
        picks = [ITEMS[k % 2]] + [random.choice(ITEMS[2:])]
        if done > step0:   # 이 차례 매입은 이미 들어감 → 그 전표의 품목으로 이어서
            inbound_no = log['docs'][step0][1]
            with db.connect() as conn, conn.cursor() as cur:
                cur.execute("SELECT itemcode FROM inbound02t WHERE companyid=%s AND receiptno=%s ORDER BY lineno", (cid, inbound_no))
                codes = [r[0] for r in cur.fetchall()]
            picks = [next(it for it in ITEMS if it[0] == code) for code in codes]
        items = []
        for it in picks:
            bundles = random.randint(4, 8)
            weight = D(bundles * random.uniform(900, 1300) * scale)
            items.append({'itemcode': it[0], 'itemname': item_names[it[0]], 'materialcode': it[2], 'materialname': code_names.get(it[2], ''),
                          'surfacecode': it[3], 'surfacename': code_names.get(it[3], '') if it[3] else '',
                          'thickness': it[4], 'width': it[5], 'length': it[6], 'qtyunit': '2', 'qty': bundles, 'weight': str(weight),
                          'unit': '1', 'unitprice': str(D(it[7] * random.uniform(0.97, 1.05))), 'warehousecode': w1[0], 'warehousecodename': w1[1]})
        if done <= step0:
            payload = IN.InboundSaveRequest(**{'is_new': True, 'receptdate': day.isoformat(), 'customcode': suppliers[k % 2],
                                               'customname': cust[suppliers[k % 2]], 'items': items}).model_dump()
            inbound_no = IN.save_receipt(cid, cname, payload, actor=ACTOR)['receiptno']
            log['docs'].append(['inbound', inbound_no])
            save_log()

        # 2) 가공: 이번 매입의 1행(코일) 전부 → 시트 (중량 그대로)
        pday = day + dt.timedelta(days=6)
        process_no = log['docs'][step0 + 1][1] if done > step0 + 1 else None
        if not process_no:
          src = next(s for s in stock(cid, pday) if s['sourceno'] == inbound_no and s['sourceline'] == 1)
          product = {'clientid': 'p1', 'processid': '1', 'processcodename': '-', 'productname': src["itemname"],
                   'thickness': picks[0][4], 'width': picks[0][5], 'length': '1219', 'qty': str(D(src['qty']) * 20),
                   'qtyunit': '4', 'weight': str(src['weight']), 'unit': '1', 'unitprice': '30'}
          payload = PROC.ProcessSaveRequest(**{'processdate': pday.isoformat(), 'customcode': processor, 'customname': cust[processor],
                                               'warehousecode': w1[0], 'warehousecodename': w1[1],
                                               'sources': [{'stocksourcetype': src['sourcetype'], 'stocksourceno': src['sourceno'],
                                                          'stocksourceline': src['sourceline'], 'qty': str(src['qty']),
                                                          'weight': str(src['weight']), 'products': [product]}]}).model_dump()
          process_no = PROC.save_document(cid, cname, payload, actor=ACTOR)
          process_no = process_no.get('processno') if isinstance(process_no, dict) else process_no
          log['docs'].append(['process', process_no])
          save_log()

        # 3) 재고이동: 이번 매입의 2행 일부를 본사창고 → 제2창고
        mday = day + dt.timedelta(days=9)
        move_no = log['docs'][step0 + 2][1] if done > step0 + 2 else None
        if not move_no:
          src = next(s for s in stock(cid, mday, w1[0]) if s['sourceno'] == inbound_no and s['sourceline'] == 2)
          move_qty = max(1, int(D(src['qty']) // 2))
          payload = MOVE.TransferSaveRequest(**{'receptdate': mday.isoformat(), 'fromwarehousecode': w1[0], 'towarehousecode': w2[0],
                                              'items': [{'stocksourcetype': src['sourcetype'], 'stocksourceno': src['sourceno'],
                                                         'stocksourceline': src['sourceline'], 'qty': move_qty}]}).model_dump()
          move_no = MOVE.save_transfer(cid, cname, payload, actor=ACTOR)
          move_no = move_no.get('receiptno') if isinstance(move_no, dict) else move_no
          log['docs'].append(['transfer', move_no])
          save_log()

        # 4) 매출: 남은 재고 중 2로트의 일부 (가공품 포함)
        oday = day + dt.timedelta(days=20 + k)
        avail = [s for s in stock(cid, oday) if s['sourcetype'] in ('INBOUND', 'PROCESS', 'OPENING')]
        lines = []
        for lot in random.sample(avail, min(2, len(avail))):
            qty = D(lot['qty'])
            sell = max(Decimal(1), (qty * Decimal(str(random.uniform(0.3, 0.6)))).to_integral_value())
            sell = min(sell, qty)
            weight = Decimal(str(lot['weight'])) if sell == qty else (Decimal(str(lot['weight'])) / qty * sell).quantize(Decimal('0.001'), rounding='ROUND_DOWN')
            lines.append({'stocksourcetype': lot['sourcetype'], 'stocksourceno': lot['sourceno'], 'stocksourceline': lot['sourceline'],
                          'qty': str(sell), 'weight': str(weight), 'adjweight': 0, 'unit': '1', 'unitprice': str(D(random.uniform(1200, 1700)))})
        buyer = buyers[k % 2]
        payload = OUT.OutboundSaveRequest(**{'is_new': True, 'receptdate': oday.isoformat(), 'customcode': buyer,
                                             'customname': cust[buyer], 'items': lines}).model_dump()
        payload['is_new'] = True
        outbound_no = OUT.save_receipt(cid, cname, payload, actor=ACTOR).get('receiptno')
        log['docs'].append(['outbound', outbound_no])
        save_log()
        print(cid, day, '매입', inbound_no, '가공', process_no, '이동', move_no, '매출', outbound_no, flush=True)

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("UPDATE company01t SET stock_open_yn='Y', stock_open_date=%s WHERE companyid=%s", (open_date, cid))
    save_log()


for company_id, (factor, consent) in COMPANIES.items():
    run_company(company_id, factor, consent)
print('done', {cid: len(v['docs']) for cid, v in created.items()})
