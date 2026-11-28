import { isApprovalPending, notifyApprovalPending } from '../../utils/approval';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Autocomplete,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  Select,
  Table,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconDeviceFloppy,
  IconFileSpreadsheet,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { loadXLSXOrNotify } from '../../utils/excelSafe';
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import sharedClasses from "../../styles/pages/ManagementShared.module.css";
import classes from "../../styles/pages/CustomerPage.module.css";
import { MenuAccessContext, PageRibbonContext } from "../../components/layout/MainLayout";
import OpeningBalanceModal from "./OpeningBalanceModal";
import ExcelBulkActions from '../../components/common/ExcelBulkActions';
import { apiErrorMessage } from '../../utils/apiError';
import { kstDate } from '../../utils/dateFormat';
import { invalidateMaster } from '../../utils/masterCache';

const PAGE_SIZE_OPTIONS = [
  { value: "15", label: "15개씩" },
  { value: "50", label: "50개씩" },
  { value: "100", label: "100개씩" },
  { value: "200", label: "200개씩" },
];

const CUSTOMER_PAGE_CACHE_TTL_MS = 20_000;
const CUSTOMER_PAGE_CACHE_LIMIT = 24;
let postcodeScriptPromise;

const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
});

const loadPostcodeService = () => {
  if (window.daum?.Postcode) return Promise.resolve();
  if (!postcodeScriptPromise) {
    postcodeScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      script.onload = resolve;
      script.onerror = () => {
        postcodeScriptPromise = null;
        reject(new Error("주소 검색 서비스를 불러오지 못했습니다."));
      };
      document.head.appendChild(script);
    });
  }
  return postcodeScriptPromise;
};

const OPENING_BALANCE_MAX = 9999999999999.99; // NUMERIC(15, 2)
const OPENING_BALANCE_HELP = "원장 시작일 이전부터 남아 있던 잔액";

// Returns a non-negative amount rounded to 2 decimals, 0 for blanks, or null when the value is not a valid amount.
const parseOpeningAmount = (value) => {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!text) return 0;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > OPENING_BALANCE_MAX) return null;
  return Math.round(amount * 100) / 100;
};

// 여신한도: 공급가 기준 원 단위, 빈칸/0 = 한도 없음(여신 통제 없이 통과). 잘못된 값이면 undefined.
const CREDIT_LIMIT_MAX = 999999999999999; // NUMERIC(15, 0)
const parseCreditLimit = (value) => {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!text) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > CREDIT_LIMIT_MAX) return undefined;
  return amount === 0 ? null : Math.round(amount);
};
const CREDIT_LIMIT_HELP = "공급가 기준 · 비우면 한도 없음 (통제관리 › 여신 통제)";

const displayUseyn = (value) => (value === "N" || value === "미사용" || value === "사용중지" ? "사용중지" : "사용중");

const makeCustomerPageCacheKey = ({
  companyid,
  search,
  status,
  tradetype,
  pageSize,
  page,
}) => JSON.stringify([companyid, search, status, tradetype, pageSize, page]);

const emptyCustomer = () => ({
  companyid: localStorage.getItem("user_company") || "",
  companyname: localStorage.getItem("user_companyname") || "",
  customercode: "",
  customername: "",
  businessno: "",
  corporationno: "",
  ownertype: "CORP",
  ceoname: "",
  tradetype: "매입처",
  businesstype: "",
  industry: "",
  manager: "",
  zipcode: "",
  phone: "",
  fax: "",
  email: "",
  bankcode: "",
  accountno: "",
  address: "",
  address2: "",
  useryn: "Y",
  remark: "",
  openingreceivable: 0,
  openingpayable: 0,
  creditlimit: "",
});

const toCustomer = (row) => ({
  companyid: row.companyid ?? "",
  companyname: row.companyname ?? "",
  customercode: row.customercode ?? "",
  customername: row.customername ?? "",
  businessno: row.businessno ?? "",
  corporationno: row.corporationno ?? "",
  ownertype: row.ownertype === "INDIV" ? "INDIV" : "CORP",
  ceoname: row.ceoname ?? "",
  tradetype: row.tradetype || "매입처",
  businesstype: row.businesstype ?? "",
  industry: row.industry ?? "",
  manager: row.manager ?? "",
  zipcode: row.zipcode ?? "",
  phone: row.phone ?? "",
  fax: row.fax ?? "",
  email: row.email ?? "",
  bankcode: row.bankcode ?? "",
  accountno: row.accountno ?? "",
  address: row.address ?? "",
  address2: row.address2 ?? "",
  useryn: displayUseyn(row.useryn ?? row.useyn),
  remark: row.remark ?? "",
  openingreceivable: parseOpeningAmount(row.openingreceivable) ?? 0,
  openingpayable: parseOpeningAmount(row.openingpayable) ?? 0,
  creditlimit: row.creditlimit === null || row.creditlimit === undefined ? "" : Number(row.creditlimit),
});

// 사업자번호 · 법인번호 검증번호 확인 (서버 · 사업장관리와 같은 규칙). 엑셀 일괄등록에서 행별로 먼저 거른다.
const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");
const validBusinessNo = (value) => {
  const digits = digitsOf(value);
  if (digits.length !== 10) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let total = weights.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0);
  total += Math.floor((Number(digits[8]) * 5) / 10);
  return (10 - (total % 10)) % 10 === Number(digits[9]);
};
const validCorporationNo = (value) => {
  const digits = digitsOf(value);
  if (digits.length !== 13) return false;
  const total = [...digits.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 2), 0);
  return (10 - (total % 10)) % 10 === Number(digits[12]);
};

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => String(item.msg || "").replace(/^Value error,\s*/i, "")).join(", ");
  return apiErrorMessage(error, fallback);
};

const TRADETYPE_TONE = { 매입처: "purchase", 매출처: "sales", 매입매출처: "both" };

