"""Company-scoped purchase vouchers. Purchases never post inventory."""
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
from pydantic import BaseModel, Field, model_validator

from config import DB_CONFIG

_pool = ThreadedConnectionPool(1, 10, host=DB_CONFIG['host'], port=DB_CONFIG['port'],
                              dbname=DB_CONFIG['database'], user=DB_CONFIG['user'],
                              password=DB_CONFIG['password'], connect_timeout=5)


@contextmanager
def _connect():
    connection = _pool.getconn()
    try:
        with connection:
            yield connection
    except Exception:
        _pool.putconn(connection, close=True)
        connection = None
        raise
    finally:
        if connection is not None:
            _pool.putconn(connection)


class PurchaseLine(BaseModel):
    inboundlineno: int | None = Field(default=None, gt=0)
    itemcode: str = Field(min_length=1, max_length=100)
    size: str = Field(default='', max_length=100)
    steelgrade: str = Field(default='', max_length=100)
    thickness: Decimal | None = Field(default=None, ge=0)
    width: Decimal | None = Field(default=None, ge=0)
    length: Decimal | None = Field(default=None, ge=0)
    qty: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    qtyunit: str = Field(min_length=1, max_length=20)
    weight: Decimal = Field(gt=0, max_digits=15, decimal_places=3)
    unit: str = Field(min_length=1, max_length=20)
    unitprice: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    warehousecode: str = Field(default='', max_length=50)
    description: str = ''


class PurchaseInput(BaseModel):
    purchaseno: str = ''
    receiptno: str | None = None
    purchasedate: date
    customcode: str = Field(min_length=1, max_length=50)
    paymentterms: str = Field(default='', max_length=100)
    paymentduedate: date | None = None
    vattype: str = 'TAXABLE'
    freightamount: Decimal = Field(default=0, ge=0)
    otheramount: Decimal = Field(default=0, ge=0)
    vatamount: Decimal = Field(default=0, ge=0)
    description: str = ''
    lines: list[PurchaseLine] = Field(min_length=1)

    @model_validator(mode='after')
    def validate_document(self):
        if self.vattype not in ('TAXABLE', 'ZERO', 'EXEMPT'):
            raise ValueError('부가세 구분이 올바르지 않습니다.')
        if self.vattype != 'TAXABLE' and self.vatamount != 0:
            raise ValueError('영세·면세의 부가세는 0이어야 합니다.')
        inbound_lines = [line.inboundlineno for line in self.lines if line.inboundlineno is not None]
        if len(inbound_lines) != len(set(inbound_lines)):
            raise ValueError('연결된 입고 품목 순번이 중복되었습니다.')
        if inbound_lines and not self.receiptno:
            raise ValueError('입고 품목이 있는 전표에는 입고번호가 필요합니다.')
        return self


def _money(value):
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _amount(line, price_unit_name):
    unit = f'{line.unit} {price_unit_name}'.upper()
    basis = line.weight / Decimal(1000) if 'TON' in unit or '톤' in unit else line.weight
    return _money(basis * line.unitprice)


