// AI 주문서인식 · 가공주문관리 공통: 품명 자동완성 + 돋보기(품목 선택 창)
//   ItemNameSuggestInput : 입력하면 품목 마스터 추천 목록, 오른쪽 돋보기 클릭 · 더블클릭 · F2 → 품목 선택 창
//   ItemPickerModal      : 매입등록 품목 선택 창과 같은 목록 (품목코드 · 품목명 · 형태구분)
// 자유 입력은 막지 않는다. 품목 마스터에 없는 품명은 가공주문관리 저장 때 화면 · 서버에서 막는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Autocomplete, Popover } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPackages, IconSearch } from '@tabler/icons-react';
import { SelectPickerModal } from '../../components/common/PickerModal';
import itemMasterClasses from '../../styles/pages/ItemMaster.module.css';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const errorMessage = (error, fallback) => (typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : fallback);

const ITEM_PICKER_COLUMNS = [
  { key: 'itemcode', label: '품목코드', width: 150 },
  { key: 'itemname', label: '품목명', width: 260 },
  { key: 'itemtype', label: '형태구분', width: 140, render: (item) => item.itemtypecodenm || item.itemtypecode || '' },
];

export function ItemPickerModal({ opened, onClose, onSelect, description = '주문 상세에 넣을 품목을 고릅니다.' }) {
  const [searchInput, setSearchInput] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const loadItems = useCallback(async (nextPage, query) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/item-master/items/picker', { ...authConfig(), params: { q: query, page: nextPage, page_size: 20 } });
      if (requestId !== requestIdRef.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (error) {
      if (requestId === requestIdRef.current) notifications.show({ title: '품목 조회 실패', message: errorMessage(error, '품목을 조회하지 못했습니다.'), color: 'red' });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (opened) { setSearchInput(''); void loadItems(1, ''); } else requestIdRef.current += 1;
  }, [opened, loadItems]);
  return <SelectPickerModal opened={opened} onClose={onClose} size="md"
    title="품목 선택" description={description} icon={<IconPackages size={21} stroke={1.8} />}
    searchValue={searchInput} onSearchChange={setSearchInput} onSearch={() => { void loadItems(1, searchInput.trim()); }} searchPlaceholder="품목코드, 품목명 또는 형태구분 검색"
    listTitle="품목" columns={ITEM_PICKER_COLUMNS} rows={items} rowKey={(item) => item.itemcode} onSelect={onSelect}
    loading={loading} total={total} page={page} pageCount={Math.max(1, Math.ceil(total / 20))} onPageChange={(nextPage) => { void loadItems(nextPage, searchInput.trim()); }}
    emptyTitle="조회된 품목이 없습니다" emptyDescription="품목코드나 품목명을 바꿔 다시 조회해 주세요." />;
}

// 품명이 품목 마스터(사용 중)에 그대로 있는지 확인 · 추천 목록은 이름이 같은 품목을 앞에 둔다
export const findMasterItemName = async (name) => {
  const { data } = await axios.get('/api/item-master/items/suggest', { ...authConfig(), params: { q: name } });
  const normalized = name.trim().toLocaleLowerCase();
  return (data.items || []).find((item) => String(item.itemname || '').trim().toLocaleLowerCase() === normalized) || null;
};

export function ItemNameSuggestInput({ value, readOnly, onValueChange, onGridKeyDown, onOpenPicker, inputProps }) {
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  const [items, setItems] = useState([]);
  const [itemsQuery, setItemsQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = String(value || '').trim();
  const isOpen = focused && edited && !readOnly && itemsQuery === query && items.length > 0;

  useEffect(() => {
    if (!focused || !edited || readOnly || !query) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/item-master/items/suggest', { ...authConfig(), params: { q: query }, signal: controller.signal });
        if (!controller.signal.aborted) { setItems(data.items || []); setItemsQuery(query); setActiveIndex(-1); }
      } catch { /* 추천 목록을 못 불러오면 목록만 닫아 둔다 */ }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [focused, edited, readOnly, query]);

  const choose = (item) => {
    onValueChange(item.itemname || '');
    setEdited(false);
    setActiveIndex(-1);
  };
  // 추천 목록 · 품목 선택 창이 쓴 키는 표(그리드) 이동으로 넘기지 않는다
  const consume = (event) => { event.preventDefault(); event.stopPropagation(); };

  return <Popover opened={isOpen} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <input
        {...inputProps}
        value={value ?? ''}
        readOnly={readOnly}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onFocus={(event) => { setFocused(true); setEdited(false); event.currentTarget.select(); }}
        onBlur={() => { setFocused(false); setEdited(false); setActiveIndex(-1); }}
        onChange={(event) => { setEdited(true); onValueChange(event.currentTarget.value); }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!readOnly && event.clientX >= bounds.right - 28) onOpenPicker();
        }}
        onDoubleClick={() => { if (!readOnly) onOpenPicker(); }}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            consume(event);
            if (!readOnly) onOpenPicker();
          } else if (isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            consume(event);
            setActiveIndex((current) => event.key === 'ArrowDown'
              ? (current + 1) % items.length : (current - 1 + items.length) % items.length);
          } else if (isOpen && event.key === 'Enter') {
            consume(event);
            choose(items[activeIndex >= 0 ? activeIndex : 0]);
          } else if (isOpen && event.key === 'Tab' && activeIndex >= 0) {
            choose(items[activeIndex]);
          } else if (isOpen && event.key === 'Escape') {
            consume(event);
            setEdited(false);
          } else onGridKeyDown?.(event);
        }}
        onPaste={inputProps?.onPaste}
      />
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions} style={{ minWidth: 220 }}>
      <div role="listbox" aria-label="품목 검색 결과">
        {items.map((item, index) => <button key={item.itemcode} type="button" role="option" aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(item)}>
          <span>{item.itemname}</span>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
}

