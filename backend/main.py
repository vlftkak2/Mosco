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

from routes import login_routes as login_router
from routes import user_routes as user_routes
from routes import userinfo_routes as userinfo_routes
from routes import userauth_routes as userauth_routes
from routes import teamauth_routes as teamauth_routes
from routes import Department_routes as department_routes
from routes import home_dashboard_routes as home_dashboard_routes
from routes import Customer_routes as customer_routes
# 고정 공통코드 그룹 API를 앱에 등록합니다.
from routes import Codemaster_routes as Codemaster_routes
from routes import ItemMaster_routes as ItemMaster_routes
from routes import InboundRegister_routes as InboundRegister_routes
from routes import InboundSearch_routes as InboundSearch_routes
from routes import OutboundRegister_routes as OutboundRegister_routes
from routes import OutboundSearch_routes as OutboundSearch_routes
from routes import StockStand_routes as StockStand_routes
from routes import CurrentStock_routes as CurrentStock_routes
from routes import IniopStock_routes as IniopStock_routes

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
    allow_origin_regex=".*",  # 모든 도메인/IP 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

# 로그인 API
app.include_router(login_router.router)

# User Password API
app.include_router(user_routes.router)

# User Password API
app.include_router(userinfo_routes.router)

# User Auth API
app.include_router(userauth_routes.router)

# Team Auth API
app.include_router(teamauth_routes.router)

# Department API
app.include_router(department_routes.router)

# Home dashboard API
app.include_router(home_dashboard_routes.router)

# Customer API
app.include_router(customer_routes.router)

# Tenant-scoped common code API
app.include_router(Codemaster_routes.router)

# Company-scoped item master API
app.include_router(ItemMaster_routes.router)

# Company-scoped inbound receipt API
app.include_router(InboundRegister_routes.router)

# Company-scoped inbound status/search API
app.include_router(InboundSearch_routes.router)

# Company-scoped outbound receipt API
app.include_router(OutboundRegister_routes.router)

# Company-scoped outbound status/search API
app.include_router(OutboundSearch_routes.router)

# Company-scoped opening stock API
app.include_router(StockStand_routes.router)

# Company-scoped current stock API
app.include_router(CurrentStock_routes.router)

# Company-scoped inventory ledger API
app.include_router(IniopStock_routes.router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
