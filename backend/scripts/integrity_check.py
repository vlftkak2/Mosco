"""데이터 정합성 야간 점검 (읽기 위주, 데이터를 바꾸지 않는다).

회사마다 재고 · 수불 · 전표 · 원가 · 거래처원장 불변식을 독립 SQL 로 다시 계산해 서비스 결과와 맞는지 본다
(규칙 본체: backend/integrity_rules.py, 테스트와 공용: 음수 재고, 재고 = 수불 합계, 로트 소진량 = 사용량, 상세 ↔ 수불, 헤더 ↔ 상세,
 공급가 + 부가세 = 합계, 원가 보존, 원장 · 여신 잔액 = 독립 계산, 매출이익 합계).

    python scripts/integrity_check.py                 # 사용 중인 모든 회사
    python scripts/integrity_check.py --company 003   # 한 회사
    python scripts/integrity_check.py --no-ledger     # 빠른 점검 (원장 · 매출이익 제외)

문제가 있으면 종료코드 1 (작업 스케줄러 · 모니터링에서 실패로 잡히게). 매출이익 검사는 임시 테이블을 만들므로
읽기 전용 복제본이 아니라 일반 DB 연결로 실행한다.
"""
import argparse
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import db  # noqa: E402
import integrity_rules as integrity  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", action="append", help="점검할 회사 코드 (여러 번 지정 가능)")
    parser.add_argument("--no-ledger", action="store_true", help="원장 · 매출이익 검사 생략")
    args = parser.parse_args()
    companies = args.company
    if not companies:
        with db.connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT companyid FROM company01t WHERE UPPER(COALESCE(company_status, '')) = 'ACTIVE' ORDER BY companyid")
            companies = [row[0] for row in cursor.fetchall()]
    failed = 0
    for companyid in companies:
        started = time.perf_counter()
        problems = integrity.check(companyid, ledger=not args.no_ledger)
        took = time.perf_counter() - started
        if problems:
            failed += 1
            print(f"[FAIL] {companyid} ({took:.1f}s)")
            for problem in problems:
                print(f"    {problem}")
        else:
            print(f"[OK]   {companyid} ({took:.1f}s)")
    print(f"companies={len(companies)} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
