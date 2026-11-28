"""The invariant checker must actually catch broken data (otherwise green tests mean nothing)."""
import pytest

from helpers import create_inbound, create_outbound, execute, inbound_line, ok, outbound_line
from integrity import assert_consistent, check

C = "T01"

CORRUPTIONS = [
    ("stock qty drift", "UPDATE currentstock01t SET qty = qty - 1 WHERE companyid = 'T01' AND sourceno = %(in)s",
     "UPDATE currentstock01t SET qty = qty + 1 WHERE companyid = 'T01' AND sourceno = %(in)s", "lot consumption"),
    ("ledger row amount drift", "UPDATE iniop01t SET supplyamt = supplyamt + 1 WHERE companyid = 'T01' AND receiptno = %(out)s",
     "UPDATE iniop01t SET supplyamt = supplyamt - 1 WHERE companyid = 'T01' AND receiptno = %(out)s", "outbound line == ledger"),
    ("outbound vat drift (ledger + amounts)", "UPDATE outbound02t SET unitamt = unitamt + 1 WHERE companyid = 'T01' AND receiptno = %(out)s",
     "UPDATE outbound02t SET unitamt = unitamt - 1 WHERE companyid = 'T01' AND receiptno = %(out)s", "unitamt == supplyamt + vat"),
    ("lot cost drift", "UPDATE currentstock01t SET costamt = costamt + 1 WHERE companyid = 'T01' AND sourceno = %(in)s",
     "UPDATE currentstock01t SET costamt = costamt - 1 WHERE companyid = 'T01' AND sourceno = %(in)s", "cost conservation"),
    ("sales amount drift (ledger/gross profit)", "UPDATE outbound02t SET supplyamt = supplyamt + 10, unitamt = unitamt + 10 WHERE companyid = 'T01' AND receiptno = %(out)s",
     "UPDATE outbound02t SET supplyamt = supplyamt - 10, unitamt = unitamt - 10 WHERE companyid = 'T01' AND receiptno = %(out)s", "outbound line == ledger"),
]


@pytest.fixture(scope="module")
def docs(api):
    inno, (key,) = create_inbound(api, "2026-11-02", lines=[inbound_line()])
    outno = create_outbound(api, "2026-11-05", [outbound_line(key, 1, 100)])
    yield {"in": inno, "out": outno}
    ok(api.delete(f"/api/outbound-register/receipts/{outno}"))
    ok(api.delete(f"/api/inbound-register/receipts/{inno}"))


@pytest.mark.parametrize("label,corrupt,restore,expected_rule", CORRUPTIONS, ids=[c[0] for c in CORRUPTIONS])
def test_checker_detects_corruption(docs, label, corrupt, restore, expected_rule):
    assert_consistent(C, "before corruption")
    execute(corrupt, docs)
    try:
        problems = check(C)
        assert problems, f"checker missed: {label}"
        if expected_rule:
            assert any(expected_rule in p for p in problems), problems
    finally:
        execute(restore, docs)
    assert_consistent(C, "after restore")

