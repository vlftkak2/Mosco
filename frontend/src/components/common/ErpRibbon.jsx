import { Button, Group } from '@mantine/core';
import {
  IconCopy, IconDeviceFloppy, IconFileSpreadsheet, IconPlus,
  IconPrinter, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import classes from '../../styles/pages/InboundRegister.module.css';

const RibbonButton = ({ icon: Icon, label, onClick, disabled, loading, className }) => (
  <Button
    className={`${classes.ribbonTool} ${className || ''}`}
    variant="subtle"
    size="sm"
    leftSection={<Icon size={15} />}
    onClick={onClick}
    disabled={disabled || !onClick}
    loading={loading}
  >
    {label}
  </Button>
);

export default function ErpRibbon({
  onSearch, onAdd, onCopy, onExcel, onSave, onDelete, onPrint, onClose,
  showPrint = true,
  useSaveColor = true,
  disabled = {}, loading = {},
}) {
  return (
    <Group className={classes.commandRibbon} justify="flex-start" wrap="nowrap" gap={2}>
      <RibbonButton icon={IconSearch} label="조회" onClick={onSearch} disabled={disabled.search} loading={loading.search} />
      <span className={classes.ribbonSeparator} />
      <RibbonButton icon={IconPlus} label="추가" onClick={onAdd} disabled={disabled.add} loading={loading.add} />
      <RibbonButton icon={IconCopy} label="복사" onClick={onCopy} disabled={disabled.copy} loading={loading.copy} />
      {onExcel && <RibbonButton icon={IconFileSpreadsheet} label="엑셀" onClick={onExcel} disabled={disabled.excel} loading={loading.excel} />}
      <RibbonButton icon={IconDeviceFloppy} label="저장" onClick={onSave} disabled={disabled.save} loading={loading.save} className={useSaveColor ? classes.ribbonSave : undefined} />
      <RibbonButton icon={IconTrash} label="삭제" onClick={onDelete} disabled={disabled.delete} loading={loading.delete} />
      {showPrint && <RibbonButton icon={IconPrinter} label="인쇄" onClick={onPrint} disabled={disabled.print} loading={loading.print} />}
      <span className={classes.ribbonSeparator} />
      <RibbonButton icon={IconX} label="닫기" onClick={onClose} disabled={disabled.close} />
    </Group>
  );
}
