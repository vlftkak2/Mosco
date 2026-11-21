-- 사업장관리 팩스번호 (연락처 · 주소). 빈 칸 허용, 기존 데이터 영향 없음.
ALTER TABLE company01t ADD COLUMN IF NOT EXISTS fax varchar(30);
