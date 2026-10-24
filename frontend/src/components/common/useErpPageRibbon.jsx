import { useContext, useEffect, useMemo, useRef } from 'react';
import ErpRibbon from './ErpRibbon';
import { PageRibbonContext } from '../layout/MainLayout';

export default function useErpPageRibbon(actions) {
  const context = useContext(PageRibbonContext);
  const actionsRef = useRef(actions);
  const { registerPageRibbon, closeActivePage } = context || {};
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const availability = {
    search: Boolean(actions?.onSearch),
    add: Boolean(actions?.onAdd),
    copy: Boolean(actions?.onCopy),
    save: Boolean(actions?.onSave),
    delete: Boolean(actions?.onDelete),
    print: Boolean(actions?.onPrint),
    excel: Boolean(actions?.onExcel),
  };
  const ribbonActions = useMemo(() => {
    const keys = ['onSearch', 'onAdd', 'onCopy', 'onSave', 'onDelete', 'onPrint', 'onExcel'];
    return Object.fromEntries(keys.map((key) => [key, (...args) => actionsRef.current?.[key]?.(...args)]));
  }, []);
  const showPrint = actions?.showPrint !== false;
  const showExcel = Boolean(actions?.showExcel);
  const closeDisabled = Boolean(actions?.disableClose);
  const useSaveColor = actions?.useSaveColor !== false;
  const ribbon = useMemo(() => (
    <ErpRibbon
      {...ribbonActions}
      onClose={closeActivePage}
      showPrint={showPrint}
      showExcel={showExcel}
      useSaveColor={useSaveColor}
      disabled={{
        search: !availability.search,
        add: !availability.add,
        copy: !availability.copy,
        save: !availability.save,
        delete: !availability.delete,
        print: !availability.print,
        excel: !availability.excel,
        close: closeDisabled,
      }}
    />
  ), [
    ribbonActions,
    closeActivePage,
    showPrint,
    showExcel,
    closeDisabled,
    useSaveColor,
    availability.search,
    availability.add,
    availability.copy,
    availability.save,
    availability.delete,
    availability.print,
    availability.excel,
  ]);

  useEffect(() => {
    if (!registerPageRibbon) return undefined;
    registerPageRibbon(ribbon);
    return () => registerPageRibbon(null);
  }, [registerPageRibbon, ribbon]);
}
