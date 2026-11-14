import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
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
import XLSX from "xlsx-js-style";
import { applyExcelHeaderStyle } from '../../utils/excelHeaderStyle';
import sharedClasses from "../../styles/pages/ManagementShared.module.css";
import classes from "../../styles/pages/CustomerPage.module.css";
import { MenuAccessContext, PageRibbonContext } from "../../components/layout/MainLayout";
import OpeningBalanceModal from "./OpeningBalanceModal";
import ExcelBulkActions from '../../components/common/ExcelBulkActions';

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

// 기초 미수금/미지급금은 MASTER/SUBMASTER만 설정·변경할 수 있습니다 (서버에서도 동일하게 검사).
const OPENING_BALANCE_AUTHORITIES = ["MASTER", "SUBMASTER"];
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
});

const toCustomer = (row) => ({
  companyid: row.companyid ?? "",
  companyname: row.companyname ?? "",
  customercode: row.customercode ?? "",
  customername: row.customername ?? "",
  businessno: row.businessno ?? "",
  corporationno: row.corporationno ?? "",
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
});

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).join(", ");
  return detail || error.response?.data?.message || error.message || fallback;
};

const TRADETYPE_TONE = { 매입처: "purchase", 매출처: "sales", 매입매출처: "both" };
const OPENING_BALANCE_LOCKED_TITLE = "MASTER/SUBMASTER 권한만 변경할 수 있습니다.";