def resolve_token(companyid, kind, token):
    """Resolve one exact code or display name within the authenticated company."""
    token = str(token or '').strip()
    if not token or kind not in ('customer', 'item', 'unit', 'qtyunit', 'warehouse'):
        return None
    with _connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        if kind == 'customer':
            cur.execute('''SELECT customercode AS code,customername AS name FROM Customer01t
                           WHERE companyid=%s AND UPPER(BTRIM(useyn))='Y'
                             AND (LOWER(customercode)=LOWER(%s) OR LOWER(customername)=LOWER(%s))
                           ORDER BY CASE WHEN LOWER(customercode)=LOWER(%s) THEN 0 ELSE 1 END LIMIT 2''',
                        (companyid, token, token, token))
        elif kind == 'item':
            cur.execute('''SELECT itemcode AS code,itemname AS name FROM ItemCode01t
                           WHERE companyid=%s AND UPPER(BTRIM(use_yn))='Y'
                             AND (LOWER(itemcode)=LOWER(%s) OR LOWER(itemname)=LOWER(%s))
                           ORDER BY CASE WHEN LOWER(itemcode)=LOWER(%s) THEN 0 ELSE 1 END LIMIT 2''',
                        (companyid, token, token, token))
        else:
            group = {'unit': 'PRICE_UNIT', 'qtyunit': 'QTY', 'warehouse': 'WAREHOUSE'}[kind]
            cur.execute('''SELECT code,code_name AS name FROM CodeMaster01t
                           WHERE companyid=%s AND groupcode=%s AND UPPER(BTRIM(use_yn))='Y'
                             AND (LOWER(code)=LOWER(%s) OR LOWER(code_name)=LOWER(%s))
                           ORDER BY CASE WHEN LOWER(code)=LOWER(%s) THEN 0 ELSE 1 END LIMIT 2''',
                        (companyid, group, token, token, token))
        rows = list(cur.fetchall())
        if len(rows) > 1 and rows[0]['code'].lower() != token.lower():
            raise ValueError(f'동일한 코드명이 여러 개입니다: {token}. 코드를 입력하세요.')
        return rows[0] if rows else None


def list_purchases(companyid, page=1, page_size=50, date_from=None, date_to=None, customname='', purchaseno=''):
    where, params = ['companyid=%s'], [companyid]
    for expression, value in [('purchasedate >= %s', date_from), ('purchasedate <= %s', date_to)]:
        if value:
            where.append(expression)
            params.append(value)
    if customname:
        where.append('customname ILIKE %s')
        params.append(f'%{customname}%')
    if purchaseno:
        where.append('purchaseno ILIKE %s')
        params.append(f'%{purchaseno}%')
    clause = ' AND '.join(where)
    with _connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f'SELECT COUNT(*) AS total FROM Purchase01t WHERE {clause}', params)
        total = cur.fetchone()['total']
        cur.execute(f'''SELECT h.*, (SELECT COUNT(*) FROM Purchase02t d WHERE d.companyid=h.companyid
                         AND d.purchaseno=h.purchaseno) AS itemcount
                         FROM Purchase01t h WHERE {clause}
                         ORDER BY purchasedate DESC,purchaseno DESC LIMIT %s OFFSET %s''',
                    params + [page_size, (page-1)*page_size])
        return {'items': list(cur.fetchall()), 'total': total, 'page': page, 'page_size': page_size}


def get_purchase(companyid, purchaseno):
    with _connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT * FROM Purchase01t WHERE companyid=%s AND purchaseno=%s', (companyid, purchaseno))
        header = cur.fetchone()
        if not header:
            return None
        cur.execute('SELECT * FROM Purchase02t WHERE companyid=%s AND purchaseno=%s ORDER BY lineno',
                    (companyid, purchaseno))
        return {'header': header, 'lines': list(cur.fetchall())}


