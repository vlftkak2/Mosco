// 사업장관리 (메뉴: WORKPLACE_MANAGEMENT) — 회사(법인) 1개 = 사업장 1개.
// 메뉴 권한이 있는 사람이 자기 회사 기본 정보를 고친다 (backend/services/masterdata/Workplace.py · company01t).
// 시스템 시작일 = 거래처원장 시작일(ledgerstartdate): 이 날짜 이전 거래는 전기이월(거래처 기초잔액)로 본다.
// 배치: 구역 제목 + 짧은 설명, 왼쪽 라벨 · 오른쪽 입력칸 2열, 맨 아래 추가정보(이미지 카드). 저장은 위쪽 공통 [저장].
// 회사명은 고객사등록(company01t.companyname) 값을 보여주기만 한다.
// 회사 로고 · 증명서 도장 · 사업자등록증은 [첨부파일 업로드] 즉시 저장된다 (JPG · PNG, 로고 · 도장 500KB, 사업자등록증 2MB).
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Loader, Modal, Paper, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import ErpBreadcrumb from '../../components/common/ErpBreadcrumb';
import ErpDateInput from '../../components/common/ErpDateInput';
import useErpPageRibbon from '../../components/common/useErpPageRibbon';
import usePageReactivated from '../../components/common/usePageReactivated';
import sharedClasses from '../../styles/pages/ManagementShared.module.css';
import classes from '../../styles/pages/CustomerPage.module.css';
import own from '../../styles/pages/Workplace.module.css';

const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } });
const EMPTY = {
  ceoname: '', ownertype: 'CORP', businessno: '', corporationno: '', businesstype: '', industry: '',
  openingdate: '', ledgerstartdate: '', phone: '', zipcode: '', address1: '', address2: '',
};
const errorText = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
};
const digits = (value) => String(value || '').replace(/\D/g, '');
const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');

// 사업자등록번호 · 법인등록번호 검증번호 (서버와 같은 규칙)
const validBusinessNo = (value) => {
  const d = digits(value);
  if (d.length !== 10) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let total = weights.reduce((sum, weight, index) => sum + Number(d[index]) * weight, 0);
  total += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (total % 10)) % 10 === Number(d[9]);
};
const validCorporationNo = (value) => {
  const d = digits(value);
  if (d.length !== 13) return false;
  const total = [...d.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 2), 0);
  return (10 - (total % 10)) % 10 === Number(d[12]);
};
const formatBusinessNo = (value) => { const d = digits(value).slice(0, 10); return [d.slice(0, 3), d.slice(3, 5), d.slice(5)].filter(Boolean).join('-'); };
const formatCorporationNo = (value) => { const d = digits(value).slice(0, 13); return [d.slice(0, 6), d.slice(6)].filter(Boolean).join('-'); };

let postcodeScriptPromise;
const loadPostcodeService = () => {
  if (window.daum?.Postcode) return Promise.resolve();
  if (!postcodeScriptPromise) {
    postcodeScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = resolve;
      script.onerror = () => { postcodeScriptPromise = null; reject(new Error('주소 검색 서비스를 불러오지 못했습니다.')); };
      document.head.appendChild(script);
    });
  }
  return postcodeScriptPromise;
};

// 구역: 제목 + 짧은 설명, 아래에 라벨 · 입력 2열
function WpSection({ title, hint, action, children }) {
  return <section className={own.block}>
    <header className={own.blockHead}><h3>{title}</h3>{hint && <span>{hint}</span>}{action && <div className={own.blockAction}>{action}</div>}</header>
    <div className={own.rows}>{children}</div>
  </section>;
}

// 한 칸: 왼쪽 라벨, 오른쪽 입력 (full = 한 줄 전체)
function Field({ label, required, full, children }) {
  return <div className={`${own.field} ${full ? own.fieldFull : ''}`}>
    <span className={own.fieldLabel}>{label}{required && <i aria-hidden="true">*</i>}</span>
    <div className={own.fieldControl}>{children}</div>
  </div>;
}

const IMAGE_CARDS = [
  { kind: 'logo', title: '회사로고', short: '로고', max: 500 * 1024, maxText: '500KB' },
  { kind: 'stamp', title: '증명서 도장', short: '도장', max: 500 * 1024, maxText: '500KB' },
  { kind: 'bizcert', title: '사업자등록증', short: '사업자등록증', max: 2 * 1024 * 1024, maxText: '2MB' },
];

