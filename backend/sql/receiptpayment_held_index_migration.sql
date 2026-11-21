-- 수금/지급등록 > 지급어음 선택(보관 중인 받은 증권) 목록 속도: 보관 중 · 타수 · 금액 있는 증권 행만 담는 부분 인덱스
--   조건은 services/receiptpayment/ReceiptPayment.py 의 _HELD_CONDITION 과 같아야 인덱스를 쓴다.
CREATE INDEX IF NOT EXISTS ix_receiptpayment02t_held
    ON public.ReceiptPayment02t (companyid, maturitydate, receiptno, lineno)
    WHERE instrumentamt > 0
      AND COALESCE(NULLIF(issuekind, ''), 'OTHER') = 'OTHER'
      AND COALESCE(NULLIF(instrumentstatus, ''), 'HELD') = 'HELD';
