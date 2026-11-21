-- 수금/지급등록 목록 정렬(수금/지급일 → 등록일자 → 전표번호, 오름차순)용 인덱스. 칸 변경 없음, 필요 없으면 DROP INDEX 로 되돌림.
DROP INDEX IF EXISTS ix_receiptpayment01t_list_order;
CREATE INDEX IF NOT EXISTS ix_receiptpayment01t_list_order
    ON ReceiptPayment01t (companyid, receiptdate, created_at, receiptno);