// 이미지 카드: 제목 + [첨부파일 업로드], 미리보기, 파일 이름 + 삭제. 미리보기를 눌러도 · 끌어놓아도 올라간다.
function ImageCard({ card, image, name, busy, onUpload, onDelete }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pick = () => { if (!busy) inputRef.current?.click(); };
  return <div className={own.imageCard}>
    <div className={own.imageCardHead}>
      <b>{card.title}</b>
      <button type="button" className={own.uploadButton} onClick={pick} disabled={busy}>첨부파일 업로드</button>
    </div>
    <div className={own.imageBox}>
      <button type="button" className={`${own.preview} ${dragging ? own.previewOn : ''}`} onClick={pick} disabled={busy}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); onUpload(card, event.dataTransfer.files?.[0]); }}
        title={image ? '눌러서 바꾸기' : '눌러서 고르거나 끌어놓기'} aria-label={`${card.title} ${image ? '바꾸기' : '올리기'}`}>
        {busy ? <Loader size="sm" color="red" />
          : image ? <img src={image} alt={card.title} />
            : <span className={own.previewEmpty}>등록된 이미지 없음</span>}
      </button>
      <div className={own.imageFoot}>
        {image ? <><span className={own.fileName} title={name}>{name || card.title}</span>
          <button type="button" className={own.fileDelete} onClick={() => onDelete(card)} disabled={busy}>삭제</button></>
          : <span className={own.fileNone}>{card.maxText} 이하</span>}
      </div>
    </div>
    <input ref={inputRef} type="file" accept="image/png,image/jpeg" hidden
      onChange={(event) => { onUpload(card, event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
  </div>;
}

const imageFrom = (item, kind) => ({ [kind]: item?.[kind] || null, [`${kind}name`]: item?.[`${kind}name`] || '' });

export default function Workplace() {
  const [form, setForm] = useState(EMPTY);
  const [saved, setSaved] = useState(EMPTY);
  const [companyname, setCompanyname] = useState('');
  const [images, setImages] = useState({});
  const [imageBusy, setImageBusy] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState({});
  const [addressOpen, setAddressOpen] = useState(false);
  const postcodeRef = useRef(null);
  const dirty = Object.keys(EMPTY).some((key) => (form[key] ?? '') !== (saved[key] ?? ''));
  const isCorp = form.ownertype === 'CORP';

  // 칸별 오류 (입력을 끝낸 칸이나 저장을 누른 뒤에만 보여 준다)
  const errors = {
    ceoname: !form.ceoname.trim() && '대표자명을 입력해 주세요.',
    businessno: !digits(form.businessno) ? '사업자등록번호를 입력해 주세요.' : !validBusinessNo(form.businessno) && '사업자등록번호가 올바르지 않습니다. 번호를 다시 확인해주세요.',
    corporationno: isCorp && (!digits(form.corporationno) ? '법인등록번호를 입력해 주세요.' : !validCorporationNo(form.corporationno) && '법인등록번호가 올바르지 않습니다. 번호를 다시 확인해주세요.'),
    ledgerstartdate: !form.ledgerstartdate && '시스템 시작일을 선택해 주세요.',
  };
  const shown = (key) => (touched[key] || touched.__all ? errors[key] || null : null);

  const apply = useCallback((item) => {
    const next = Object.fromEntries(Object.keys(EMPTY).map((key) => [key, key.endsWith('date') ? dateOnly(item?.[key]) : (item?.[key] ?? EMPTY[key])]));
    setForm(next);
    setSaved(next);
    setTouched({});
    setCompanyname(item?.companyname || '');
    setImages(Object.assign({}, ...IMAGE_CARDS.map(({ kind }) => imageFrom(item, kind))));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/workplace', authConfig());
      apply(response.data.item);
    } catch (error) {
      notifications.show({ title: '사업장 정보 조회 실패', message: errorText(error, '사업장 정보를 불러오지 못했습니다.'), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [apply]);
  useEffect(() => { void load(); }, [load]);
  usePageReactivated(() => { if (!dirty) void load(); });

  const save = useCallback(async () => {
    if (saving) return;
    const firstError = Object.values(errors).find(Boolean);
    if (firstError) {
      setTouched({ __all: true });
      notifications.show({ title: '입력 확인', message: firstError, color: 'orange' });
      return;
    }
    setSaving(true);
    try {
      const response = await axios.put('/api/workplace', { ...form, openingdate: form.openingdate || null }, authConfig());
      apply(response.data.item);
      notifications.show({ title: '저장 완료', message: '사업장 정보를 저장했습니다.', color: 'teal' });
    } catch (error) {
      notifications.show({ title: '저장 실패', message: errorText(error, '사업장 정보를 저장하지 못했습니다.'), color: 'red' });
    } finally {
      setSaving(false);
    }
  // errors 는 form 으로만 정해진다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, apply, saving]);

  useErpPageRibbon({ onSearch: () => void load(), onSave: () => void save(), showPrint: false });

  const set = (key, format) => (event) => {
    const { value } = event.currentTarget;
    setForm((current) => ({ ...current, [key]: format ? format(value) : value }));
  };
  const touch = (key) => () => setTouched((current) => ({ ...current, [key]: true }));

  const uploadImage = async (card, file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      notifications.show({ title: '파일 확인', message: 'JPG · PNG 이미지만 올릴 수 있습니다.', color: 'orange' });
      return;
    }
    if (file.size > card.max) {
      notifications.show({ title: '파일 확인', message: `${card.title} 이미지는 ${card.maxText} 이하로 올려 주세요.`, color: 'orange' });
      return;
    }
    setImageBusy(card.kind);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await axios.post(`/api/workplace/${card.kind}`, body, authConfig());
      setImages((current) => ({ ...current, ...imageFrom(response.data.item, card.kind) }));
      notifications.show({ title: `${card.short} 등록 완료`, message: `${card.title} 이미지를 저장했습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: `${card.short} 등록 실패`, message: errorText(error, '이미지를 저장하지 못했습니다.'), color: 'red' });
    } finally {
      setImageBusy('');
    }
  };
  const deleteImage = async (card) => {
    setImageBusy(card.kind);
    try {
      const response = await axios.delete(`/api/workplace/${card.kind}`, authConfig());
      setImages((current) => ({ ...current, ...imageFrom(response.data.item, card.kind) }));
      notifications.show({ title: `${card.short} 삭제 완료`, message: `${card.title} 이미지를 지웠습니다.`, color: 'teal' });
    } catch (error) {
      notifications.show({ title: `${card.short} 삭제 실패`, message: errorText(error, '이미지를 지우지 못했습니다.'), color: 'red' });
    } finally {
      setImageBusy('');
    }
  };

  // 주소 검색: 카카오 우편번호 서비스로 우편번호 · 도로명주소를 채우고, 상세주소만 직접 입력.
  // 창이 다 열린 뒤(onEnterTransitionEnd)에 붙여야 안쪽 영역이 있다 (거래처관리 · 고객사등록과 같은 방식).
  const embedPostcode = useCallback(() => {
    loadPostcodeService().then(() => {
      const container = postcodeRef.current;
      if (!container || !window.daum?.Postcode) return;
      container.replaceChildren();
      new window.daum.Postcode({
        width: '100%', height: '100%',
        oncomplete: (data) => {
          setForm((current) => ({ ...current, zipcode: data.zonecode || '', address1: data.roadAddress || data.jibunAddress || '' }));
          setAddressOpen(false);
        },
      }).embed(container);
    }).catch((error) => {
      notifications.show({ title: '주소 검색 실패', message: error.message || '주소 검색 서비스를 불러오지 못했습니다.', color: 'red' });
      setAddressOpen(false);
    });
  }, []);

  return <Box className={`${sharedClasses.pageShell} ${classes.page}`}>
    <ErpBreadcrumb parent="운영정보" current="사업장관리" />

    <Paper className={`${classes.panel} ${own.panel}`} withBorder>
      <div className={own.body}>
        <WpSection title="사업자정보" hint="거래명세서 공급자 칸에 표시됩니다."
          action={<>{loading && <Loader size="xs" color="red" />}<span className={`${own.statusBadge} ${dirty ? own.statusDirty : ''}`}>{dirty ? '저장 안 됨 · 위쪽 [저장]' : '저장됨'}</span></>}>
          <Field label="사업자 유형" required full>
            <div className={own.radioRow} role="radiogroup" aria-label="사업자 유형">
              {[['CORP', '법인사업자'], ['INDIV', '개인사업자']].map(([value, text]) => (
                <label key={value} className={own.radio}>
                  <input type="radio" name="ownertype" value={value} checked={form.ownertype === value}
                    onChange={() => setForm((current) => ({ ...current, ownertype: value }))} />
                  {text}
                </label>
              ))}
            </div>
          </Field>
          <Field label="회사명">
            <TextInput aria-label="회사명" value={companyname} readOnly className={own.lockedInput} title="고객사등록에서 정한 회사명입니다. 여기서는 바꿀 수 없습니다." />
          </Field>
          <Field label="대표자명" required>
            <TextInput aria-label="대표자명" value={form.ceoname} onChange={set('ceoname')} onBlur={touch('ceoname')} error={shown('ceoname')} />
          </Field>
          <Field label="사업자등록번호" required>
            <TextInput aria-label="사업자등록번호" value={form.businessno} placeholder="000-00-00000" inputMode="numeric"
              onChange={set('businessno', formatBusinessNo)} onBlur={touch('businessno')} error={shown('businessno')} />
          </Field>
          <Field label="법인등록번호" required={isCorp}>
            <TextInput aria-label="법인등록번호" disabled={!isCorp} value={isCorp ? form.corporationno : ''}
              placeholder={isCorp ? '000000-0000000' : '개인사업자는 입력하지 않습니다'} inputMode="numeric"
              onChange={set('corporationno', formatCorporationNo)} onBlur={touch('corporationno')} error={shown('corporationno')} />
          </Field>
          <Field label="업태"><TextInput aria-label="업태" value={form.businesstype} onChange={set('businesstype')} placeholder="예: 도소매업" /></Field>
          <Field label="종목"><TextInput aria-label="종목" value={form.industry} onChange={set('industry')} placeholder="예: 철강재" /></Field>
          <Field label="개업년월일">
            <ErpDateInput aria-label="개업년월일" value={form.openingdate} onChange={(event) => setForm((current) => ({ ...current, openingdate: event.currentTarget.value }))} />
          </Field>
        </WpSection>

        <WpSection title="연락처 · 주소" hint="증명서와 거래명세서에 표시됩니다.">
          <Field label="전화번호"><TextInput aria-label="전화번호" value={form.phone} onChange={set('phone')} placeholder="02-0000-0000" /></Field>
          <Field label="주소" full>
            {/* 우편번호 · 주소는 카카오 주소 검색으로만 채운다 (칸을 눌러도 검색이 열림) */}
            <div className={own.addressLine}>
              <TextInput className={`${own.addressInput} ${own.zip}`} aria-label="우편번호" value={form.zipcode} readOnly placeholder="우편번호" onClick={() => setAddressOpen(true)} />
              <TextInput className={`${own.addressInput} ${own.addressMain}`} aria-label="주소" value={form.address1} readOnly placeholder="[주소 검색]으로 입력"
                onClick={() => setAddressOpen(true)} title={form.address1} />
              <button type="button" className={own.addressSearch} onClick={() => setAddressOpen(true)}>주소 검색</button>
            </div>
          </Field>
          <Field label="상세주소" full>
            <TextInput aria-label="상세주소" value={form.address2} onChange={set('address2')} placeholder="동 · 호수 · 건물명" />
          </Field>
        </WpSection>

        <WpSection title="운영 기준" hint="이 날짜 이전 거래는 전기이월(거래처 기초잔액)로 봅니다.">
          <Field label="시스템 시작일" required>
            <ErpDateInput aria-label="시스템 시작일" value={form.ledgerstartdate}
              onChange={(event) => { const { value } = event.currentTarget; setForm((current) => ({ ...current, ledgerstartdate: value })); setTouched((current) => ({ ...current, ledgerstartdate: true })); }}
              error={shown('ledgerstartdate')} />
          </Field>
        </WpSection>

        <section className={own.block}>
          <header className={own.blockHead}><h3>추가정보</h3><span>증명서 · 화면에 쓰이는 이미지입니다. 올리면 바로 저장됩니다.</span></header>
          <p className={own.imageRule}><i>*</i> JPG, PNG만 등록 가능합니다.</p>
          <div className={own.imageCards}>
            {IMAGE_CARDS.map((card) => <ImageCard key={card.kind} card={card} image={images[card.kind]} name={images[`${card.kind}name`]}
              busy={imageBusy === card.kind} onUpload={uploadImage} onDelete={deleteImage} />)}
          </div>
        </section>
      </div>
    </Paper>

    <Modal opened={addressOpen} onClose={() => setAddressOpen(false)} onEnterTransitionEnd={embedPostcode} title="주소 검색" size="lg" centered>
      <div ref={postcodeRef} style={{ height: 520, width: '100%' }} />
    </Modal>
  </Box>;
}