// 거래처 엑셀 칼럼: 상세 화면 입력 순서 · 화면 이름과 같다. 양식 받기 · 목록 엑셀 · 일괄 업로드가 같은 정의를 쓴다.
//  text: 엑셀에서 숫자로 바뀌어 앞자리 0이 사라지지 않게 텍스트 칸으로 만든다.
//  aliases: 예전 양식(대표자명 · 전화번호 · 은행명 · 기초미수금 …)으로 올려도 받는다.
const TRADETYPES = ["매입처", "매출처", "매입매출처"];
const CUSTOMER_EXCEL_COLUMNS = [
  { key: "customercode", header: "거래처코드", width: 14, text: true, aliases: ["customercode", "거래처 코드", "거래처코드(자동채번)", "거래처코드(선택/자동채번)"], guide: "비우면 자동 채번 (Cust-00001 형식). 이미 있는 코드나 파일 안에서 겹친 코드는 등록하지 않습니다." },
  { key: "tradetype", header: "거래구분", width: 12, aliases: ["tradetype"], guide: "매입처 / 매출처 / 매입매출처 (비우면 매입처)" },
  { key: "customername", header: "거래처명", width: 26, required: true, aliases: ["customername", "거래처명(상호)", "상호명"], guide: "거래처 이름 (상호)" },
  { key: "ceoname", header: "대표자", width: 12, aliases: ["ceoname", "대표자명", "대표자 성명"] },
  { key: "ownertype", header: "사업자유형", width: 12, aliases: ["ownertype", "사업자 유형"], guide: "법인사업자 / 개인사업자 (비우면 법인사업자)" },
  { key: "businessno", header: "사업자번호", width: 15, text: true, aliases: ["businessno", "사업자등록번호"], guide: "000-00-00000 (- 없이 10자리도 됨, 검증번호 확인)" },
  { key: "corporationno", header: "법인번호", width: 17, text: true, aliases: ["corporationno", "법인등록번호"], guide: "000000-0000000 (- 없이 13자리도 됨). 개인사업자는 비웁니다." },
  { key: "businesstype", header: "업태", width: 12, aliases: ["businesstype"] },
  { key: "industry", header: "업종", width: 12, aliases: ["industry"] },
  { key: "phone", header: "전화", width: 15, text: true, aliases: ["phone", "전화번호", "대표 연락처", "연락처"] },
  { key: "fax", header: "팩스", width: 15, text: true, aliases: ["fax", "팩스번호"] },
  { key: "email", header: "이메일", width: 22, aliases: ["email", "메일"] },
  { key: "zipcode", header: "우편번호", width: 10, text: true, aliases: ["zipcode", "우편 번호"], guide: "숫자 5자리" },
  { key: "address", header: "주소", width: 36, aliases: ["address", "사업장 주소"] },
  { key: "address2", header: "상세주소", width: 24, aliases: ["address2", "상세 주소"] },
  { key: "bankcode", header: "은행", width: 14, aliases: ["bankname", "은행명", "bankcode", "은행코드", "bank"], guide: "기본정보관리에 등록된 은행 이름 (아래 은행 목록)" },
  { key: "accountno", header: "계좌번호", width: 18, text: true, aliases: ["accountno", "계좌"] },
  { key: "useryn", header: "사용여부", width: 10, aliases: ["useryn", "사용 여부"], guide: "사용중 / 사용중지 (비우면 사용중)" },
  { key: "manager", header: "업체 담당자", width: 12, aliases: ["manager", "업체담당자", "담당자"], guide: "20자 이내" },
  { key: "openingreceivable", header: "기초 미수금", width: 14, aliases: ["openingreceivable", "기초미수금"], guide: "0 이상 숫자 (관리자만 반영, 그 외 계정은 0으로 등록)" },
  { key: "openingpayable", header: "기초 미지급금", width: 14, aliases: ["openingpayable", "기초미지급금"], guide: "0 이상 숫자 (관리자만 반영, 그 외 계정은 0으로 등록)" },
  { key: "creditlimit", header: "여신한도", width: 14, aliases: ["creditlimit", "여신 한도"], guide: "공급가 기준 원 단위, 비우면 한도 없음 (관리자만 반영)" },
  { key: "remark", header: "비고", width: 24, aliases: ["remark"] },
];
const excelHeaderKey = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();
const CUSTOMER_HEADER_LOOKUP = new Map(CUSTOMER_EXCEL_COLUMNS.flatMap((column) =>
  [column.header, ...(column.aliases || [])].map((name) => [excelHeaderKey(name), column.key])));
// 텍스트 칸: 양식의 빈 줄에도 텍스트 서식을 미리 넣어 둔다 (숫자로 입력돼 앞자리 0이 사라지는 것을 막음)
const TEMPLATE_TEXT_ROWS = 300;
const markTextColumns = (worksheet, columns, rowCount, XLSX) => {
  columns.forEach((column, columnIndex) => {
    if (!column.text) return;
    for (let row = 1; row <= rowCount; row += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: columnIndex });
      const cell = worksheet[address];
      worksheet[address] = cell ? { ...cell, t: "s", v: String(cell.v ?? ""), z: "@" } : { t: "s", v: "", z: "@" };
    }
  });
  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  range.e.r = Math.max(range.e.r, rowCount);
  worksheet["!ref"] = XLSX.utils.encode_range(range);
};
// 엑셀에서 숫자로 읽힌 우편번호(6234 → 06234)를 5자리로 되돌린다
const normalizeZipcode = (value) => (/^\d{1,4}$/.test(value) ? value.padStart(5, "0") : value);
const OPENING_BALANCE_LOCKED_TITLE = "기능 권한 '거래처 기초잔액 · 여신한도 변경'이 있어야 바꿀 수 있습니다.";