// ── 강종 · 표면 (공통코드 MATERIAL / SURFACE) ───────────────────────────────
// 코드 목록을 한 번 받아 두고 화면에서 거른다. 값은 코드명(이름)으로 넣는다 (주문서 원문과 같은 형태).
export async function loadCodeOptions(groupcode) {
  const items = [];
  let page = 1;
  let total = 0;
  do {
    const { data } = await axios.get(`/api/code-master/groups/${groupcode}/items`, { ...authConfig(), params: { page, page_size: 200, include_total: true } });
    items.push(...(data.items || []));
    total = data.total || 0;
    page += 1;
  } while (items.length < total && page <= 50);
  const unique = new Map();
  items.filter((item) => item.use).forEach((item) => {
    const code = String(item.code || '').trim();
    if (code) unique.set(code.toLocaleUpperCase(), { code, name: item.name || code });
  });
  return [...unique.values()];
}

const matchOptions = (options, query) => {
  const text = String(query || '').trim().toLocaleLowerCase();
  if (!text) return [];
  return options.filter((option) => `${option.code} ${option.name}`.toLocaleLowerCase().includes(text))
    .sort((a, b) => Number(String(b.name).toLocaleLowerCase() === text) - Number(String(a.name).toLocaleLowerCase() === text))
    .slice(0, 8);
};

const CODE_PICKER_COLUMNS = [
  { key: 'code', label: '코드', width: 140 },
  { key: 'name', label: '코드명', width: 260 },
];

