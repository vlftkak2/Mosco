import logging
import os

# 로그 설정은 앱 시작 시 한 번만 (uvicorn 자체 로그는 uvicorn 설정을 그대로 사용).
# 루트 로거에 이미 핸들러가 있으면 basicConfig 는 아무것도 하지 않는다.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware  
from config import ALLOWED_ORIGINS, APP_ENV
from fastapi.exceptions import RequestValidationError
from validation_messages import validation_exception_handler

from routes.auth import login_routes as login_router
from routes.system import Board_routes
from routes.system import health_routes
from routes.system import User_routes as system_user_routes
from routes.auth import userpassword_routes as user_routes

from routes.dashboard import home_dashboard_routes as home_dashboard_routes
from routes.masterdata import Customer_routes as customer_routes
from routes.masterdata import Workplace_routes as workplace_routes
from routes.masterdata import Company_routes as company_routes
from routes.masterdata import LicenseRevenue_routes as license_revenue_routes
from routes.masterdata import AiCost_routes as ai_cost_routes
from services.masterdata import LicenseCharge as license_charge_module
from routes.auth import user_routes as company_user_routes
from routes.auth import UserMenu_routes as user_menu_routes

# 고정 공통코드 그룹 API를 앱에 등록합니다.
from routes.masterdata import Codemaster_routes as Codemaster_routes
from routes.masterdata import ItemMaster_routes as ItemMaster_routes
from routes.process import ItemProcessMaster_routes as ItemProcessMaster_routes
from routes.process import ItemProcessRegister_routes as ItemProcessRegister_routes
from routes.process import ItemProcessSearch_routes as ItemProcessSearch_routes
from routes.inbound import InboundRegister_routes as InboundRegister_routes
from routes.inbound import InboundSearch_routes as InboundSearch_routes
from routes.outbound import OutboundRegister_routes as OutboundRegister_routes
from routes.outbound import OutboundSearch_routes as OutboundSearch_routes
from routes.outbound import GrossProfit_routes as GrossProfit_routes
from routes.outbound import GrossProfitDashboard_routes as GrossProfitDashboard_routes
from routes.inventory import StockStand_routes as StockStand_routes
from routes.inventory import CurrentStock_routes as CurrentStock_routes
from routes.inventory import SharedStock_routes as SharedStock_routes
from routes.inventory import IniopStock_routes as IniopStock_routes
from routes.inoutmove import inoutmoveRegister_routes as inoutmoveRegister_routes
from routes.inoutmove import inoutmoveSearch_routes as inoutmoveSearch_routes
from routes.receiptpayment import ReceiptPayment_routes as ReceiptPayment_routes
from routes.receiptpayment import ReceiptPaymentSearch_routes as ReceiptPaymentSearch_routes
from routes.receiptpayment import InstrumentStatus_routes as InstrumentStatus_routes
from routes.receiptpayment import CustomerLedger_routes as CustomerLedger_routes
from routes.receiptpayment import CustomerBalanceDashboard_routes as CustomerBalanceDashboard_routes
from routes.closing import MonthClose_routes as MonthClose_routes
from routes.ai import AIOrder_routes as AIOrder_routes
from routes.ai import AIOrderManage_routes as AIOrderManage_routes
from routes.ai import AIOrderOptimization_routes as AIOrderOptimization_routes
from routes.ai import AIChat_routes as AIChat_routes
from routes.control import Approval_routes as Approval_routes
from routes.eapproval import EApproval_routes as EApproval_routes
from routes.payroll import Payroll_routes as Payroll_routes

import uvicorn

# 운영에서는 API 문서(/docs · /redoc · /openapi.json)를 열지 않는다 (로그인 없이 전체 API 목록이 보이므로)
_IS_PRODUCTION = APP_ENV in {"production", "prod"}
app = FastAPI(
    docs_url=None if _IS_PRODUCTION else "/docs",
    redoc_url=None if _IS_PRODUCTION else "/redoc",
    openapi_url=None if _IS_PRODUCTION else "/openapi.json",
)
# 입력값 검증 오류(422) 문구를 한글로 (응답 모양은 그대로)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
# 감사 기록(누가): 요청한 로그인 사용자를 DB 세션 설정 mosco.actor 로 넘긴다 (backend/request_context.py)
from request_context import ActorContextMiddleware  # noqa: E402
app.add_middleware(ActorContextMiddleware)


