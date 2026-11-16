-- 2026-11-16 운영 DB에 이미 실행한 정리 작업 (기록용). 실행 전 백업: C:\Mosco_backup\Mosco_before_fix_20261116.dump
BEGIN;
-- docs/test_history_seed.py 가 넣은 TEST 전표 (수불장·현재고 없이 직접 입력된 데이터)
DELETE FROM process02t WHERE companyid = '001' AND processno LIKE 'PRTEST%';
DELETE FROM process01t WHERE companyid = '001' AND processno LIKE 'PRTEST%';
DELETE FROM inbound03t WHERE companyid = '001' AND receiptno LIKE 'TESTIN%';
DELETE FROM inbound02t WHERE companyid = '001' AND receiptno LIKE 'TESTIN%';
DELETE FROM inbound01t WHERE companyid = '001' AND receiptno LIKE 'TESTIN%';
DELETE FROM currentstock01t WHERE companyid = '001' AND sourceno LIKE 'STTEST%' AND created_by = 'TEST';
-- 평문 비밀번호 테스트 계정 (001: test1·test2 MASTER, test5·test6 USER)
DELETE FROM usermenupermission01t WHERE lower(useremail) IN ('test1@naver.com','test2@naver.com','test5@naver.com','test6@naver.com');
DELETE FROM usermenufavorite01t  WHERE lower(useremail) IN ('test1@naver.com','test2@naver.com','test5@naver.com','test6@naver.com');
DELETE FROM user01t WHERE companyid = '001' AND password NOT LIKE 'pbkdf2%'
   AND lower(email) IN ('test1@naver.com','test2@naver.com','test5@naver.com','test6@naver.com');
-- 개인정보·평문 비밀번호가 남아 있던 백업 테이블
DROP TABLE IF EXISTS user01t_backup;
COMMIT;
