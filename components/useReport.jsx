'use client';

import { useCallback, useState } from 'react';
import ReportDialog from './ReportDialog';

/** const [openReport, reportDialog] = useReport();  openReport(target, sendFn) */
export default function useReport() {
  const [current, setCurrent] = useState(null);
  const open = useCallback((target, send) => setCurrent({ target, send }), []);
  const dialog = current ? <ReportDialog target={current.target} send={current.send} onClose={() => setCurrent(null)} /> : null;
  return [open, dialog];
}
