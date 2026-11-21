-- 거래처 사업자번호 · 법인번호 표시 형식 통일 (사업장관리 · 고객사등록과 같은 형식)
--   사업자번호 10자리 → 000-00-00000, 법인번호 13자리 → 000000-0000000
--   숫자 자리수가 맞는 값만 형식을 맞춘다 (검증번호가 틀린 번호는 바꾸지 않는다 — 화면에서 담당자가 고친다).

UPDATE public.customer01t
SET businessno = regexp_replace(regexp_replace(businessno, '\D', '', 'g'), '^(\d{3})(\d{2})(\d{5})$', '\1-\2-\3')
WHERE regexp_replace(COALESCE(businessno, ''), '\D', '', 'g') ~ '^\d{10}$'
  AND businessno !~ '^\d{3}-\d{2}-\d{5}$';

UPDATE public.customer01t
SET corporationno = regexp_replace(regexp_replace(corporationno, '\D', '', 'g'), '^(\d{6})(\d{7})$', '\1-\2')
WHERE regexp_replace(COALESCE(corporationno, ''), '\D', '', 'g') ~ '^\d{13}$'
  AND corporationno !~ '^\d{6}-\d{7}$';
