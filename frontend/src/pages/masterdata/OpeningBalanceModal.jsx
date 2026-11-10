import { useRef, useState } from 'react';
import axios from 'axios';
import XLSX from 'xlsx-js-style';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconScale, IconUpload } from '@tabler/icons-react';
import PickerModal, { PickerEmpty, pickerClasses } from '../../components/common/PickerModal';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';

// 거래처관리 > 기초잔액 엑셀: 이미 등록된 거래처의 기초 미수금 / 기초 미지급금만 일괄로 바꾼다.
// 1) 양식 받기: 등록된 거래처 전체 + 현재 기초잔액이 채워진 엑셀
// 2) 금액만 고쳐서 올리기 → 서버가 거래처코드로 찾아 미리보기(변경 / 그대로 / 코드 없음)
// 3) [반영] → 같은 계산으로 바뀐 거래처만 한 번에 저장 (중간에 오류가 나면 하나도 바뀌지 않는다)

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const won = (value) => Math.round(Number(value) || 0).toLocaleString('ko-KR');
const HEADER_ALIASES = {
  customercode: ['거래처코드', 'customercode', '코드'],
  openingreceivable: ['기초미수금', '기초 미수금', 'openingreceivable'],
  openingpayable: ['기초미지급금', '기초 미지급금', 'openingpayable'],
};
const normalizeHeader = (value) => String(value ?? '').replace(/\s+/g, '').toLowerCase();
const findColumn = (headers, field) => {
  const aliases = HEADER_ALIASES[field].map(normalizeHeader);
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
};

