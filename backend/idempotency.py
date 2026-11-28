"""전표 중복 저장 방지 (더블 클릭 · 네트워크 재시도 · 여러 탭).

화면은 '새 전표' 화면을 열 때마다 request_key(UUID)를 하나 만들어 저장 요청에 같이 보낸다.
서버는 전표를 만드는 같은 트랜잭션 안에서 (회사, request_key) 를 request_key01t 에 먼저 넣는다.
  - 처음 온 요청: 행이 들어가고 전표를 만든다 (실패하면 같이 롤백되어 다시 시도할 수 있다).
  - 같은 키로 동시에 온 요청: 첫 요청의 트랜잭션이 끝날 때까지 기다렸다가, 커밋됐으면 중복으로 거절한다.
request_key 를 보내지 않는 기존 호출(스크립트 · 승인 실행 등)은 예전과 똑같이 동작한다.
"""


class DuplicateRequestError(ValueError):
    pass


def claim(cursor, companyid: str, payload: dict, doctype: str, actor: str | None = None) -> None:
    key = str((payload or {}).get("request_key") or "").strip()
    if not key:
        return
    cursor.execute(
        """INSERT INTO request_key01t (companyid, request_key, doctype, created_by)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (companyid, request_key) DO NOTHING""",
        (companyid, key[:64], doctype, actor),
    )
    if cursor.rowcount != 1:
        raise DuplicateRequestError("이미 저장된 요청입니다. 목록을 다시 조회해 저장된 전표를 확인해 주세요.")


# ── 동시 수정 감지 (낙관적 잠금) ─────────────────────────────────────────────
# 화면은 전표를 열 때 받은 수정시각(없으면 등록시각)을 expected_updated_at 으로 보낸다.
# 그 사이 다른 사람이 저장했으면 덮어쓰지 않고 409 로 알려 준다. 보내지 않으면 예전처럼 검사하지 않는다.
_VERSION_SQL = {
    "OUTBOUND": "SELECT COALESCE(updated_at, created_at) FROM Outbound01t WHERE companyid = %s AND receiptno = %s FOR UPDATE",
    "RECEIPTPAYMENT": "SELECT COALESCE(updated_at, created_at) FROM ReceiptPayment01t WHERE companyid = %s AND receiptno = %s FOR UPDATE",
    "PROCESS": "SELECT COALESCE(updatedat, createdat) FROM Process01t WHERE companyid = %s AND processno = %s FOR UPDATE",
}


class ConcurrentModificationError(ValueError):
    pass


def ensure_unchanged(cursor, doctype: str, companyid: str, docno: str, payload: dict) -> None:
    expected = (payload or {}).get("expected_updated_at")
    if not expected or not docno:
        return
    cursor.execute(_VERSION_SQL[doctype], (companyid, docno))
    row = cursor.fetchone()
    if not row:
        return
    cursor.execute("SELECT %s::timestamptz IS DISTINCT FROM %s::timestamptz", (row[0], str(expected)))
    if cursor.fetchone()[0]:
        raise ConcurrentModificationError(
            "다른 사용자가 이 전표를 먼저 수정했습니다. 전표를 다시 불러온 뒤 수정해 주세요."
        )
