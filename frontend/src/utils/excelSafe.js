// 엑셀(xlsx-js-style) 공통
//  1) 필요할 때만 내려받는다: 엑셀 라이브러리(약 870KB)는 화면을 열 때가 아니라 [엑셀] · [업로드]를 누를 때 받는다.
//     사용법: const XLSX = await loadXLSX();  (API 는 xlsx-js-style 과 같음)
//  2) 수식 주입 막기: =, +, -, @, 탭, 줄바꿈(CR)으로 시작하는 글자 칸은 앞에 작은따옴표(')를 붙여 글자로만 보이게 한다.
//     (거래처명 · 비고 등에 '=HYPERLINK(...)' 같은 값이 있어도 엑셀이 수식으로 실행하지 않게)
//     숫자 칸은 바꾸지 않는다. '-5', '+1,000' 처럼 숫자 모양 글자와 '-' 하나만 있는 칸도 그대로 둔다.

import { notifications } from '@mantine/notifications';

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMBER_LIKE = /^[-+]?(\d[\d,]*)(\.\d+)?%?$/;

export function excelSafeText(value) {
  if (typeof value !== 'string' || !FORMULA_START.test(value)) return value;
  if (value === '-' || value === '+' || NUMBER_LIKE.test(value)) return value;
  return `'${value}`;
}

function safeCell(cell) {
  if (typeof cell === 'string') return excelSafeText(cell);
  // 스타일을 붙인 칸 { v, t, s } — 수식(f)을 일부러 넣은 칸은 건드리지 않는다
  if (cell && typeof cell === 'object' && !(cell instanceof Date) && typeof cell.v === 'string' && !cell.f) {
    const v = excelSafeText(cell.v);
    return v === cell.v ? cell : { ...cell, v };
  }
  return cell;
}

export function excelSafeRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const next = {};
    Object.keys(row).forEach((key) => { next[key] = safeCell(row[key]); });
    return next;
  });
}

export function excelSafeAoa(aoa) {
  if (!Array.isArray(aoa)) return aoa;
  return aoa.map((line) => (Array.isArray(line) ? line.map(safeCell) : line));
}

function wrapXLSX(X) {
  const utils = {
    ...X.utils,
    json_to_sheet: (rows, options) => X.utils.json_to_sheet(excelSafeRows(rows), options),
    aoa_to_sheet: (aoa, options) => X.utils.aoa_to_sheet(excelSafeAoa(aoa), options),
    sheet_add_json: (sheet, rows, options) => X.utils.sheet_add_json(sheet, excelSafeRows(rows), options),
    sheet_add_aoa: (sheet, aoa, options) => X.utils.sheet_add_aoa(sheet, excelSafeAoa(aoa), options),
  };
  return { ...X, utils };
}

let loading = null;
export function loadXLSX() {
  if (!loading) {
    loading = import('xlsx-js-style')
      .then((mod) => wrapXLSX(mod.default || mod))
      .catch((error) => { loading = null; throw error; });
  }
  return loading;
}

// 못 받으면(네트워크 끊김 · 새 버전 배포 직후) 알림을 띄우고 null
export async function loadXLSXOrNotify() {
  try {
    return await loadXLSX();
  } catch (error) {
    console.error('엑셀 기능을 불러오지 못했습니다:', error);
    notifications.show({ title: '엑셀 기능을 불러오지 못했습니다', message: '네트워크를 확인한 뒤 다시 시도해 주세요. 계속되면 새로고침해 주세요.', color: 'red' });
    return null;
  }
}