export default function OpeningBalanceModal({ opened, onClose, canEdit, onApplied }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  const reset = () => { setRows([]); setFileName(''); setPreview(null); setBusy(''); };
  const close = () => { if (busy === 'apply') return; reset(); onClose(); };

  const downloadTemplate = async () => {
    setBusy('template');
    try {
      const { data } = await axios.get('/api/opening-balances', authConfig());
      const sheetRows = (data.items || []).map((item) => ({
        거래처코드: item.customercode, 거래처명: item.customername,
        기초미수금: Number(item.openingreceivable) || 0, 기초미지급금: Number(item.openingpayable) || 0,
      }));
      const worksheet = XLSX.utils.json_to_sheet(sheetRows, { header: ['거래처코드', '거래처명', '기초미수금', '기초미지급금'] });
      worksheet['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 16 }];
      applyExcelHeaderStyle(worksheet, 4);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '기초잔액');
      XLSX.writeFile(workbook, `거래처_기초잔액_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`);
    } catch (error) {
      notifications.show({ title: '양식 받기 실패', message: error.response?.data?.detail || '기초잔액 양식을 만들지 못했습니다.', color: 'red' });
    } finally {
      setBusy('');
    }
  };

  const send = async (payloadRows, dryRun) => axios.post('/api/opening-balances', { rows: payloadRows, dry_run: dryRun }, authConfig());

  const readFile = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy('preview');
    setPreview(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
      const headers = table[0] || [];
      const codeIndex = findColumn(headers, 'customercode');
      const recvIndex = findColumn(headers, 'openingreceivable');
      const payIndex = findColumn(headers, 'openingpayable');
      if (codeIndex < 0 || (recvIndex < 0 && payIndex < 0)) {
        throw new Error('첫 줄에 "거래처코드"와 "기초미수금"·"기초미지급금" 제목이 있어야 합니다. [양식 받기]로 받은 파일을 사용해 주세요.');
      }
      const parsed = [];
      table.slice(1).forEach((cells, index) => {
        const code = String(cells[codeIndex] ?? '').trim();
        if (!code) return;
        parsed.push({
          rowno: index + 2, customercode: code,
          openingreceivable: recvIndex >= 0 ? String(cells[recvIndex] ?? '') : '',
          openingpayable: payIndex >= 0 ? String(cells[payIndex] ?? '') : '',
        });
      });
      if (!parsed.length) throw new Error('거래처코드가 있는 행이 없습니다.');
      const { data } = await send(parsed, true);
      setRows(parsed);
      setFileName(file.name);
      setPreview(data);
    } catch (error) {
      const detail = error.response?.data?.detail;
      const message = Array.isArray(detail)
        ? `${detail.length}개 칸의 금액이 잘못되었습니다. 금액은 0 이상의 숫자로 입력해 주세요. (예: ${detail[0]?.loc?.slice(-2).join(' ')})`
        : detail || error.message || '파일을 읽지 못했습니다.';
      notifications.show({ title: '기초잔액 파일 확인', message, color: 'orange', autoClose: 8000 });
      setRows([]);
      setFileName('');
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    if (!preview?.changed_count) return;
    setBusy('apply');
    try {
      const { data } = await send(rows, false);
      notifications.show({ title: '기초잔액 반영 완료', message: `${data.changed_count.toLocaleString()}곳의 기초잔액을 바꿨습니다.`, color: 'teal' });
      const appliedRows = rows;
      reset();
      // 화면에 열려 있는 거래처 폼도 새 금액으로 맞춘다 (옛 금액으로 다시 저장되지 않게)
      onApplied?.(appliedRows);
      onClose();
    } catch (error) {
      notifications.show({ title: '기초잔액 반영 실패', message: error.response?.data?.detail || '기초잔액을 반영하지 못했습니다. 변경 사항은 모두 취소했습니다.', color: 'red' });
      setBusy('');
    }
  };

  const changed = preview?.changed || [];
  return <PickerModal opened={opened} onClose={close} closeDisabled={busy === 'apply'}
    title="기초잔액 엑셀" description="이미 등록된 거래처의 기초 미수금·기초 미지급금만 한 번에 바꿉니다. 다른 거래처 정보는 바뀌지 않습니다." icon={<IconScale size={22} stroke={1.7} />}
    filters={<>
      <Button size="sm" variant="default" leftSection={<IconDownload size={15} />} onClick={downloadTemplate} loading={busy === 'template'}>1. 양식 받기</Button>
      <Button size="sm" color="red" leftSection={<IconUpload size={15} />} onClick={() => fileRef.current?.click()} loading={busy === 'preview'} disabled={!canEdit}>2. 엑셀 올리기</Button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={readFile} />
      {fileName && <Text size="xs" c="dimmed" style={{ alignSelf: 'center' }}>{fileName}</Text>}
    </>}
    guide={<>
      <p>[양식 받기]로 받은 파일에서 <b>기초미수금 · 기초미지급금</b> 금액만 고쳐 올리세요. 빈칸은 0원으로 반영됩니다. 기말 잔액은 원장에서 자동 계산되므로 입력하지 않습니다.</p>
      {!canEdit && <p style={{ color: '#c2561b' }}>기초잔액 반영은 관리자(MASTER·SUBMASTER)만 할 수 있습니다. 양식은 받을 수 있습니다.</p>}
      {preview && <div className={pickerClasses.criteria}>
        <span><b>변경</b>{preview.changed_count.toLocaleString()}곳</span>
        <span><b>그대로</b>{preview.unchanged_count.toLocaleString()}곳</span>
        <span style={preview.missing_count ? { color: '#c2561b' } : undefined}><b>코드 없음</b>{preview.missing_count.toLocaleString()}곳{preview.missing_count ? ` (${preview.missing.slice(0, 5).map((item) => `${item.rowno}행 ${item.customercode}`).join(', ')}${preview.missing_count > 5 ? ' …' : ''}) — 반영하지 않습니다` : ''}</span>
      </div>}
    </>}
    listTitle="바뀌는 거래처" count={preview ? preview.changed_count : 0} listHint={preview ? '반영 전 금액 → 반영 후 금액' : '엑셀을 올리면 바뀌는 거래처가 여기에 나옵니다'}
    selectedCount={preview?.changed_count || 0} selectionLabel="곳 바뀜"
    onApply={apply} applyLabel="반영" applying={busy === 'apply'} applyDisabled={!canEdit || !preview?.changed_count || Boolean(busy)}>
    <table className={pickerClasses.table} style={{ width: '100%', minWidth: 760 }} aria-label="바뀌는 거래처">
      <colgroup><col style={{ width: 60 }} /><col style={{ width: 120 }} /><col /><col style={{ width: 220 }} /><col style={{ width: 220 }} /></colgroup>
      <thead><tr><th className={pickerClasses.center}>엑셀 행</th><th>거래처코드</th><th>거래처명</th><th className={pickerClasses.right}>기초미수금</th><th className={pickerClasses.right}>기초미지급금</th></tr></thead>
      <tbody>
        {changed.map((item) => <tr key={item.customercode} style={{ cursor: 'default' }}>
          <td className={pickerClasses.center}>{item.rowno}</td>
          <td>{item.customercode}</td>
          <td title={item.customername}>{item.customername}</td>
          <td className={pickerClasses.right}>{won(item.before_receivable)} → <b>{won(item.after_receivable)}</b></td>
          <td className={pickerClasses.right}>{won(item.before_payable)} → <b>{won(item.after_payable)}</b></td>
        </tr>)}
        {preview && preview.changed_count > changed.length && <tr><td colSpan={5} className={pickerClasses.center} style={{ color: '#8290a5' }}>
          외 {(preview.changed_count - changed.length).toLocaleString()}곳 더 바뀝니다 (반영은 전부 됩니다)
        </td></tr>}
        {!changed.length && <tr><td colSpan={5} className={pickerClasses.emptyCell}>
          <PickerEmpty title={preview ? '바뀌는 거래처가 없습니다' : '엑셀을 올려 주세요'} description={preview ? '올린 금액이 지금 기초잔액과 모두 같습니다.' : '[양식 받기] → 금액 입력 → [엑셀 올리기] 순서로 진행합니다.'} />
        </td></tr>}
      </tbody>
    </table>
    {busy === 'preview' && <Group justify="center" p="md"><Text size="xs" c="dimmed">파일을 확인하고 있습니다…</Text></Group>}
  </PickerModal>;
}
