-- 사용자 코드: 회사별 내부 계정 관리 코드 (001, 002, … 회사마다 1부터, 999 넘으면 1000 …)
--   계정을 만들 때 서버가 자동으로 부여하고 바꾸지 않는다. 고객계정관리 목록은 이 코드 순서로 보인다.
--   기존 계정은 회사별로 등록 순서(등록일시 → 이메일)대로 채운다.

ALTER TABLE public.user01t ADD COLUMN IF NOT EXISTS usercode character varying(10);

UPDATE public.user01t AS u
SET usercode = lpad(numbered.seq::text, 3, '0')
FROM (
    SELECT companyid, email,
           row_number() OVER (PARTITION BY companyid ORDER BY createdat NULLS LAST, LOWER(email)) AS seq
    FROM public.user01t
) AS numbered
WHERE u.companyid = numbered.companyid AND u.email = numbered.email AND u.usercode IS NULL;

ALTER TABLE public.user01t ALTER COLUMN usercode SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_user01t_company_usercode ON public.user01t (companyid, usercode);
