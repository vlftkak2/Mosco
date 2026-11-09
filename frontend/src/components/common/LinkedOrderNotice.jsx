// 현재고가 AI 주문(주문서 관리 재고매칭)에 연결되어 있으면 표시한다. 이런 재고는 선택할 수 없고
// 주문서 관리에서 연결을 해제해야 다시 쓸 수 있다. 출고등록 · 재고이전 · 가공등록의 현재고 선택 창에서 사용.
import { Tooltip } from '@mantine/core';
import { IconLink } from '@tabler/icons-react';

// 좁은 칸에서도 잘리지 않게 작은 주황 아이콘 + 마우스 올리면 주문번호
export function LinkedOrderBadge({ orders }) {
  if (!orders) return null;
  return <Tooltip label={`주문 연결: ${orders} · 주문서 관리에서 연결을 해제해야 선택할 수 있습니다`} withinPortal>
    <span role="img" aria-label={`주문 연결 ${orders}`}
      style={{ display: 'inline-flex', marginLeft: 4, verticalAlign: 'middle', color: '#e8590c', cursor: 'help' }}>
      <IconLink size={14} stroke={2.2} />
    </span>
  </Tooltip>;
}
