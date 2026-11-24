"""seed_stockshare_20261124.py 로 넣은 것만 지운다 (created_stockshare_20261124.json 기준).
전표는 만든 역순으로 화면과 같은 삭제 함수로 지우고(매출 → 재고이동 → 가공 → 매입), 그다음 거래처 · 품목 · 공통코드를 지우고,
재고 공개를 넣기 전 값으로 되돌린다."""
import json
import os
import sys

sys.path.insert(0, 'c:/Mosco/backend')
sys.stdout.reconfigure(encoding='utf-8')
import db  # noqa: E402
from services.inbound import InboundRegister as IN  # noqa: E402
from services.inoutmove import inoutmoveRegister as MOVE  # noqa: E402
from services.outbound import OutboundRegister as OUT  # noqa: E402
from services.process import ItemProcessRegister as PROC  # noqa: E402

LOG = 'c:/Mosco/demo_seed/created_stockshare_20261124.json'
created = json.load(open(LOG, encoding='utf-8'))
fail = []
for cid, log in created.items():
    for kind, no in reversed(log['docs']):
        try:
            if kind == 'outbound':
                OUT.delete_receipt(cid, no)
            elif kind == 'transfer':
                MOVE.delete_transfer(cid, no)
            elif kind == 'process':
                PROC.delete_documents(cid, [no])
            elif kind == 'inbound':
                IN.delete_receipt(cid, no)
        except Exception as error:  # 하나가 실패해도 나머지는 계속
            fail.append((cid, kind, no, str(error)))
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM customer01t WHERE companyid=%s AND customercode = ANY(%s)", (cid, log['customers']))
        cur.execute("DELETE FROM itemcode01t WHERE companyid=%s AND itemcode = ANY(%s)", (cid, log['items']))
        for groupcode, code in log['codes']:
            cur.execute("DELETE FROM codemaster01t WHERE companyid=%s AND groupcode=%s AND code=%s", (cid, groupcode, code))
        open_yn, open_date = log.get('stock_open_before') or ['N', None]
        cur.execute("UPDATE company01t SET stock_open_yn=%s, stock_open_date=%s WHERE companyid=%s", (open_yn or 'N', open_date, cid))
        # 남은 자료 확인 (재고 · 수불 · 전표가 0 이어야 함)
        left = {}
        for table in ('currentstock01t', 'iniop01t', 'inbound01t', 'outbound01t', 'process01t', 'inoutmove01t'):
            cur.execute("SELECT to_regclass(%s)", (table,))
            if cur.fetchone()[0]:
                cur.execute(f'SELECT COUNT(*) FROM "{table}" WHERE companyid=%s', (cid,))
                left[table] = cur.fetchone()[0]
    print(cid, '남은 자료:', left)
print('삭제 실패:', fail or '없음')
if not fail:
    os.remove(LOG)
    print('기록 파일 삭제:', LOG)