const StatusTag = ({ value }) => (
  <span className={`${classes.tag} ${value === "사용중" ? classes.tagActive : classes.tagInactive}`}>
    {value}
  </span>
);

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
              <Table.Td className={classes.centerCell}>
                <StatusTag value={customer.useryn} />
              </Table.Td>
            </Table.Tr>
          ))
        ) : (
          <Table.Tr className={classes.emptyRow}>
            <Table.Td colSpan={8} className={classes.emptyCell}>
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
            templateTitle="거래처 일괄등록 샘플 양식을 내려받습니다"
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
        <div className={classes.identityText}>
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
          <TextInput
            label="대표자"
            value={draft.ceoname}
            onChange={(event) => onChange("ceoname", event.currentTarget.value)}
          />
          <TextInput
            className={classes.fullRow}
            label="거래처명"
            value={draft.customername}
            onChange={(event) =>
              onChange("customername", event.currentTarget.value)
            }
            required
          />
        </FormSection>

        <FormSection title="사업자·연락처">
          <TextInput
            label="사업자등록번호"
            value={draft.businessno}
            placeholder="예시 입력값 000-00-00000"
            onChange={(event) =>
              onChange("businessno", event.currentTarget.value)
            }
          />
          <TextInput
            label="법인등록번호"
            value={draft.corporationno}
            placeholder="예시 입력값 000000-0000000"
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

        <FormSection title="거래·담당">
          <Select
            label="거래구분"
            value={draft.tradetype}
            onChange={(value) => onChange("tradetype", value || "")}
            data={["매입처", "매출처", "매입매출처"]}
          />
          <Select
            label="사용 여부"
            value={displayUseyn(draft.useryn)}
            onChange={(value) => onChange("useryn", value || "")}
            data={["사용중", "사용중지"]}
          />
          <Select
            className={classes.dropdownSelect}
            label="담당자"
            value={managers.includes(draft.manager) ? draft.manager : null}
            onChange={(value) => onChange("manager", value || "")}
            data={managers}
            searchable
            clearable
            placeholder="담당자 선택"
          />
        </FormSection>

        <FormSection title="계좌">
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
        </FormSection>

        <FormSection
          title="기초잔액"
          hint={OPENING_BALANCE_HELP}
          aside={
            !canEditOpeningBalances && (
              <span className={classes.lockChip} title={OPENING_BALANCE_LOCKED_TITLE}>
                읽기 전용
              </span>
            )
          }
        >
          <NumberInput
            className={classes.amountInput}
            label="기초 미수금"
            value={draft.openingreceivable}
            onChange={(value) => onChange("openingreceivable", value)}
            disabled={!canEditOpeningBalances}
            title={canEditOpeningBalances ? undefined : OPENING_BALANCE_LOCKED_TITLE}
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
            title={canEditOpeningBalances ? undefined : OPENING_BALANCE_LOCKED_TITLE}
            thousandSeparator=","
            decimalScale={2}
            allowNegative={false}
            min={0}
            max={OPENING_BALANCE_MAX}
            clampBehavior="strict"
            hideControls
            styles={{ input: { textAlign: "right" } }}
          />
          {!canEditOpeningBalances && (
            <p className={`${classes.lockNote} ${classes.fullRow}`}>
              기초 미수금·미지급금은 MASTER/SUBMASTER 권한만 변경할 수 있습니다.
            </p>
          )}
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
  const canEditOpeningBalances = OPENING_BALANCE_AUTHORITIES.includes(
    String(menuAccess?.authority || "USER").toUpperCase(),
  );
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
    if (draft.manager && !managers.includes(draft.manager)) {
      notifications.show({
        message: "담당자 정보가 사용자 목록에 없습니다. 담당자를 다시 선택해 주세요.",
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
      const savedCustomer = {
        ...payload,
        customercode: data.customercode || payload.customercode,
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
  }, [draft, isNew, managers, refreshAfterWrite]);

  const downloadTemplate = useCallback(() => {
    const headers = [
      "거래처코드",
      "거래처명",
      "사업자번호",
      "법인번호",
      "대표자명",
      "거래구분",
      "업태",
      "업종",
      "담당자",
      "우편번호",
      "주소",
      "상세주소",
      "전화번호",
      "팩스",
      "이메일",
      "은행명",
      "계좌번호",
      "사용여부",
      "비고",
      "기초미수금",
      "기초미지급금",
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      ["CUST001", "거래처명", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 0, 0],
    ]);
    applyExcelHeaderStyle(worksheet, headers.length);
    worksheet["!cols"] = headers.map(() => ({ wch: 18 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "거래처");
    XLSX.writeFile(workbook, "거래처_일괄등록_샘플.xlsx");
  }, []);

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
      const headers = [
        "거래처코드",
        "거래처명",
        "사업자번호",
        "법인번호",
        "대표자명",
        "거래구분",
        "업태",
        "업종",
        "담당자",
        "우편번호",
        "주소",
        "상세주소",
        "전화번호",
        "팩스",
        "이메일",
        "은행명",
        "계좌번호",
        "사용여부",
        "비고",
        "기초미수금",
        "기초미지급금",
        "등록자",
        "수정자",
      ];
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...(data.data || []).map((customer) => [
          customer.customercode ?? "",
          customer.customername ?? "",
          customer.businessno ?? "",
          customer.corporationno ?? "",
          customer.ceoname ?? "",
          customer.tradetype ?? "",
          customer.businesstype ?? "",
          customer.industry ?? "",
          customer.manager ?? "",
          customer.zipcode ?? "",
          customer.address ?? "",
          customer.address2 ?? "",
          customer.phone ?? "",
          customer.fax ?? "",
          customer.email ?? "",
          customer.bankname ??
            banks.find(
              (bank) =>
                String(bank.bankcode ?? "").trim().toLocaleLowerCase() ===
                String(customer.bankcode ?? "").trim().toLocaleLowerCase(),
            )?.bankname ??
            "",
          customer.accountno ?? "",
          displayUseyn(customer.useryn ?? customer.useyn),
          customer.remark ?? "",
          parseOpeningAmount(customer.openingreceivable) ?? 0,
          parseOpeningAmount(customer.openingpayable) ?? 0,
          customer.createdbyname ?? "",
          customer.updatedbyname ?? "",
        ]),
      ]);
      applyExcelHeaderStyle(worksheet, headers.length);
      worksheet["!cols"] = headers.map((_, index) => ({
        wch: index === 1 ? 26 : index === 10 ? 36 : 18,
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "거래처목록");
      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
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
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (rows.length > 10000)
          throw new Error("한 번에 최대 10,000행까지 등록할 수 있습니다.");
        const aliases = {
          customercode: [
            "customercode",
            "거래처코드",
            "거래처 코드",
            "거래처코드(자동채번)",
            "거래처코드(선택/자동채번)",
          ],
          customername: [
            "customername",
            "거래처명",
            "거래처명(상호)",
            "상호명",
          ],
          businessno: ["businessno", "사업자번호", "사업자등록번호"],
          corporationno: ["corporationno", "법인번호", "법인등록번호"],
          ceoname: ["ceoname", "대표자명", "대표자", "대표자 성명"],
          tradetype: ["tradetype", "거래구분"],
          businesstype: ["businesstype", "업태"],
          industry: ["industry", "업종"],
          manager: ["manager", "담당자"],
          zipcode: ["zipcode", "우편번호", "우편 번호"],
          phone: ["phone", "전화번호", "대표 연락처", "연락처"],
          fax: ["fax", "팩스"],
          email: ["email", "이메일", "메일"],
          bankcode: ["bankname", "은행명", "은행", "bankcode", "은행코드", "bank"],
          accountno: ["accountno", "계좌번호", "계좌"],
          address: ["address", "주소", "사업장 주소"],
          address2: ["address2", "상세주소", "상세 주소"],
          useryn: ["useryn", "사용여부", "사용 여부"],
          remark: ["remark", "비고"],
          openingreceivable: ["openingreceivable", "기초미수금", "기초 미수금"],
          openingpayable: ["openingpayable", "기초미지급금", "기초 미지급금"],
        };
        const imported = rows
          .map((row, rowIndex) => {
            const normalized = Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key.trim().toLowerCase(),
                String(value).trim(),
              ]),
            );
            const customer = { ...emptyCustomer(), tradetype: "" };
            customer.companyid = companyid;
            customer.companyname = companyname;
            Object.entries(aliases).forEach(([field, names]) => {
              const key = names.find(
                (name) => normalized[name.toLowerCase()] !== undefined,
              );
              if (key) customer[field] = normalized[key.toLowerCase()];
            });
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
            return {
              customer,
              excelRow: rowIndex + 2,
              bankError: Boolean(importedBankValue && !bankMatch),
              openingError: openingReceivable === null || openingPayable === null,
            };
          })
          .filter(({ customer }) => customer.customercode || customer.customername);

        if (!imported.length)
          throw new Error(
            "업로드할 데이터가 없습니다. 샘플 양식의 첫 번째 시트를 확인해 주세요.",
          );
        const failures = [];
        const validCustomers = [];
        imported.forEach(({ customer, excelRow, bankError, openingError }) => {
          const rowErrors = [];
          if (!customer.customercode) rowErrors.push("거래처코드 필수");
          if (!customer.customername) rowErrors.push("거래처명 필수");
          if (bankError) rowErrors.push("코드마스터에 등록되지 않은 은행명/은행코드");
          if (openingError) rowErrors.push("기초미수금/기초미지급금은 0 이상의 숫자");
          if (rowErrors.length) failures.push(`${excelRow}행: ${rowErrors.join(", ")}`);
          else validCustomers.push(customer);
        });

        if (validCustomers.length) {
          setUploadProgress(
            `${validCustomers.length.toLocaleString()}건 서버 등록 중`,
          );
          const { data } = await axios.post("/api/bulk-create", {
            customers: validCustomers,
          }, authConfig());
          if (data.success === false)
            throw new Error(data.message || "일괄 등록에 실패했습니다.");
        }
        notifications.show({
          title: failures.length
            ? validCustomers.length ? "일괄 등록 완료 (일부 제외)" : "일괄 등록 중단"
            : "일괄 등록 완료",
          message: `${validCustomers.length}건 등록${failures.length ? `, ${failures.length}건 제외: ${failures.slice(0, 5).join(" / ")}` : ""}`,
          color: failures.length ? "orange" : "teal",
          position: "bottom-right",
          autoClose: 7000,
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
          <Text component="span" className={classes.breadcrumbParent}>정보관리</Text>
          <Text component="span" className={classes.breadcrumbChevron}>›</Text>
          <Text component="span" className={classes.breadcrumbCurrent}>거래처관리</Text>
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
