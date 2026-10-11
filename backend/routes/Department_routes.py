from fastapi import FastAPI,APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
from fastapi.responses import StreamingResponse
import io
from datetime import datetime
from fastapi import Response  
from urllib.parse import quote

# 모듈 임포트 (이름 충돌을 피하기 위해 as 사용)
import Department as department_module

router = APIRouter(prefix="/api", tags=["department"])

# 부서정보 리스트
@router.get("/department-list")
def get_department_list(departmentname:str):
    try:
        return department_module.DepartmentList(departmentname)
    except Exception as e:
        raise HTTPException(status_code=500,detail=str(e))

# 부서정보 수정
@router.post("/department-modify")
def post_department_modify(data: department_module.DepartmentModifyRequest):
    result = department_module.DepartmentModify(data)
    
    # 실패했을 경우 401 에러
    # if not result["success"]:
    #     raise HTTPException(status_code=401, detail=result["message"])
        
    return result

@router.post("/department-create")
def post_department_create(data: department_module.DepartmentCreateRequest):
    result = department_module.DepartmentCreate(data)
    
    # # 실패했을 경우 401 에러
    # if not result["success"]:
    #     raise HTTPException(status_code=401, detail=result["message"])
        
    return result

@router.post("/department-delete")
def post_department_delete(data: department_module.DepartmentDeleteRequest):
    result = department_module.DepartmentDelete(data)
            
    return result