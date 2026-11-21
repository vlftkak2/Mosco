-- 중복 로그인 차단: 계정당 활성 세션 1개
--   user01t.session_id = 마지막 로그인 때 발급한 세션 ID. 토큰의 sid 와 다르면 그 토큰은 더 쓸 수 없다.
--   (나중에 로그인한 쪽이 이기고, 먼저 접속해 있던 쪽은 다음 요청에서 로그아웃된다)
-- 적용 직후에는 모든 사용자의 session_id 가 비어 있으므로 기존 접속은 한 번씩 다시 로그인해야 한다.

ALTER TABLE public.user01t ADD COLUMN IF NOT EXISTS session_id character varying(64);
