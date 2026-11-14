"""상담게시판. 회사 · 작성자는 항상 로그인 계정에서 정한다.

탭: 공지사항(notice) · 재고문의(stock) · AI ERP문의(ai) · 시스템문의(system)
  - 공지사항   = 운영사(001)만 보고 등록 · 수정 · 삭제 · 상단 고정. 답글 없음.
  - AI ERP문의 = 운영사(001)만 보고 답글 (홈페이지 문의가 들어올 탭, 지금은 운영사가 시험 등록 가능)
  - 재고 · 시스템문의 = 각 회사가 자기 문의를 등록 · 관리, 운영사(001)는 전체 열람 · 답글 · 시험 등록
처리상태(답글이 있는 탭): 답글 없음 = waiting(답변대기), 마지막 답글이 운영사 = answered(답변완료),
                         마지막 답글이 문의 회사 = followup(추가문의)
답글: 작성자만 수정, 작성자 · 운영사가 삭제.
"""
from typing import Literal

from fastapi import HTTPException
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel, ConfigDict, Field

from db import connect

Category = Literal['notice', 'stock', 'ai', 'system']
Status = Literal['', 'waiting', 'followup', 'answered']
CATEGORIES = ('notice', 'stock', 'ai', 'system')
OPERATOR_ONLY = ('notice', 'ai')   # 운영사만 보는 탭
COMPANY_TABS = ('stock', 'system')  # 회사가 쓰는 문의 탭
NO_REPLY = ('notice', 'ai')         # 답글 없는 탭
PINNABLE = ('notice',)              # 상단 고정할 수 있는 탭
OPERATOR = '001'


class PostInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    category: Category
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20000)
    phone: str = Field(default='', max_length=50)
    pinned: bool = False  # 공지사항만, 운영사만 적용


class ReplyInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    reply: str = Field(min_length=1, max_length=20000)


def is_operator(user):
    return user['companyid'] == OPERATOR


def can_create(user, category):
    return is_operator(user) or category in COMPANY_TABS


def visible_categories(user):
    return CATEGORIES if is_operator(user) else COMPANY_TABS


def visibility(user):
    if is_operator(user):
        return 'TRUE', []
    return "(category IN ('stock', 'system') AND companyid = %s)", [user['companyid']]


def permissions(item, user):
    item = dict(item)
    item['can_edit'] = item['companyid'] == user['companyid'] and can_create(user, item['category'])
    item['can_reply'] = item['category'] not in NO_REPLY and (
        is_operator(user) or item['companyid'] == user['companyid']
    )
    item['can_pin'] = is_operator(user) and item['category'] in PINNABLE
    return item


# 목록 · 상세 공통: 답글 수 · 마지막 답글 회사 · 처리상태
_STATUS_SQL = """
    CASE WHEN b.category IN ('notice', 'ai') THEN b.category
         WHEN lr.last_company IS NULL THEN 'waiting'
         WHEN lr.last_company = '001' THEN 'answered'
         ELSE 'followup' END
"""
_LATEST_REPLY_JOIN = """
    LEFT JOIN LATERAL (
        SELECT r.companyid AS last_company, r.created_at AS last_at FROM boardreply01t r
        WHERE r.board_id = b.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ) lr ON TRUE
"""


def find_post(cursor, post_id, user, lock=False):
    scope, args = visibility(user)
    cursor.execute(f'SELECT * FROM board01t WHERE id = %s AND {scope}' + (' FOR UPDATE' if lock else ''), [post_id, *args])
    item = cursor.fetchone()
    if not item:
        raise HTTPException(404, '게시글을 찾을 수 없습니다.')
    return permissions(item, user)


def list_posts(user, category, keyword, page, page_size, status=''):
    scope, args = visibility(user)
    where = f'{scope} AND category = %s'
    args.append(category)
    if keyword:
        where += " AND (title ILIKE %s OR content ILIKE %s)"
        literal = keyword.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        args.extend([f'%{literal}%', f'%{literal}%'])
    if status and category not in NO_REPLY:
        where += f' AND ({_STATUS_SQL}) = %s'
        args.append(status)
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute('SELECT companyname FROM company01t WHERE companyid = %s', (OPERATOR,))
        management_company = cursor.fetchone()
        management_company_name = (management_company or {}).get('companyname') or ''
        cursor.execute(f'SELECT COUNT(*) AS total FROM board01t b {_LATEST_REPLY_JOIN} WHERE {where}', args)
        total = cursor.fetchone()['total']
        cursor.execute(f'''SELECT b.id, b.category, b.title, b.companyid, b.companyname, b.created_name,
                          b.created_by, b.updated_by, b.updated_name, b.created_at, b.updated_at, b.pinned,
                          (SELECT COUNT(*) FROM boardreply01t c WHERE c.board_id = b.id) AS reply_count,
                          lr.last_at AS last_reply_at, {_STATUS_SQL} AS status
                          FROM board01t b {_LATEST_REPLY_JOIN} WHERE {where}
                          ORDER BY b.pinned DESC, b.id DESC LIMIT %s OFFSET %s''',
                       [*args, page_size, (page - 1) * page_size])
        return {'items': cursor.fetchall(), 'total': total, 'can_create': can_create(user, category),
                'is_operator': is_operator(user), 'management_company_name': management_company_name}


def summary(user):
    """탭별 건수와 처리가 필요한 문의 수 (운영사 = 답변대기 + 추가문의, 회사 = 운영사 답변을 기다리는 내 문의)."""
    scope, args = visibility(user)
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(f'''SELECT b.category, COUNT(*) AS total,
                                  COUNT(*) FILTER (WHERE ({_STATUS_SQL}) IN ('waiting', 'followup')) AS pending
                           FROM board01t b {_LATEST_REPLY_JOIN} WHERE {scope} GROUP BY b.category''', args)
        rows = {row['category']: row for row in cursor.fetchall()}
    return {'categories': {key: {'total': (rows.get(key) or {}).get('total', 0), 'pending': (rows.get(key) or {}).get('pending', 0)}
                           for key in visible_categories(user)},
            'is_operator': is_operator(user)}


