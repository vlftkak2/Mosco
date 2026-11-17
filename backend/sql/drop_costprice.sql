-- currentstock01t.costprice 삭제 (2026-11-17)
-- 원가는 금액(costamt)으로만 관리하고, 원가단가(kg)는 화면에서 남은 원가금액 ÷ 남은 중량으로 계산한다.
-- 삭제해도 나머지 컬럼 순서는 그대로다 (등록·수정 칸은 계속 맨 오른쪽).
ALTER TABLE currentstock01t DROP COLUMN IF EXISTS costprice;
