import { IconDownload, IconUpload } from '@tabler/icons-react';
import classes from './ExcelBulkActions.module.css';

// 샘플양식 · 엑셀 일괄등록 버튼 묶음 (여러 화면 공통 디자인).
// 동작은 화면이 넘겨주는 함수 그대로: 샘플 = onDownloadTemplate, 일괄등록 = 숨은 파일 입력(inputRef)을 열어 onUpload.
// extraActions: 같은 묶음에 붙일 버튼 [{ key, label, icon, onClick, title, disabled }]
export default function ExcelBulkActions({
  onDownloadTemplate, templateDisabled = false, templateLabel = '샘플양식',
  templateTitle = '일괄등록에 쓰는 엑셀 샘플 양식을 내려받습니다',
  inputRef, onUpload, uploading = false, uploadLabel = '엑셀 일괄등록', uploadProgressLabel, uploadDisabled = false,
  uploadTitle = '샘플 양식으로 작성한 엑셀 파일을 올려 한 번에 등록합니다', accept = '.xlsx,.xls',
  extraActions = [],
}) {
  return <div className={classes.group} role="group" aria-label="엑셀 일괄등록">
    <button type="button" className={classes.action} onClick={onDownloadTemplate} disabled={templateDisabled} title={templateTitle}>
      <IconDownload size={14} stroke={1.9} />{templateLabel}
    </button>
    <button type="button" className={`${classes.action} ${classes.primary} ${uploading ? classes.busy : ''}`}
      onClick={() => inputRef.current?.click()} disabled={uploading || uploadDisabled} aria-busy={uploading || undefined} title={uploadTitle}>
      {uploading ? <span className={classes.spinner} aria-hidden="true" /> : <IconUpload size={14} stroke={1.9} />}
      {uploading && uploadProgressLabel ? uploadProgressLabel : uploadLabel}
    </button>
    {extraActions.map(({ key, label, icon: Icon, onClick, title, disabled }) => (
      <button key={key || label} type="button" className={classes.action} onClick={onClick} title={title} disabled={disabled}>
        {Icon && <Icon size={14} stroke={1.9} />}{label}
      </button>
    ))}
    <input ref={inputRef} type="file" accept={accept} onChange={onUpload} hidden />
  </div>;
}