def get_post(user, post_id):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        return with_replies(cursor, find_post(cursor, post_id, user), user)


def with_replies(cursor, item, user=None):
    cursor.execute('''SELECT id, companyid, companyname, created_name, created_by, content, created_at, updated_at, updated_name
                      FROM boardreply01t WHERE board_id=%s ORDER BY created_at, id''', (item['id'],))
    replies = cursor.fetchall()
    if user is not None:
        replies = [dict(reply, can_edit=reply_can_edit(reply, user), can_delete=reply_can_delete(reply, user)) for reply in replies]
    item['replies'] = replies
    last = replies[-1] if replies else None
    item['status'] = (item['category'] if item['category'] in NO_REPLY else 'waiting' if not last
                      else 'answered' if last.get('companyid') == OPERATOR else 'followup')
    return item


def reply_can_edit(reply, user):
    return reply.get('companyid') == user['companyid'] and reply.get('created_by') == user['email']


def reply_can_delete(reply, user):
    return reply_can_edit(reply, user) or is_operator(user)


def create_post(user, data):
    if not can_create(user, data.category):
        raise HTTPException(403, '이 게시판에 글을 등록할 권한이 없습니다.')
    pinned = bool(data.pinned) and is_operator(user) and data.category in PINNABLE
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute('''INSERT INTO board01t
            (category, title, content, phone, companyid, companyname, created_by, created_name, pinned)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
            (data.category, data.title, data.content, data.phone, user['companyid'],
             user['companyname'], user['email'], user['username'], pinned))
        return with_replies(cursor, permissions(cursor.fetchone(), user), user)


def update_post(user, post_id, data):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        item = find_post(cursor, post_id, user, lock=True)
        if not item['can_edit'] or data.category != item['category']:
            raise HTTPException(403, '게시글을 수정할 권한이 없습니다.')
        pinned = bool(data.pinned) if item['can_pin'] else bool(item.get('pinned'))
        cursor.execute('''UPDATE board01t SET title=%s, content=%s, phone=%s, pinned=%s,
            updated_by=%s, updated_name=%s, updated_at=NOW() WHERE id=%s RETURNING *''',
            (data.title, data.content, data.phone, pinned, user['email'], user['username'], post_id))
        return with_replies(cursor, permissions(cursor.fetchone(), user), user)


def set_pinned(user, post_id, pinned):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        item = find_post(cursor, post_id, user, lock=True)
        if not item['can_pin']:
            raise HTTPException(403, '상단 고정은 운영사의 공지사항만 설정할 수 있습니다.')
        cursor.execute('UPDATE board01t SET pinned=%s WHERE id=%s RETURNING *', (bool(pinned), post_id))
        return with_replies(cursor, permissions(cursor.fetchone(), user), user)


def delete_post(user, post_id):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        item = find_post(cursor, post_id, user, lock=True)
        if not item['can_edit']:
            raise HTTPException(403, '게시글을 삭제할 권한이 없습니다.')
        cursor.execute('DELETE FROM board01t WHERE id=%s', (post_id,))


def save_reply(user, post_id, data):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        item = find_post(cursor, post_id, user, lock=True)
        if not item['can_reply']:
            raise HTTPException(403, '답변을 작성할 권한이 없습니다.')
        cursor.execute('''INSERT INTO boardreply01t
            (board_id, companyid, companyname, created_by, created_name, content)
            VALUES (%s,%s,%s,%s,%s,%s)''',
            (post_id, user['companyid'], user['companyname'], user['email'], user['username'], data.reply))
        # 답글은 게시글의 수정자 · 수정일시를 바꾸지 않는다 (답변 상태는 마지막 답글로 계산)
        cursor.execute('SELECT * FROM board01t WHERE id=%s', (post_id,))
        return with_replies(cursor, permissions(cursor.fetchone(), user), user)


def _find_reply(cursor, post_id, reply_id, user):
    find_post(cursor, post_id, user, lock=True)  # 게시글을 볼 수 있어야 답글도 다룬다
    cursor.execute('SELECT * FROM boardreply01t WHERE id=%s AND board_id=%s FOR UPDATE', (reply_id, post_id))
    reply = cursor.fetchone()
    if not reply:
        raise HTTPException(404, '답글을 찾을 수 없습니다.')
    return reply


def update_reply(user, post_id, reply_id, data):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        reply = _find_reply(cursor, post_id, reply_id, user)
        if not reply_can_edit(reply, user):
            raise HTTPException(403, '본인이 작성한 답글만 수정할 수 있습니다.')
        cursor.execute('UPDATE boardreply01t SET content=%s, updated_at=NOW(), updated_by=%s, updated_name=%s WHERE id=%s',
                       (data.reply, user['email'], user['username'], reply_id))
        cursor.execute('SELECT * FROM board01t WHERE id=%s', (post_id,))
        return with_replies(cursor, permissions(cursor.fetchone(), user), user)


def delete_reply(user, post_id, reply_id):
    with connect() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        reply = _find_reply(cursor, post_id, reply_id, user)
        if not reply_can_delete(reply, user):
            raise HTTPException(403, '답글을 삭제할 권한이 없습니다.')
        cursor.execute('DELETE FROM boardreply01t WHERE id=%s', (reply_id,))
        cursor.execute('SELECT * FROM board01t WHERE id=%s', (post_id,))
        return with_replies(cursor, permissions(cursor.fetchone(), user), user)
