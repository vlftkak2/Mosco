// 급여입력 보조 창: 지급항목 설정 (모양은 공통 삭제 확인 창 ConfirmDeleteModal 과 같은 계열)
// 회사가 쓰는 지급항목만 고른다. 기본급은 항상 사용. 쓰지 않는 항목도 이미 금액이 있는 급여에서는 보인다.
// 서버: backend/services/payroll/Payroll.py (save_items)
import { useState } from 'react';
import axios from 'axios';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconListCheck } from '@tabler/icons-react';
import { apiErrorMessage } from '../../utils/apiError';
import confirmClasses from '../../styles/components/ConfirmDeleteModal.module.css';
import pc from '../../styles/pages/Payroll.module.css';
import { PAY_ITEMS, authConfig } from './payrollCommon';

const TAXABLE = PAY_ITEMS.filter((i) => !i.nontax);
const NONTAX = PAY_ITEMS.filter((i) => i.nontax);

export function ItemSettingsModal({ opened, onClose, enabled, onSaved }) {
  const [keys, setKeys] = useState(() => new Set([...enabled, 'pay_base']));
  const [saving, setSaving] = useState(false);
  const changed = keys.size !== new Set([...enabled, 'pay_base']).size || [...keys].some((k) => !enabled.includes(k) && k !== 'pay_base');
  const toggle = (key) => {
    if (key === 'pay_base') return;
    setKeys((cur) => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const close = () => { if (!saving) onClose(); };
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axios.put('/api/payroll/items', { keys: [...keys] }, authConfig());
      notifications.show({ title: '지급항목 저장', message: `선택한 ${data.pay_items.length}개 항목이 입력 화면에 표시됩니다.`, color: 'teal' });
      onSaved(data.pay_items);
      onClose();
    } catch (error) {
      notifications.show({ title: '지급항목 저장 실패', message: apiErrorMessage(error, '지급항목을 저장하지 못했습니다.'), color: 'red' });
    } finally { setSaving(false); }
  };

  const chip = (item) => {
    const on = keys.has(item.key);
    const fixed = item.key === 'pay_base';
    return <button key={item.key} type="button" role="checkbox" aria-checked={on} disabled={fixed || saving}
      className={`${pc.chip} ${on ? pc.chipOn : ''} ${fixed ? pc.chipFixed : ''}`} onClick={() => toggle(item.key)}
      title={fixed ? '기본급은 항상 사용됩니다' : item.hint || undefined}>
      <span className={pc.chipBox} aria-hidden="true">{on ? '✓' : ''}</span>
      <span className={pc.chipLabel}>{item.label}</span>
      {fixed && <span className={pc.chipTag}>기본</span>}
    </button>;
  };

  return <Modal opened={opened} onClose={close} centered size={500} withCloseButton={false} padding={0} radius={16} returnFocus={false}
    closeOnEscape={!saving} closeOnClickOutside={!saving} overlayProps={{ backgroundOpacity: 0.2 }} classNames={{ content: confirmClasses.content }}>
    <div className={confirmClasses.top}>
      <span className={confirmClasses.icon} aria-hidden="true"><IconListCheck size={24} stroke={1.8} /></span>
      <h2>지급항목 설정</h2>
      <span className={confirmClasses.target}>{keys.size}개 선택됨</span>
      <p>급여 입력에 사용할 항목을 선택하세요.<br />선택하지 않은 항목은 입력 화면에 표시되지 않습니다.</p>
    </div>
    <div className={pc.chipArea}>
      <div className={pc.chipGroupHead}>과세 항목</div>
      <div className={pc.chipGrid}>{TAXABLE.map(chip)}</div>
      <div className={pc.chipGroupHead}>비과세 항목 <small>월 20만 원 한도</small></div>
      <div className={pc.chipGrid}>{NONTAX.map(chip)}</div>
      <p className={pc.chipNote}>이미 입력된 금액은 선택과 관계없이 그대로 유지됩니다.</p>
    </div>
    <div className={confirmClasses.actions}>
      <button type="button" className={confirmClasses.cancel} onClick={close} disabled={saving}>취소</button>
      <button type="button" className={confirmClasses.confirm} onClick={save} disabled={saving || !changed} data-autofocus>
        {saving && <span className={confirmClasses.spinner} aria-hidden="true" />}저장
      </button>
    </div>
  </Modal>;
}