def list_inbound_candidates(companyid, q='', limit=50):
    with _connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''SELECT h.receiptno,h.receptdate,h.customcode,h.customname,COUNT(d.lineno) AS itemcount
                       FROM Inbound01t h JOIN Inbound02t d ON d.companyid=h.companyid AND d.receiptno=h.receiptno
                       WHERE h.companyid=%s AND NOT EXISTS
                         (SELECT 1 FROM Purchase01t p WHERE p.companyid=h.companyid AND p.receiptno=h.receiptno)
                         AND (h.receiptno ILIKE %s OR h.customname ILIKE %s)
                       GROUP BY h.companyid,h.receiptno ORDER BY h.receptdate DESC,h.receiptno DESC LIMIT %s''',
                    (companyid, f'%{q}%', f'%{q}%', limit))
        return list(cur.fetchall())


def get_inbound_preview(companyid, receiptno):
    with _connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT receiptno,receptdate,customcode,customname FROM Inbound01t WHERE companyid=%s AND receiptno=%s',
                    (companyid, receiptno))
        header = cur.fetchone()
        if not header:
            return None
        cur.execute('''SELECT lineno AS inboundlineno,itemcode,itemname,size,qty,qtyunit,weight,unit,
                              unitprice,warehousecode,warehousecodename,description
                       FROM Inbound02t WHERE companyid=%s AND receiptno=%s ORDER BY lineno''',
                    (companyid, receiptno))
        return {'header': header, 'lines': list(cur.fetchall())}


def save_purchase(companyid, companyname, username, data: PurchaseInput):
    with _connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Serializes numbering and saves for this company; other companies remain independent.
        cur.execute('SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)', (f'purchase:{companyid}',))
        customer = resolve_token(companyid, 'customer', data.customcode)
        if not customer:
            raise ValueError('사용 가능한 매입처 코드를 선택하세요.')
        customer_code = customer['code']
        if data.receiptno:
            cur.execute('SELECT customcode FROM Inbound01t WHERE companyid=%s AND receiptno=%s',
                        (companyid, data.receiptno))
            source_header = cur.fetchone()
            if not source_header or source_header['customcode'] != customer_code:
                raise ValueError('입고 전표와 매입처가 일치하지 않습니다.')
            cur.execute('SELECT lineno,itemcode FROM Inbound02t WHERE companyid=%s AND receiptno=%s',
                        (companyid, data.receiptno))
            source_lines = {row['lineno']: row['itemcode'] for row in cur.fetchall()}
        else:
            source_lines = {}
        item_tokens = sorted({line.itemcode.strip() for line in data.lines})
        item_names = {}
        normalized_items = {}
        for token in item_tokens:
            match = resolve_token(companyid, 'item', token)
            if not match:
                raise ValueError(f'사용 가능한 품목코드 또는 품목명을 입력하세요: {token}')
            normalized_items[token] = match['code']
            item_names[match['code']] = match['name']
        groups = {'unit': 'PRICE_UNIT', 'qtyunit': 'QTY', 'warehousecode': 'WAREHOUSE'}
        cur.execute('''SELECT groupcode,code,code_name FROM CodeMaster01t WHERE companyid=%s
                       AND groupcode=ANY(%s) AND UPPER(BTRIM(use_yn))='Y' ''',
                    (companyid, list(groups.values())))
        options = {(row['groupcode'], row['code']): row['code_name'] for row in cur.fetchall()}
        option_names = {}
        for (group, code), name in options.items():
            option_names.setdefault((group, name.casefold()), []).append(code)
        def code_for(group, token):
            token = str(token).strip()
            if (group, token) in options:
                return token
            matches = option_names.get((group, token.casefold()), [])
            if len(matches) > 1:
                raise ValueError(f'동일한 코드명이 여러 개입니다: {token}. 코드를 입력하세요.')
            return matches[0] if matches else None
        amounts = []
        normalized_lines = []
        for line in data.lines:
            codes = {}
            for field, group in groups.items():
                value = getattr(line, field).strip()
                if field == 'warehousecode' and not value:
                    codes[field] = ''
                    continue
                code = code_for(group, value)
                if not code:
                    raise ValueError(f'사용 가능한 {field} 코드 또는 코드명을 입력하세요: {value}')
                codes[field] = code
            item_code = normalized_items[line.itemcode.strip()]
            if line.inboundlineno and source_lines.get(line.inboundlineno) != item_code:
                raise ValueError('연결된 입고 품목이 변경되었습니다. 다시 불러오세요.')
            normalized_lines.append((item_code, codes))
            amounts.append(_amount(line, options[(groups['unit'], codes['unit'])]))
        purchaseno = data.purchaseno.strip()
        if purchaseno:
            cur.execute('SELECT receiptno FROM Purchase01t WHERE companyid=%s AND purchaseno=%s FOR UPDATE',
                        (companyid, purchaseno))
            existing = cur.fetchone()
            if not existing:
                raise ValueError('수정할 매입 전표가 없습니다.')
            if existing['receiptno'] != data.receiptno:
                raise ValueError('저장된 전표의 입고 연결은 변경할 수 없습니다.')
        else:
            if data.receiptno:
                cur.execute('SELECT 1 FROM Purchase01t WHERE companyid=%s AND receiptno=%s',
                            (companyid, data.receiptno))
                if cur.fetchone():
                    raise ValueError('이미 매입 등록된 입고 전표입니다.')
            prefix = f'PUR{data.purchasedate:%Y%m%d}'
            cur.execute('''SELECT COALESCE(MAX(RIGHT(purchaseno,5)::integer),0) AS seq
                           FROM Purchase01t WHERE companyid=%s AND purchaseno ~ %s''',
                        (companyid, f'^{prefix}[0-9]{{5}}$'))
            sequence = cur.fetchone()['seq'] + 1
            if sequence > 99999:
                raise ValueError('해당 날짜의 매입 전표번호를 더 생성할 수 없습니다.')
            purchaseno = f'{prefix}{sequence:05d}'
        goods = _money(sum(amounts, Decimal(0)))
        supply = _money(goods + data.freightamount + data.otheramount)
        vat = _money(data.vatamount)
        total = supply + vat
        values = (data.purchasedate, customer_code, customer['name'], data.paymentterms,
                  data.paymentduedate, data.vattype, _money(data.freightamount), _money(data.otheramount),
                  goods, supply, vat, total, data.description, username)
        if data.purchaseno:
            cur.execute('''UPDATE Purchase01t SET purchasedate=%s,customcode=%s,customname=%s,paymentterms=%s,
                           paymentduedate=%s,vattype=%s,freightamount=%s,otheramount=%s,goodsamount=%s,
                           supplyamount=%s,vatamount=%s,totalamount=%s,description=%s,updatedby=%s,
                           updated_at=CURRENT_TIMESTAMP WHERE companyid=%s AND purchaseno=%s''',
                        values + (companyid, purchaseno))
            cur.execute('DELETE FROM Purchase02t WHERE companyid=%s AND purchaseno=%s', (companyid, purchaseno))
        else:
            cur.execute('''INSERT INTO Purchase01t(companyid,companyname,purchaseno,receiptno,purchasedate,
                           customcode,customname,paymentterms,paymentduedate,vattype,freightamount,otheramount,
                           goodsamount,supplyamount,vatamount,totalamount,description,createdby,updatedby)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                        (companyid, companyname, purchaseno, data.receiptno) + values[:-1] + (username, username))
        for lineno, (line, amount, normalized) in enumerate(zip(data.lines, amounts, normalized_lines), 1):
            item_code, codes = normalized
            warehouse = options.get((groups['warehousecode'], codes['warehousecode']), '')
            cur.execute('''INSERT INTO Purchase02t(companyid,companyname,purchaseno,lineno,inboundlineno,
                           itemcode,itemname,size,steelgrade,thickness,width,length,qty,qtyunit,weight,unit,
                           unitprice,supplyamount,warehousecode,warehousecodename,description)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                        (companyid, companyname, purchaseno, lineno, line.inboundlineno,
                         item_code, item_names[item_code], line.size.strip(), line.steelgrade.strip(),
                         line.thickness, line.width, line.length, line.qty, codes['qtyunit'], line.weight,
                         codes['unit'], _money(line.unitprice), amount, codes['warehousecode'], warehouse,
                         line.description))
    return {'purchaseno': purchaseno, 'totalamount': total, 'saved_count': len(data.lines)}


def delete_purchase(companyid, purchaseno):
    with _connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT 1 FROM Purchase01t WHERE companyid=%s AND purchaseno=%s FOR UPDATE',
                    (companyid, purchaseno))
        if not cur.fetchone():
            return False
        cur.execute('DELETE FROM Purchase02t WHERE companyid=%s AND purchaseno=%s', (companyid, purchaseno))
        cur.execute('DELETE FROM Purchase01t WHERE companyid=%s AND purchaseno=%s', (companyid, purchaseno))
        return True
