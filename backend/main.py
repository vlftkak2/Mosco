from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware  
from config import ALLOWED_ORIGINS

from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager

# import scheduler as scheduler_module
# from routes import inventory_routes as inv_router
# from routes import pg_routes as pg_router
# from routes import omssap_routes as omssap_router
# from routes import wmsoms_routes as wmsoms_router
# from routes import hktvmalloms_standard_routes as hktvmall_oms_standard_router
# from routes import hktvmalloms_merchant_routes as hktvmall_oms_merchant_router
# from routes import hktvmallimprove_standard_routes as hktvmall_improve_standard_router
# from routes import hktvmall_allocate_routes as hktvmall_allocate_router
# from routes import shoppay_routes as shoppay_routes
# from routes import domesticlogistics_routes as domestic_routes
# from routes import D2CStatistics_routes as D2C_Statistics_routes
# from routes import D2CMonth_routes as D2CMonth_routes
# from routes import D2CWeek_routes as D2CWeek_routes
# from routes import D2CDay_routes as D2CDay_routes
# from routes import D2CItem_routes as D2CItem_routes

from routes.auth import login_routes as login_router
from routes.auth import userpassword_routes as user_routes

from routes.dashboard import home_dashboard_routes as home_dashboard_routes
from routes.masterdata import Customer_routes as customer_routes
from routes.masterdata import Company_routes as company_routes
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
from routes.inbound import Purchase_routes as Purchase_routes
from routes.outbound import OutboundRegister_routes as OutboundRegister_routes
from routes.outbound import OutboundSearch_routes as OutboundSearch_routes
from routes.outbound import GrossProfit_routes as GrossProfit_routes
from routes.outbound import GrossProfitDashboard_routes as GrossProfitDashboard_routes
from routes.inventory import StockStand_routes as StockStand_routes
from routes.inventory import CurrentStock_routes as CurrentStock_routes
from routes.inventory import IniopStock_routes as IniopStock_routes
from routes.inoutmove import inoutmoveRegister_routes as inoutmoveRegister_routes
from routes.inoutmove import inoutmoveSearch_routes as inoutmoveSearch_routes
from routes.receiptpayment import ReceiptPayment_routes as ReceiptPayment_routes
from routes.receiptpayment import ReceiptPaymentSearch_routes as ReceiptPaymentSearch_routes
from routes.receiptpayment import InstrumentStatus_routes as InstrumentStatus_routes
from routes.ai import AIOrder_routes as AIOrder_routes
from routes.ai import AIOrderManage_routes as AIOrderManage_routes
from routes.ai import AIOrderOptimization_routes as AIOrderOptimization_routes

import uvicorn

app = FastAPI()

# 스케줄 설정
# scheduler = BackgroundScheduler()

# # 2. 수명 주기(lifespan) 설정
# @asynccontextmanager
# async def lifespan(app: FastAPI):
    
#     # OMS/SAP 검증 [StartUp] 서버 가동 시 실행
#     # scheduler_module.setup_scheduler()
#     # scheduler_module.scheduler.start()
    
#     yield  # --- 서버 운영 중 ---
    
#     # [ShutDown] 서버 종료 시 실행
#     scheduler_module.scheduler.shutdown()

# app = FastAPI(lifespan=lifespan)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

# 로그인 API
app.include_router(login_router.router)

# User Password API
app.include_router(user_routes.router)

# Home dashboard API
app.include_router(home_dashboard_routes.router)

# Customer API
app.include_router(customer_routes.router)

# Steel119 master company management API
app.include_router(company_routes.router)
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
app.include_router(Purchase_routes.router)

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

# Company-scoped inventory ledger API
app.include_router(IniopStock_routes.router)

# Company-scoped warehouse transfer API
app.include_router(inoutmoveRegister_routes.router)
app.include_router(inoutmoveSearch_routes.router)

# Company-scoped receipt/payment entry and status API
app.include_router(ReceiptPayment_routes.router)
app.include_router(ReceiptPaymentSearch_routes.router)
app.include_router(InstrumentStatus_routes.router)  # 수표/어음 현황

# Isolated AI order recognition test API (does not touch ERP transaction tables).
app.include_router(AIOrder_routes.router)
app.include_router(AIOrderManage_routes.router)
app.include_router(AIOrderOptimization_routes.router)  # 가공 최적화

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