# 동기 API 를 실행하는 스레드 수 (기본 40). 한 회사의 요청이 잠금을 기다리며 스레드를 붙잡아도
# 다른 회사 요청을 처리할 여유를 둔다. DB 연결은 db.POOL_MAX / POOL_MAX_PER_COMPANY 로 따로 제한된다.
async def _raise_threadpool_limit():
    import os

    import anyio.to_thread

    anyio.to_thread.current_default_thread_limiter().total_tokens = max(40, int(os.getenv("API_THREADPOOL_SIZE", "100")))


app.add_event_handler("startup", _raise_threadpool_limit)

# 헬스체크 (로그인 불필요, docker healthcheck · 터널 준비 확인용)
app.include_router(health_routes.router)

# 로그인 API
app.include_router(login_router.router)

app.include_router(Board_routes.router)
app.include_router(system_user_routes.router)  # 사용자관리

# User Password API
app.include_router(user_routes.router)

# Home dashboard API
app.include_router(home_dashboard_routes.router)
# 서버를 켤 때 대시보드 '오늘' 칸(날씨·뉴스)을 뒤에서 미리 받아 둔다 (시작은 늦어지지 않음, DASHBOARD_WARMUP=0 이면 끔)
app.add_event_handler("startup", home_dashboard_routes.home_dashboard_module.warm_today_info_in_background)

# Customer API
app.include_router(customer_routes.router)
app.include_router(workplace_routes.router)  # 사업장관리

# Steel119 master company management API
app.include_router(company_routes.router)
app.include_router(license_revenue_routes.router)  # 라이선스 매출현황 (001 MASTER)
app.include_router(ai_cost_routes.router)  # AI 비용현황 (모스코 전용)
# 라이선스 전월 청구 확정: 시작 때 빠진 달 채우기 + 매달 1일 00:01(KST)
app.add_event_handler("startup", license_charge_module.start_monthly_close)
app.include_router(company_user_routes.router)
app.include_router(user_menu_routes.router)

# Tenant-scoped common code API
app.include_router(Codemaster_routes.router)

# Company-scoped item master API
app.include_router(ItemMaster_routes.router)

# Company-scoped item processing rule API
app.include_router(ItemProcessMaster_routes.router)
app.include_router(ItemProcessRegister_routes.router)
app.include_router(ItemProcessSearch_routes.router)

# Company-scoped inbound receipt API
app.include_router(InboundRegister_routes.router)

# Company-scoped inbound status/search API
app.include_router(InboundSearch_routes.router)

# Company-scoped outbound receipt API
app.include_router(OutboundRegister_routes.router)

# Company-scoped outbound status/search API
app.include_router(OutboundSearch_routes.router)
app.include_router(GrossProfit_routes.router)  # 매출이익분석
app.include_router(GrossProfitDashboard_routes.router)  # 매출이익 현황판

# Company-scoped opening stock API
app.include_router(StockStand_routes.router)

# Company-scoped current stock API
app.include_router(CurrentStock_routes.router)
app.include_router(SharedStock_routes.router)  # 타사 재고현황 (001 계정 전용)

# Company-scoped inventory ledger API
app.include_router(IniopStock_routes.router)

# Company-scoped warehouse transfer API
app.include_router(inoutmoveRegister_routes.router)
app.include_router(inoutmoveSearch_routes.router)

# Company-scoped receipt/payment entry and status API
app.include_router(ReceiptPayment_routes.router)
app.include_router(ReceiptPaymentSearch_routes.router)
app.include_router(InstrumentStatus_routes.router)  # 수표/어음 현황
app.include_router(CustomerLedger_routes.router)  # 거래처원장
app.include_router(CustomerBalanceDashboard_routes.router)  # 거래처 잔액 현황
app.include_router(MonthClose_routes.router)  # 월마감 관리

# Isolated AI order recognition test API (does not touch ERP transaction tables).
app.include_router(AIOrder_routes.router)
app.include_router(AIOrderManage_routes.router)
app.include_router(AIOrderOptimization_routes.router)  # 가공 최적화
app.include_router(AIChat_routes.router)  # AI 업무비서 (모스코 전용)
app.include_router(Approval_routes.router)  # 통제관리 (승인요청 · 승인)
app.include_router(EApproval_routes.router)  # 전자결재 (휴가 · 출장 · 업무보고)
app.include_router(Payroll_routes.router)  # 급여관리 (급여입력 · 급여대장 · 내 급여현황)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
