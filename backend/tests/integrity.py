"""테스트용 이름 유지: 검사 규칙 본체는 backend/integrity_rules.py (운영 야간 점검 scripts/integrity_check.py 와 공용)."""
from integrity_rules import assert_consistent, check, expected_ledger  # noqa: F401
