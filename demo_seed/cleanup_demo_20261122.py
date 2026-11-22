"""시연용 데이터 삭제: created_20261122.json 의 전표를 역순(수금지급 → 매출 → 매입)으로 저장 화면과 같은 삭제 함수로 지움."""
import sys, json
sys.path.insert(0, 'c:/Mosco/backend'); sys.stdout.reconfigure(encoding='utf-8')
from services.inbound import InboundRegister as IN
from services.outbound import OutboundRegister as OUT
from services.receiptpayment import ReceiptPayment as RP

CID = "001"
created = json.load(open("c:/Mosco/demo_seed/created_20261122.json", encoding="utf-8"))
fail = []
for no in reversed(created["receiptpayment"]):
    try: RP.delete_document(CID, no)
    except Exception as e: fail.append((no, str(e)))
for no in reversed(created["outbound"]):
    try: OUT.delete_receipt(CID, no)
    except Exception as e: fail.append((no, str(e)))
for no in reversed(created["inbound"]):
    try: IN.delete_receipt(CID, no)
    except Exception as e: fail.append((no, str(e)))
print("삭제 실패:", fail or "없음")