export function CodePickerModal({ opened, onClose, onSelect, title, options }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // 열 때마다 새로 그려진다 (부모가 열린 동안만 렌더) → 검색어 · 쪽은 처음부터
  const text = search.trim().toLocaleLowerCase();
  const filtered = text ? options.filter((option) => `${option.code} ${option.name}`.toLocaleLowerCase().includes(text)) : options;
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  return <SelectPickerModal opened={opened} onClose={onClose} size="sm"
    title={title} description="사용 중인 공통코드에서 고릅니다." icon={<IconPackages size={21} stroke={1.8} />}
    searchValue={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder="코드 또는 코드명 검색"
    listTitle="코드" columns={CODE_PICKER_COLUMNS} rows={filtered.slice((page - 1) * 20, page * 20)} rowKey={(option) => option.code} onSelect={onSelect}
    total={filtered.length} page={page} pageCount={pageCount} onPageChange={setPage}
    emptyTitle="조회된 사용 중 코드가 없습니다" />;
}

// 입력하면 공통코드 추천, 오른쪽 돋보기 클릭 · 더블클릭 · F2 → 코드 선택 창 (품명 칸과 같은 조작)
export function CodeSuggestInput({ value, options, readOnly, onValueChange, onGridKeyDown, onOpenPicker, inputProps }) {
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const items = edited ? matchOptions(options || [], value) : [];
  const isOpen = focused && edited && !readOnly && items.length > 0;
  const choose = (option) => { onValueChange(option.name || option.code); setEdited(false); setActiveIndex(-1); };
  const consume = (event) => { event.preventDefault(); event.stopPropagation(); };
  return <Popover opened={isOpen} position="bottom-start" width="target" withinPortal shadow="none" offset={0} zIndex={500} transitionProps={{ duration: 0 }}>
    <Popover.Target>
      <input
        {...inputProps}
        value={value ?? ''}
        readOnly={readOnly}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onFocus={(event) => { setFocused(true); setEdited(false); event.currentTarget.select(); }}
        onBlur={() => { setFocused(false); setEdited(false); setActiveIndex(-1); }}
        onChange={(event) => { setEdited(true); setActiveIndex(-1); onValueChange(event.currentTarget.value); }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!readOnly && event.clientX >= bounds.right - 28) onOpenPicker();
        }}
        onDoubleClick={() => { if (!readOnly) onOpenPicker(); }}
        onKeyDown={(event) => {
          if (event.key === 'F2') { consume(event); if (!readOnly) onOpenPicker(); }
          else if (isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            consume(event);
            setActiveIndex((current) => (event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length));
          } else if (isOpen && event.key === 'Enter') { consume(event); choose(items[activeIndex >= 0 ? activeIndex : 0]); }
          else if (isOpen && event.key === 'Tab' && activeIndex >= 0) choose(items[activeIndex]);
          else if (isOpen && event.key === 'Escape') { consume(event); setEdited(false); }
          else onGridKeyDown?.(event);
        }}
      />
    </Popover.Target>
    <Popover.Dropdown className={itemMasterClasses.shapeSuggestions} style={{ minWidth: 200 }}>
      <div role="listbox" aria-label="코드 검색 결과">
        {items.map((option, index) => <button key={option.code} type="button" role="option" aria-selected={index === activeIndex}
          className={itemMasterClasses.shapeSuggestion}
          style={index === activeIndex ? { background: '#edf3f8' } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}>
          <span>{option.name}</span><small>{option.code}</small>
        </button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
}

// 조회조건 품명 칸 (재고매칭 · 과거 매입이력 · 과거 가공이력 공용): 입력하면 품목 마스터 품명을 추천.
// 추천에서 고르면 '일치' 검색, 직접 고쳐 쓰면 '포함' 검색. onChange(value, exact)
export function ItemNameAutocomplete({ value, exact, disabled, onChange, onKeyDown, width = 170, subject = '재고' }) {
  const [options, setOptions] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const pickedRef = useRef(exact ? value : null);   // 일치 검색으로 정해진 품명 (자동완성 선택 직후 onChange 가 다시 와도 유지)
  const pick = (picked) => { pickedRef.current = picked; onChange(picked, true); };
  // Tab: 추천 목록이 열려 있으면 하이라이트된 품명(없으면 첫 번째)을 고르고 다음 칸으로 넘어간다 (Enter 와 같은 선택)
  const handleKeyDown = (event) => {
    if (event.key === 'Tab' && !event.shiftKey && dropdownOpen && !exact && options.length) {
      const selected = document.querySelector('.mantine-Autocomplete-dropdown [data-combobox-selected]');
      pick(String(selected?.textContent || options[0]).trim());
      setDropdownOpen(false);
    }
    onKeyDown?.(event);
  };
  useEffect(() => { if (exact) pickedRef.current = value; }, [exact, value]);
  const query = String(value || '').trim();
  useEffect(() => {
    if (!query || exact) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/item-master/items/suggest', { ...authConfig(), params: { q: query }, signal: controller.signal });
        if (!controller.signal.aborted) setOptions([...new Set((data.items || []).map((item) => String(item.itemname || '').trim()).filter(Boolean))]);
      } catch { /* 추천을 못 불러오면 목록 없이 둔다 */ }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, exact]);
  return <Autocomplete size="sm" style={{ width }} disabled={disabled} value={value} data={exact ? [] : options} leftSection={<IconSearch size={14} />}
    filter={({ options: list }) => list} limit={20} comboboxProps={{ zIndex: 500 }} onKeyDown={handleKeyDown}
    onDropdownOpen={() => setDropdownOpen(true)} onDropdownClose={() => setDropdownOpen(false)}
    label={<>품명 <span style={{ color: exact ? '#d94a54' : '#8292a9', fontWeight: 600 }}>{exact ? '· 일치' : '· 포함'}</span></>}
    title={exact ? `이 품명과 똑같은 ${subject}만 찾습니다. 글자를 고치면 포함 검색으로 바뀝니다.` : `입력한 글자가 들어간 품명의 ${subject}를 모두 찾습니다. 추천 목록에서 고르면 일치 검색이 됩니다. 비우면 전체 품명.`}
    onChange={(next) => onChange(next, next === pickedRef.current)}
    onOptionSubmit={pick} />;
}
