import { isApprovalPending, notifyApprovalPending } from '../../utils/approval';
import { memo, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import axios from 'axios';
import { usePageActivation } from '../../components/common/usePageReactivated';
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import { INSTRUMENT_OPTIONS_BY_FIELD, INSTRUMENT_TYPE_OPTIONS, instrumentLabel } from '../../utils/instrumentCodes';
import {
  ActionIcon, Autocomplete, Badge, Box, Button, Group, Input, Loader, Modal, NumberInput,
  Pagination, Paper, Select, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBuildingBank, IconBuildingStore, IconChevronDown, IconCopy, IconDeviceFloppy, IconFileDollar, IconFileSpreadsheet, IconFilter, IconPlus, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import ErpDateInput from '../../components/common/ErpDateInput';
import PickerModal, { ColumnResizeHandle, PickerEmpty, SelectPickerModal, pickerClasses, useResizableColumns } from '../../components/common/PickerModal';
import { PageRibbonContext } from '../../components/layout/MainLayout';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import simpleTheme from '../../styles/pages/SimpleTheme.module.css';
import codeClasses from '../../styles/pages/CodeMasterPage.module.css';
import inboundClasses from '../../styles/pages/InboundRegister.module.css';
import classes from '../../styles/pages/ReceiptPayment.module.css';
import outboundClasses from '../../styles/pages/OutboundRegister.module.css'; // 상세 탭 모양 (매입 · 매출등록과 같음)
import searchClasses from '../../styles/pages/ReceiptPaymentSearch.module.css';
import ConfirmDeleteModal from '../../components/common/ConfirmDeleteModal';
import { useUnsavedChanges } from '../../utils/dirtyRegistry';
import { apiErrorMessage } from '../../utils/apiError';
import { kstDate } from '../../utils/dateFormat';
import { useRequestKey } from '../../utils/requestKey';
import { fetchAllPages, loadMaster, peekMaster } from '../../utils/masterCache';

const PAGE_SIZE_OPTIONS = [
  { value: '15', label: '15개씩' }, { value: '50', label: '50개씩' },
  { value: '100', label: '100개씩' }, { value: '200', label: '200개씩' },
];
const TRANSACTION_OPTIONS = [
  { value: 'RECEIPT', label: '수금' }, { value: 'PAYMENT', label: '지급' },
];
const TRANSACTION_FILTER_OPTIONS = [{ value: '', label: '전체' }, ...TRANSACTION_OPTIONS];
const AMOUNT_FIELDS = [
  { key: 'cashamt', label: '현금', width: 90 },
  { key: 'instrumentamt', label: '수표·어음', width: 100 },
  { key: 'bankamt', label: '은행예금', width: 95 },
  { key: 'cardamt', label: '카드', width: 85 },
  { key: 'offsetamt', label: '상계', width: 85 },
  { key: 'lossamt', label: '잡손실', width: 85 },
  { key: 'chargeamt', label: '잡이익', width: 85 },
];
const INSTRUMENT_PREFIX_FIELDS = [
  { key: 'instrumenttype', label: '수표/어음 종류', width: 100, options: INSTRUMENT_OPTIONS_BY_FIELD.instrumenttype },
  { key: 'instrumentno', label: '수표/어음 번호', width: 140, maxLength: 100 },
];
const INSTRUMENT_INFO_FIELDS = [
  { key: 'issuedate', label: '발행일', width: 100, type: 'date' },
  { key: 'issuercompany', label: '발행회사', width: 130, maxLength: 150 },
  { key: 'issuer', label: '발행자', width: 90, maxLength: 100 },
  { key: 'issuekind', label: '발행구분', width: 90, options: INSTRUMENT_OPTIONS_BY_FIELD.issuekind },
  { key: 'maturitydate', label: '만기일', width: 100, type: 'date' },
  { key: 'custodyaccount', label: '보관계좌', width: 120, maxLength: 100 },
  { key: 'custodybank', label: '보관은행', width: 110, maxLength: 100 },
  { key: 'instrumentstatus', label: '어음처리상태', width: 120, options: INSTRUMENT_OPTIONS_BY_FIELD.instrumentstatus },
];
const DESCRIPTION_FIELD = { key: 'description', label: '비고', width: 180, maxLength: 500 };
// 전표 하나는 '기본'(현금 · 상계 · 잡손실 · 잡이익 · 비고 한 줄) 또는 '어음/수표'(증권 여러 장) 중 한 가지로만 입력한다 (탭으로 나눔).
const CASH_FORM_FIELDS = [
  { key: 'cashamt', label: '현금' }, { key: 'offsetamt', label: '상계' },
  { key: 'lossamt', label: '잡손실' }, { key: 'chargeamt', label: '잡이익' },
];
const CASH_KEYS = CASH_FORM_FIELDS.map((field) => field.key);
const emptyCashForm = () => ({ cashamt: '', offsetamt: '', lossamt: '', chargeamt: '', description: '' });
const INSTRUMENT_AMOUNT_FIELD = { key: 'instrumentamt', label: '금액', width: 110 };
const INSTRUMENT_FIELD_BY_KEY = Object.fromEntries([...INSTRUMENT_PREFIX_FIELDS, ...INSTRUMENT_INFO_FIELDS].map((field) => [field.key, field]));
// 어음/수표 칸 순서: 종류 / 어음번호 / 금액 / 발행회사 / 발행자 / 발행일 / 만기일 / 보관계좌 / 보관은행 / 어음처리상태 / 비고
const INSTRUMENT_GRID_FIELDS = ['instrumenttype', 'instrumentno', 'instrumentamt', 'issuercompany', 'issuer', 'issuedate', 'maturitydate',
  'custodyaccount', 'custodybank', 'instrumentstatus'].map((key) => (key === 'instrumentamt' ? INSTRUMENT_AMOUNT_FIELD
  : key === 'instrumenttype' ? { ...INSTRUMENT_FIELD_BY_KEY[key], label: '종류' }
    : key === 'instrumentno' ? { ...INSTRUMENT_FIELD_BY_KEY[key], label: '어음번호' } : INSTRUMENT_FIELD_BY_KEY[key]));
const INSTRUMENT_KEYS = [...INSTRUMENT_PREFIX_FIELDS, ...INSTRUMENT_INFO_FIELDS].map((field) => field.key).concat('instrumentamt');
const DETAIL_NAVIGATION_FIELDS = [...INSTRUMENT_GRID_FIELDS.map((field) => field.key), 'description'];
// 수금/지급 기본 목록: 수금/지급일 · 구분 · 거래처 · 담당자 · 금액 · 비고 · 전표번호 · 등록/수정 정보
const SUMMARY_COLUMNS = [
  ['receiptdate', '수금/지급일', 95], ['transactiontype', '구분', 60], ['customname', '거래처', 125], ['manager', '담당자', 80],
  ['cashamt', '현금', 90], ['instrumentamt', '수표/어음', 95], ['totalamt', '자금 합계', 95],
  ['offsetamt', '상계', 80], ['lossamt', '잡손실', 80], ['chargeamt', '잡이익', 80], ['description', '비고', 160],
  ['receiptno', '전표번호', 150], ['created_at', '등록일자', 130], ['created_by', '등록자', 80],
  ['updated_at', '수정일자', 130], ['updated_by', '수정자', 80],
].map(([key, label, width]) => ({ key, label, width }));
// 결제·할인·부도 처리 결과 (저장된 전표에서 처리, 입력 중에는 비어 있음)
const PROCESS_COLUMNS = [
  { key: 'processdate', label: '처리일', width: 95 },
  { key: 'discountfee', label: '할인료', width: 90 },
  { key: 'processmemo', label: '처리메모', width: 160 },
];
// 어음/수표 표: 저장된 전표에서만 처리 결과(처리일 · 할인료 · 처리메모)를 뒤에 붙인다
// 지급 전표 맨 끝: '지급어음 선택'으로 넣은 어음의 원래 수금 전표번호
const SOURCE_COLUMN = { key: 'source_receiptno', label: '수금 원천 전표', width: 150 };
// 어음/수표 표 칸 (보이는 조건: saved = 저장된 전표만, receipt = 수금 전표만, payment = 지급 전표만)
//  … 보관은행 | 처리일 | 어음처리상태 | 배서처 | 처리메모 | 할인료 | 비고 | 수금 원천 전표 (수금 · 지급 같은 순서)
const ENDORSEE_COLUMN = { key: 'endorsee', label: '배서처', width: 130 };
const INSTRUMENT_PRE_STATUS_FIELDS = INSTRUMENT_GRID_FIELDS.filter((field) => field.key !== 'instrumentstatus');
const INSTRUMENT_STATUS_FIELD = INSTRUMENT_GRID_FIELDS.find((field) => field.key === 'instrumentstatus');
const INSTRUMENT_COLUMN_SPECS = [
  { key: 'check', label: '', width: 36 }, { key: 'no', label: 'No.', width: 46 },
  ...INSTRUMENT_PRE_STATUS_FIELDS.map((field) => ({ key: field.key, label: field.label, width: field.width })),
  { ...PROCESS_COLUMNS.find((column) => column.key === 'processdate'), saved: true },
  { key: INSTRUMENT_STATUS_FIELD.key, label: INSTRUMENT_STATUS_FIELD.label, width: INSTRUMENT_STATUS_FIELD.width },
  { ...ENDORSEE_COLUMN, saved: true, receipt: true },
  { ...PROCESS_COLUMNS.find((column) => column.key === 'processmemo'), saved: true },
  { ...PROCESS_COLUMNS.find((column) => column.key === 'discountfee'), saved: true },
  { key: DESCRIPTION_FIELD.key, label: DESCRIPTION_FIELD.label, width: DESCRIPTION_FIELD.width },
  { ...SOURCE_COLUMN, payment: true },
];
const INSTRUMENT_COLUMN_WIDTHS = INSTRUMENT_COLUMN_SPECS.map((column) => column.width);
const INSTRUMENT_HEADER_LABELS = INSTRUMENT_COLUMN_SPECS.map((column) => column.label);
const sourceText = (row) => row.source_receiptno || '';

// ── 어음/수표 표 엑셀식 입력 (매입등록과 같은 방식) ──
// 값은 직접 입력과 같은 규칙으로 넣는다: 종류 · 어음처리상태는 목록 값(코드)만, 날짜는 YYYY-MM-DD, 금액은 0 이상 소수 둘째 자리까지,
// 글자는 칸 최대 길이까지. 보유증권(지급어음 선택) 행은 비고만 바꿀 수 있다. 못 알아본 값은 비우고 알려 준다.
const DETAIL_FIELD_SPEC = Object.fromEntries([...INSTRUMENT_GRID_FIELDS, DESCRIPTION_FIELD].map((field) => [field.key, field]));
const DETAIL_FIELD_INDEX = Object.fromEntries(DETAIL_NAVIGATION_FIELDS.map((key, index) => [key, index]));
const PASTE_AMOUNT_PATTERN = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;
const normalizePastedDate = (text) => {
  const match = /^(\d{4})[-./\s]?(\d{1,2})[-./\s]?(\d{1,2})\.?$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
// 붙여넣은 글자 → 칸 값. { value } 또는 { invalid: 'amount' | 'option' | 'date', raw }
const normalizeDetailValue = (field, text) => {
  const spec = DETAIL_FIELD_SPEC[field];
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { value: '' };
  if (field === 'instrumentamt') {
    const normalized = trimmed.replaceAll(',', '').replace(/\s/g, '');
    if (!PASTE_AMOUNT_PATTERN.test(normalized)) return { invalid: 'amount', raw: trimmed };
    const amount = Math.round(Number(normalized) * 100) / 100;
    return Number.isFinite(amount) ? { value: String(amount) } : { invalid: 'amount', raw: trimmed };
  }
  if (spec?.options) {
    const lower = trimmed.toLocaleLowerCase();
    const option = spec.options.find((item) => item.value.toLocaleLowerCase() === lower || item.label.toLocaleLowerCase() === lower);
    return option ? { value: option.value } : { invalid: 'option', raw: trimmed };
  }
  if (spec?.type === 'date') {
    const value = normalizePastedDate(trimmed);
    return value === null ? { invalid: 'date', raw: trimmed } : { value };
  }
  return { value: spec?.maxLength ? trimmed.slice(0, spec.maxLength) : trimmed };
};
const detailWritable = (row, field) => !row.source_receiptno || field === 'description';
// 복사(Ctrl+C) 글자: 화면에 보이는 값 (종류 · 상태는 이름) → 엑셀이나 이 표에 다시 붙여넣을 수 있다
const detailCopyText = (row, field) => {
  const spec = DETAIL_FIELD_SPEC[field];
  const value = row[field] ?? '';
  const text = spec?.options ? instrumentLabel(field, value) : spec?.type === 'date' ? dateOnly(value) : String(value);
  return text.replace(/[\t\r\n]+/g, ' ');
};
const parseClipboardMatrix = (text) => String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  .filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
const isMultiCellText = (text) => /[\t\n]/.test(String(text || '').replace(/\r?\n$/, '').replace(/\r/g, '\n'));
const detailCellOf = (target) => {
  const cell = target instanceof Element ? target.closest('[data-detail-row][data-detail-field]') : null;
  return cell && DETAIL_FIELD_INDEX[cell.dataset.detailField] !== undefined ? { rowId: cell.dataset.detailRow, field: cell.dataset.detailField, cell } : null;
};

const AMOUNT_KEYS = AMOUNT_FIELDS.map(({ key }) => key);
const todayString = () => {
  const d = kstDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const makeFilters = () => {
  const d = kstDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return {
    date_from: `${y}-${m}-01`,
    date_to: `${y}-${m}-${String(new Date(y, d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
    transactiontype: '', customer: '', receiptno: '',
  };
};
const emptyHeader = () => ({
  receiptno: '', receiptdate: todayString(), transactiontype: 'RECEIPT',
  customcode: '', customname: '', manager: '', description: '',
});
const makeDetail = (data = {}) => ({
  id: data.id || `detail-${Date.now()}-${Math.random()}`,
  lineno: data.lineno ?? null, // saved rows: DB line number (결제·할인 처리 대상 지정)
  cashamt: data.cashamt ?? '', instrumentamt: data.instrumentamt ?? '',
  instrumenttype: data.instrumenttype ?? '', instrumentno: data.instrumentno ?? '',
  issuedate: data.issuedate ? String(data.issuedate).slice(0, 10) : '',
  issuercompany: data.issuercompany ?? '', issuer: data.issuer ?? '', issuekind: data.issuekind ?? '',
  maturitydate: data.maturitydate ? String(data.maturitydate).slice(0, 10) : '',
  custodyaccount: data.custodyaccount ?? '', custodybank: data.custodybank ?? '',
  instrumentstatus: data.instrumentstatus ?? '',
  bankamt: data.bankamt ?? '', cardamt: data.cardamt ?? '',
  offsetamt: data.offsetamt ?? '', lossamt: data.lossamt ?? '',
  chargeamt: data.chargeamt ?? '', description: data.description ?? '',
  processdate: data.processdate ? String(data.processdate).slice(0, 10) : '',
  discountfee: data.discountfee ?? '', processmemo: data.processmemo ?? '',
  created_by: data.created_by ?? '', updated_by: data.updated_by ?? '',
  // 보유증권 불러오기: 지급 행이 사용한 수금 증권 / 수금 증권이 사용된 지급전표
  source_receiptno: data.source_receiptno ?? '', source_lineno: data.source_lineno ?? null,
  used_receiptno: data.used_receiptno ?? '',
  // 배서: 넘겨준 지급 전표의 거래처 · 일자 (처리일 칸에 일자를 보여 준다)
  used_customname: data.used_customname ?? '', used_date: data.used_date ? String(data.used_date).slice(0, 10) : '',
});
const sourceKey = (receiptno, lineno) => `${receiptno}:${lineno}`;
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const numeric = (value) => {
  const parsed = Number(String(value ?? 0).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatted = (value) => numeric(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dateOnly = (value) => value ? String(value).slice(0, 10) : '';
const totalOf = (row) => ['cashamt', 'instrumentamt', 'bankamt', 'cardamt'].reduce((sum, key) => sum + numeric(row[key]), 0);
// 저장된 행이 증권 줄인지 (증권 정보가 하나라도 있으면 어음/수표)
const isInstrumentRow = (row) => numeric(row.instrumentamt) > 0 || Boolean(String(row.instrumenttype || '').trim())
  || Boolean(String(row.instrumentno || '').trim()) || Boolean(row.source_receiptno);
// 어음/수표 행에 입력한 내용이 있는지
const instrumentRowHasInput = (row) => isInstrumentRow(row)
  || INSTRUMENT_KEYS.some((key) => key !== 'instrumentamt' && String(row[key] ?? '').trim()) || Boolean(String(row.description || '').trim());
const cashFormHasInput = (form) => CASH_KEYS.some((key) => numeric(form[key]) > 0) || Boolean(String(form.description || '').trim());
// 저장된 상세 → 기본 한 줄 (기본 줄이 여러 개였던 예전 전표는 합쳐서 보여 준다)
const cashFormOf = (rows) => rows.reduce((form, row) => ({
  cashamt: String(numeric(form.cashamt) + numeric(row.cashamt) + numeric(row.bankamt) + numeric(row.cardamt) || ''),
  offsetamt: String(numeric(form.offsetamt) + numeric(row.offsetamt) || ''),
  lossamt: String(numeric(form.lossamt) + numeric(row.lossamt) || ''),
  chargeamt: String(numeric(form.chargeamt) + numeric(row.chargeamt) || ''),
  description: [form.description, row.description].map((text) => String(text || '').trim()).filter(Boolean).join(' / '),
}), emptyCashForm());
const typeName = (value) => value === 'PAYMENT' ? '지급' : '수금';
// 저장된 기본 전표 수정: 불러온 값과 지금 값이 다른지 (금액은 숫자로, 글자는 앞뒤 공백 없이 비교)
const cashEditKey = (header, form) => JSON.stringify([
  header.receiptno, header.receiptdate, header.transactiontype, header.customcode, String(header.manager || '').trim(), String(header.description || '').trim(),
  ...CASH_KEYS.map((key) => numeric(form[key])), String(form.description || '').trim(),
]);
// 만기일이 발행일보다 앞이면 잘못 입력한 날짜 (둘 다 있을 때만 비교)
const maturityBeforeIssue = (row) => Boolean(row.issuedate && row.maturitydate && String(row.maturitydate).slice(0, 10) < String(row.issuedate).slice(0, 10));
// 같은 어음 = '어음번호 + 발행회사'가 같은 것 (대소문자 · 앞뒤 공백 무시). 수금 · 지급 각각 한 장만.
//  '지급어음 선택' 행은 원래 수금 어음과 같은 증권이라 세지 않는다.
const instrumentNoKey = (value) => String(value || '').trim().toUpperCase();
const instrumentKey = (row) => (instrumentNoKey(row.instrumentno) ? `${instrumentNoKey(row.instrumentno)}\t${instrumentNoKey(row.issuercompany)}` : '');
const duplicateInstrumentRows = (rows) => {
  const seen = new Map();
  for (const [index, row] of rows.entries()) {
    const key = instrumentKey(row);
    if (!key || row.source_receiptno) continue;
    if (seen.has(key)) return [seen.get(key) + 1, index + 1, row.instrumentno, row.issuercompany];
    seen.set(key, index);
  }
  return null;
};
const notifyMaturityBeforeIssue = (rowNumber) => notifications.show({
  id: 'receipt-payment-maturity-check', title: '만기일 확인',
  message: `어음/수표 ${rowNumber}행: 만기일이 발행일보다 앞입니다. 날짜를 확인해 주세요.`, color: 'orange',
});
// 잡손실 · 잡이익: 수금은 + 잡손실 − 잡이익, 지급은 − 잡손실 + 잡이익 — 서버 · 거래처원장과 같은 규칙
const signedAdjust = (loss, gain, transactiontype) => (transactiontype === 'RECEIPT' ? numeric(loss) - numeric(gain) : numeric(gain) - numeric(loss));
const errorText = (error) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(' · ');
  return apiErrorMessage(error, '요청을 처리하지 못했습니다.');
};

const ResizableHeaderCell = memo(function ResizableHeaderCell({ index, width, onResize, children, ...props }) {
  return <Table.Th {...props} className={classes.resizableHeader}>
    {children}
    <span className={classes.columnResizeHandle} onPointerDown={(event) => onResize(event, index, width)} role="separator" aria-orientation="vertical" aria-label={`${index + 1}열 너비 조절`} />
  </Table.Th>;
});

// 자금 합계 = 현금+수표·어음+은행예금+카드 / 상계·잡손실 = 돈이 오가지 않은 정리액 / 전표 합계 = 둘의 합 (거래처원장 반영액)
const DOCUMENT_MONEY_KEYS = ['cashamt', 'instrumentamt', 'totalamt', 'offsetamt', 'lossamt', 'chargeamt'];
const DATE_TIME_KEYS = new Set(['created_at', 'updated_at']);
const seoulDateTime = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
// 등록일자 · 수정일자: 화면은 분까지, 엑셀은 초까지 (매입등록과 동일)
const dateTimeText = (value, withSeconds = false) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const part = Object.fromEntries(seoulDateTime.formatToParts(date).map((entry) => [entry.type, entry.value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}${withSeconds ? `:${part.second}` : ''}`;
};
const ReceiptPaymentSummaryRow = memo(function ReceiptPaymentSummaryRow({ doc, selected, onSelect }) {
  const rowRef = useRef(null);
  // 저장 직후 선택된 전표가 목록 아래쪽에 있어도 보이도록 스크롤
  useEffect(() => { if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return <Table.Tr ref={rowRef} className={selected ? classes.selectedRow : ''} onClick={() => onSelect(doc.receiptno)}>
    {SUMMARY_COLUMNS.map((column) => {
      const value = doc[column.key];
      const money = DOCUMENT_MONEY_KEYS.includes(column.key);
      const text = DATE_TIME_KEYS.has(column.key) ? dateTimeText(value) : undefined;
      return <Table.Td key={column.key} ta={money ? 'right' : column.key === 'transactiontype' ? 'center' : undefined} title={column.key === 'transactiontype' ? typeName(value) : text ?? String(value ?? '')}>
        {column.key === 'receiptdate' ? dateOnly(value)
          : text !== undefined ? text
          : column.key === 'transactiontype' // 수금/지급 현황과 같은 둥근 배지
            ? <Badge className={value === 'PAYMENT' ? searchClasses.paymentBadge : searchClasses.receiptBadge} variant="light">{typeName(value)}</Badge>
          : money ? formatted(value) : value || ''}
      </Table.Td>;
    })}
  </Table.Tr>;
});

// 헤더 거래처(수백 건): Mantine은 닫힌 목록도 옵션을 모두 그리므로, props가 같으면 다시 그리지 않도록 memo로 분리.
const HeaderCustomerSelect = memo(function HeaderCustomerSelect({ options, value, disabled, onChange }) {
  return <Select searchable autoSelectOnBlur aria-label="거래처" placeholder="" disabled={disabled} data={options} value={value} onChange={onChange} />;
});

// 수표/어음 종류·발행구분·어음처리상태: 평소엔 가벼운 표시용 입력칸만 그리고, 포커스/클릭할 때만 검색형 Select로 바꾼다.
// (행마다 Select 3개가 닫힌 상태에서도 옵션 목록·위치계산을 해서 행 추가가 느렸음)
const LazyOptionSelect = memo(function LazyOptionSelect({ ariaLabel, options, value, disabled, onChange }) {
  const [active, setActive] = useState(null); // null | 'focus' | 'click' (click opens the list right away)
  const clickedRef = useRef(false);
  const selectRef = useRef(null);
  const data = useMemo(() => (value && !options.some((option) => option.value === value)
    ? [{ value, label: value }, ...options] // an older free-text value stays visible until changed
    : options), [options, value]);
  const label = data.find((option) => option.value === value)?.label ?? '';
  useLayoutEffect(() => { if (active) selectRef.current?.focus(); }, [active]);
  if (!active || disabled) {
    return <div className={classes.lazySelect}>
      <input aria-label={ariaLabel} className={classes.lazySelectInput} value={label} readOnly disabled={disabled}
        onMouseDown={() => { clickedRef.current = !disabled; }}
        onFocus={() => { if (!disabled) setActive(clickedRef.current ? 'click' : 'focus'); clickedRef.current = false; }} />
      <IconChevronDown size={14} className={classes.lazySelectChevron} aria-hidden />
    </div>;
  }
  return <Select ref={selectRef} aria-label={ariaLabel} size="xs" searchable clearable autoSelectOnBlur selectFirstOptionOnChange
    data={data} value={value || null} placeholder="" nothingFoundMessage="목록에 없습니다" comboboxProps={{ withinPortal: true }}
    defaultDropdownOpened={active === 'click'}
    onChange={(nextValue) => onChange(nextValue || '')}
    onBlur={() => setActive(null)} />;
});

const ReceiptPaymentDetailInputCell = memo(function ReceiptPaymentDetailInputCell({ rowId, rowNumber, field, value, numericInput = false, suggestions, disabled, onUpdate, onOpenPicker }) {
  const [draft, setDraft] = useState(value ?? '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pickerOpenRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const [synced, setSynced] = useState({ type: field.type, numericInput, value });
  if (synced.type !== field.type || synced.numericInput !== numericInput || synced.value !== value) {
    setSynced({ type: field.type, numericInput, value });
    if (!numericInput && field.type !== 'date') { setDraft(value ?? ''); setShowSuggestions(false); }
  }
  const openPicker = () => {
    if (disabled || !onOpenPicker) return;
    pickerOpenRef.current = true;
    setShowSuggestions(false);
    onOpenPicker(rowId, field.key);
  };
  return <Table.Td data-detail-row={rowId} data-detail-field={field.key}>
    {numericInput
      ? <NumberInput aria-label={`${rowNumber}행 ${field.label}`} value={value} min={0} allowNegative={false} decimalScale={2} thousandSeparator="," hideControls withKeyboardEvents={false} size="xs" disabled={disabled} placeholder="" onChange={(nextValue) => onUpdate(rowId, field.key, nextValue)} />
      : field.type === 'date'
        ? <ErpDateInput aria-label={`${rowNumber}행 ${field.label}`} size="xs" value={value} disabled={disabled} placeholder="" autoComplete="off" onChange={(event) => onUpdate(rowId, field.key, event.currentTarget.value)} />
        : field.options
          // 검색형 선택: 입력하면 목록이 좁혀지고 Enter/Tab(자동확정)으로 선택. 목록에 없는 값은 들어가지 않음.
          ? <LazyOptionSelect ariaLabel={`${rowNumber}행 ${field.label}`} options={field.options} value={value} disabled={disabled}
            onChange={(nextValue) => onUpdate(rowId, field.key, nextValue)} />
        : suggestions
          ? <Box className={inboundClasses.itemNameSearchTarget} onClick={(event) => {
            const input = event.currentTarget.querySelector('input');
            if (input && event.clientX >= input.getBoundingClientRect().right - 28) openPicker();
          }} onDoubleClick={openPicker}>
            <Autocomplete aria-label={`${rowNumber}행 ${field.label}`} value={draft} placeholder="" autoComplete="off" data={showSuggestions && draft.trim() ? suggestions : []} limit={8} maxLength={field.maxLength} size="xs" disabled={disabled}
            classNames={{ input: `${codeClasses.cellInput} ${inboundClasses.itemCodePickerInput} ${inboundClasses.itemNameSearchInput}` }}
            filter={({ options, search }) => {
              const query = String(search || '').trim().toLocaleLowerCase();
              if (!showSuggestions || !query || !Array.isArray(options)) return [];
              return options.filter((option) => `${option.label || option.value || ''} ${option.code || ''}`
                .toLocaleLowerCase().includes(query));
            }}
            onChange={(nextValue) => { pickerOpenRef.current = false; setDraft(nextValue); setShowSuggestions(Boolean(nextValue.trim())); }}
            onOptionSubmit={(nextValue) => { pickerOpenRef.current = false; setDraft(nextValue); setShowSuggestions(false); onUpdate(rowId, field.key, nextValue); }}
            onKeyDown={(event) => {
              const untouched = draft === (value ?? '');
              // F2 · (아직 글자를 치지 않았을 때) 스페이스: 은행 선택 창 (매입등록 자동완성 칸과 같음)
              if (event.key === 'F2' || (event.key === ' ' && untouched && onOpenPicker)) { event.preventDefault(); openPicker(); return; }
              // Tab: ↑/↓로 고른 항목 → 이름·코드가 정확히 같은 은행 하나 → 후보가 하나뿐이면 그 은행. 못 정하면 친 글자 그대로 (수기 입력 가능 칸)
              if (event.key !== 'Tab' || event.shiftKey) return;
              const listId = event.currentTarget.getAttribute('aria-controls');
              const highlighted = listId ? document.getElementById(listId)?.querySelector('[role="option"][data-combobox-selected]') : null;
              if (highlighted) { highlighted.click(); return; }
              const query = draft.trim().toLocaleLowerCase();
              if (untouched || !query) return;
              const exact = suggestions.filter((option) => [option.value, option.label, option.code].some((text) => String(text || '').trim().toLocaleLowerCase() === query));
              const visible = showSuggestions ? suggestions.filter((option) => `${option.label || option.value || ''} ${option.code || ''}`.toLocaleLowerCase().includes(query)) : [];
              const pick = exact.length === 1 ? exact[0] : visible.length === 1 ? visible[0] : null;
              if (!pick) return;
              skipBlurCommitRef.current = true;
              setDraft(pick.value); setShowSuggestions(false); onUpdate(rowId, field.key, pick.value);
            }}
            onBlur={() => {
              setShowSuggestions(false);
              if (skipBlurCommitRef.current) { skipBlurCommitRef.current = false; pickerOpenRef.current = false; return; }
              if (!pickerOpenRef.current && draft !== (value ?? '')) onUpdate(rowId, field.key, draft);
              pickerOpenRef.current = false;
            }} /></Box>
        : <TextInput aria-label={`${rowNumber}행 ${field.label}`} value={draft} placeholder="" autoComplete="off" maxLength={field.maxLength} size="xs" disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => { if (draft !== (value ?? '')) onUpdate(rowId, field.key, draft); }} />}
  </Table.Td>;
});

// 기본 탭: 현금 · 상계 · 잡손실 · 잡이익 · 비고 — 어음/수표 표와 같은 모양의 한 줄 표에서 입력 (←/→ · Enter 로 칸 이동)
const CASH_TABLE_FIELDS = [...CASH_FORM_FIELDS.map((field) => ({ ...field, width: 150 })), { ...DESCRIPTION_FIELD, width: 320 }];
const CashEntryTable = memo(function CashEntryTable({ form, disabled, readOnly, showRow = true, onChange }) {
  const update = useCallback((_rowId, key, value) => onChange(key, key === 'description' ? value : (value === '' ? '' : String(value))), [onChange]);
  const moveFocus = (event) => {
    const input = event.target instanceof HTMLElement ? event.target.closest('input') : null;
    const cell = input?.closest('[data-detail-field]');
    if (!input || !cell) return;
    let step = 0;
    if (event.key === 'Enter') step = 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      try {
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd = input.selectionStart === (input.value?.length ?? 0) && input.selectionEnd === input.selectionStart;
        if (event.key === 'ArrowRight' && atEnd) step = 1;
        if (event.key === 'ArrowLeft' && atStart) step = -1;
      } catch { return; }
    }
    if (!step) return;
    const cells = [...event.currentTarget.querySelectorAll('[data-detail-field]')];
    const next = cells[cells.indexOf(cell) + step]?.querySelector('input');
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  return <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table} ${classes.cashTable}`} withTableBorder withColumnBorders
    style={{ tableLayout: 'fixed', width: '100%', minWidth: CASH_TABLE_FIELDS.reduce((sum, field) => sum + field.width, 46) }} onKeyDown={moveFocus}>
    <colgroup><col style={{ width: 46 }} />{CASH_TABLE_FIELDS.map((field) => <col key={field.key} style={{ width: field.width }} />)}</colgroup>
    <Table.Thead><Table.Tr><Table.Th ta="center">No.</Table.Th>{CASH_TABLE_FIELDS.map((field) => <Table.Th key={field.key}>{field.label}</Table.Th>)}</Table.Tr></Table.Thead>
    <Table.Tbody>{showRow && <Table.Tr>
      <Table.Td ta="center">1</Table.Td>
      {CASH_TABLE_FIELDS.map((field) => (readOnly
        ? (field.key === 'description' ? <ReadonlyTextCell key={field.key} field={field} value={form.description} /> : <ReadonlyAmountCell key={field.key} value={form[field.key]} />)
        : <ReceiptPaymentDetailInputCell key={field.key} rowId="cash" rowNumber={1} field={field} value={form[field.key]}
          numericInput={field.key !== 'description'} disabled={disabled} onUpdate={update} />))}
    </Table.Tr>}</Table.Tbody>
  </Table>;
});

const ReceiptPaymentHeaderTextInput = memo(function ReceiptPaymentHeaderTextInput({ label, value, maxLength, disabled, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setDraft(value ?? '');
  }
  return <TextInput aria-label={label} value={draft} maxLength={maxLength} disabled={disabled}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => { if (draft !== (value ?? '')) onCommit(draft); }} />;
});

const ReceiptPaymentDetailRow = memo(function ReceiptPaymentDetailRow({ row, index, selected, disabled: rowDisabled, bankOptions, showSource, onToggle, onUpdate, onOpenPicker }) {
  const rowNumber = index + 1;
  const fromHeld = Boolean(row.source_receiptno);
  const disabled = rowDisabled || fromHeld; // 불러온 증권 행은 내용 수정 불가 (행 삭제·비고만 가능)
  const sourceTitle = fromHeld ? `보유증권 ${row.source_receiptno}-${row.source_lineno} 사용` : row.used_receiptno ? `지급전표 ${row.used_receiptno}에 사용됨` : undefined;
  return <Table.Tr className={[selected ? classes.detailSelectedRow : '', fromHeld ? classes.heldSourceRow : ''].filter(Boolean).join(' ')}>
    <Table.Td ta="center"><input type="checkbox" aria-label={`${rowNumber}행 선택`} checked={selected} disabled={rowDisabled} onChange={(event) => onToggle(row.id, event.nativeEvent.shiftKey)} /></Table.Td>
    <Table.Td ta="center" title={sourceTitle}>{rowNumber}{fromHeld && <span className={classes.heldBadge}>보유</span>}{row.used_receiptno && <span className={classes.usedBadge}>사용</span>}</Table.Td>
    {INSTRUMENT_GRID_FIELDS.map((field) => <ReceiptPaymentDetailInputCell key={field.key} rowId={row.id} rowNumber={rowNumber} field={field} value={row[field.key]}
      numericInput={field.key === 'instrumentamt'}
      // 발행회사는 수기 입력 그대로 저장 (자동맞춤 · 선택창 없음). 보관은행만 목록 선택을 돕는다.
      suggestions={field.key === 'custodybank' ? bankOptions : undefined}
      onOpenPicker={field.key === 'custodybank' ? onOpenPicker : undefined} disabled={disabled} onUpdate={onUpdate} />)}
    <ReceiptPaymentDetailInputCell rowId={row.id} rowNumber={rowNumber} field={DESCRIPTION_FIELD} value={row.description} disabled={rowDisabled} onUpdate={onUpdate} />
    {showSource && <Table.Td title={row.source_receiptno ? `${row.source_receiptno}-${row.source_lineno}` : undefined}>{sourceText(row)}</Table.Td>}
  </Table.Tr>;
});

// 결제·할인·부도·처리취소 가능 여부 (백엔드 _process_block_reason 과 같은 규칙)
//  받은 증권(수금·타수): 보관 → 결제/할인/부도, 처리된 것 → 처리취소. 배서된 것은 불가.
//  발행한 어음(지급·자수): 보관 → 결제, 결제된 것 → 처리취소.
const PROCESS_ACTION_INFO = {
  SETTLE: { label: '결제', color: 'teal' },
  DISCOUNT: { label: '할인', color: 'blue' },
  DISHONOR: { label: '부도', color: 'red' },
  CANCEL: { label: '처리취소', color: 'gray' },
};
const PROCESSED_STATUSES = ['SETTLED', 'DISCOUNTED', 'DISHONORED'];
const canProcess = (row, transactiontype, action) => {
  if (numeric(row.instrumentamt) <= 0) return false;
  const status = String(row.instrumentstatus || '').toUpperCase();
  const kind = String(row.issuekind || '').toUpperCase();
  if (transactiontype === 'RECEIPT') {
    if (kind === 'OWN') return false;
    if (row.used_receiptno || status === 'ENDORSED') { // 배서한 증권: 부도(상환청구)만, 처리취소 → 배서
      if (action === 'DISHONOR') return status === 'ENDORSED';
      if (action === 'CANCEL') return status === 'DISHONORED';
      return false;
    }
    return action === 'CANCEL' ? PROCESSED_STATUSES.includes(status) : ['', 'HELD'].includes(status);
  }
  if (kind === 'OTHER') { // 배서양도(타수 직접 입력): 부도만, 처리취소 → 배서. 불러온 행은 원본 수금에서 처리
    if (row.source_receiptno) return false;
    if (action === 'DISHONOR') return ['', 'ENDORSED'].includes(status);
    if (action === 'CANCEL') return status === 'DISHONORED';
    return false;
  }
  if (kind !== 'OWN') return false;
  if (action === 'SETTLE') return !PROCESSED_STATUSES.includes(status);
  if (action === 'CANCEL') return status === 'SETTLED';
  return false;
};
const processActionsFor = (transactiontype) => (transactiontype === 'PAYMENT' ? ['SETTLE', 'DISHONOR', 'CANCEL'] : ['SETTLE', 'DISCOUNT', 'DISHONOR', 'CANCEL']);
const isManualEndorsed = (row, transactiontype) => transactiontype === 'PAYMENT' && String(row.issuekind || '').toUpperCase() === 'OTHER' && !row.source_receiptno;
const isProcessable = (row, transactiontype) => processActionsFor(transactiontype).some((action) => canProcess(row, transactiontype, action));
// 발행한 어음(지급·자수)도 처리 전 상태는 '보관' (만기에 결제 처리).
const statusText = (row, transactiontype) => {
  if (transactiontype === 'PAYMENT' && !row.instrumentstatus && numeric(row.instrumentamt) > 0 && !isManualEndorsed(row, transactiontype)) return '보관'; // 예전 빈 상태
  if (row.instrumentstatus === 'DISHONORED' && (row.used_receiptno || row.source_receiptno || isManualEndorsed(row, transactiontype))) return '부도(배서)'; // 넘겨준 어음의 부도
  return instrumentLabel('instrumentstatus', row.instrumentstatus);
};
// 처리취소하면 돌아갈 상태
const statusBeforeProcess = (row, transactiontype) => (isManualEndorsed(row, transactiontype) ? '배서'
  : row.used_receiptno ? '배서' : '보관');

// 저장된 전표(읽기 전용)는 입력 컴포넌트 대신 글자만 그린다 → 전표 선택 시 렌더가 훨씬 가볍다.
const readonlyText = (field, value) => field.options ? instrumentLabel(field.key, value)
  : field.type === 'date' ? dateOnly(value) : String(value ?? '');
const ReadonlyAmountCell = ({ value }) => <td className={classes.readonlyCell} data-align="right">{value === '' || value == null ? '' : formatted(value)}</td>;
const ReadonlyTextCell = ({ field, value }) => {
  const text = readonlyText(field, value);
  return <td className={classes.readonlyCell} title={text}>{text}</td>;
};
const ReceiptPaymentReadonlyRow = memo(function ReceiptPaymentReadonlyRow({ row, index, transactiontype, selectable, selected, onToggle }) {
  const rowNumber = index + 1;
  const sourceTitle = row.source_receiptno ? `보유증권 ${row.source_receiptno}-${row.source_lineno} 사용` : row.used_receiptno ? `지급전표 ${row.used_receiptno}에 사용됨` : undefined;
  // 저장된 전표: 행 아무 곳이나 눌러도 체크 (처리 가능한 행만). 체크박스를 직접 누르면 체크박스가 처리한다.
  return <tr className={[selected ? classes.detailSelectedRow : '', row.source_receiptno ? classes.heldSourceRow : ''].filter(Boolean).join(' ') || undefined}
    style={selectable ? { cursor: 'pointer' } : undefined}
    onClick={(event) => { if (selectable && !(event.target instanceof HTMLInputElement)) onToggle(row.id, event.shiftKey); }}>
    <td className={classes.readonlyCell} data-align="center"><input type="checkbox" aria-label={`${rowNumber}행 선택`} checked={selected} disabled={!selectable}
      title={selectable ? undefined : '결제·할인·부도 처리 대상이 아닌 행입니다.'} onChange={(event) => onToggle(row.id, event.nativeEvent.shiftKey)} /></td>
    <td className={classes.readonlyCell} data-align="center" title={sourceTitle}>{rowNumber}{row.source_receiptno && <span className={classes.heldBadge}>보유</span>}{row.used_receiptno && <span className={classes.usedBadge}>사용</span>}</td>
    {INSTRUMENT_PRE_STATUS_FIELDS.map((field) => (field.key === 'instrumentamt' ? <ReadonlyAmountCell key={field.key} value={row.instrumentamt} />
      : <ReadonlyTextCell key={field.key} field={field} value={row[field.key]} />))}
    {/* 처리일: 결제 · 할인 · 부도는 처리한 날, 배서는 넘겨준 지급 전표의 일자 */}
    <td className={classes.readonlyCell}>{dateOnly(row.processdate || row.used_date)}</td>
    <td className={`${classes.readonlyCell} ${PROCESSED_STATUSES.includes(row.instrumentstatus) ? classes[`status${row.instrumentstatus}`] || '' : ''}`}>{statusText(row, transactiontype)}</td>
    {transactiontype === 'RECEIPT' && <ReadonlyTextCell field={ENDORSEE_COLUMN} value={row.used_customname || ''} />}
    <ReadonlyTextCell field={{ key: 'processmemo' }} value={row.processmemo} />
    <ReadonlyAmountCell value={numeric(row.discountfee) > 0 ? row.discountfee : ''} />
    <ReadonlyTextCell field={DESCRIPTION_FIELD} value={row.description} />
    {transactiontype === 'PAYMENT' && <ReadonlyTextCell field={SOURCE_COLUMN} value={sourceText(row)} />}
  </tr>;
});

const ReceiptPaymentFilterPanel = memo(function ReceiptPaymentFilterPanel({ initialValues, transactionOptions, onSearch, onDraftChange, onClose }) {
  const [draft, setDraft] = useState(initialValues);
  const draftRef = useRef(draft);
  const update = (key, value) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    onDraftChange?.(next); // 최상단 [조회]도 지금 입력한 조건으로 조회하도록 페이지에 알림
  };
  const submit = () => onSearch({ ...draftRef.current });
  const searchOnEnter = (event) => { if (event.key === 'Enter') submit(); };

  return <Paper className={`${inboundClasses.receiptFilterSidebar} ${classes.filterPanel}`} withBorder>
    <Group className={inboundClasses.receiptFilterHeader} justify="space-between"><Text fw={700}>조회조건</Text><ActionIcon variant="subtle" color="gray" aria-label="조회조건 닫기" onClick={onClose}><IconX size={15} /></ActionIcon></Group>
    <Stack gap="sm" className={`${inboundClasses.receiptFilterFields} ${classes.filters}`}>
      <Input.Wrapper label="수금/지급 기간"><Stack gap={6}>
        <ErpDateInput type="date" value={draft.date_from} onChange={(event) => update('date_from', event.currentTarget.value)} />
        <ErpDateInput type="date" value={draft.date_to} onChange={(event) => update('date_to', event.currentTarget.value)} />
      </Stack></Input.Wrapper>
      <Select label="구분" data={transactionOptions} value={draft.transactiontype} onChange={(value) => update('transactiontype', value || '')} />
      <TextInput label="거래처" placeholder="거래처코드 또는 거래처명" value={draft.customer} onChange={(event) => update('customer', event.currentTarget.value)} onKeyDown={searchOnEnter} />
      <TextInput label="전표번호" placeholder="전표번호" value={draft.receiptno} onChange={(event) => update('receiptno', event.currentTarget.value)} onKeyDown={searchOnEnter} />
    </Stack>
  </Paper>;
});

// 결제·할인·부도·처리취소: 저장된 전표에서 선택한 증권 행을 처리한다 (마지막 처리만 기록).
const InstrumentProcessModal = memo(function InstrumentProcessModal({ request, transactiontype, onClose, onDone }) {
  const action = request?.action;
  const rows = useMemo(() => request?.rows || [], [request]);
  const [processdate, setProcessdate] = useState(todayString);
  const [memo, setMemo] = useState('');
  const [fees, setFees] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [openedFor, setOpenedFor] = useState(null);
  if (request !== openedFor) { // reset the form each time the modal opens
    setOpenedFor(request);
    setProcessdate(todayString()); setMemo(''); setFees({}); setSubmitting(false);
  }
  if (!request) return null;
  const info = PROCESS_ACTION_INFO[action];
  const isCancel = action === 'CANCEL';
  const total = rows.reduce((sum, row) => sum + numeric(row.instrumentamt), 0);
  const feeTotal = rows.reduce((sum, row) => sum + numeric(fees[row.lineno]), 0);
  const submit = async () => {
    if (!isCancel && !processdate) {
      notifications.show({ title: '처리일을 입력해 주세요', message: `${info.label} 처리일은 필수입니다.`, color: 'orange' });
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`/api/receipt-payment/documents/${encodeURIComponent(request.receiptno)}/instrument-process`, {
        action, processdate: isCancel ? null : processdate, processmemo: isCancel ? '' : memo,
        lines: rows.map((row) => ({ lineno: Number(row.lineno), discountfee: action === 'DISCOUNT' ? numeric(fees[row.lineno]) : 0 })),
      }, authConfig());
      notifications.show({ title: `${info.label} 완료`, message: `${rows.length}건 · ${formatted(total)}원을 ${info.label} 처리했습니다.`, color: 'teal' });
      onDone(request.receiptno);
    } catch (error) {
      notifications.show({ title: `${info.label} 실패`, message: errorText(error), color: 'red', autoClose: 9000 });
      setSubmitting(false);
    }
  };
  return <Modal opened onClose={() => !submitting && onClose()} title={`증권 ${info.label}`} centered size="lg">
    <Stack gap="sm">
      <Text size="sm" c="dimmed">{isCancel
        ? `선택한 ${rows.length}건을 처리 전 상태(${[...new Set(rows.map((row) => statusBeforeProcess(row, transactiontype)))].join('·')})로 되돌립니다. 처리일·할인료·처리메모는 지워집니다.`
        : `선택한 ${rows.length}건을 '${info.label}'(으)로 처리합니다.`}
        {action === 'DISHONOR' && rows.some((row) => row.used_receiptno) && <><br />배서한 어음은 연결된 지급 행도 '부도(배서)'로 표시됩니다. 상환한 돈은 지급 전표로, 상환청구 내용은 처리메모에 남겨 주세요.</>}
        {action === 'DISHONOR' && rows.some((row) => isManualEndorsed(row, transactiontype)) && <><br />배서양도한 어음이 부도나 상환청구를 받은 경우입니다. 상환한 돈은 지급 전표로, 청구 내용은 처리메모에 남겨 주세요.</>}</Text>
      <Box className={classes.processTableWrap}>
        <table className={classes.processTable}>
          <thead><tr><th>No.</th><th>종류</th><th>번호</th><th>만기일</th><th>금액</th>{isCancel && <th>현재 상태</th>}{action === 'DISCOUNT' && <th>할인료</th>}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.lineno}>
            <td>{row.lineno}</td><td>{instrumentLabel('instrumenttype', row.instrumenttype)}</td><td>{row.instrumentno}</td>
            <td>{dateOnly(row.maturitydate)}</td><td data-align="right">{formatted(row.instrumentamt)}</td>
            {isCancel && <td>{statusText(row, transactiontype)}{row.processdate ? ` (${dateOnly(row.processdate)})` : ''}</td>}
            {action === 'DISCOUNT' && <td><NumberInput aria-label={`${row.lineno}행 할인료`} size="xs" value={fees[row.lineno] ?? ''} min={0} max={numeric(row.instrumentamt)}
              allowNegative={false} decimalScale={2} thousandSeparator="," hideControls onChange={(value) => setFees((current) => ({ ...current, [row.lineno]: value }))} /></td>}
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={4}>합계</td><td data-align="right">{formatted(total)}</td>{isCancel && <td />}{action === 'DISCOUNT' && <td data-align="right">{formatted(feeTotal)}</td>}</tr></tfoot>
        </table>
      </Box>
      {!isCancel && <Group grow align="flex-start">
        <Input.Wrapper label="처리일" required><ErpDateInput type="date" value={processdate} onChange={(event) => setProcessdate(event.currentTarget.value)} /></Input.Wrapper>
        <TextInput label="처리메모" placeholder={action === 'SETTLE' ? '예) 국민은행 입금' : action === 'DISCOUNT' ? '예) 신한은행 할인'
          : rows.some((row) => row.used_receiptno || isManualEndorsed(row, transactiontype)) ? '예) B사 상환청구, 11/30 현금 상환 / A사에 청구 예정' : '예) 부도 통보일, 사유'} maxLength={500} value={memo} onChange={(event) => setMemo(event.currentTarget.value)} />
      </Group>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={submitting}>취소</Button>
        <Button color={info.color} onClick={() => void submit()} loading={submitting}>{info.label}</Button>
      </Group>
    </Stack>
  </Modal>;
});

// 보유증권 불러오기: 보관 중인 수금 증권(어음·수표·외상매출채권)을 골라 지급 상세로 가져온다.
const HELD_PAGE_SIZE = 50;
const daysUntil = (value) => {
  if (!value) return null;
  const today = kstDate();
  return Math.round((new Date(`${String(value).slice(0, 10)}T00:00:00`) - today) / 86400000);
};
const HELD_COLUMNS = [
  { key: 'select', label: '', width: 52 },
  { key: 'maturitydate', label: '만기일', width: 100 },
  { key: 'dday', label: 'D-day', width: 80, align: 'center' },
  { key: 'instrumenttype', label: '종류', width: 110 },
  { key: 'instrumentno', label: '증권번호', width: 160 },
  { key: 'instrumentamt', label: '금액', width: 130, align: 'right' },
  { key: 'issuercompany', label: '발행회사', width: 180 },
  { key: 'customname', label: '받은 거래처', width: 180 },
  { key: 'receiptdate', label: '수금일', width: 100 },
  { key: 'receiptno', label: '수금전표', width: 160 },
];
const CUSTOMER_PICKER_COLUMNS = [
  { key: 'customercode', label: '거래처코드', width: 130 },
  { key: 'customername', label: '거래처명', width: 260 },
  { key: 'ceoname', label: '대표자', width: 140 },
  { key: 'businessno', label: '사업자번호', width: 150 },
];
const BANK_PICKER_COLUMNS = [
  { key: 'code', label: '은행코드', width: 140 },
  { key: 'name', label: '은행명', width: 260 },
];
const HeldInstrumentPickerModal = memo(function HeldInstrumentPickerModal({ opened, onClose, excludedKeys, onApply }) {
  const heldColumns = useResizableColumns(HELD_COLUMNS);
  const [filters, setFilters] = useState({ maturity_from: '', maturity_to: '', customer: '', keyword: '', instrumenttype: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState({});
  const requestRef = useRef(0);

  const load = useCallback(async (nextPage, nextFilters) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value));
      const { data } = await axios.get('/api/receipt-payment/held-instruments', { ...authConfig(), params: { ...params, page: nextPage, page_size: HELD_PAGE_SIZE } });
      if (request !== requestRef.current) return;
      setRows(data.items || []); setTotal(data.total || 0); setPage(nextPage);
    } catch (error) {
      if (request === requestRef.current) notifications.show({ title: '보유증권 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);
  const resetAndLoad = useEffectEvent(() => {
    const empty = { maturity_from: '', maturity_to: '', customer: '', keyword: '', instrumenttype: '' };
    setFilters(empty); setSelected({}); setRows([]); setTotal(0);
    void load(1, empty);
  });
  useEffect(() => { if (opened) resetAndLoad(); }, [opened]);

  const visibleRows = rows.filter((row) => !excludedKeys.has(sourceKey(row.receiptno, row.lineno)));
  const selectedRows = Object.values(selected);
  const selectedAmount = selectedRows.reduce((sum, row) => sum + numeric(row.instrumentamt), 0);
  const toggle = (row) => setSelected((current) => {
    const key = sourceKey(row.receiptno, row.lineno);
    const next = { ...current };
    if (next[key]) delete next[key]; else next[key] = row;
    return next;
  });
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selected[sourceKey(row.receiptno, row.lineno)]);
  const toggleAllVisible = (checked) => setSelected((current) => {
    const next = { ...current };
    visibleRows.forEach((row) => { const key = sourceKey(row.receiptno, row.lineno); if (checked) next[key] = row; else delete next[key]; });
    return next;
  });
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const search = () => { void load(1, filters); };
  const close = () => { requestRef.current += 1; onClose(); };

  return <PickerModal opened={opened} onClose={close}
    title="보유증권 불러오기" description="보관 중인 수금 증권을 골라 지급 상세에 추가합니다." icon={<IconFileDollar size={22} stroke={1.7} />}
    filters={<div style={{ display: 'contents' }} onKeyDown={(event) => { if (event.key === 'Enter') search(); }}>
      <ErpDateInput label="만기일 시작" value={filters.maturity_from} onChange={(event) => updateFilter('maturity_from', event.currentTarget.value)} />
      <ErpDateInput label="만기일 끝" value={filters.maturity_to} onChange={(event) => updateFilter('maturity_to', event.currentTarget.value)} />
      <Select size="sm" label="종류" data={[{ value: '', label: '전체' }, ...INSTRUMENT_TYPE_OPTIONS]} value={filters.instrumenttype} onChange={(value) => updateFilter('instrumenttype', value || '')} />
      <TextInput size="sm" label="받은 거래처" value={filters.customer} onChange={(event) => updateFilter('customer', event.currentTarget.value)} />
      <TextInput size="sm" label="증권번호·발행회사" leftSection={<IconSearch size={14} />} value={filters.keyword} onChange={(event) => updateFilter('keyword', event.currentTarget.value)} />
      <Button size="sm" color="red" leftSection={<IconSearch size={15} />} onClick={search}>조회</Button>
    </div>}
    guide={<p>수금으로 받아 보관 중인 어음·수표·외상매출채권입니다. 선택하면 지급 상세에 추가되고, 저장하면 원래 증권은 '배서'로 바뀝니다.</p>}
    listTitle="보관 중인 증권" count={total} loading={loading}
    selectedCount={selectedRows.length} selectionLabel={`선택 · 합계 ${formatted(selectedAmount)}원`}
    pagination={<Pagination size="sm" color="red" total={Math.max(1, Math.ceil(total / HELD_PAGE_SIZE))} value={page} onChange={(nextPage) => void load(nextPage, filters)} siblings={1} disabled={loading} />}
    onApply={() => { onApply(selectedRows); onClose(); }} applyLabel="선택 적용">
    <table className={pickerClasses.table} style={{ width: `max(100%, ${heldColumns.tableWidth}px)` }} aria-label="보관 중인 증권">
      <colgroup>{HELD_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: heldColumns.widthOf(column) }} />)}</colgroup>
      <thead><tr>
        <th className={pickerClasses.center}><input className={pickerClasses.checkbox} type="checkbox" aria-label="전체 선택" checked={allVisibleSelected} disabled={!visibleRows.length} onChange={(event) => toggleAllVisible(event.currentTarget.checked)} /></th>
        {HELD_COLUMNS.slice(1).map((column) => <th key={column.key} className={`${pickerClasses.resizableHead} ${column.align ? pickerClasses[column.align] : ''}`}>{column.label}<ColumnResizeHandle column={column} columns={heldColumns} /></th>)}
      </tr></thead>
      <tbody>
        {visibleRows.map((row) => {
          const key = sourceKey(row.receiptno, row.lineno);
          const days = daysUntil(row.maturitydate);
          return <tr key={key} className={selected[key] ? pickerClasses.selectedRow : undefined} onClick={() => toggle(row)}>
            <td className={pickerClasses.center} onClick={(event) => event.stopPropagation()}><input className={pickerClasses.checkbox} type="checkbox" aria-label={`${row.instrumentno || key} 선택`} checked={Boolean(selected[key])} onChange={() => toggle(row)} /></td>
            <td>{dateOnly(row.maturitydate)}</td>
            <td className={pickerClasses.center}><span className={days !== null && days < 0 ? classes.heldOverdue : days !== null && days <= 7 ? classes.heldSoon : undefined}>{days === null ? '' : days < 0 ? `D+${-days}` : days === 0 ? 'D-Day' : `D-${days}`}</span></td>
            <td>{instrumentLabel('instrumenttype', row.instrumenttype)}</td>
            <td title={row.instrumentno || ''}>{row.instrumentno || ''}</td>
            <td className={pickerClasses.right}>{formatted(row.instrumentamt)}</td>
            <td title={row.issuercompany || ''}>{row.issuercompany || ''}</td>
            <td title={row.customname || ''}>{row.customname || ''}</td>
            <td>{dateOnly(row.receiptdate)}</td>
            <td>{row.receiptno}-{row.lineno}</td>
          </tr>;
        })}
        {!visibleRows.length && <tr><td colSpan={HELD_COLUMNS.length} className={pickerClasses.emptyCell}>
          <PickerEmpty title={loading ? '보유증권을 조회하고 있습니다' : '보관 중인 증권이 없습니다'} description={loading ? '' : '만기일이나 검색 조건을 바꿔 다시 조회해 주세요.'} />
        </td></tr>}
      </tbody>
    </table>
  </PickerModal>;
});

const ReceiptCustomerPickerModal = memo(function ReceiptCustomerPickerModal({ opened, onClose, onSelect }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (nextPage, nextSearch) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/list', {
        ...authConfig(),
        params: { search_keyword: nextSearch || undefined, status: 'Y', page: nextPage, page_size: 20, include_total: true },
      });
      if (request !== requestRef.current) return;
      setCustomers(data.data || []); setTotal(data.total || 0); setPage(nextPage); setSearch(nextSearch);
    } catch (error) {
      if (request === requestRef.current) notifications.show({ title: '거래처 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!opened) return;
    setSearchInput(''); setCustomers([]); setTotal(0);
    void load(1, '');
  }, [opened, load]);

  const runSearch = () => { void load(1, searchInput.trim()); };
  const select = (customer) => { onSelect(customer); onClose(); };
  const invalidatePending = () => { requestRef.current += 1; onClose(); };

  return <SelectPickerModal opened={opened} onClose={invalidatePending} size="lg"
    title="거래처 선택" description="수금·지급 전표에 넣을 거래처를 고릅니다." icon={<IconBuildingStore size={21} stroke={1.8} />}
    searchValue={searchInput} onSearchChange={setSearchInput} onSearch={runSearch} searchPlaceholder="거래처코드 또는 거래처명 검색"
    listTitle="거래처" columns={CUSTOMER_PICKER_COLUMNS} rows={customers} rowKey={(customer) => customer.customercode} onSelect={select}
    loading={loading} total={total} page={page} pageCount={Math.max(1, Math.ceil(total / 20))} onPageChange={(nextPage) => void load(nextPage, search)}
    emptyTitle="조회된 거래처가 없습니다" emptyDescription="거래처코드나 이름을 바꿔 다시 조회해 주세요." />;
});

const ReceiptBankPickerModal = memo(function ReceiptBankPickerModal({ opened, onClose, options, onSelect }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? options.filter((item) => `${item.code} ${item.name}`.toLocaleLowerCase().includes(query)) : options;
  }, [options, search]);
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const [prevOpened, setPrevOpened] = useState(opened);
  if (prevOpened !== opened) {
    setPrevOpened(opened);
    if (opened) { setSearch(''); setPage(1); }
  }

  return <SelectPickerModal opened={opened} onClose={onClose} size="sm"
    title="은행 선택" description="보관은행으로 넣을 은행을 고릅니다." icon={<IconBuildingBank size={21} stroke={1.8} />}
    searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder="은행코드 또는 은행명 검색"
    listTitle="은행" columns={BANK_PICKER_COLUMNS} rows={pageItems} rowKey={(item) => item.code} onSelect={(item) => { onSelect(item); onClose(); }}
    total={filtered.length} page={page} pageCount={Math.max(1, Math.ceil(filtered.length / pageSize))} onPageChange={setPage}
    emptyTitle="조회된 은행이 없습니다" />;
});

export default function ReceiptPayment() {
  const pageActivation = usePageActivation(); // 탭에 돌아올 때마다 목록(코드·거래처)을 다시 불러온다
  const ribbon = useContext(PageRibbonContext);
  const registerRibbon = ribbon?.registerPageRibbon;
  const closePage = ribbon?.closeActivePage;
  const [filterOpen, setFilterOpen] = useState(true);
  const filterInputsRef = useRef(null);
  if (filterInputsRef.current === null) filterInputsRef.current = makeFilters();
  const [filters, setFilters] = useState(makeFilters);
  const [documents, setDocuments] = useState([]);
  const [header, setHeader] = useState(emptyHeader);
  const [customers, setCustomers] = useState(() => peekMaster('customers:active') || []);
  const [bankOptions, setBankOptions] = useState(() => peekMaster('receipt-payment:bank-options') || []);
  const [items, setItems] = useState([]);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [detailPicker, setDetailPicker] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [summaryColumnWidths, setSummaryColumnWidths] = useState(() => SUMMARY_COLUMNS.map((column) => column.width));
  const [detailColumnWidths, setDetailColumnWidths] = useState(INSTRUMENT_COLUMN_WIDTHS);
  // 탭: 기본(CASH, 한 줄 입력폼) / 어음·수표(INSTRUMENT, items 표). 전표 하나는 둘 중 한 가지만 입력한다.
  const [activeTab, setActiveTab] = useState('CASH');
  const [cashForm, setCashForm] = useState(emptyCashForm);
  const [drafting, setDrafting] = useState(false); // 새 전표 입력 중
  const [editBase, setEditBase] = useState(''); // 저장된 기본 전표를 불러왔을 때의 값 (수정 여부 비교)
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const headerRef = useRef(header); // 어음번호 확인 때 지금 전표번호 (자기 전표는 중복에서 뺌)
  headerRef.current = header;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const selectedReceiptRef = useRef('');
  const detailRequest = useRef(0);
  const detailCache = useRef(new Map());
  const detailStamp = useRef(new Map());   // 전표번호 → 상세 조회 때 받은 수정시각 (updated_at ?? created_at)
  const detailLoadingRef = useRef(detailLoading);
  detailLoadingRef.current = detailLoading;
  const listRequest = useRef(0);
  const selectionAnchor = useRef(null);
  const processableIdsRef = useRef(null); // saved document: only these rows can be selected
  const listTableRef = useRef(null);
  const listSubtotalRef = useRef(null);
  const listHorizontalScrollRef = useRef(null);
  const detailTableWrapRef = useRef(null);
  const pendingDetailFocus = useRef(null);
  const updateHeaderField = useCallback((field, value) => {
    setHeader((current) => ({ ...current, [field]: value }));
  }, []);
  const summaryTableWidth = summaryColumnWidths.reduce((sum, width) => sum + width, 0);
  const isSavedDocument = Boolean(header.receiptno);
  // 저장된 전표에서만 처리 결과 칸(처리일 · 할인료 · 처리메모)을 보인다
  const showSourceColumn = header.transactiontype === 'PAYMENT';
  const visibleDetailColumns = INSTRUMENT_COLUMN_SPECS.map((_, index) => index).filter((index) => {
    const column = INSTRUMENT_COLUMN_SPECS[index];
    return (!column.saved || isSavedDocument) && (!column.receipt || header.transactiontype === 'RECEIPT') && (!column.payment || showSourceColumn);
  });
  const visibleDetailWidths = visibleDetailColumns.map((index) => detailColumnWidths[index]);
  const visibleDetailLabels = visibleDetailColumns.map((index) => INSTRUMENT_HEADER_LABELS[index]);
  const detailTableWidth = visibleDetailWidths.reduce((sum, width) => sum + width, 0);
  const cashHasInput = cashFormHasInput(cashForm);
  const instrumentCount = items.filter(instrumentRowHasInput).length;
  // 한 가지만 입력: 기본에 입력했으면 어음/수표를, 어음/수표에 입력했으면 기본을 잠근다
  const cashLocked = instrumentCount > 0;
  const instrumentLocked = cashHasInput;
  // 신규 전표는 추가 직후 저장 버튼을 활성화하고, 저장된 전표는 읽기 전용으로 표시한다.
  // 저장된 전표 중 기본(현금 등)만 있는 전표는 수정 가능. 어음/수표 전표는 처리 이력 · 배서 연결 때문에 읽기 전용.
  const cashEditable = isSavedDocument && !detailLoading && instrumentCount === 0 && Boolean(editBase);
  const readOnlyDocument = isSavedDocument && !cashEditable;
  const editDirty = cashEditable && cashEditKey(header, cashForm) !== editBase;
  const canSave = Boolean((!isSavedDocument && drafting) || editDirty);
  // 탭 닫기 · 브라우저 닫기 전에 확인: 새 전표에 입력한 내용이 있거나 저장된 전표를 고쳤을 때
  useUnsavedChanges((!isSavedDocument && drafting && (cashHasInput || instrumentCount > 0)) || editDirty);
  const requestKey = useRequestKey(!isSavedDocument && drafting && (cashHasInput || instrumentCount > 0));   // 새 전표 중복 저장 막기
  const canExport = header.receiptno ? (items.length > 0 || cashHasInput) : documents.length > 0;

  // visibleIndexes: 일부 칸을 숨긴 표(상세)에서 화면에 보이는 칸의 원래 번호 (DOM 칸 위치 · 표 너비 계산용)
  const startColumnResize = useCallback((event, index, startWidth, widths, setWidths, scope, visibleIndexes = null) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const priorUserSelect = document.body.style.userSelect;
    const priorCursor = document.body.style.cursor;
    const handle = event.currentTarget;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    handle.classList.add(classes.columnResizeHandleActive);
    const nextWidths = [...widths];
    const getTables = () => scope === 'summary'
      ? [listTableRef.current?.querySelector('table'), listSubtotalRef.current?.querySelector('table')].filter(Boolean)
      : [detailTableWrapRef.current?.querySelector('table')].filter(Boolean);
    const handleMove = (moveEvent) => {
      const nextWidth = Math.max(54, startWidth + moveEvent.clientX - startX);
      nextWidths[index] = nextWidth;
      const totalWidth = (visibleIndexes ? visibleIndexes.map((visible) => nextWidths[visible]) : nextWidths).reduce((sum, width) => sum + width, 0);
      const domIndex = visibleIndexes ? visibleIndexes.indexOf(index) : index;
      getTables().forEach((table) => {
        const column = table.querySelectorAll('colgroup col')[domIndex];
        if (column) column.style.width = `${nextWidth}px`;
        table.style.setProperty('--code-table-min-width', `${totalWidth}px`);
        if (scope === 'summary' && table === listSubtotalRef.current?.querySelector('table')) {
          table.style.width = `${totalWidth}px`;
          table.style.minWidth = `${totalWidth}px`;
        }
      });
      if (scope === 'summary' && listHorizontalScrollRef.current?.firstElementChild) {
        listHorizontalScrollRef.current.firstElementChild.style.width = `${totalWidth}px`;
      }
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.style.userSelect = priorUserSelect;
      document.body.style.cursor = priorCursor;
      handle.classList.remove(classes.columnResizeHandleActive);
      setWidths(nextWidths);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, []);

  const baseCustomerOptions = useMemo(() => customers
    .map((customer) => ({ value: customer.customercode, label: customer.customername }))
    .filter((option) => option.value && option.label), [customers]);
  // Keep the same array unless the current customer is missing: a new array makes the Select redraw every option (hundreds of customers).
  const customerOptions = useMemo(() => (
    header.customcode && !baseCustomerOptions.some((option) => option.value === header.customcode)
      ? [{ value: header.customcode, label: header.customname || header.customcode }, ...baseCustomerOptions]
      : baseCustomerOptions
  ), [baseCustomerOptions, header.customcode, header.customname]);

  // 거래처 · 은행 목록: 지난번 값(메모리 캐시, 매입·매출등록과 같은 거래처 목록)으로 바로 채우고 서버 값으로 곧바로 바꾼다
  useEffect(() => {
    let cancelled = false;
    void loadMaster('customers:active', () => fetchAllPages(async (pageNumber) => {
      const { data } = await axios.get('/api/list', {
        ...authConfig(), params: { status: 'Y', page: pageNumber, page_size: 200, include_total: true },
      });
      return { items: data.data || [], total: data.total || 0 };
    }, 200)).then((list) => { if (!cancelled) setCustomers(list); }).catch((error) => {
      if (!cancelled) notifications.show({ title: '거래처 조회 실패', message: errorText(error), color: 'red' });
    });
    return () => { cancelled = true; };
  }, [pageActivation]);

  useEffect(() => {
    let cancelled = false;
    void loadMaster('receipt-payment:bank-options', async () => {
      const items = await fetchAllPages(async (pageNumber) => {
        const { data } = await axios.get('/api/code-master/groups/BANK/items', {
          ...authConfig(), params: { page: pageNumber, page_size: 200, include_total: true },
        });
        return { items: data.items || [], total: data.total || 0 };
      }, 200);
      return [...new Map(items.filter((item) => item.use)
        .map((item) => ({ value: String(item.name || '').trim(), label: String(item.name || '').trim(), code: String(item.code || '').trim(), name: String(item.name || '').trim() }))
        .filter((item) => item.name)
        .map((item) => [item.code || item.name, item])).values()];
    }).then((options) => { if (!cancelled) setBankOptions(options); }).catch(() => { if (!cancelled && !peekMaster('receipt-payment:bank-options')) setBankOptions([]); });
    return () => { cancelled = true; };
  }, [pageActivation]);

  // focusReceiptno: 저장 직후 그 전표가 있는 쪽으로 이동 (서버가 쪽 번호를 정해 돌려준다)
  const loadDocuments = useCallback(async (nextPage = 1, query = filters, size = pageSize, focusReceiptno = '') => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/receipt-payment/documents', {
        ...authConfig(),
        params: {
          page: nextPage, page_size: size,
          date_from: query.date_from || undefined, date_to: query.date_to || undefined,
          transactiontype: query.transactiontype || undefined, customer: query.customer || undefined,
          receiptno: query.receiptno || undefined, focus_receiptno: focusReceiptno || undefined,
        },
      });
      if (request !== listRequest.current) return;
      setDocuments(data.documents || []);
      setTotalRows(data.total || 0);
      setPage(data.page || nextPage);
    } catch (error) {
      if (request === listRequest.current) notifications.show({ title: '수금/지급 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [filters, pageSize]);

  const loadInitialDocuments = useEffectEvent(() => { void loadDocuments(1, filters, pageSize); });
  useEffect(() => { loadInitialDocuments(); }, []);

  const applyLoadedItems = useCallback((loaded) => {
    const instrumentRows = loaded.filter(isInstrumentRow);
    setItems(instrumentRows);
    setCashForm(cashFormOf(loaded.filter((row) => !isInstrumentRow(row))));
    setActiveTab(instrumentRows.length ? 'INSTRUMENT' : 'CASH');
    setDrafting(false);
  }, []);
  const openDocument = useCallback(async (receiptno) => {
    const cachedItems = detailCache.current.get(receiptno);
    if (selectedReceiptRef.current === receiptno) {
      if (cachedItems) return;
      if (detailLoadingRef.current) return;
    }
    selectedReceiptRef.current = receiptno;
    const request = ++detailRequest.current;
    const summary = documentsRef.current.find((doc) => doc.receiptno === receiptno);
    if (summary) {
      setHeader({
        receiptno: summary.receiptno, receiptdate: dateOnly(summary.receiptdate),
        transactiontype: summary.transactiontype, customcode: summary.customcode || '',
        customname: summary.customname || '', manager: summary.manager || '', description: summary.description || '',
        // 수정 저장 때 서버에 보내는 '열 때의 수정시각' (상세 조회 응답 그대로 · 아래 상세 조회가 다시 채운다)
        expected_updated_at: cachedItems ? detailStamp.current.get(receiptno) : undefined,
      });
    }
    setSelectedRows([]);
    selectionAnchor.current = null;
    setEditBase('');
    if (cachedItems) {
      applyLoadedItems(cachedItems);
      if (summary && !cachedItems.some(isInstrumentRow)) {
        setEditBase(cashEditKey({
          receiptno: summary.receiptno, receiptdate: dateOnly(summary.receiptdate), transactiontype: summary.transactiontype,
          customcode: summary.customcode || '', manager: summary.manager || '', description: summary.description || '',
        }, cashFormOf(cachedItems)));
      }
      detailLoadingRef.current = false;
      setDetailLoading(false);
      return;
    }
    setItems([]);
    setCashForm(emptyCashForm());
    setDrafting(false);
    detailLoadingRef.current = true;
    setDetailLoading(true);
    try {
      const { data } = await axios.get(`/api/receipt-payment/documents/${encodeURIComponent(receiptno)}`, authConfig());
      if (request !== detailRequest.current) return;
      const doc = data.document;
      const stamp = doc.updated_at ?? doc.created_at ?? undefined;
      detailStamp.current.set(receiptno, stamp);
      setHeader({
        receiptno: doc.receiptno, receiptdate: dateOnly(doc.receiptdate),
        transactiontype: doc.transactiontype, customcode: doc.customcode,
        customname: doc.customname, manager: doc.manager || '', description: doc.description || '',
        expected_updated_at: stamp,
      });
      const nextItems = (doc.items || []).map((item) => makeDetail(item));
      detailCache.current.set(receiptno, nextItems);
      applyLoadedItems(nextItems);
      setEditBase(nextItems.some(isInstrumentRow) ? '' : cashEditKey({
        receiptno: doc.receiptno, receiptdate: dateOnly(doc.receiptdate), transactiontype: doc.transactiontype,
        customcode: doc.customcode, manager: doc.manager || '', description: doc.description || '',
      }, cashFormOf(nextItems)));
    } catch (error) {
      if (request === detailRequest.current) notifications.show({ title: '상세 조회 실패', message: errorText(error), color: 'red' });
    } finally {
      if (request === detailRequest.current) {
        detailLoadingRef.current = false;
        setDetailLoading(false);
      }
    }
  }, [applyLoadedItems]);

  // 조회조건 칸에서 입력 중인 값 (다시 그리지 않고 기억만): 엔터와 최상단 [조회]가 같은 조건을 쓴다
  const rememberFilterDraft = useCallback((draft) => { filterInputsRef.current = draft; }, []);
  const runSearch = useCallback((inputValues = filterInputsRef.current) => {
    const next = { ...inputValues };
    filterInputsRef.current = next;
    setFilters(next);
    void loadDocuments(1, next, pageSize);
  }, [loadDocuments, pageSize]);
  const closeFilter = useCallback(() => setFilterOpen(false), []);

  const startNew = useCallback(() => {
    selectedReceiptRef.current = '';
    detailRequest.current += 1;
    setEditBase('');
    setHeader(emptyHeader());
    setItems([makeDetail()]);
    setCashForm(emptyCashForm());
    setActiveTab('CASH');
    setDrafting(true);
    setSelectedRows([]);
    selectionAnchor.current = null;
  }, []);
  const updateCashForm = useCallback((key, value) => setCashForm((current) => ({ ...current, [key]: value })), []);

  const selectDocument = useCallback((receiptno) => { void openDocument(receiptno); }, [openDocument]);

  const chooseCustomer = useCallback((customer) => {
    setHeader((current) => ({ ...current, customname: customer.customername || '', customcode: customer.customercode || '' }));
  }, []);
  const pickHeaderCustomer = useCallback((value) => {
    const customer = customers.find((item) => item.customercode === value);
    chooseCustomer(customer || {
      customercode: value || '',
      customername: customerOptions.find((option) => option.value === value)?.label || '',
    });
  }, [customers, customerOptions, chooseCustomer]);

  // 같은 구분(수금/지급)의 다른 전표에 이미 있는지 서버에 확인 (입력하자마자 알림, 저장은 서버가 다시 막는다)
  const checkInstrumentOnServer = useCallback((row) => {
    void axios.get('/api/receipt-payment/instrument-numbers', { ...authConfig(), params: {
      no: String(row.instrumentno).trim(), issuer: String(row.issuercompany || '').trim(),
      transactiontype: headerRef.current.transactiontype || 'RECEIPT', exclude_receiptno: headerRef.current.receiptno || undefined,
    } })
      .then(({ data }) => {
        const found = data.items?.[0];
        if (!found) return;
        notifications.show({
          id: 'receipt-payment-instrumentno', title: '이미 등록된 어음', color: 'orange',
          message: `어음번호 ${found.instrumentno} · 발행회사 ${found.issuercompany || '(없음)'} 어음은 이미 ${found.receiptno}(${found.transactiontype === 'PAYMENT' ? '지급' : '수금'} · ${found.customname || ''}) 전표에 있습니다. 저장할 수 없습니다.`,
        });
      })
      .catch(() => {});
  }, []);

  // 발행구분은 입력한 그대로 둔다 (자동으로 채우지 않음, 빈값이면 빈값으로 저장)
  const updateDetail = useCallback((id, key, value) => {
    if (key === 'instrumentno' || key === 'issuercompany') {
      const rows = itemsRef.current;
      const index = rows.findIndex((row) => row.id === id);
      const next = index >= 0 ? { ...rows[index], [key]: value } : null;
      const nextKey = next ? instrumentKey(next) : '';
      if (nextKey) {
        const sameIndex = rows.findIndex((row, rowIndex) => rowIndex !== index && !row.source_receiptno && instrumentKey(row) === nextKey);
        if (sameIndex >= 0) {
          notifications.show({ id: 'receipt-payment-instrumentno', title: '같은 어음 중복', message: `${sameIndex + 1}행에 어음번호 · 발행회사가 같은 어음(${next.instrumentno} · ${next.issuercompany || '발행회사 없음'})이 있습니다.`, color: 'orange' });
        } else checkInstrumentOnServer(next);
      }
    }
    if (key === 'issuedate' || key === 'maturitydate') {
      const index = itemsRef.current.findIndex((row) => row.id === id);
      if (index >= 0 && maturityBeforeIssue({ ...itemsRef.current[index], [key]: value })) notifyMaturityBeforeIssue(index + 1);
    }
    setItems((rows) => rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }, [checkInstrumentOnServer]);
  const changeTransactionType = useCallback((value) => {
    setHeader((current) => ({ ...current, transactiontype: value || 'RECEIPT' }));
  }, []);
  const openDetailPicker = useCallback((rowId, field) => setDetailPicker({ rowId, field }), []);
  const selectDetailBank = useCallback((bank) => {
    if (detailPicker?.rowId) updateDetail(detailPicker.rowId, 'custodybank', bank.name || '');
  }, [detailPicker, updateDetail]);
  const toggleRow = useCallback((id, shiftKey) => {
    setSelectedRows((previous) => {
      const next = new Set(previous);
      const currentItems = itemsRef.current;
      const anchorIndex = currentItems.findIndex((row) => row.id === selectionAnchor.current);
      const currentIndex = currentItems.findIndex((row) => row.id === id);
      if (shiftKey && anchorIndex >= 0 && currentIndex >= 0) {
        currentItems.slice(Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex) + 1)
          .filter((row) => !processableIdsRef.current || processableIdsRef.current.has(row.id))
          .forEach((row) => next.add(row.id));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      selectionAnchor.current = id;
      return [...next];
    });
  }, []);

  const [heldPickerOpen, setHeldPickerOpen] = useState(false);
  // 결제·할인·부도·처리취소 (저장된 전표)
  const [processRequest, setProcessRequest] = useState(null);
  const processableIds = useMemo(() => (isSavedDocument
    ? new Set(items.filter((row) => isProcessable(row, header.transactiontype)).map((row) => row.id))
    : null), [isSavedDocument, items, header.transactiontype]);
  processableIdsRef.current = processableIds;
  const selectedItems = useMemo(() => {
    const selected = new Set(selectedRows);
    return items.filter((row) => selected.has(row.id));
  }, [items, selectedRows]);
  const openProcess = useCallback((action) => {
    const rows = selectedItems.filter((row) => canProcess(row, header.transactiontype, action));
    if (!rows.length || rows.length !== selectedItems.length) {
      notifications.show({ title: `${PROCESS_ACTION_INFO[action].label}할 수 없습니다`, message: `선택한 행 중 ${PROCESS_ACTION_INFO[action].label}할 수 없는 행이 있습니다. 상태를 확인해 주세요.`, color: 'orange' });
      return;
    }
    setProcessRequest({ action, receiptno: header.receiptno, rows });
  }, [selectedItems, header.transactiontype, header.receiptno]);
  const finishProcess = useCallback((receiptno) => {
    setProcessRequest(null);
    detailCache.current.clear();
    if (selectedReceiptRef.current === receiptno) void openDocument(receiptno); // reload the detail with the new state
  }, [openDocument]);
  const usedSourceKeys = useMemo(() => new Set(items.filter((row) => row.source_receiptno)
    .map((row) => sourceKey(row.source_receiptno, row.source_lineno))), [items]);
  const hasHeldRows = usedSourceKeys.size > 0;
  const applyHeldInstruments = useCallback((selectedInstruments) => {
    const added = selectedInstruments.map((source) => makeDetail({
      instrumentamt: String(numeric(source.instrumentamt)), instrumenttype: source.instrumenttype || '', instrumentno: source.instrumentno || '',
      issuedate: source.issuedate, issuercompany: source.issuercompany || '', issuer: source.issuer || '',
      issuekind: 'OTHER', maturitydate: source.maturitydate, custodyaccount: source.custodyaccount || '',
      custodybank: source.custodybank || '', instrumentstatus: 'ENDORSED',
      source_receiptno: source.receiptno, source_lineno: source.lineno,
    }));
    // 새 전표의 빈 첫 행은 불러온 증권으로 대체
    setItems((rows) => [...rows.filter(instrumentRowHasInput), ...added]);
    setActiveTab('INSTRUMENT');
    setSelectedRows([]);
    notifications.show({ title: '보유증권 추가', message: `${added.length}장 · ${formatted(added.reduce((sum, row) => sum + numeric(row.instrumentamt), 0))}원을 지급 상세에 추가했습니다. 저장하면 원래 증권이 '배서'로 바뀝니다.`, color: 'teal' });
  }, []);

  const addDetail = useCallback((focusField = null) => {
    const newRow = makeDetail();
    if (focusField) pendingDetailFocus.current = { rowId: newRow.id, field: focusField };
    setItems((rows) => [...rows, newRow]);
    setSelectedRows([]);
  }, []);
  useEffect(() => {
    const pendingFocus = pendingDetailFocus.current;
    if (!pendingFocus || !items.some((row) => row.id === pendingFocus.rowId)) return undefined;
    pendingDetailFocus.current = null;
    const frame = requestAnimationFrame(() => {
      const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
      const firstCell = Array.from(cells || []).find((cell) =>
        cell.dataset.detailRow === pendingFocus.rowId && cell.dataset.detailField === pendingFocus.field
      );
      firstCell?.querySelector('input, textarea, select')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);
  const handleDetailTableKeyDown = useCallback((event) => {
    const input = event.target instanceof HTMLElement ? event.target.closest('input, textarea, select') : null;
    const cell = input?.closest('[data-detail-row][data-detail-field]');
    if (!input || !cell || saving || isSavedDocument) return;

    // While an autocomplete (보관은행) shows suggestions, ↑/↓/Enter belong to that list:
    // moving to another row here would blur the input and close the list before a choice is made.
    const suggestionList = input.dataset.expanded !== undefined && input.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null;
    if (suggestionList?.querySelector('[role="option"]') && ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      const currentRowIndex = items.findIndex((row) => row.id === cell.dataset.detailRow);
      const nextRow = items[currentRowIndex + 1];
      if (nextRow) {
        const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
        const nextCell = Array.from(cells || []).find((candidate) =>
          candidate.dataset.detailRow === nextRow.id && candidate.dataset.detailField === cell.dataset.detailField
        );
        nextCell?.querySelector('input, textarea, select')?.focus();
      } else if (!event.shiftKey && !event.nativeEvent.isComposing && !instrumentLocked) {
        // 마지막 행에서 Enter: 새 행을 이어 붙이고 같은 칸으로 간다 (매입등록과 같음)
        addDetail(cell.dataset.detailField);
      }
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const currentRowIndex = items.findIndex((row) => row.id === cell.dataset.detailRow);
      const nextRow = items[currentRowIndex + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!nextRow) return;
      const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
      const nextCell = Array.from(cells || []).find((candidate) =>
        candidate.dataset.detailRow === nextRow.id && candidate.dataset.detailField === cell.dataset.detailField
      );
      const nextInput = nextCell?.querySelector('input, textarea, select');
      if (!nextInput || nextInput.disabled) return;
      event.preventDefault();
      nextInput.focus();
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (input instanceof HTMLInputElement && input.type === 'date') return;
    let start;
    let end;
    try {
      start = input.selectionStart;
      end = input.selectionEnd;
    } catch {
      return;
    }
    if (typeof start !== 'number' || typeof end !== 'number' || start !== end) return;
    const valueLength = input.value?.length ?? 0;
    const movingLeft = event.key === 'ArrowLeft';
    if ((movingLeft && start !== 0) || (!movingLeft && end !== valueLength)) return;

    const fieldIndex = DETAIL_NAVIGATION_FIELDS.indexOf(cell.dataset.detailField);
    const nextField = DETAIL_NAVIGATION_FIELDS[fieldIndex + (movingLeft ? -1 : 1)];
    if (!nextField) return;
    const cells = detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]');
    const nextCell = Array.from(cells || []).find((candidate) =>
      candidate.dataset.detailRow === cell.dataset.detailRow && candidate.dataset.detailField === nextField
    );
    const nextInput = nextCell?.querySelector('input, textarea, select');
    if (!nextInput || nextInput.disabled) return;
    event.preventDefault();
    nextInput.focus();
    try {
      const caret = movingLeft ? (nextInput.value?.length ?? 0) : 0;
      nextInput.setSelectionRange(caret, caret);
    } catch {
      // Date and numeric inputs may not expose a text selection range.
    }
  }, [isSavedDocument, items, saving, instrumentLocked, addDetail]);
  // ── 어음/수표 표: 셀 범위 선택 · 붙여넣기 · 채우기 · 행 삽입 (매입등록과 같은 방식) ──
  // 범위: Shift+방향키 / Shift+클릭. 포커스는 시작 칸에 두고 범위만 칠한다 (다시 그리지 않고 DOM 클래스로).
  const activeDetailCellRef = useRef(null);
  const detailRangeRef = useRef(null);
  const paintedDetailCellsRef = useRef(new Set());
  const detailBounds = useCallback(() => {
    const range = detailRangeRef.current;
    if (!range) return null;
    const rows = itemsRef.current;
    const anchorIndex = rows.findIndex((row) => row.id === range.anchorId);
    const focusIndex = rows.findIndex((row) => row.id === range.focusId);
    if (anchorIndex < 0 || focusIndex < 0) return null;
    return {
      top: Math.min(anchorIndex, focusIndex), bottom: Math.max(anchorIndex, focusIndex),
      left: Math.min(range.anchorColumn, range.focusColumn), right: Math.max(range.anchorColumn, range.focusColumn),
    };
  }, []);
  const isMultiDetailRange = useCallback((bounds = detailBounds()) => Boolean(bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right)), [detailBounds]);
  const paintDetailRange = useCallback(() => {
    paintedDetailCellsRef.current.forEach((cell) => cell.classList.remove(inboundClasses.rangeCell));
    paintedDetailCellsRef.current.clear();
    const bounds = detailBounds();
    if (!isMultiDetailRange(bounds)) return;
    const rowIds = new Set(itemsRef.current.slice(bounds.top, bounds.bottom + 1).map((row) => row.id));
    detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]').forEach((cell) => {
      const column = DETAIL_FIELD_INDEX[cell.dataset.detailField];
      if (rowIds.has(cell.dataset.detailRow) && column >= bounds.left && column <= bounds.right) {
        cell.classList.add(inboundClasses.rangeCell);
        paintedDetailCellsRef.current.add(cell);
      }
    });
  }, [detailBounds, isMultiDetailRange]);
  const clearDetailRange = useCallback(() => {
    if (!detailRangeRef.current && !paintedDetailCellsRef.current.size) return;
    detailRangeRef.current = null;
    paintDetailRange();
  }, [paintDetailRange]);
  useEffect(() => { if (detailRangeRef.current) paintDetailRange(); }, [items, activeTab, paintDetailRange]);
  const detailEditable = !saving && !isSavedDocument && !instrumentLocked;

  const focusDetailCell = useCallback((rowId, field) => {
    requestAnimationFrame(() => {
      const cell = [...(detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]') || [])]
        .find((candidate) => candidate.dataset.detailRow === rowId && candidate.dataset.detailField === field);
      const input = cell?.querySelector('input, textarea, select');
      if (input && !input.disabled) input.focus();
    });
  }, []);
  // 칸(글자 · 보관은행)은 벗어날 때 값을 확정한다 → 여러 칸을 바꾸기 전에 지금 칸을 먼저 확정해 둔다 (그 값을 기준으로 바꿈)
  const commitFocusedDetail = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && detailTableWrapRef.current?.contains(active)) flushSync(() => active.blur());
  }, []);
  // 여러 칸을 바꾼 뒤: 직접 입력과 같은 확인 (같은 어음 중복 · 다른 전표에 있는 어음 · 만기일이 발행일보다 앞)
  const applyDetailRows = useCallback((next, changedIds, identityIds = new Set()) => {
    itemsRef.current = next;
    setItems(next);
    const duplicate = duplicateInstrumentRows(next);
    if (duplicate) {
      notifications.show({ id: 'receipt-payment-instrumentno', title: '같은 어음 중복', message: `${duplicate[0]}행과 ${duplicate[1]}행에 어음번호 · 발행회사가 같은 어음(${duplicate[2]} · ${duplicate[3] || '발행회사 없음'})이 있습니다.`, color: 'orange' });
    } else {
      next.filter((row) => identityIds.has(row.id) && !row.source_receiptno && instrumentKey(row)).slice(0, 20).forEach(checkInstrumentOnServer);
    }
    const badMaturity = next.findIndex((row) => changedIds.has(row.id) && maturityBeforeIssue(row));
    if (badMaturity >= 0) notifyMaturityBeforeIssue(badMaturity + 1);
  }, [checkInstrumentOnServer]);

  // 붙여넣기: 시작 칸부터 오른쪽 · 아래로. 모자란 행은 새로 만든다 (전표 최대 1,000행).
  const pasteIntoDetail = useCallback((startRow, startColumn, matrix) => {
    if (startRow + matrix.length > 1000) {
      notifications.show({ title: '붙여넣기 제한', message: '전표 하나에는 최대 1,000행까지 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    commitFocusedDetail();
    const next = [...itemsRef.current];
    const changedIds = new Set();
    const identityIds = new Set();
    let invalidAmounts = 0;
    const unresolved = [];
    matrix.forEach((line, rowOffset) => {
      const index = startRow + rowOffset;
      const row = { ...(next[index] || makeDetail()) };
      line.forEach((text, columnOffset) => {
        const field = DETAIL_NAVIGATION_FIELDS[startColumn + columnOffset];
        if (!field || !detailWritable(row, field)) return;
        const result = normalizeDetailValue(field, text);
        if (result.invalid === 'amount') { invalidAmounts += 1; return; }   // 금액: 예전처럼 그 칸은 그대로 둔다
        if (result.invalid) { unresolved.push(`${index + 1}행 ${DETAIL_FIELD_SPEC[field].label}: ${result.raw}`); row[field] = ''; return; }
        row[field] = result.value;
        if (field === 'instrumentno' || field === 'issuercompany') identityIds.add(row.id);
      });
      next[index] = row;
      changedIds.add(row.id);
    });
    applyDetailRows(next, changedIds, identityIds);
    setSelectedRows([]);
    if (invalidAmounts) notifications.show({ title: '숫자 입력 확인', message: '금액 칸에 숫자가 아니거나 소수점 셋째 자리 이상인 값은 붙여넣지 않았습니다.', color: 'red' });
    if (unresolved.length) notifications.show({
      title: '값 확인 필요', color: 'orange', autoClose: 8000,
      message: `${unresolved.slice(0, 5).join(' · ')}${unresolved.length > 5 ? ` 외 ${unresolved.length - 5}건` : ''}. 목록에 있는 종류·상태와 올바른 날짜(YYYY-MM-DD)만 들어가 해당 칸은 비워 두었습니다.`,
    });
  }, [commitFocusedDetail, applyDetailRows]);

  const clearDetailRangeCells = useCallback(() => {
    const bounds = detailBounds();
    if (!bounds) return;
    commitFocusedDetail();
    const fields = DETAIL_NAVIGATION_FIELDS.slice(bounds.left, bounds.right + 1);
    const changedIds = new Set();
    const next = itemsRef.current.map((row, index) => {
      if (index < bounds.top || index > bounds.bottom) return row;
      const target = { ...row };
      fields.forEach((field) => { if (detailWritable(target, field)) target[field] = ''; });
      changedIds.add(row.id);
      return target;
    });
    applyDetailRows(next, changedIds);
  }, [detailBounds, commitFocusedDetail, applyDetailRows]);

  // Ctrl+D: 범위가 여러 행이면 맨 윗행 값을 아래로 · 체크한 행이 있으면 현재 칸 값을 그 아래 체크한 행들에 · 아니면 바로 윗행 값을 현재 칸에
  const fillDetailDown = useCallback(() => {
    const active = activeDetailCellRef.current;
    if (!active) return;
    commitFocusedDetail();
    const rows = itemsRef.current;
    const activeIndex = rows.findIndex((row) => row.id === active.rowId);
    if (activeIndex < 0) return;
    const bounds = detailBounds();
    const rangeFields = bounds ? DETAIL_NAVIGATION_FIELDS.slice(bounds.left, bounds.right + 1) : [active.field];
    const selected = new Set(selectedRows);
    let source; let targets; let mode;
    if (bounds && bounds.bottom > bounds.top) {
      mode = 'range'; source = rows[bounds.top]; targets = rows.slice(bounds.top + 1, bounds.bottom + 1);
    } else if (selected.size) {
      mode = 'selected'; source = rows[activeIndex]; targets = rows.filter((row, index) => index > activeIndex && selected.has(row.id));
    } else {
      mode = 'above'; source = rows[activeIndex - 1]; targets = [rows[activeIndex]];
    }
    if (!source || !targets.length) return;
    const targetIds = new Set(targets.map((row) => row.id));
    const identityIds = new Set();
    const next = rows.map((row) => {
      if (!targetIds.has(row.id)) return row;
      const target = { ...row };
      rangeFields.forEach((field) => {
        if (!detailWritable(target, field)) return;
        target[field] = source[field] ?? '';
        if (field === 'instrumentno' || field === 'issuercompany') identityIds.add(row.id);
      });
      return target;
    });
    applyDetailRows(next, targetIds, identityIds);
    focusDetailCell(active.rowId, active.field);
    if (mode !== 'above') notifications.show({ title: '아래로 채우기 완료', message: `${targets.length.toLocaleString()}개 행에 ${mode === 'range' ? '범위 맨 윗행' : '현재 칸'}의 값을 복사했습니다.`, color: 'teal' });
  }, [commitFocusedDetail, detailBounds, selectedRows, applyDetailRows, focusDetailCell]);

  // Ctrl+Enter: 아래에 빈 행 · Ctrl+Shift+Enter: 현재 행 복제 (복사 버튼과 같음 — 보유증권 행은 같은 증권을 두 번 쓸 수 없어 복제 불가)
  const insertDetailBelow = useCallback((rowId, field, duplicate) => {
    commitFocusedDetail();
    const rows = itemsRef.current;
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    if (duplicate && rows[index].source_receiptno) {
      notifications.show({ title: '복사할 수 없는 행', message: '보유증권 행은 같은 증권을 두 번 쓸 수 없어 복사할 수 없습니다.', color: 'orange' });
      return;
    }
    const newRow = duplicate ? makeDetail({ ...rows[index], id: undefined }) : makeDetail();
    const next = [...rows];
    next.splice(index + 1, 0, newRow);
    pendingDetailFocus.current = { rowId: newRow.id, field };
    applyDetailRows(next, new Set([newRow.id]));
    setSelectedRows([]);
  }, [commitFocusedDetail, applyDetailRows]);

  const handleDetailFocusCapture = useCallback((event) => {
    const cell = detailCellOf(event.target);
    if (!cell) return;
    const previous = activeDetailCellRef.current;
    activeDetailCellRef.current = { rowId: cell.rowId, field: cell.field };
    if (previous?.rowId !== cell.rowId || previous?.field !== cell.field) clearDetailRange();
  }, [clearDetailRange]);

  const handleDetailKeyDownCapture = useCallback((event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const { key } = event;
    if (ctrl && !event.altKey && key.toLowerCase() === 'd') event.preventDefault();   // 저장된 전표에서도 브라우저 즐겨찾기로 넘기지 않는다
    if (!detailEditable || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const cell = detailCellOf(event.target);
    const active = activeDetailCellRef.current;
    if (!cell || !active) return;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    const arrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
    if (event.shiftKey && !ctrl && arrow) {
      const target = event.target;
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && !isMultiDetailRange() && target instanceof HTMLInputElement && !target.readOnly) {
        try {
          const { selectionStart: start, selectionEnd: end, value } = target;
          const allSelected = start === 0 && end === value.length;
          if (start !== null && !allSelected && (key === 'ArrowLeft' ? start !== 0 : end !== value.length)) return;
        } catch { /* 글자 선택 위치가 없는 칸 → 범위 확장 */ }
      }
      const rows = itemsRef.current;
      const range = detailRangeRef.current || { anchorId: active.rowId, anchorColumn: DETAIL_FIELD_INDEX[active.field], focusId: active.rowId, focusColumn: DETAIL_FIELD_INDEX[active.field] };
      const focusIndex = rows.findIndex((row) => row.id === range.focusId);
      if (focusIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(rows.length - 1, focusIndex + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
      const nextColumn = Math.max(0, Math.min(DETAIL_NAVIGATION_FIELDS.length - 1, range.focusColumn + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)));
      stop();
      detailRangeRef.current = { ...range, focusId: rows[nextIndex].id, focusColumn: nextColumn };
      paintDetailRange();
      [...(detailTableWrapRef.current?.querySelectorAll('[data-detail-row][data-detail-field]') || [])]
        .find((candidate) => candidate.dataset.detailRow === rows[nextIndex].id && candidate.dataset.detailField === DETAIL_NAVIGATION_FIELDS[nextColumn])
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (ctrl && !event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      const rows = itemsRef.current;
      if (!rows.length) return;
      stop();
      focusDetailCell(rows[key === 'ArrowUp' ? 0 : rows.length - 1].id, active.field);
      return;
    }
    if (ctrl && key.toLowerCase() === 'd') { stop(); fillDetailDown(); return; }
    if (ctrl && key === 'Enter') { stop(); insertDetailBelow(active.rowId, active.field, event.shiftKey); return; }
    if (key === 'Delete' && !ctrl && isMultiDetailRange()) { stop(); clearDetailRangeCells(); return; }
    if (key === 'Escape' && detailRangeRef.current) clearDetailRange();
  }, [detailEditable, isMultiDetailRange, paintDetailRange, focusDetailCell, fillDetailDown, insertDetailBelow, clearDetailRangeCells, clearDetailRange]);

  // Shift+클릭: 현재 칸부터 클릭한 칸까지 범위 (포커스는 그대로). 그냥 클릭하면 범위를 푼다.
  const handleDetailMouseDownCapture = useCallback((event) => {
    const cell = detailCellOf(event.target);
    const active = activeDetailCellRef.current;
    if (!event.shiftKey || !cell || !active || !detailEditable) { if (detailRangeRef.current) clearDetailRange(); return; }
    event.preventDefault();
    detailRangeRef.current = {
      anchorId: detailRangeRef.current?.anchorId || active.rowId,
      anchorColumn: detailRangeRef.current?.anchorColumn ?? DETAIL_FIELD_INDEX[active.field],
      focusId: cell.rowId, focusColumn: DETAIL_FIELD_INDEX[cell.field],
    };
    paintDetailRange();
  }, [detailEditable, clearDetailRange, paintDetailRange]);

  const detailRangeText = useCallback(() => {
    const bounds = detailBounds();
    if (!bounds) return '';
    const fields = DETAIL_NAVIGATION_FIELDS.slice(bounds.left, bounds.right + 1);
    return itemsRef.current.slice(bounds.top, bounds.bottom + 1)
      .map((row) => fields.map((field) => detailCopyText(row, field)).join('\t')).join('\n');
  }, [detailBounds]);
  const handleDetailCopyCapture = useCallback((event) => {
    if (!isMultiDetailRange()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', detailRangeText());
  }, [isMultiDetailRange, detailRangeText]);
  const handleDetailCutCapture = useCallback((event) => {
    if (!isMultiDetailRange()) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', detailRangeText());
    if (detailEditable) clearDetailRangeCells();
  }, [isMultiDetailRange, detailRangeText, detailEditable, clearDetailRangeCells]);

  // 붙여넣기: 엑셀 범위 → 현재 칸(범위가 있으면 범위 왼쪽 위)부터 · 범위에 값 하나 → 범위 전체 · 종류/상태 칸에 값 하나 → 목록에서 찾아 넣기
  const handleDetailPasteCapture = useCallback((event) => {
    if (!detailEditable) return;
    const cell = detailCellOf(event.target);
    if (!cell) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const bounds = detailBounds();
    const multiRange = isMultiDetailRange(bounds);
    const multiText = isMultiCellText(text);
    if (!multiRange && !multiText && !DETAIL_FIELD_SPEC[cell.field]?.options) return;   // 글자 · 금액 · 날짜 한 칸은 칸 기본 붙여넣기
    event.preventDefault();
    event.stopPropagation();
    const rows = itemsRef.current;
    if (multiRange) {
      if (multiText) { pasteIntoDetail(bounds.top, bounds.left, parseClipboardMatrix(text)); return; }
      const value = text.replace(/\r?\n$/, '');
      if (!value.trim()) { clearDetailRangeCells(); return; }
      const line = DETAIL_NAVIGATION_FIELDS.slice(bounds.left, bounds.right + 1).map(() => value);
      pasteIntoDetail(bounds.top, bounds.left, rows.slice(bounds.top, bounds.bottom + 1).map(() => line));
      return;
    }
    const startRow = rows.findIndex((row) => row.id === cell.rowId);
    if (startRow < 0) return;
    pasteIntoDetail(startRow, DETAIL_FIELD_INDEX[cell.field], multiText ? parseClipboardMatrix(text) : [[text]]);
  }, [detailEditable, detailBounds, isMultiDetailRange, pasteIntoDetail, clearDetailRangeCells]);
  const handleAddAction = useCallback(() => {
    if (header.receiptno || !drafting) { startNew(); return; }
    if (activeTab !== 'INSTRUMENT') {
      notifications.show({ title: '기본은 한 줄 입력입니다', message: '어음/수표 탭에서 추가를 누르면 증권 행이 추가됩니다.', color: 'orange' });
      return;
    }
    if (instrumentLocked) {
      notifications.show({ title: '어음/수표를 추가할 수 없습니다', message: '기본 탭에 입력한 내용이 있습니다. 전표 하나는 기본 또는 어음/수표 중 한 가지만 입력할 수 있습니다.', color: 'orange' });
      return;
    }
    addDetail();
  }, [header.receiptno, drafting, activeTab, instrumentLocked, addDetail, startNew]);
  const deleteSelected = useCallback(() => {
    if (isSavedDocument || !selectedRows.length) return false; // 저장된 전표의 선택은 결제·할인 처리용
    const selected = new Set(selectedRows);
    setItems((rows) => rows.filter((row) => !selected.has(row.id)));
    setSelectedRows([]);
    selectionAnchor.current = null;
    return true;
  }, [isSavedDocument, selectedRows]);

  const copySelected = useCallback(() => {
    if (isSavedDocument) {
      // 저장된 전표 → 같은 내용의 새 전표 (매입등록 복사와 같음): 수금/지급일은 오늘, 저장 전까지 새 전표
      //  어음/수표는 처리 결과(상태 · 처리일 · 할인료 · 메모)를 비우고, '지급어음 선택'으로 넣은 행은 같은 증권을 두 번 쓸 수 없어 뺀다.
      const sourceNo = header.receiptno;
      const instrumentSource = items.filter(instrumentRowHasInput);
      const usable = instrumentSource.filter((row) => !row.source_receiptno);
      const skipped = instrumentSource.length - usable.length;
      if (!cashHasInput && !usable.length) {
        notifications.show({ title: '복사할 내용 없음', message: skipped ? '지급어음 선택으로 넣은 증권은 다시 쓸 수 없어 복사할 내용이 없습니다.' : '복사할 금액이 없는 전표입니다.', color: 'orange' });
        return;
      }
      selectedReceiptRef.current = '';
      detailRequest.current += 1;
      setEditBase('');
      setHeader({
        ...emptyHeader(), transactiontype: header.transactiontype, customcode: header.customcode || '', customname: header.customname || '',
        manager: header.manager || '', description: header.description || '',
      });
      setCashForm(cashHasInput ? { ...cashForm } : emptyCashForm());
      setItems(usable.length ? usable.map((row) => makeDetail({
        ...row, id: undefined, lineno: null, issuekind: '', instrumentstatus: '', processdate: '', discountfee: '', processmemo: '',
        used_receiptno: '', used_customname: '', used_date: '', created_by: '', updated_by: '',
      })) : [makeDetail()]);
      setActiveTab(usable.length ? 'INSTRUMENT' : 'CASH');
      setSelectedRows([]);
      selectionAnchor.current = null;
      setDrafting(true);
      notifications.show({
        title: '전표 복사 완료',
        message: `${sourceNo} 전표를 새 ${typeName(header.transactiontype)} 전표로 복사했습니다 (수금/지급일 오늘).${skipped ? ` 지급어음 선택 증권 ${skipped}장은 다시 쓸 수 없어 뺐습니다.` : ''} 확인 후 저장해 주세요.`,
        color: 'teal',
      });
      return;
    }
    if (selectedRows.length !== 1) {
      notifications.show({ title: '복사할 행을 선택해 주세요', message: '상세에서 한 행을 선택한 뒤 복사할 수 있습니다.', color: 'orange' });
      return;
    }
    const source = items.find((row) => row.id === selectedRows[0]);
    if (source?.source_receiptno) {
      notifications.show({ title: '복사할 수 없는 행', message: '보유증권 행은 같은 증권을 두 번 쓸 수 없어 복사할 수 없습니다.', color: 'orange' });
      return;
    }
    if (source) setItems((rows) => [...rows, makeDetail({ ...source, id: undefined })]);
    setSelectedRows([]);
  }, [isSavedDocument, items, selectedRows, header, cashHasInput, cashForm]);

  // 자금 합계 = 수표/어음 + 현금, 전표 합계 = 자금 합계 + 상계 ± 잡손실 ± 잡이익 (거래처원장 반영액)
  const totals = useMemo(() => {
    const instrumentamt = items.reduce((sum, row) => sum + numeric(row.instrumentamt), 0);
    const cashamt = numeric(cashForm.cashamt);
    const offsetamt = numeric(cashForm.offsetamt);
    const lossamt = numeric(cashForm.lossamt);
    const totalamt = instrumentamt + cashamt;
    return { instrumentamt, cashamt, offsetamt, lossamt, chargeamt: numeric(cashForm.chargeamt), totalamt, ledgeramt: totalamt + offsetamt + signedAdjust(lossamt, cashForm.chargeamt, header.transactiontype) };
  }, [items, cashForm, header.transactiontype]);

  const [manualOtherConfirm, setManualOtherConfirm] = useState(null); // 지급 타수 직접 입력 확인
  const saveDocument = useCallback(async ({ confirmedManualOther = false } = {}) => {
    if (!header.receiptdate || !header.transactiontype || !header.customcode || !header.customname) {
      notifications.show({ title: '필수 항목을 확인해 주세요', message: '수금/지급일, 구분, 거래처를 선택해 주세요.', color: 'red' });
      return;
    }
    // 기본 또는 어음/수표 중 한 가지만 (서버도 같은 규칙으로 막는다)
    const instrumentRows = items.filter(instrumentRowHasInput);
    if (cashHasInput && instrumentRows.length) {
      notifications.show({ title: '한 가지만 입력해 주세요', message: '전표 하나는 기본 또는 어음/수표 중 한 가지만 입력할 수 있습니다.', color: 'red' });
      return;
    }
    if (cashHasInput && !CASH_KEYS.some((key) => numeric(cashForm[key]) > 0)) {
      notifications.show({ title: '금액을 입력해 주세요', message: '기본 탭에 현금 · 상계 · 잡손실 · 잡이익 중 하나 이상의 금액을 입력해 주세요.', color: 'red' });
      return;
    }
    if (!cashHasInput && !instrumentRows.length) {
      notifications.show({ title: '금액을 입력해 주세요', message: '기본 탭 또는 어음/수표 탭에 금액을 입력해 주세요.', color: 'red' });
      return;
    }
    const emptyRowIndex = instrumentRows.findIndex((row) => numeric(row.instrumentamt) <= 0);
    if (emptyRowIndex >= 0) {
      notifications.show({ title: '어음/수표 금액을 입력해 주세요', message: `어음/수표 ${emptyRowIndex + 1}행에 금액이 없습니다. 금액을 입력하거나 빈 행을 삭제해 주세요.`, color: 'red' });
      return;
    }
    const duplicate = duplicateInstrumentRows(instrumentRows);
    if (duplicate) {
      notifications.show({ title: '같은 어음 중복', message: `${duplicate[0]}행과 ${duplicate[1]}행의 어음번호 · 발행회사(${duplicate[2]} · ${duplicate[3] || '발행회사 없음'})가 같습니다.`, color: 'red' });
      return;
    }
    const badMaturityIndex = instrumentRows.findIndex(maturityBeforeIssue);
    if (badMaturityIndex >= 0) {
      notifyMaturityBeforeIssue(badMaturityIndex + 1);
      return;
    }
    // 지급에 타수 증권을 직접 입력: 받은 어음이면 보유증권 불러오기를 써야 원본이 '배서'로 바뀐다.
    if (!confirmedManualOther && header.transactiontype === 'PAYMENT') {
      const manualOther = instrumentRows.map((row, index) => ({ row, index }))
        .filter(({ row }) => !row.source_receiptno && numeric(row.instrumentamt) > 0 && String(row.issuekind || '').toUpperCase() === 'OTHER');
      if (manualOther.length) {
        setManualOtherConfirm(manualOther.map(({ index }) => index + 1));
        return;
      }
    }
    setSaving(true);
    try {
      const { data } = await axios.put('/api/receipt-payment/documents', {
        ...header,
        // 새 전표: 중복 저장 막기 키 (저장된 전표 수정은 header.expected_updated_at 으로 동시 수정 확인)
        ...(header.receiptno ? {} : { request_key: requestKey.take() }),
        items: cashHasInput
          // 기본: 한 줄 (은행예금 · 카드는 쓰지 않음)
          ? [{
            cashamt: numeric(cashForm.cashamt), instrumentamt: 0, instrumenttype: '', instrumentno: '', issuedate: null,
            issuercompany: '', issuer: '', issuekind: '', maturitydate: null, custodyaccount: '', custodybank: '', instrumentstatus: '',
            bankamt: 0, cardamt: 0, offsetamt: numeric(cashForm.offsetamt), lossamt: numeric(cashForm.lossamt),
            chargeamt: numeric(cashForm.chargeamt), description: String(cashForm.description || '').trim(), source_receiptno: '', source_lineno: null,
          }]
          // 어음/수표: 증권 한 장 = 한 줄. 발행구분은 화면에서 받지 않으므로 수금 = 타수(받은 증권), 지급 = 자수(발행한 어음)로 정한다.
          : instrumentRows.map((row) => ({
            cashamt: 0, instrumentamt: numeric(row.instrumentamt),
            instrumenttype: row.instrumenttype || '', instrumentno: row.instrumentno || '',
            issuedate: row.issuedate || null, issuercompany: row.issuercompany || '',
            issuer: row.issuer || '', issuekind: row.issuekind || (header.transactiontype === 'PAYMENT' ? 'OWN' : 'OTHER'),
            maturitydate: row.maturitydate || null,
            custodyaccount: row.custodyaccount || '', custodybank: row.custodybank || '',
            instrumentstatus: row.instrumentstatus || '',
            bankamt: 0, cardamt: 0, offsetamt: 0, lossamt: 0, chargeamt: 0, description: row.description || '',
            source_receiptno: row.source_receiptno || '', source_lineno: row.source_receiptno ? Number(row.source_lineno) : null,
          })),
      }, authConfig());
      requestKey.reset();
      if (isApprovalPending(data)) {
        notifyApprovalPending(data);
        const editing = header.receiptno;
        startNew();
        if (editing) await openDocument(editing);
        return;
      }
      notifications.show({ title: '저장 완료', message: `${data.receiptno} 전표를 저장했습니다.`, color: 'teal' });
      // 입력 중인 임시 상태를 비우고 목록을 갱신한 뒤, 저장된 전표를 다시 선택한다.
      // 다른 전표의 상세도 바뀌었을 수 있다 (보유증권 사용 → 원본 수금 증권 배서) → 기억해 둔 상세를 모두 비운다.
      detailCache.current.clear();
      startNew();
      await loadDocuments(1, filters, pageSize, data.receiptno);
      await openDocument(data.receiptno);
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error), color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [filters, header, items, cashForm, cashHasInput, loadDocuments, openDocument, pageSize, startNew, requestKey]);

  const [deleteBlocked, setDeleteBlocked] = useState('');   // 서버가 삭제를 거절한 사유
  const deleteDocument = useCallback(async () => {
    if (!header.receiptno) return;
    setSaving(true);
    try {
      const { data } = await axios.delete(`/api/receipt-payment/documents/${encodeURIComponent(header.receiptno)}`, authConfig());
      if (isApprovalPending(data)) {
        notifyApprovalPending(data);
        setDeleteOpen(false);
        return;
      }
      notifications.show({ title: '삭제 완료', message: `${header.receiptno} 전표를 삭제했습니다.`, color: 'teal' });
      detailCache.current.clear(); // 지급 삭제 → 원본 수금 증권이 보관으로 돌아옴
      setDeleteOpen(false);
      startNew();
      await loadDocuments(page, filters, pageSize);
    } catch (error) {
      setDeleteBlocked(errorText(error));   // 월마감 · 증권 처리 등: 같은 창에서 사유를 보여 준다
    } finally {
      setSaving(false);
    }
  }, [filters, header.receiptno, loadDocuments, page, pageSize, startNew]);

  const deleteAction = useCallback(() => {
    if (deleteSelected()) return;
    if (header.receiptno) setDeleteOpen(true);
    else notifications.show({ title: '삭제할 항목이 없습니다', message: '상세 행을 선택해 주세요.', color: 'orange' });
  }, [deleteSelected, header.receiptno]);

  const exportExcel = useCallback(async () => {
    const documentRows = header.receiptno
      ? (cashHasInput ? [{ ...makeDetail(cashForm), cashamt: cashForm.cashamt }] : items)
      : [];
    const rows = header.receiptno
      ? documentRows.map((row, index) => ({
        전표번호: header.receiptno, 수금지급일: header.receiptdate, 구분: typeName(header.transactiontype),
        거래처: header.customname, 순번: index + 1,
        수표어음종류: instrumentLabel('instrumenttype', row.instrumenttype), 수표어음번호: row.instrumentno, 수표어음: numeric(row.instrumentamt),
        발행회사: row.issuercompany, 발행자: row.issuer, 발행일: dateOnly(row.issuedate), 만기일: dateOnly(row.maturitydate),
        보관계좌: row.custodyaccount, 보관은행: row.custodybank,
        처리일: dateOnly(row.processdate || row.used_date), 어음처리상태: row.instrumentamt ? statusText(row, header.transactiontype) : '',
        ...(header.transactiontype === 'RECEIPT' ? { 배서처: row.used_customname || '' } : {}),
        처리메모: row.processmemo || '', 할인료: numeric(row.discountfee), 비고: row.description,
        현금: numeric(row.cashamt), '자금 합계': numeric(row.instrumentamt) + numeric(row.cashamt), 상계: numeric(row.offsetamt),
        잡손실: numeric(row.lossamt), 잡이익: numeric(row.chargeamt),
        '전표 합계': numeric(row.instrumentamt) + numeric(row.cashamt) + numeric(row.offsetamt) + signedAdjust(row.lossamt, row.chargeamt, header.transactiontype),
        등록자: row.created_by || '', 수정자: row.updated_by || '',
        ...(header.transactiontype === 'PAYMENT' ? { '수금 원천 전표': sourceText(row) } : {}),
      }))
      : documents.map((row) => ({
        '수금/지급일': dateOnly(row.receiptdate), 구분: typeName(row.transactiontype), 거래처: row.customname, 담당자: row.manager || '',
        현금: numeric(row.cashamt), '수표/어음': numeric(row.instrumentamt), '자금 합계': numeric(row.totalamt),
        상계: numeric(row.offsetamt), 잡손실: numeric(row.lossamt), 잡이익: numeric(row.chargeamt), 비고: row.description || '',
        전표번호: row.receiptno, 등록일자: dateTimeText(row.created_at, true), 등록자: row.created_by || '',
        수정일자: dateTimeText(row.updated_at, true), 수정자: row.updated_by || '',
      }));
    if (!rows.length) {
      notifications.show({ title: '엑셀 데이터 없음', message: '다운로드할 데이터가 없습니다.', color: 'orange' });
      return;
    }
    const XLSX = await loadXLSXOrNotify();
    if (!XLSX) return;
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    applyExcelHeaderStyle(worksheet, Object.keys(rows[0] || {}).length);
    XLSX.utils.book_append_sheet(workbook, worksheet, '수금지급');
    XLSX.writeFile(workbook, `수금지급_${todayString()}.xlsx`);
  }, [documents, header, items, cashForm, cashHasInput]);

  // 리본 버튼은 ref를 통해 최신 핸들러를 호출 → 행 추가처럼 핸들러만 바뀔 때는 리본(레이아웃 전체)을 다시 등록하지 않는다.
  const ribbonActions = useRef({});
  useLayoutEffect(() => {
    ribbonActions.current = { runSearch, handleAddAction, copySelected, exportExcel, saveDocument, deleteAction };
  });
  // 저장된 전표: 전표 통째로 새 전표로 복사 / 입력 중: 선택한 어음 행 한 개 복사
  const copyEnabled = !saving && (isSavedDocument ? !detailLoading : selectedRows.length === 1);
  const deleteEnabled = !saving && Boolean(header.receiptno || selectedRows.length > 0);
  useEffect(() => {
    if (!registerRibbon) return undefined;
    const call = (name) => () => ribbonActions.current[name]?.();
    registerRibbon(
      <Group className={inboundClasses.commandRibbon} gap={2} wrap="nowrap">
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={call('runSearch')} loading={loading} disabled={loading}>조회</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={call('handleAddAction')} disabled={saving}>추가</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} onClick={call('copySelected')} disabled={!copyEnabled}>복사</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={call('saveDocument')} loading={saving} disabled={saving || !canSave}>저장</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} onClick={call('deleteAction')} disabled={!deleteEnabled}>삭제</Button>
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={call('exportExcel')} disabled={!canExport}>엑셀</Button>
        <span className={inboundClasses.ribbonSeparator} />
        <Button className={inboundClasses.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closePage}>닫기</Button>
      </Group>,
    );
    return () => registerRibbon(null);
  }, [registerRibbon, closePage, loading, saving, copyEnabled, canExport, canSave, deleteEnabled]);

  const visibleTotals = useMemo(() => documents.reduce((sum, row) => {
    DOCUMENT_MONEY_KEYS.forEach((key) => { sum[key] += numeric(row[key]); });
    return sum;
  }, { ...Object.fromEntries(DOCUMENT_MONEY_KEYS.map((key) => [key, 0])) }), [documents]);
  const syncListScroll = (left) => {
    for (const element of [listTableRef.current, listSubtotalRef.current]) {
      if (element && Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left;
    }
  };
  // The list table stretches to the panel width (minus its vertical scrollbar), so the subtotal
  // table copies its rendered width to keep every column lined up.
  const hasDocuments = documents.length > 0;
  useEffect(() => {
    const listTable = listTableRef.current?.querySelector('table');
    const subtotalTable = listSubtotalRef.current?.querySelector('table');
    if (!listTable || !subtotalTable || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const width = `${listTable.getBoundingClientRect().width}px`;
      subtotalTable.style.width = width;
      subtotalTable.style.minWidth = width;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(listTable);
    return () => observer.disconnect();
  }, [hasDocuments, summaryTableWidth]);

  return (
    <Box className={`${simpleTheme.simple} ${sharedClasses.pageShell} ${classes.page}`}>
      <Box component="nav" aria-label="현재 위치" className={inboundClasses.pageBreadcrumb}>
        <Group className={inboundClasses.breadcrumbTrail} gap={7}>
          <Text component="span" className={inboundClasses.breadcrumbParent}>자금관리</Text>
          <Text component="span" className={inboundClasses.breadcrumbChevron}>›</Text>
          <Text component="span" className={inboundClasses.breadcrumbCurrent}>수금/지급등록</Text>
        </Group>
        {!filterOpen && (
          <Button className={inboundClasses.receiptFilterToggle} variant="subtle" size="xs"
            leftSection={<IconFilter size={15} />} onClick={() => setFilterOpen(true)}>
            조회조건
          </Button>
        )}
      </Box>
      <Box className={`${inboundClasses.inboundWorkspace} ${classes.workspace}`}>
        <Box className={`${inboundClasses.inboundPrimaryColumn} ${classes.primary}`}>
          <Paper className={`${sharedClasses.panel} ${inboundClasses.topReceiptPanel} ${classes.listPanel}`} withBorder>
            <Group className={inboundClasses.topReceiptToolbar} justify="space-between" wrap="nowrap">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>수금/지급 기본</Text><Badge variant="light" color="gray">{totalRows.toLocaleString()}건</Badge></Group>
            </Group>
            <Box ref={listTableRef} className={`${inboundClasses.topReceiptTable} ${classes.listTableWrap}`}>
              <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`} withTableBorder withColumnBorders
                style={{ width: 'max(100%, var(--code-table-min-width))', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed', '--code-table-min-width': `${summaryTableWidth}px` }}>
                <colgroup>{SUMMARY_COLUMNS.map((column, index) => <col key={column.key} style={{ width: summaryColumnWidths[index] }} />)}</colgroup>
                <Table.Thead><Table.Tr>{SUMMARY_COLUMNS.map((column, index) => <ResizableHeaderCell key={column.key} index={index} width={summaryColumnWidths[index]}
                  onResize={(event, columnIndex, width) => startColumnResize(event, columnIndex, width, summaryColumnWidths, setSummaryColumnWidths, 'summary')}>{column.label}</ResizableHeaderCell>)}</Table.Tr></Table.Thead>
                <Table.Tbody>
                  {documents.map((doc) => <ReceiptPaymentSummaryRow key={doc.receiptno} doc={doc}
                    selected={header.receiptno === doc.receiptno} onSelect={selectDocument} />)}
                </Table.Tbody>
              </Table>
              {!documents.length && <Box className={classes.emptyMessage}>{loading ? <Loader size="sm" color="red" /> : '검색된 수금/지급 전표가 없습니다.'}</Box>}
            </Box>
            <Box className={inboundClasses.topReceiptBottom}>
              {!!documents.length && <Box ref={listSubtotalRef} className={inboundClasses.topReceiptSubtotalViewport}>
                <Table className={`${inboundClasses.receiptFinderTable} ${inboundClasses.receiptSubtotalTable}`} withTableBorder withColumnBorders
                  style={{ width: `${summaryTableWidth}px`, minWidth: `${summaryTableWidth}px`, tableLayout: 'fixed' }}>
                  <colgroup>{SUMMARY_COLUMNS.map((column, index) => <col key={column.key} style={{ width: summaryColumnWidths[index] }} />)}</colgroup>
                  <Table.Tbody><Table.Tr>
                    {SUMMARY_COLUMNS.map((column, index) => <Table.Td key={column.key}
                      className={`${inboundClasses.topReceiptSubtotalCell} ${Object.hasOwn(visibleTotals, column.key) ? inboundClasses.topReceiptSubtotalNumber : ''}`}>
                      {index === 0 ? '소계' : Object.hasOwn(visibleTotals, column.key) ? formatted(visibleTotals[column.key]) : ''}
                    </Table.Td>)}
                  </Table.Tr></Table.Tbody>
                </Table>
              </Box>}
              <Box ref={listHorizontalScrollRef} className={inboundClasses.topReceiptHorizontalScroll}
                onScroll={(event) => syncListScroll(event.currentTarget.scrollLeft)} aria-label="수금/지급 기본 가로 스크롤">
                <Box className={inboundClasses.topReceiptHorizontalContent} style={{ width: `${summaryTableWidth}px` }} />
              </Box>
            </Box>
            <Group className={`${inboundClasses.topReceiptPagination} ${classes.listFooter}`} justify="space-between" wrap="nowrap">
              <Select className={inboundClasses.topReceiptPageSize} aria-label="페이지당 표시 건수" data={PAGE_SIZE_OPTIONS} value={String(pageSize)} w={100} size="xs"
                onChange={(value) => { if (value) { const size = Number(value); setPageSize(size); void loadDocuments(1, filters, size); } }} />
              <Pagination size="sm" total={Math.max(1, Math.ceil(totalRows / pageSize))} value={page} onChange={(value) => void loadDocuments(value, filters, pageSize)} withEdges color="red" disabled={loading || !totalRows} />
            </Group>
          </Paper>

          <Paper className={`${sharedClasses.panel} ${inboundClasses.editorPanel} ${classes.detailPanel}`} withBorder>
            <Group className={classes.detailHeader} justify="space-between" wrap="wrap">
              <Group gap={8}><Text className={inboundClasses.sectionTitle} fw={700}>수금/지급 상세</Text>{header.receiptno && <Badge variant="light" color="gray">{header.receiptno}</Badge>}</Group>
            </Group>
            <Box className={`${inboundClasses.sharedReceiptFields} ${classes.headerFields}`}>
              <Box className={inboundClasses.sharedReceiptField}><Text className={classes.fieldLabel}>수금/지급일 <i>*</i></Text><ErpDateInput type="date" value={header.receiptdate} disabled={saving || readOnlyDocument} onChange={(event) => { const { value: nextValue } = event.currentTarget; setHeader((v) => ({ ...v, receiptdate: nextValue })); }} /></Box>
              <Box className={inboundClasses.sharedReceiptField}><Text className={classes.fieldLabel}>구분 <i>*</i></Text><Select data={TRANSACTION_OPTIONS} value={header.transactiontype} disabled={saving || readOnlyDocument || hasHeldRows} title={hasHeldRows ? '보유증권 행이 있어 구분을 바꿀 수 없습니다.' : undefined} onChange={changeTransactionType} /></Box>
              <Box className={`${inboundClasses.sharedReceiptField} ${classes.customerField}`}><Text className={classes.fieldLabel}>거래처 <i>*</i></Text>
                <Box onDoubleClick={() => { if (!saving && !readOnlyDocument) setCustomerPickerOpen(true); }}>
                  {/* 저장된 전표는 읽기 전용 → 거래처 목록(수백 건)을 그리지 않고 이름만 표시해 행 선택 반응을 빠르게 */}
                  {readOnlyDocument ? <TextInput aria-label="거래처" value={header.customname || header.customcode || ''} disabled readOnly />
                    : <HeaderCustomerSelect options={customerOptions} value={header.customcode || null} disabled={saving} onChange={pickHeaderCustomer} />}
                </Box>
              </Box>
              <Box className={inboundClasses.sharedReceiptField}><Text className={classes.fieldLabel}>담당자</Text><ReceiptPaymentHeaderTextInput label="담당자" value={header.manager} maxLength={100} disabled={saving || readOnlyDocument} onCommit={(value) => updateHeaderField('manager', value)} /></Box>
              <Box className={`${inboundClasses.sharedReceiptField} ${classes.descriptionField}`}><Text className={classes.fieldLabel}>비고</Text><ReceiptPaymentHeaderTextInput label="비고" value={header.description} maxLength={500} disabled={saving || readOnlyDocument} onCommit={(value) => updateHeaderField('description', value)} /></Box>
            </Box>
            {/* 탭: 기본(한 줄 입력폼) / 어음·수표(표). 전표 하나는 둘 중 한 가지만 입력 */}
            <Box className={outboundClasses.detailTabsBar} role="tablist" aria-label="수금/지급 입력 구분">
              <button type="button" role="tab" aria-selected={activeTab === 'CASH'} className={activeTab === 'CASH' ? outboundClasses.detailTabActive : outboundClasses.detailTab}
                onClick={() => setActiveTab('CASH')}>기본 {cashHasInput ? 1 : 0}건</button>
              <button type="button" role="tab" aria-selected={activeTab === 'INSTRUMENT'} className={activeTab === 'INSTRUMENT' ? outboundClasses.detailTabActive : outboundClasses.detailTab}
                onClick={() => setActiveTab('INSTRUMENT')}>어음/수표 {instrumentCount.toLocaleString()}건</button>
            </Box>
            {activeTab === 'CASH' ? <Box className={classes.cashPanel}>
              {/* 어음/수표 탭과 같은 회색 안내 줄 */}
              <Group className={classes.detailToolbar} justify="space-between" wrap="nowrap">
                <Text className={classes.toolbarHint}>{cashLocked ? '어음/수표에 입력한 내용이 있어 기본은 입력할 수 없습니다.' : '상계는 미수·미지급 양쪽에서 함께 빠집니다.'}</Text>
              </Group>
              {(() => {
                // 표 머리글은 항상 보이고, 입력 줄은 새 전표 작성 중이거나 저장된 기본 전표일 때만 보인다 (어음/수표 탭과 동일)
                const showCashRow = !detailLoading && (isSavedDocument ? cashHasInput : (drafting || cashHasInput));
                return <Box className={`${codeClasses.tableWrap} ${classes.detailTableWrap}`}>
                  <CashEntryTable form={cashForm} readOnly={readOnlyDocument} showRow={showCashRow} disabled={saving || cashLocked} onChange={updateCashForm} />
                  {!showCashRow && <Box className={classes.emptyDetailMessage}>{detailLoading ? <Loader size="sm" color="red" />
                    : isSavedDocument ? '기본 입력이 없는 전표입니다.' : '상단의 추가를 눌러 수금/지급 전표를 등록하세요.'}</Box>}
                </Box>;
              })()}
            </Box> : <>
              <Group className={classes.detailToolbar} justify="space-between" wrap="nowrap">
                <Group gap={8}>
                  <Text className={classes.toolbarHint}>{isSavedDocument
                    ? (processableIds?.size ? '처리할 행을 체크하면 결제·할인·부도·처리취소 버튼이 켜집니다.' : '결제·할인·부도로 처리할 수 있는 행이 없습니다.')
                    : instrumentLocked ? '기본 탭에 입력한 내용이 있어 어음/수표는 입력할 수 없습니다.' : '어음/수표 금액은 수표·어음 합계에 자동 반영됩니다.'}</Text>
                  {selectedRows.length > 0 && <Badge variant="light" color="gray">{selectedRows.length}개 선택</Badge>}
                </Group>
                {isSavedDocument
                  ? <Group gap={6} wrap="nowrap">
                    {processActionsFor(header.transactiontype).map((action) => {
                      const enabled = !saving && selectedItems.length > 0 && selectedItems.every((row) => canProcess(row, header.transactiontype, action));
                      return <Button key={action} size="xs" variant="light" color={PROCESS_ACTION_INFO[action].color} disabled={!enabled}
                        title={selectedItems.length ? undefined : '처리할 증권 행을 선택해 주세요.'} onClick={() => openProcess(action)}>{PROCESS_ACTION_INFO[action].label}</Button>;
                    })}
                  </Group>
                  : <Button size="xs" variant="default" leftSection={<IconSearch size={14} />}
                    disabled={saving || header.transactiontype !== 'PAYMENT' || instrumentLocked}
                    title={header.transactiontype !== 'PAYMENT' ? '지급 전표에서 사용할 수 있습니다.' : undefined}
                    onClick={() => setHeldPickerOpen(true)}>지급어음 선택</Button>}
              </Group>
              <Box ref={detailTableWrapRef} className={`${codeClasses.tableWrap} ${classes.detailTableWrap}`} onKeyDown={handleDetailTableKeyDown}
                onKeyDownCapture={handleDetailKeyDownCapture} onFocusCapture={handleDetailFocusCapture} onMouseDownCapture={handleDetailMouseDownCapture}
                onCopyCapture={handleDetailCopyCapture} onCutCapture={handleDetailCutCapture} onPasteCapture={handleDetailPasteCapture}>
                <Table className={`${sharedClasses.table} ${codeClasses.codeTable} ${classes.table}`} withTableBorder withColumnBorders
                  style={{ width: 'max(100%, var(--code-table-min-width))', minWidth: 'var(--code-table-min-width)', tableLayout: 'fixed', '--code-table-min-width': `${detailTableWidth}px` }}>
                  <colgroup>{visibleDetailWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
                  <Table.Thead><Table.Tr>
                    {visibleDetailLabels.map((label, index) => <ResizableHeaderCell key={`${label}-${index}`} index={visibleDetailColumns[index]} width={visibleDetailWidths[index]}
                      ta={index === 0 || index === 1 ? 'center' : undefined}
                      onResize={(event, columnIndex, width) => startColumnResize(event, columnIndex, width, detailColumnWidths, setDetailColumnWidths, 'detail', visibleDetailColumns)}>
                      {index === 0
                        ? (isSavedDocument
                          ? <input type="checkbox" aria-label="처리 가능한 행 전체 선택" checked={processableIds.size > 0 && selectedRows.length === processableIds.size}
                            disabled={!processableIds.size || saving} onChange={(event) => setSelectedRows(event.currentTarget.checked ? [...processableIds] : [])} />
                          : <input type="checkbox" aria-label="전체 행 선택" checked={items.length > 0 && selectedRows.length === items.length} disabled={!items.length || saving || instrumentLocked} onChange={(event) => setSelectedRows(event.currentTarget.checked ? items.map((row) => row.id) : [])} />)
                        : label}
                    </ResizableHeaderCell>)}
                  </Table.Tr></Table.Thead>
                  <Table.Tbody>{items.map((row, index) => isSavedDocument ? <ReceiptPaymentReadonlyRow key={row.id} row={row} index={index} transactiontype={header.transactiontype}
                    selectable={!saving && processableIds.has(row.id)} selected={selectedRows.includes(row.id)} onToggle={toggleRow} /> : <ReceiptPaymentDetailRow
                    key={row.id}
                    row={row}
                    index={index}
                    selected={selectedRows.includes(row.id)}
                    disabled={saving || isSavedDocument || instrumentLocked}
                    bankOptions={bankOptions}
                    showSource={showSourceColumn}
                    onToggle={toggleRow}
                    onUpdate={updateDetail}
                    onOpenPicker={openDetailPicker}
                  />)}</Table.Tbody>
                </Table>
                {!items.length && <Box className={classes.emptyDetailMessage}>{detailLoading ? <Loader size="sm" color="red" />
                  : isSavedDocument ? '어음/수표가 없는 전표입니다.' : '상단의 추가를 눌러 수금/지급 전표를 등록하세요.'}</Box>}
              </Box>
            </>}
            <Group className={`${sharedClasses.footer} ${codeClasses.tableFooter} ${classes.detailFooter}`} justify="flex-end" wrap="wrap">
              <Text size="xs" fw={700}>수표/어음 {formatted(totals.instrumentamt)} · 현금 {formatted(totals.cashamt)} · 자금 합계 {formatted(totals.totalamt)} · 상계 {formatted(totals.offsetamt)} · 잡손실 {formatted(totals.lossamt)} · 잡이익 {formatted(totals.chargeamt)} · 전표 합계 {formatted(totals.ledgeramt)}</Text>
            </Group>
          </Paper>
        </Box>

        {filterOpen && <ReceiptPaymentFilterPanel initialValues={filterInputsRef.current} transactionOptions={TRANSACTION_FILTER_OPTIONS} onSearch={runSearch} onDraftChange={rememberFilterDraft} onClose={closeFilter} />}
      </Box>
      <ConfirmDeleteModal opened={deleteOpen} onClose={() => { setDeleteOpen(false); setDeleteBlocked(''); }} onConfirm={() => void deleteDocument()} loading={saving} blocked={deleteBlocked}
        title="수금/지급 전표를 삭제할까요?" target={header.receiptno} message="전표와 상세 행이 모두 삭제되며" note="삭제한 전표는 복구할 수 없습니다." />
      <ReceiptCustomerPickerModal opened={customerPickerOpen} onClose={() => setCustomerPickerOpen(false)} onSelect={chooseCustomer} />
      <Modal opened={Boolean(manualOtherConfirm)} onClose={() => setManualOtherConfirm(null)} title="타수 증권 직접 입력 확인" centered size="md">
        <Stack gap="md">
          <Text size="sm">{manualOtherConfirm?.join(', ')}행은 <b>타수(받은) 증권</b>을 직접 입력했습니다.</Text>
          <Text size="sm" c="dimmed">이 시스템에서 수금으로 받은 증권이라면 <b>보유증권 불러오기</b>로 넣어야 원본 증권이 '배서'로 바뀌어 중복 사용을 막을 수 있습니다.
            시스템에 없는 증권(도입 전에 받은 어음 등)이라면 그대로 저장해도 됩니다.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setManualOtherConfirm(null)}>취소</Button>
            <Button color="red" onClick={() => { setManualOtherConfirm(null); void saveDocument({ confirmedManualOther: true }); }}>그대로 저장</Button>
          </Group>
        </Stack>
      </Modal>
      <InstrumentProcessModal request={processRequest} transactiontype={header.transactiontype} onClose={() => setProcessRequest(null)} onDone={finishProcess} />
      <HeldInstrumentPickerModal opened={heldPickerOpen} onClose={() => setHeldPickerOpen(false)} excludedKeys={usedSourceKeys} onApply={applyHeldInstruments} />
      <ReceiptBankPickerModal opened={detailPicker?.field === 'custodybank'} onClose={() => setDetailPicker(null)} options={bankOptions} onSelect={selectDetailBank} />
    </Box>
  );
}