// 상세 머리의 사용여부: 같은 줄의 코드 · 거래구분처럼 글자로 (사용중지는 흐리게)
const StatusTag = ({ value }) => (
  <span className={`${classes.tag} ${value === "사용중" ? classes.tagActive : classes.tagInactive}`}>
    {value}
  </span>
);
// 목록의 사용여부: 고객계정관리 목록과 같은 둥근 배지 (사용중 = 초록, 사용중지 = 회색)
const StatusBadge = ({ value }) => (
  <Badge size="sm" variant="light" color={value === "사용중" ? "teal" : "gray"}>{value}</Badge>
);
const OWNER_TYPES = [["CORP", "법인사업자"], ["INDIV", "개인사업자"]];
// 목록 날짜: YYYY-MM-DD (마우스를 올리면 시각까지)
const pad2 = (value) => String(value).padStart(2, "0");
const listDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` : "";
};
const listDateTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? `${listDate(value)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}` : "";
};

const TradetypeTag = ({ value }) =>
  value ? (
    <span className={`${classes.tag} ${classes[`trade_${TRADETYPE_TONE[value] || "etc"}`]}`}>
      {value}
    </span>
  ) : (
    "-"
  );

const FormSection = ({ title, hint, aside, children }) => (
  <section className={classes.formSection}>
    <div className={classes.formSectionHead}>
      <span className={classes.formSectionTitle}>{title}</span>
      {hint && <span className={classes.formSectionHint}>{hint}</span>}
      {aside}
    </div>
    <div className={classes.customerFormGrid}>{children}</div>
  </section>
);

// 거래처 목록 열: 머리글 오른쪽 끝을 끌어 너비를 바꾼다 (매입현황 등 다른 목록과 같은 방식)
const CUSTOMER_COLUMNS = [
  { key: 'code', label: '코드', width: 112, minWidth: 70 },
  { key: 'name', label: '상호', width: 220, minWidth: 100 },
  { key: 'ceo', label: '대표자', width: 104, minWidth: 60 },
  { key: 'bizno', label: '사업자번호', width: 120, minWidth: 80 },
  { key: 'tel', label: '전화', width: 120, minWidth: 70 },
  { key: 'fax', label: '팩스', width: 120, minWidth: 70 },
  { key: 'type', label: '거래구분', width: 96, minWidth: 70, center: true },
  { key: 'createdat', label: '등록일자', width: 100, minWidth: 80, center: true },
  { key: 'createdby', label: '등록자', width: 84, minWidth: 60 },
  { key: 'updatedat', label: '수정일자', width: 100, minWidth: 80, center: true },
  { key: 'updatedby', label: '수정자', width: 84, minWidth: 60 },
  { key: 'use', label: '사용여부', width: 86, minWidth: 64, center: true },
];

const CustomerTable = memo(function CustomerTable({
  customers,
  selectedCode,
  loading,
  onSelect,
}) {
  const [columnWidths, setColumnWidths] = useState({});
  const widthOf = (column) => columnWidths[column.key] ?? column.width;
  const tableWidth = CUSTOMER_COLUMNS.reduce((sum, column) => sum + widthOf(column), 0);

  const resizeColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column);
    const table = event.currentTarget.closest('table');
    const col = table?.querySelector(`col[data-column-key="${column.key}"]`);
    let nextWidth = startWidth;
    let frame = 0;
    const apply = () => {
      if (col) col.style.width = `${nextWidth}px`;
      if (table) table.style.width = `${tableWidth + nextWidth - startWidth}px`;
    };
    const move = (pointerEvent) => {
      nextWidth = Math.max(column.minWidth, Math.min(1200, startWidth + pointerEvent.clientX - startX));
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; apply(); });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (frame) window.cancelAnimationFrame(frame);
      apply();
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  return (
    <Table className={classes.partnerTable} style={{ width: tableWidth, minWidth: '100%' }}>
      <colgroup>
        {CUSTOMER_COLUMNS.map((column) => <col key={column.key} data-column-key={column.key} style={{ width: widthOf(column) }} />)}
      </colgroup>
      <Table.Thead>
        <Table.Tr>
          {CUSTOMER_COLUMNS.map((column) => (
            <Table.Th key={column.key} aria-label={column.label || '선택'} className={column.center ? classes.centerCell : undefined}>
              {column.label}
              {!column.fixed && <span className={classes.columnResizeHandle} role="separator" aria-label={`${column.label} 열 너비 조절`}
                onPointerDown={(event) => resizeColumn(event, column)} onClick={(event) => event.stopPropagation()} />}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {customers.length ? (
          customers.map((customer) => (
            <Table.Tr
              key={`${customer.companyid}-${customer.customercode}`}
              className={
                customer.customercode === selectedCode
                  ? classes.selectedRow
                  : ""
              }
              onClick={() => onSelect(customer)}
            >
              <Table.Td
                className={classes.codeCell}
                title={customer.customercode}
              >
                {customer.customercode}
              </Table.Td>
              <Table.Td
                className={classes.partnerNameCell}
                title={customer.customername}
              >
                {customer.customername}
              </Table.Td>
              <Table.Td title={customer.ceoname || "-"}>
                {customer.ceoname || "-"}
              </Table.Td>
              <Table.Td className={classes.numCell} title={customer.businessno || "-"}>
                {customer.businessno || "-"}
              </Table.Td>
              <Table.Td className={classes.numCell} title={customer.phone || "-"}>
                {customer.phone || "-"}
              </Table.Td>
              <Table.Td className={classes.numCell} title={customer.fax || "-"}>
                {customer.fax || "-"}
              </Table.Td>
              <Table.Td className={classes.centerCell} title={customer.tradetype || "-"}>
                <TradetypeTag value={customer.tradetype} />
              </Table.Td>
              <Table.Td className={classes.centerCell} title={listDateTime(customer.createdat)}>{listDate(customer.createdat)}</Table.Td>
              <Table.Td title={customer.createdbyname || customer.createdby || ""}>{customer.createdbyname || customer.createdby || ""}</Table.Td>
              <Table.Td className={classes.centerCell} title={listDateTime(customer.updatedat)}>{listDate(customer.updatedat)}</Table.Td>
              <Table.Td title={customer.updatedbyname || customer.updatedby || ""}>{customer.updatedbyname || customer.updatedby || ""}</Table.Td>
              <Table.Td className={classes.centerCell}>
                <StatusBadge value={customer.useryn} />
              </Table.Td>
            </Table.Tr>
          ))
        ) : (
          <Table.Tr className={classes.emptyRow}>
            <Table.Td colSpan={CUSTOMER_COLUMNS.length} className={classes.emptyCell}>
              <div className={classes.emptyState}>
                <strong>{loading ? "불러오는 중..." : "검색 결과가 없습니다."}</strong>
                {!loading && <span>검색어나 사용 여부·거래 구분 조건을 바꿔 보세요.</span>}
              </div>
            </Table.Td>
          </Table.Tr>
        )}
      </Table.Tbody>
    </Table>
  );
});

const CustomerListPanel = memo(function CustomerListPanel({
  customers,
  total,
  page,
  pageCount,
  pageSize,
  statusFilter,
  tradetypeFilter,
  query,
  loading,
  uploadProgress,
  uploadInputRef,
  onQueryChange,
  onSearch,
  onStatusChange,
  onTradetypeChange,
  onPageChange,
  onPageSizeChange,
  onDownloadTemplate,
  onUpload,
  onOpenOpeningBalances,
  onSelect,
  selectedCode,
}) {
  return (
    <Paper className={`${classes.panel} ${classes.customerListPanel}`} withBorder>
      <div className={classes.toolbar}>
        <div className={classes.toolbarTitle}>
          <Text className={classes.sectionTitle} fw={700}>거래처 목록</Text>
          <Badge color="gray" variant="light" className={classes.countBadge}>
            {Number(total || 0).toLocaleString()}건
          </Badge>
        </div>
        <div className={classes.toolbarActions}>
          <ExcelBulkActions
            onDownloadTemplate={onDownloadTemplate}
            templateTitle="거래처 일괄등록 양식(작성안내 포함)을 내려받습니다"
            inputRef={uploadInputRef}
            onUpload={onUpload}
            uploading={Boolean(uploadProgress)}
            uploadProgressLabel={uploadProgress}
            uploadDisabled={loading && !uploadProgress}
            uploadTitle="샘플 양식으로 작성한 엑셀 파일로 거래처를 한 번에 등록합니다"
            extraActions={[{ key: "opening", label: "기초잔액 엑셀", icon: IconFileSpreadsheet, onClick: onOpenOpeningBalances, title: "이미 등록된 거래처의 기초 미수금·미지급금을 엑셀로 한 번에 바꿉니다" }]}
          />
        </div>
      </div>
      <div className={classes.filterBar}>
        <TextInput
          className={classes.searchInput}
          placeholder="코드 또는 거래처명을 입력해주세요"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && onSearch()}
          size="sm"
        />
        <div className={classes.filterField}>
          <span className={classes.filterLabel}>사용 여부</span>
          <Select
            aria-label="사용 여부 필터"
            value={statusFilter}
            onChange={onStatusChange}
            data={["전체", "사용중", "사용중지"]}
            w={112}
            size="xs"
          />
        </div>
        <div className={classes.filterField}>
          <span className={classes.filterLabel}>거래 구분</span>
          <Select
            aria-label="거래구분 필터"
            value={tradetypeFilter}
            onChange={onTradetypeChange}
            data={["전체", "매입처", "매출처", "매입매출처"]}
            w={128}
            size="xs"
          />
        </div>
      </div>
      <div className={classes.customerTableWrap}>
        <CustomerTable
          customers={customers}
          selectedCode={selectedCode}
          loading={loading}
          onSelect={onSelect}
        />
      </div>
      <Group
        className={classes.customerListFooter}
        justify="space-between"
        wrap="wrap"
      >
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            총 {total}개 항목
          </Text>
          <Select
            aria-label="페이지당 표시 수"
            value={String(pageSize)}
            onChange={onPageSizeChange}
            data={PAGE_SIZE_OPTIONS}
            w={100}
            size="xs"
          />
        </Group>
        <Pagination
          total={pageCount}
          value={page}
          onChange={onPageChange}
          size="sm"
        />
      </Group>
    </Paper>
  );
});

const CustomerFormPanel = memo(function CustomerFormPanel({
  draft,
  isNew,
  onChange,
  banks,
  managers,
  canEditOpeningBalances,
}) {
  const [addressOpen, setAddressOpen] = useState(false);
  const postcodeContainerRef = useRef(null);

  const embedPostcode = useCallback(() => {
    if (!addressOpen) return;
    loadPostcodeService()
      .then(() => {
        const container = postcodeContainerRef.current;
        if (!addressOpen || !container || !window.daum?.Postcode) return;
        while (container.firstChild) container.removeChild(container.firstChild);
        new window.daum.Postcode({
          width: "100%",
          height: "100%",
          oncomplete: (data) => {
            onChange("zipcode", data.zonecode || "");
            onChange("address", data.roadAddress || data.jibunAddress || "");
            setAddressOpen(false);
          },
        }).embed(container);
      })
      .catch((error) => {
        notifications.show({
          title: "주소 검색 실패",
          message: error.message || "주소 검색 서비스를 불러오지 못했습니다.",
          color: "red",
          position: "bottom-right",
        });
        setAddressOpen(false);
      });
  }, [addressOpen, onChange]);

  const hasCustomer = isNew || Boolean(draft.customercode);
  const headerName = isNew
    ? "신규 거래처"
    : draft.customername || (hasCustomer ? "(거래처명 미입력)" : "선택된 거래처 없음");
  const headerUseyn = displayUseyn(draft.useryn);

  return (
    <Paper className={`${classes.panel} ${classes.formPanel}`} withBorder>
      <div className={classes.toolbar}>
        <div className={classes.toolbarTitle}>
          <Text className={classes.sectionTitle} fw={700}>상세 정보 입력 및 수정</Text>
        </div>
        <Badge color={isNew ? "red" : "gray"} variant="light">
          {isNew ? "신규 등록" : "조회 모드"}
        </Badge>
      </div>
      <div className={`${classes.identityStrip} ${isNew ? classes.identityStripNew : ""}`}>
        <div className={`${classes.identityText} ${classes.identityInline}`}>
          <strong title={headerName}>{headerName}</strong>
          <div className={classes.identityMeta}>
            {hasCustomer ? (
              <>
                <span className={classes.identityCode}>{draft.customercode || "코드 미발급"}</span>
                {isNew && draft.customername && (
                  <span className={classes.identityName} title={draft.customername}>{draft.customername}</span>
                )}
                <TradetypeTag value={draft.tradetype} />
                <StatusTag value={headerUseyn} />
              </>
            ) : (
              <span>왼쪽 목록에서 거래처를 선택하거나 [추가]를 누르세요.</span>
            )}
          </div>
        </div>
      </div>
      <Box className={classes.formBody}>
        {/* 기본정보: 거래처코드 · 거래구분 · 거래처명 · 대표자 */}
        <FormSection title="기본정보">
          <TextInput
            className={classes.codeInput}
            label="거래처 코드"
            value={draft.customercode}
            onChange={(event) =>
              onChange("customercode", event.currentTarget.value)
            }
            disabled={!isNew}
          />
          <Select
            label="거래구분"
            value={draft.tradetype}
            onChange={(value) => onChange("tradetype", value || "")}
            data={["매입처", "매출처", "매입매출처"]}
          />
          <TextInput
            label="거래처명"
            value={draft.customername}
            onChange={(event) =>
              onChange("customername", event.currentTarget.value)
            }
            required
          />
          <TextInput
            label="대표자"
            value={draft.ceoname}
            onChange={(event) => onChange("ceoname", event.currentTarget.value)}
          />
        </FormSection>

        {/* 사업자·연락처: 사업자 유형 · 사업자번호 · 법인번호 · 업태 · 업종 · 전화 · 팩스 · 이메일 · 주소 */}
        <FormSection title="사업자·연락처">
          <div className={`${classes.fullRow} ${classes.ownerTypeRow}`}>
            <div className={classes.fieldLabel}>사업자 유형</div>
            <div className={classes.ownerRadioRow} role="radiogroup" aria-label="사업자 유형">
              {OWNER_TYPES.map(([value, text]) => (
                <label key={value} className={classes.ownerRadio}>
                  <input type="radio" name="customer-ownertype" value={value} checked={draft.ownertype === value}
                    onChange={() => {
                      onChange("ownertype", value);
                      // 개인사업자는 법인번호가 없다 (서버도 같은 규칙으로 비운다)
                      if (value === "INDIV") onChange("corporationno", "");
                    }} />
                  {text}
                </label>
              ))}
            </div>
          </div>
          <TextInput
            label="사업자번호"
            value={draft.businessno}
            placeholder="000-00-00000"
            onChange={(event) =>
              onChange("businessno", event.currentTarget.value)
            }
          />
          <TextInput
            label="법인번호"
            value={draft.corporationno}
            placeholder={draft.ownertype === "INDIV" ? "개인사업자는 입력하지 않습니다" : "000000-0000000"}
            disabled={draft.ownertype === "INDIV"}
            onChange={(event) => onChange("corporationno", event.currentTarget.value)}
          />
          <TextInput
            label="업태"
            value={draft.businesstype}
            onChange={(event) => onChange("businesstype", event.currentTarget.value)}
          />
          <TextInput
            label="업종"
            value={draft.industry}
            onChange={(event) => onChange("industry", event.currentTarget.value)}
          />
          <TextInput
            label="전화"
            value={draft.phone}
            onChange={(event) => onChange("phone", event.currentTarget.value)}
          />
          <TextInput
            label="팩스"
            value={draft.fax}
            onChange={(event) => onChange("fax", event.currentTarget.value)}
          />
          <TextInput
            className={classes.fullRow}
            label="이메일"
            type="email"
            value={draft.email}
            onChange={(event) => onChange("email", event.currentTarget.value)}
          />
          {/* 주소: [우편번호 · 주소 · 검색] 한 줄 + 상세주소 한 줄 (주소와 같은 폭) */}
          <Group className={`${classes.addressField} ${classes.fullRow}`} align="flex-start" gap="xs" wrap="nowrap">
            <TextInput
              label="우편번호"
              value={draft.zipcode}
              placeholder="00000"
              inputMode="numeric"
              maxLength={5}
              onChange={(event) => onChange("zipcode", event.currentTarget.value)}
              style={{ flex: "0 0 88px" }}
            />
            <TextInput
              label="주소"
              value={draft.address}
              title={draft.address}
              placeholder="[주소 검색]으로 입력"
              onChange={(event) => onChange("address", event.currentTarget.value)}
              style={{ flex: "1 1 0", minWidth: 0 }}
            />
            <button type="button" className={classes.addressSearchButton} onClick={() => setAddressOpen(true)}>
              주소 검색
            </button>
          </Group>
          <TextInput
            className={classes.fullRow}
            label="상세주소"
            value={draft.address2}
            placeholder="동 · 호수 · 건물명"
            onChange={(event) => onChange("address2", event.currentTarget.value)}
          />
        </FormSection>

        {/* 부가정보: 은행 · 계좌번호 · 사용여부 · 담당자 · 기초잔액 */}
        <FormSection
          title="부가정보"
          aside={
            !canEditOpeningBalances && (
              <span className={classes.lockChip} title={OPENING_BALANCE_LOCKED_TITLE}>
                기초잔액 읽기 전용
              </span>
            )
          }
        >
          <Select
            className={classes.dropdownSelect}
            label="은행"
            value={draft.bankcode}
            onChange={(value) => onChange("bankcode", value || "")}
            data={banks.map((bank) => ({ value: bank.bankcode, label: bank.bankname }))}
            searchable
            clearable
            placeholder="은행 선택"
          />
          <TextInput
            label="계좌번호"
            value={draft.accountno}
            onChange={(event) => onChange("accountno", event.currentTarget.value)}
          />
          <Select
            label="사용 여부"
            value={displayUseyn(draft.useryn)}
            onChange={(value) => onChange("useryn", value || "")}
            data={["사용중", "사용중지"]}
          />
          {/* 담당자: 직접 입력 (회사 직원 이름은 추천으로만 보여준다) */}
          <Autocomplete
            label="업체 담당자"
            value={draft.manager}
            onChange={(value) => onChange("manager", value)}
            data={managers}
            maxLength={20}
            placeholder="업체 담당자 이름"
          />
          <NumberInput
            className={classes.amountInput}
            label="기초 미수금"
            value={draft.openingreceivable}
            onChange={(value) => onChange("openingreceivable", value)}
            disabled={!canEditOpeningBalances}
            title={canEditOpeningBalances ? OPENING_BALANCE_HELP : OPENING_BALANCE_LOCKED_TITLE}
            thousandSeparator=","
            decimalScale={2}
            allowNegative={false}
            min={0}
            max={OPENING_BALANCE_MAX}
            clampBehavior="strict"
            hideControls
            styles={{ input: { textAlign: "right" } }}
          />
          <NumberInput
            className={classes.amountInput}
            label="기초 미지급금"
            value={draft.openingpayable}
            onChange={(value) => onChange("openingpayable", value)}
            disabled={!canEditOpeningBalances}
            title={canEditOpeningBalances ? OPENING_BALANCE_HELP : OPENING_BALANCE_LOCKED_TITLE}
            thousandSeparator=","
            decimalScale={2}
            allowNegative={false}
            min={0}
            max={OPENING_BALANCE_MAX}
            clampBehavior="strict"
            hideControls
            styles={{ input: { textAlign: "right" } }}
          />
          <NumberInput
            className={classes.amountInput}
            label="여신한도"
            value={draft.creditlimit}
            onChange={(value) => onChange("creditlimit", value)}
            disabled={!canEditOpeningBalances}
            title={canEditOpeningBalances ? CREDIT_LIMIT_HELP : OPENING_BALANCE_LOCKED_TITLE}
            placeholder="한도 없음"
            thousandSeparator=","
            decimalScale={0}
            allowNegative={false}
            min={0}
            max={CREDIT_LIMIT_MAX}
            clampBehavior="strict"
            hideControls
            suffix="원"
            styles={{ input: { textAlign: "right" } }}
          />
          {!canEditOpeningBalances && <p className={`${classes.lockNote} ${classes.fullRow}`}>
            기초 미수금·미지급금 · 여신한도는 권한이 있는 직원만 바꿀 수 있습니다.
          </p>}
        </FormSection>

        <FormSection title="비고">
          <Textarea
            className={classes.fullRow}
            aria-label="비고사항"
            placeholder="비고사항"
            value={draft.remark}
            onChange={(event) => onChange("remark", event.currentTarget.value)}
            minRows={2}
            autosize
            maxRows={4}
          />
        </FormSection>
      </Box>
      <Modal
        opened={addressOpen}
        onClose={() => setAddressOpen(false)}
        onEnterTransitionEnd={embedPostcode}
        title="주소 검색"
        centered
        size="lg"
      >
        <Box ref={postcodeContainerRef} h={520} w="100%" />
      </Modal>
    </Paper>
  );
});

export default function CustomerPage() {
  const pageLayout = useContext(PageRibbonContext);
  const registerPageRibbon = pageLayout?.registerPageRibbon;
  const closeActivePage = pageLayout?.closeActivePage;
  const menuAccess = useContext(MenuAccessContext);
  // 기초잔액 · 여신한도: 거래처등록 권한이면 수정 (막으려면 통제관리 › 거래처 수정 승인)
  const canEditOpeningBalances = true;
  const companyid = localStorage.getItem("user_company") || "";
  const companyname = localStorage.getItem("user_companyname") || "";
  const [customers, setCustomers] = useState([]);
  const [selectedCode, setSelectedCode] = useState(null);
  const [draft, setDraft] = useState(emptyCustomer);
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("전체");
  const [tradetypeFilter, setTradetypeFilter] = useState("전체");
  const [banks, setBanks] = useState([]);
  const [managers, setManagers] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allocatingCode, setAllocatingCode] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const uploadInputRef = useRef(null);
  const customerPageCacheRef = useRef(new Map());
  const customerPageRequestsRef = useRef(new Map());
  const customerCacheEpochRef = useRef(0);
  const latestListRequestRef = useRef(0);
  const currentTotalRef = useRef(0);
  const currentTotalFilterKeyRef = useRef(null);
  const forceTotalNextRef = useRef(false);
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [pageSize, total],
  );

  useEffect(() => {
    if (!companyid) return;
    axios.get("/api/banks", { ...authConfig(), params: { companyid } })
      .then(({ data }) => setBanks(data.data || []))
      .catch((error) => {
        setBanks([]);
        notifications.show({
          title: "은행 목록을 불러오지 못했습니다.",
          message: errorMessage(error, "은행 API 응답을 확인해 주세요."),
          color: "red",
        });
      });
  }, [companyid]);

  useEffect(() => {
    if (!companyid) return;
    axios.get("/api/managers", authConfig())
      .then(({ data }) => setManagers(data.data || []))
      .catch((error) => {
        setManagers([]);
        notifications.show({
          title: "담당자 목록을 불러오지 못했습니다.",
          message: errorMessage(error, "사용자 API 응답을 확인해 주세요."),
          color: "red",
        });
      });
  }, [companyid]);

  const requestCustomerPage = useCallback(
    (requestedPage, knownTotal, includeTotal = requestedPage === 1) => {
      const cacheKey = makeCustomerPageCacheKey({
        companyid,
        search: appliedQuery,
        status: statusFilter,
        tradetype: tradetypeFilter,
        pageSize,
        page: requestedPage,
      });
      const cached = customerPageCacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < CUSTOMER_PAGE_CACHE_TTL_MS) {
        customerPageCacheRef.current.delete(cacheKey);
        const refreshedCache = {
          ...cached,
          total: cached.totalKnown
            ? cached.total
            : (knownTotal ?? cached.total),
        };
        customerPageCacheRef.current.set(cacheKey, refreshedCache);
        if (!includeTotal || cached.totalKnown)
          return Promise.resolve(refreshedCache);
      }
      if (cached) customerPageCacheRef.current.delete(cacheKey);

      const existingRequest = customerPageRequestsRef.current.get(cacheKey);
      if (existingRequest) return existingRequest;

      const requestEpoch = customerCacheEpochRef.current;
      const request = axios
        .get("/api/list", {
          params: {
            companyid,
            search_keyword: appliedQuery || undefined,
            status: statusFilter === "전체" ? undefined : statusFilter,
            tradetype: tradetypeFilter === "전체" ? undefined : tradetypeFilter,
            page: requestedPage,
            page_size: pageSize,
            include_total: includeTotal,
          },
          ...authConfig(),
        })
        .then(({ data }) => {
          if (data.success === false)
            throw new Error(data.error || "거래처 목록을 불러오지 못했습니다.");
          const result = {
            rows: (data.data || []).map(toCustomer),
            total: data.total ?? knownTotal ?? (data.data || []).length,
            totalKnown: data.total !== undefined && data.total !== null,
            cachedAt: Date.now(),
          };
          if (requestEpoch === customerCacheEpochRef.current) {
            customerPageCacheRef.current.set(cacheKey, result);
            if (customerPageCacheRef.current.size > CUSTOMER_PAGE_CACHE_LIMIT) {
              const oldestKey = customerPageCacheRef.current
                .keys()
                .next().value;
              customerPageCacheRef.current.delete(oldestKey);
            }
          }
          return result;
        })
        .finally(() => {
          if (customerPageRequestsRef.current.get(cacheKey) === request) {
            customerPageRequestsRef.current.delete(cacheKey);
          }
        });

      customerPageRequestsRef.current.set(cacheKey, request);
      return request;
    },
    [appliedQuery, companyid, pageSize, statusFilter, tradetypeFilter],
  );

  const loadCustomers = useCallback(
    async (forceTotal = false) => {
      if (!companyid) return;
      const requestId = ++latestListRequestRef.current;
      const totalFilterKey = JSON.stringify([
        companyid,
        appliedQuery,
        statusFilter,
        tradetypeFilter,
      ]);
      const hasKnownTotal = currentTotalFilterKeyRef.current === totalFilterKey;
      const includeTotal =
        forceTotal || forceTotalNextRef.current || !hasKnownTotal;
      forceTotalNextRef.current = false;
      const knownTotal = hasKnownTotal ? currentTotalRef.current : null;
      const cacheKey = makeCustomerPageCacheKey({
        companyid,
        search: appliedQuery,
        status: statusFilter,
        tradetype: tradetypeFilter,
        pageSize,
        page,
      });
      const cached = customerPageCacheRef.current.get(cacheKey);
      setListLoading(
        !cached || Date.now() - cached.cachedAt >= CUSTOMER_PAGE_CACHE_TTL_MS,
      );
      try {
        const result = await requestCustomerPage(
          page,
          knownTotal,
          includeTotal,
        );
        if (requestId !== latestListRequestRef.current) return;
        if (result.total !== null && result.total !== undefined) {
          currentTotalRef.current = result.total;
          currentTotalFilterKeyRef.current = totalFilterKey;
        }
        setCustomers(result.rows);
        setTotal(result.total);
        setSelectedCode(
          (current) => current || result.rows[0]?.customercode || null,
        );
        if (page < Math.ceil(result.total / pageSize)) {
          // Keep the next page warm so sequential paging avoids waiting on another round trip.
          requestCustomerPage(page + 1, result.total, false).catch(() => {});
        }
      } catch (error) {
        if (requestId !== latestListRequestRef.current) return;
        notifications.show({
          title: "목록 조회 실패",
          message: errorMessage(error, "서버 연결을 확인해 주세요."),
          color: "red",
          position: "bottom-right",
        });
      } finally {
        if (requestId === latestListRequestRef.current) setListLoading(false);
      }
    },
    [
      appliedQuery,
      companyid,
      page,
      pageSize,
      requestCustomerPage,
      statusFilter,
      tradetypeFilter,
    ],
  );

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (isNew) return;
    const selected = customers.find(
      (customer) => customer.customercode === selectedCode,
    );
    if (selected) setDraft(selected);
    else if (customers.length === 0 && !selectedCode) setDraft(emptyCustomer());
  }, [customers, isNew, selectedCode]);

  const selectCustomer = useCallback((customer) => {
    setSelectedCode(customer.customercode);
    setDraft(customer);
    setIsNew(false);
  }, []);

  // 기초잔액 엑셀 (이미 등록된 거래처의 기초 미수금·미지급금 일괄 반영)
  const [openingModalOpen, setOpeningModalOpen] = useState(false);
  const openOpeningBalances = useCallback(() => setOpeningModalOpen(true), []);
  const closeOpeningBalances = useCallback(() => setOpeningModalOpen(false), []);

  const handleQueryChange = useCallback((value) => setQuery(value), []);
  const handleSearch = useCallback(() => {
    setPage(1);
    setAppliedQuery(query.trim());
  }, [query]);
  const handleStatusChange = useCallback((value) => {
    setStatusFilter(value || "전체");
    setPage(1);
  }, []);
  const handleTradetypeChange = useCallback((value) => {
    setTradetypeFilter(value || "전체");
    setPage(1);
  }, []);
  const handlePageSizeChange = useCallback((value) => {
    setPageSize(Number(value) || 20);
    setPage(1);
  }, []);
  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);
  const startNewCustomer = useCallback(async () => {
    if (!companyid) {
      notifications.show({
        title: "회사 정보 갱신 필요",
        message: "로그아웃한 뒤 다시 로그인해 주세요.",
        color: "orange",
        position: "bottom-right",
      });
      return;
    }
    setAllocatingCode(true);
    try {
      const { data } = await axios.get("/api/next-code", {
        ...authConfig(),
        params: { companyid },
      });
      setDraft({ ...emptyCustomer(), customercode: data.customercode });
      setSelectedCode(null);
      setIsNew(true);
    } catch (error) {
      notifications.show({
        title: "거래처코드 발급 실패",
        message: errorMessage(error, "다시 시도해 주세요."),
        color: "red",
        position: "bottom-right",
      });
    } finally {
      setAllocatingCode(false);
    }
  }, [companyid]);

  // 반영 후: 목록을 다시 읽고, 폼에 열려 있는 거래처의 기초잔액도 새 금액으로 맞춘다.
  const applyOpeningToDraft = useCallback((appliedRows) => {
    const toAmount = (value) => {
      const number = Number(String(value ?? "").replace(/,/g, "").trim() || 0);
      return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
    };
    const byCode = new Map((appliedRows || []).map((row) => [String(row.customercode).toLowerCase(), row]));
    setDraft((current) => {
      const row = current?.customercode && byCode.get(String(current.customercode).toLowerCase());
      return row ? { ...current, openingreceivable: toAmount(row.openingreceivable), openingpayable: toAmount(row.openingpayable) } : current;
    });
  }, []);

  const refreshAfterWrite = useCallback(
    async (resetFilters = false) => {
      customerCacheEpochRef.current += 1;
      customerPageCacheRef.current.clear();
      customerPageRequestsRef.current.clear();
      // 다른 화면(매입·매출·수금 등록)이 지난 거래처 목록으로 먼저 채우지 않게 공유 캐시도 비운다
      invalidateMaster('customers:');
      if (!resetFilters) return loadCustomers(true);
      forceTotalNextRef.current = true;
      const alreadyAtDefault =
        page === 1 &&
        !appliedQuery &&
        statusFilter === "전체" &&
        tradetypeFilter === "전체";
      setPage(1);
      setAppliedQuery("");
      setQuery("");
      setStatusFilter("전체");
      setTradetypeFilter("전체");
      if (alreadyAtDefault) await loadCustomers(true);
    },
    [appliedQuery, loadCustomers, page, statusFilter, tradetypeFilter],
  );
  const handleOpeningApplied = useCallback((appliedRows) => {
    applyOpeningToDraft(appliedRows);
    void refreshAfterWrite();
  }, [applyOpeningToDraft, refreshAfterWrite]);

  const saveCustomer = useCallback(async () => {
    if (!draft.customername.trim()) {
      notifications.show({
        title: "필수 항목 확인",
        message: "거래처명은 필수입니다.",
        color: "red",
        position: "bottom-right",
      });
      return;
    }
    if (!draft.companyid || !draft.companyname) {
      notifications.show({
        title: "회사 정보 갱신 필요",
        message: "로그아웃한 뒤 다시 로그인해 주세요.",
        color: "orange",
        position: "bottom-right",
      });
      return;
    }
    const creating = isNew;
    const payload = {
      ...draft,
      customercode: draft.customercode.trim(),
      customername: draft.customername.trim(),
      openingreceivable: parseOpeningAmount(draft.openingreceivable) ?? 0,
      openingpayable: parseOpeningAmount(draft.openingpayable) ?? 0,
      creditlimit: parseCreditLimit(draft.creditlimit) ?? null,
    };
    setSaving(true);
    try {
      const { data } = await axios.post(
        creating ? "/api/create" : "/api/update",
        payload,
        authConfig(),
      );
      if (data.success === false)
        throw new Error(data.message || "저장하지 못했습니다.");
      // 승인 통제: 승인요청으로 보관됨 (승인되면 반영). 새 거래처는 입력칸을 비워 다시 요청하지 않게
      if (isApprovalPending(data)) {
        notifyApprovalPending(data);
        if (creating) void startNewCustomer();
        return;
      }
      const savedCustomer = {
        ...payload,
        customercode: data.customercode || payload.customercode,
        creditlimit: payload.creditlimit ?? "",
      };
      notifications.show({
        title: creating ? "등록 완료" : "수정 완료",
        message: data.message || "거래처 정보를 저장했습니다.",
        color: "teal",
        position: "bottom-right",
      });
      setIsNew(false);
      setSelectedCode(savedCustomer.customercode);
      setDraft(savedCustomer);
      // The write has committed. Refresh the table in the background so the save button
      // does not stay busy while the list count and current page are fetched again.
      void refreshAfterWrite(creating);
    } catch (error) {
      notifications.show({
        title: creating ? "등록 실패" : "변경 실패",
        message: errorMessage(error, "거래처 저장에 실패했습니다."),
        color: "red",
        icon: <IconX size={18} />,
        position: "bottom-right",
      });
    } finally {
      setSaving(false);
    }
  }, [draft, isNew, refreshAfterWrite, startNewCustomer]);

  const downloadTemplate = useCallback(async () => {
    // 1번 시트 '거래처' = 업로드할 데이터 (상세 화면 입력 순서), 2번 시트 '작성안내' = 칼럼별 입력 규칙 · 은행 목록
    const headers = CUSTOMER_EXCEL_COLUMNS.map((column) => column.header);
    const sample = {
      customercode: "", tradetype: "매입처", customername: "(예시) 모스코상사 - 이 줄은 지우고 작성", ceoname: "홍길동",
      ownertype: "법인사업자", businessno: "", corporationno: "", businesstype: "도매", industry: "철강재",
      phone: "02-1234-5678", fax: "", email: "", zipcode: "", address: "", address2: "",
      bankcode: banks[0]?.bankname || "", accountno: "", useryn: "사용중", manager: "", openingreceivable: 0, openingpayable: 0, creditlimit: "", remark: "",
    };
    const XLSX = await loadXLSXOrNotify();
    if (!XLSX) return;
    const worksheet = XLSX.utils.aoa_to_sheet([headers, CUSTOMER_EXCEL_COLUMNS.map((column) => sample[column.key])]);
    markTextColumns(worksheet, CUSTOMER_EXCEL_COLUMNS, TEMPLATE_TEXT_ROWS, XLSX);
    applyExcelHeaderStyle(worksheet, headers.length);
    worksheet["!cols"] = CUSTOMER_EXCEL_COLUMNS.map((column) => ({ wch: column.width }));

    const guideRows = [
      ["칼럼", "필수", "입력 방법"],
      ...CUSTOMER_EXCEL_COLUMNS.map((column) => [column.header, column.required ? "필수" : "", column.guide || ""]),
      [],
      ["※ 첫 번째 시트('거래처')만 읽습니다. 첫 줄 제목은 바꾸지 마세요. 예시 줄은 지우고 작성해 주세요."],
      ["※ 틀린 행은 등록하지 않고 행 번호와 이유를 알려 드립니다. 나머지 행은 등록됩니다."],
      [],
      ["은행 목록 (기본정보관리)"],
      ...banks.map((bank) => [bank.bankname]),
    ];
    const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
    applyExcelHeaderStyle(guideSheet, 3);
    guideSheet["!cols"] = [{ wch: 16 }, { wch: 6 }, { wch: 80 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "거래처");
    XLSX.utils.book_append_sheet(workbook, guideSheet, "작성안내");
    XLSX.writeFile(workbook, "거래처_일괄등록_양식.xlsx");
  }, [banks]);

  const exportCustomers = useCallback(async () => {
    if (!companyid) return;
    setExportLoading(true);
    try {
      const { data } = await axios.get("/api/export", {
        ...authConfig(),
        params: {
          companyid,
          search_keyword: appliedQuery || undefined,
          status: statusFilter === "전체" ? undefined : statusFilter,
          tradetype: tradetypeFilter === "전체" ? undefined : tradetypeFilter,
        },
      });
      if (data.success === false)
        throw new Error(data.error || "엑셀 데이터를 불러오지 못했습니다.");
      // 양식과 같은 칼럼명 · 순서 (그대로 고쳐서 다시 올릴 수 있다) → 목록의 등록일자 · 등록자 · 수정일자 · 수정자
      const headers = [...CUSTOMER_EXCEL_COLUMNS.map((column) => column.header), "등록일자", "등록자", "수정일자", "수정자"];
      const valueOf = (customer, key) => {
        if (key === "ownertype") return customer.ownertype === "INDIV" ? "개인사업자" : "법인사업자";
        if (key === "bankcode") {
          return customer.bankname ?? banks.find((bank) =>
            String(bank.bankcode ?? "").trim().toLocaleLowerCase() === String(customer.bankcode ?? "").trim().toLocaleLowerCase())?.bankname ?? "";
        }
        if (key === "useryn") return displayUseyn(customer.useryn ?? customer.useyn);
        if (key === "openingreceivable" || key === "openingpayable") return parseOpeningAmount(customer[key]) ?? 0;
        if (key === "creditlimit") return customer.creditlimit === null || customer.creditlimit === undefined ? "" : Number(customer.creditlimit);
        return customer[key] ?? "";
      };
      const XLSX = await loadXLSXOrNotify();
      if (!XLSX) return;
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...(data.data || []).map((customer) => [
          ...CUSTOMER_EXCEL_COLUMNS.map((column) => valueOf(customer, column.key)),
          listDateTime(customer.createdat),
          customer.createdbyname ?? "",
          listDateTime(customer.updatedat),
          customer.updatedbyname ?? "",
        ]),
      ]);
      markTextColumns(worksheet, CUSTOMER_EXCEL_COLUMNS, (data.data || []).length, XLSX);
      applyExcelHeaderStyle(worksheet, headers.length);
      worksheet["!cols"] = [...CUSTOMER_EXCEL_COLUMNS.map((column) => ({ wch: column.width })), { wch: 17 }, { wch: 10 }, { wch: 17 }, { wch: 10 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "거래처목록");
      const now = kstDate(); // 파일 이름 날짜: 한국 시간 기준 (toISOString 은 UTC 라 새벽에는 전날로 찍힌다)
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      XLSX.writeFile(workbook, `거래처목록_${date}.xlsx`);
      notifications.show({
        title: "엑셀 다운로드 완료",
        message: `${(data.data || []).length.toLocaleString()}건을 저장했습니다.`,
        color: "teal",
        position: "bottom-right",
      });
    } catch (error) {
      notifications.show({
        title: "엑셀 다운로드 실패",
        message: errorMessage(error, "거래처 데이터를 내려받지 못했습니다."),
        color: "red",
        position: "bottom-right",
      });
    } finally {
      setExportLoading(false);
    }
  }, [appliedQuery, banks, companyid, statusFilter, tradetypeFilter]);

  const uploadCustomers = useCallback(
    async (event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      if (!companyid || !companyname) {
        notifications.show({
          title: "회사 정보 갱신 필요",
          message: "로그아웃한 뒤 다시 로그인해 주세요.",
          color: "orange",
          position: "bottom-right",
        });
        return;
      }

      setUploadProgress("엑셀 파일 읽는 중");
      try {
        const XLSX = await loadXLSXOrNotify();
        if (!XLSX) return;
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (rows.length > 10000)
          throw new Error("한 번에 최대 10,000행까지 등록할 수 있습니다.");
        // 지금 등록된 거래처코드: 이미 있는 코드는 그 행만 빼고 나머지를 등록한다 (서버는 하나라도 겹치면 전체를 거부)
        setUploadProgress("등록된 거래처코드 확인 중");
        const { data: existingData } = await axios.get("/api/opening-balances", authConfig());
        const existingCodes = new Set((existingData.items || []).map((item) => String(item.customercode || "").trim().toLowerCase()));
        const imported = rows
          .map((row, rowIndex) => {
            const customer = { ...emptyCustomer(), tradetype: "" };
            customer.companyid = companyid;
            customer.companyname = companyname;
            Object.entries(row).forEach(([header, value]) => {
              const field = CUSTOMER_HEADER_LOOKUP.get(excelHeaderKey(header));
              if (field) customer[field] = String(value ?? "").trim();
            });
            customer.zipcode = normalizeZipcode(customer.zipcode);
            const importedBankValue = customer.bankcode.trim().toLocaleLowerCase();
            const bankMatch = importedBankValue
              ? banks.find((bank) => bank.bankcode.trim().toLocaleLowerCase() === importedBankValue)
                || banks.find((bank) => bank.bankname.trim().toLocaleLowerCase() === importedBankValue)
              : null;
            if (bankMatch) customer.bankcode = bankMatch.bankcode;
            // Only MASTER/SUBMASTER may set opening balances; others always register 0 (the server enforces the same).
            const openingReceivable = canEditOpeningBalances ? parseOpeningAmount(customer.openingreceivable) : 0;
            const openingPayable = canEditOpeningBalances ? parseOpeningAmount(customer.openingpayable) : 0;
            customer.openingreceivable = openingReceivable ?? 0;
            customer.openingpayable = openingPayable ?? 0;
            // 여신한도도 관리자만 (그 외 계정은 비워서 등록, 서버도 같은 규칙)
            const creditLimit = canEditOpeningBalances ? parseCreditLimit(customer.creditlimit) : null;
            customer.creditlimit = creditLimit ?? null;
            return {
              customer,
              excelRow: rowIndex + 2,
              bankError: Boolean(importedBankValue && !bankMatch),
              openingError: openingReceivable === null || openingPayable === null,
              creditError: creditLimit === undefined,
            };
          })
          .filter(({ customer }) => customer.customercode || customer.customername);

        if (!imported.length)
          throw new Error(
            "업로드할 데이터가 없습니다. 양식의 첫 번째 시트('거래처')를 확인해 주세요.",
          );
        const failures = [];
        const validCustomers = [];
        const codesInFile = new Map();
        imported.forEach(({ customer, excelRow, bankError, openingError, creditError }) => {
          const rowErrors = [];
          const code = customer.customercode.trim();
          if (code) {
            if (existingCodes.has(code.toLowerCase())) rowErrors.push(`이미 등록된 거래처코드(${code})`);
            if (codesInFile.has(code.toLowerCase())) rowErrors.push(`${codesInFile.get(code.toLowerCase())}행과 같은 거래처코드(${code})`);
            else codesInFile.set(code.toLowerCase(), excelRow);
          }
          if (!customer.customername) rowErrors.push("거래처명 필수");
          if (customer.customername.startsWith("(예시)")) rowErrors.push("예시 줄 (지우고 작성)");
          if (!customer.tradetype) customer.tradetype = "매입처";
          else if (!TRADETYPES.includes(customer.tradetype)) rowErrors.push(`거래구분은 ${TRADETYPES.join(" / ")}`);
          const ownerText = String(customer.ownertype || "").trim();
          if (!ownerText || ["법인", "법인사업자", "CORP"].includes(ownerText.toUpperCase())) customer.ownertype = "CORP";
          else if (["개인", "개인사업자", "INDIV"].includes(ownerText.toUpperCase())) customer.ownertype = "INDIV";
          else rowErrors.push("사업자유형은 법인사업자 / 개인사업자");
          const useText = String(customer.useryn || "").trim();
          if (!useText || ["사용중", "Y"].includes(useText.toUpperCase())) customer.useryn = "Y";
          else if (["사용중지", "미사용", "N"].includes(useText.toUpperCase())) customer.useryn = "N";
          else rowErrors.push("사용여부는 사용중 / 사용중지");
          if (customer.manager.length > 20) rowErrors.push("업체 담당자는 20자 이내");
          if (bankError) rowErrors.push("기본정보관리에 등록되지 않은 은행");
          if (creditError) rowErrors.push("여신한도는 0 이상 숫자");
          if (openingError) rowErrors.push("기초 미수금 / 기초 미지급금은 0 이상의 숫자");
          if (customer.businessno && !validBusinessNo(customer.businessno)) rowErrors.push(`사업자번호 확인(${customer.businessno})`);
          if (customer.ownertype === "INDIV") customer.corporationno = ""; // 개인사업자는 법인번호 없음 (서버도 같은 규칙)
          else if (customer.corporationno && !validCorporationNo(customer.corporationno)) rowErrors.push(`법인번호 확인(${customer.corporationno})`);
          if (rowErrors.length) failures.push(`${excelRow}행: ${rowErrors.join(", ")}`);
          else validCustomers.push(customer);
        });

        let generatedCount = 0;
        if (validCustomers.length) {
          setUploadProgress(
            `${validCustomers.length.toLocaleString()}건 서버 등록 중`,
          );
          const { data } = await axios.post("/api/bulk-create", {
            customers: validCustomers,
          }, authConfig());
          if (data.success === false)
            throw new Error(data.message || "일괄 등록에 실패했습니다.");
          if (isApprovalPending(data)) {
            notifyApprovalPending(data);
            return;
          }
          generatedCount = (data.generated_codes || []).length;
        }
        notifications.show({
          title: failures.length
            ? validCustomers.length ? "일괄 등록 완료 (일부 제외)" : "일괄 등록 중단"
            : "일괄 등록 완료",
          message: <div>
            <div>{validCustomers.length.toLocaleString()}건 등록{generatedCount ? ` (자동 채번 ${generatedCount}건)` : ""}{failures.length ? `, ${failures.length.toLocaleString()}건 제외` : ""}</div>
            {failures.length > 0 && <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
              {failures.map((failure) => <div key={failure}>{failure}</div>)}
            </div>}
          </div>,
          color: failures.length ? "orange" : "teal",
          position: "bottom-right",
          // 제외된 행이 있으면 사용자가 닫을 때까지 둔다 (이유를 다 읽을 수 있게)
          autoClose: failures.length ? false : 7000,
        });
        if (validCustomers.length > 0) await refreshAfterWrite(true);
      } catch (error) {
        notifications.show({
          title: "엑셀 업로드 실패",
          message: errorMessage(error, "파일을 읽지 못했습니다."),
          color: "red",
          icon: <IconX size={18} />,
          position: "bottom-right",
        });
      } finally {
        setUploadProgress("");
      }
    },
    [banks, canEditOpeningBalances, companyid, companyname, refreshAfterWrite],
  );

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(
      <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconSearch size={15} />} onClick={handleSearch} loading={listLoading}>조회</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconPlus size={15} />} onClick={startNewCustomer} loading={allocatingCode}>추가</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconCopy size={15} />} disabled>복사</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconDeviceFloppy size={15} />} onClick={saveCustomer} loading={saving || allocatingCode} disabled={allocatingCode}>저장</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconTrash size={15} />} disabled>삭제</Button>
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconFileSpreadsheet size={15} />} onClick={exportCustomers} loading={exportLoading} disabled={listLoading}>엑셀</Button>
        <span className={classes.ribbonSeparator} />
        <Button className={classes.ribbonTool} variant="subtle" size="sm" leftSection={<IconX size={15} />} onClick={closeActivePage}>닫기</Button>
      </Group>,
    );
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, closeActivePage, handleSearch, listLoading, startNewCustomer, allocatingCode, exportCustomers, exportLoading, saveCustomer, saving]);

  return (
    <Box className={`${sharedClasses.pageShell} ${classes.page} ${classes.simple}`}>
      <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
        <Group gap={7}>
          <Text component="span" className={classes.breadcrumbParent}>거래처관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>거래처등록</Text>
        </Group>
      </Box>

      <div className={classes.workspace}>
        <CustomerListPanel
          customers={customers}
          total={total}
          page={page}
          pageCount={pageCount}
          pageSize={pageSize}
          statusFilter={statusFilter}
          tradetypeFilter={tradetypeFilter}
          query={query}
          loading={listLoading}
          uploadProgress={uploadProgress}
          uploadInputRef={uploadInputRef}
          onQueryChange={handleQueryChange}
          onSearch={handleSearch}
          onStatusChange={handleStatusChange}
          onTradetypeChange={handleTradetypeChange}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          onDownloadTemplate={downloadTemplate}
          onUpload={uploadCustomers}
          onOpenOpeningBalances={openOpeningBalances}
          onSelect={selectCustomer}
          selectedCode={selectedCode}
        />
        <CustomerFormPanel
          draft={draft}
          isNew={isNew}
          onChange={updateDraft}
          banks={banks}
          managers={managers}
          canEditOpeningBalances={canEditOpeningBalances}
        />
      </div>
      <OpeningBalanceModal opened={openingModalOpen} onClose={closeOpeningBalances} canEdit={canEditOpeningBalances} onApplied={handleOpeningApplied} />
    </Box>
  );
}
