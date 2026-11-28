-- 메뉴권한 재구성 (2026-11-27) · 여러 번 실행해도 같은 결과
--  코드에 박혀 있던 'MASTER / SUBMASTER / 001' 판단을 메뉴권한으로 옮긴다.
--   · 모스코 전용 메뉴(PLATFORM): 모스코(001) 직원에게만 메뉴권한관리에서 부여 (다른 회사 화면에는 안 나옴)
--   · 관리자 메뉴(계정관리 · 메뉴권한관리 · 직원관리): 모든 회사가 메뉴권한으로 부여 (모스코 직원이 받으면 전체 회사 관리)
--   · 화면 안의 기능(기초잔액 · 여신한도, 원장 시작일)은 따로 권한을 두지 않고 그 메뉴 권한에 포함
--     (거래처 수정을 막으려면 통제관리 › 거래처등록 › 수정 승인)
--  역할(MASTER / SUBMASTER)은 그대로 둔다. 모스코 MASTER 는 잠김 방지를 위해 계속 모든 권한을 가진다.
--  전환하는 날 화면이 달라지지 않게, 지금 관리자(SUBMASTER)와 모스코 직원에게 같은 권한을 넣어 둔다.
BEGIN;

-- 예전 규칙 '모스코 전용 메뉴는 부여 불가' 제약을 없앤다 (이제 모스코 직원에게 부여)
ALTER TABLE menucatalog01t DROP CONSTRAINT IF EXISTS menucatalog01t_check;

-- 모스코 전용: 모스코 직원에게 부여할 수 있게
UPDATE menucatalog01t SET assignable = TRUE
 WHERE menuid IN ('COMPANY_REGISTRATION', 'LICENSE_REVENUE', 'SHARED_STOCK') AND access_scope = 'PLATFORM';

-- 관리자 메뉴: 모든 회사에서 부여
UPDATE menucatalog01t SET access_scope = 'COMPANY', assignable = TRUE
 WHERE menuid IN ('COMPANY_USER_MANAGEMENT', 'USER_MENU_PERMISSION');

-- (초안에서 만들었던 기능 권한 · menutype 칸은 쓰지 않는다: 있으면 지움)
DELETE FROM usermenupermission01t WHERE menuid IN ('FN_OPENING_BALANCE', 'FN_LEDGER_START');
DELETE FROM menucatalog01t WHERE menuid IN ('FN_OPENING_BALANCE', 'FN_LEDGER_START');
ALTER TABLE menucatalog01t DROP COLUMN IF EXISTS menutype;

-- 전환: 지금 고객사 관리자(SUBMASTER)가 하던 일 = 같은 권한
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT u.companyid, u.email, m.menuid, 'Y', 'menu-migration-20261127'
  FROM user01t u
 CROSS JOIN (VALUES ('COMPANY_USER_MANAGEMENT'), ('USER_MENU_PERMISSION'), ('USER_MANAGEMENT')) AS m(menuid)
 WHERE u.companyid <> '001' AND UPPER(COALESCE(u.authority, '')) = 'SUBMASTER'
ON CONFLICT (companyid, useremail, menuid) DO UPDATE SET useyn = 'Y', updatedby = 'menu-migration-20261127', updatedat = CURRENT_TIMESTAMP
 WHERE UPPER(COALESCE(usermenupermission01t.useyn, 'N')) <> 'Y';

-- 전환: 타사 재고현황은 모스코 직원 누구나 보던 화면 → 모스코 직원 전원에게
INSERT INTO usermenupermission01t (companyid, useremail, menuid, useyn, createdby)
SELECT u.companyid, u.email, 'SHARED_STOCK', 'Y', 'menu-migration-20261127'
  FROM user01t u
 WHERE u.companyid = '001' AND UPPER(COALESCE(u.authority, '')) <> 'MASTER'
ON CONFLICT (companyid, useremail, menuid) DO NOTHING;

COMMIT;
