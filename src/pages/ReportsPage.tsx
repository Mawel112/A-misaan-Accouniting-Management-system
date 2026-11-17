import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, SlidersHorizontal } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { CompanyLogo } from '../components/CompanyLogo.tsx';
import { formatDisplayDate, formatShilling, formatUsd, todayIsoDate } from '../utils/format.ts';
import { exportA4Pdf, type PaperOrientation, type PdfProjectInfoRow } from '../utils/pdfExport.ts';
import type { Expense, Project, Purchase, Supplier, TransactionCurrency } from '../types/index.ts';

type ReportType = 'project-financial' | 'daily-expenses' | 'supplier-purchases' | 'all-projects';
type CurrencyDisplayMode = 'both' | 'usd' | 'sh';

interface ProjectFinancialReportData {
  exchangeRate?: number;
  project: Project;
  transactions: Array<{
    id: number;
    date: string;
    category: string;
    description: string;
    payment_method: string;
    reference: string;
    currency: TransactionCurrency;
    sh_amount: number | null;
    usd_amount: number;
    amount: number;
  }>;
}

interface DailyExpensesReportData {
  exchangeRate?: number;
  rows: Expense[];
  totalAmount: number;
  count: number;
}

interface SupplierPurchaseReportData {
  exchangeRate?: number;
  rows: Purchase[];
  totalAmount: number;
  count: number;
}

interface AllProjectsReportData {
  exchangeRate?: number;
  projects: Project[];
  totals: {
    contractAmount: number;
    projectBudget: number;
    totalExpenses: number;
    totalPurchases: number;
    totalCost: number;
    remainingBudget: number;
  };
}

interface ColumnDef {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

const REPORT_COLUMNS: Record<ReportType, ColumnDef[]> = {
  'project-financial': [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description' },
    { key: 'method', label: 'Method' },
    { key: 'ref', label: 'Ref' },
    { key: 'currency', label: 'Currency' },
    { key: 'sh', label: 'Amount (SH.)', align: 'right' },
    { key: 'usd', label: 'Amount (USD)', align: 'right' },
  ],
  'daily-expenses': [
    { key: 'date', label: 'Date' },
    { key: 'project', label: 'Project' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description' },
    { key: 'method', label: 'Method' },
    { key: 'ref', label: 'Ref' },
    { key: 'currency', label: 'Currency' },
    { key: 'sh', label: 'Amount (SH.)', align: 'right' },
    { key: 'usd', label: 'Amount (USD)', align: 'right' },
  ],
  'supplier-purchases': [
    { key: 'date', label: 'Date' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'project', label: 'Project' },
    { key: 'description', label: 'Description' },
    { key: 'qty', label: 'Qty', align: 'right' },
    { key: 'status', label: 'Status' },
    { key: 'currency', label: 'Currency' },
    { key: 'sh', label: 'Amount (SH.)', align: 'right' },
    { key: 'usd', label: 'Amount (USD)', align: 'right' },
  ],
  'all-projects': [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Project Name' },
    { key: 'budget', label: 'Budget (USD)', align: 'right' },
    { key: 'expenses', label: 'Expenses (USD)', align: 'right' },
    { key: 'purchases', label: 'Purchases (USD)', align: 'right' },
    { key: 'total_cost', label: 'Total Cost (USD)', align: 'right' },
    { key: 'remaining', label: 'Remaining (USD)', align: 'right' },
  ],
};

function buildDefaultColumnSelection(): Record<ReportType, string[]> {
  return {
    'project-financial': REPORT_COLUMNS['project-financial'].map((c) => c.key),
    'daily-expenses': REPORT_COLUMNS['daily-expenses'].map((c) => c.key),
    'supplier-purchases': REPORT_COLUMNS['supplier-purchases'].map((c) => c.key),
    'all-projects': REPORT_COLUMNS['all-projects'].map((c) => c.key),
  };
}

function buildProjectInfoRows(p: Project): PdfProjectInfoRow[] {
  return [
    { field: 'Project', details: `${p.project_code} — ${p.project_name}` },
    { field: 'Client', details: p.client_name || '—' },
    { field: 'Start Date', details: formatDisplayDate(p.start_date) },
    { field: 'Expected Completion', details: formatDisplayDate(p.expected_completion_date) },
    { field: 'Contract Amount (USD)', details: formatUsd(p.contract_amount) },
    { field: 'Project Budget (USD)', details: formatUsd(p.project_budget) },
  ];
}

export function ReportsPage() {
  const { user, company } = useAuth();
  const { showError } = useToast();

  const [reportType, setReportType] = useState<ReportType>('project-financial');
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Print / Export Layout & Column Customization
  const [orientation, setOrientation] = useState<PaperOrientation>('portrait');
  const [currencyMode, setCurrencyMode] = useState<CurrencyDisplayMode>('both');
  const [selectedColumnsByReport, setSelectedColumnsByReport] = useState<Record<ReportType, string[]>>(
    buildDefaultColumnSelection
  );

  // Filters
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [dailyProjectId, setDailyProjectId] = useState<string>('all');
  const [dailyFrom, setDailyFrom] = useState<string>('');
  const [dailyTo, setDailyTo] = useState<string>('');
  const [purchaseProjectId, setPurchaseProjectId] = useState<string>('all');
  const [purchaseSupplierId, setPurchaseSupplierId] = useState<string>('all');
  const [purchaseFrom, setPurchaseFrom] = useState<string>('');
  const [purchaseTo, setPurchaseTo] = useState<string>('');
  const [allProjectsStatus, setAllProjectsStatus] = useState<string>('All');

  // Report data states
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projReport, setProjReport] = useState<ProjectFinancialReportData | null>(null);
  const [dailyReport, setDailyReport] = useState<DailyExpensesReportData | null>(null);
  const [supReport, setSupReport] = useState<SupplierPurchaseReportData | null>(null);
  const [allReport, setAllReport] = useState<AllProjectsReportData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [projRes, supRes] = await Promise.all([
          api.get<Project[]>('/projects'),
          api.get<Supplier[]>('/suppliers'),
        ]);
        setProjects(projRes.data);
        setSuppliers(supRes.data);
        if (projRes.data.length > 0) {
          setSelectedProjectId(String(projRes.data[0].id));
        }
      } catch (err) {
        showError(extractApiError(err, 'Failed to load filter options.'));
      }
    })();
  }, [showError]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      if (reportType === 'project-financial') {
        if (!selectedProjectId) {
          setProjReport(null);
          return;
        }
        const res = await api.get<ProjectFinancialReportData>('/reports/project-financial', {
          params: { projectId: selectedProjectId },
        });
        setProjReport(res.data);
      } else if (reportType === 'daily-expenses') {
        const res = await api.get<DailyExpensesReportData>('/reports/daily-expenses', {
          params: {
            from: dailyFrom || undefined,
            to: dailyTo || undefined,
            projectId: dailyProjectId !== 'all' ? dailyProjectId : undefined,
          },
        });
        setDailyReport(res.data);
      } else if (reportType === 'supplier-purchases') {
        const res = await api.get<SupplierPurchaseReportData>('/reports/supplier-purchases', {
          params: {
            from: purchaseFrom || undefined,
            to: purchaseTo || undefined,
            projectId: purchaseProjectId !== 'all' ? purchaseProjectId : undefined,
            supplierId: purchaseSupplierId !== 'all' ? purchaseSupplierId : undefined,
          },
        });
        setSupReport(res.data);
      } else {
        const res = await api.get<AllProjectsReportData>('/reports/all-projects', {
          params: { status: allProjectsStatus !== 'All' ? allProjectsStatus : undefined },
        });
        setAllReport(res.data);
      }
    } catch (err) {
      showError(extractApiError(err, 'Failed to generate financial report.'));
    } finally {
      setLoading(false);
    }
  }, [
    reportType,
    selectedProjectId,
    dailyFrom,
    dailyTo,
    dailyProjectId,
    purchaseFrom,
    purchaseTo,
    purchaseProjectId,
    purchaseSupplierId,
    allProjectsStatus,
    showError,
  ]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const handleCurrencyModeChange = (mode: CurrencyDisplayMode) => {
    setCurrencyMode(mode);
    setSelectedColumnsByReport((prev) => {
      const updated = { ...prev };
      (['project-financial', 'daily-expenses', 'supplier-purchases'] as ReportType[]).forEach((rt) => {
        const current = new Set(updated[rt]);
        if (mode === 'both') {
          current.add('sh');
          current.add('usd');
        } else if (mode === 'usd') {
          current.delete('sh');
          current.add('usd');
        } else {
          current.add('sh');
          current.delete('usd');
        }
        updated[rt] = REPORT_COLUMNS[rt].map((c) => c.key).filter((k) => current.has(k));
      });
      return updated;
    });
  };

  const toggleColumn = (key: string) => {
    setSelectedColumnsByReport((prev) => {
      const current = prev[reportType];
      const exists = current.includes(key);
      if (exists && current.length <= 1) {
        return prev; // Keep at least one column visible
      }
      const nextSet = new Set(current);
      if (exists) nextSet.delete(key);
      else nextSet.add(key);

      const ordered = REPORT_COLUMNS[reportType].map((c) => c.key).filter((k) => nextSet.has(k));

      // Keep currency mode indicator in sync if sh/usd toggled directly
      if (reportType !== 'all-projects') {
        const hasSh = ordered.includes('sh');
        const hasUsd = ordered.includes('usd');
        if (hasSh && hasUsd) setCurrencyMode('both');
        else if (hasUsd && !hasSh) setCurrencyMode('usd');
        else if (hasSh && !hasUsd) setCurrencyMode('sh');
      }

      return { ...prev, [reportType]: ordered };
    });
  };

  const selectAllColumns = () => {
    setSelectedColumnsByReport((prev) => ({
      ...prev,
      [reportType]: REPORT_COLUMNS[reportType].map((c) => c.key),
    }));
    if (reportType !== 'all-projects') {
      setCurrencyMode('both');
    }
  };

  const activeColumns = useMemo(() => {
    const selected = new Set(selectedColumnsByReport[reportType]);
    return REPORT_COLUMNS[reportType].filter((c) => selected.has(c.key));
  }, [reportType, selectedColumnsByReport]);

  // Single-Project Header Info (only when a single project is selected, NEVER for All Projects)
  const singleProjectInfo = useMemo<Project | null>(() => {
    if (reportType === 'project-financial') {
      return projReport?.project ?? null;
    }
    if (reportType === 'daily-expenses' && dailyProjectId !== 'all') {
      return projects.find((p) => String(p.id) === dailyProjectId) ?? null;
    }
    if (reportType === 'supplier-purchases' && purchaseProjectId !== 'all') {
      return projects.find((p) => String(p.id) === purchaseProjectId) ?? null;
    }
    return null;
  }, [reportType, projReport, dailyProjectId, purchaseProjectId, projects]);

  const activeCompany = company!;
  const preparedBy = user?.full_name || 'Finance Department';
  const today = todayIsoDate();

  const columnAlignmentsForPdf = useMemo(() => {
    const map: Record<number, 'left' | 'center' | 'right'> = {};
    activeColumns.forEach((col, idx) => {
      if (col.align === 'right') map[idx] = 'right';
    });
    return map;
  }, [activeColumns]);

  const handleDownloadPdf = async () => {
    if (!activeCompany) return;
    setExporting(true);
    try {
      const pdfCols = activeColumns.map((c) => c.label);

      if (reportType === 'project-financial' && projReport) {
        const p = projReport.project;
        await exportA4Pdf({
          filename: `${p.project_code}_Financial_Report.pdf`,
          company: activeCompany,
          documentTitle: 'PROJECT FINANCIAL REPORT',
          subtitle: `${p.project_code} — ${p.project_name}`,
          documentDate: today,
          preparedBy,
          orientation,
          projectInfo: buildProjectInfoRows(p),
          metadata: [
            { label: 'Location', value: p.location || '—' },
            { label: 'Status', value: p.status },
            { label: 'Transactions', value: String(projReport.transactions.length) },
          ],
          columns: pdfCols,
          rows: projReport.transactions.map((t) =>
            activeColumns.map((col) => {
              switch (col.key) {
                case 'date':
                  return formatDisplayDate(t.date);
                case 'type':
                  return t.category;
                case 'description':
                  return t.description;
                case 'method':
                  return t.payment_method;
                case 'ref':
                  return t.reference || '—';
                case 'currency':
                  return t.currency || 'USD';
                case 'sh':
                  return t.sh_amount !== null && t.sh_amount !== undefined ? formatShilling(t.sh_amount) : '—';
                case 'usd':
                  return formatUsd(t.usd_amount ?? t.amount);
                default:
                  return '';
              }
            })
          ),
          columnAlignments: columnAlignmentsForPdf,
          summaryRows: [
            { label: 'Total Expenses (USD)', value: formatUsd(p.total_expenses) },
            { label: 'Total Purchases (USD)', value: formatUsd(p.total_purchases) },
            { label: 'Total Project Cost (USD)', value: formatUsd(p.total_project_cost), highlight: 'navy' },
            { label: 'Contract Amount (USD)', value: formatUsd(p.contract_amount) },
            {
              label: 'Remaining Budget (USD)',
              value: formatUsd(p.remaining_budget),
              highlight: p.remaining_budget >= 0 ? 'positive' : 'negative',
            },
            {
              label: 'Profit / Loss (USD)',
              value: formatUsd(p.profit_loss ?? p.contract_amount - p.total_project_cost),
              highlight: (p.profit_loss ?? p.contract_amount - p.total_project_cost) >= 0 ? 'positive' : 'negative',
            },
          ],
          note: 'All grand totals are calculated in USD ($). Profit / Loss = Contract Amount − Total Project Cost.',
        });
      } else if (reportType === 'daily-expenses' && dailyReport) {
        const projLabel =
          dailyProjectId === 'all'
            ? 'All Projects'
            : singleProjectInfo
            ? `${singleProjectInfo.project_code} — ${singleProjectInfo.project_name}`
            : 'Selected Project';
        await exportA4Pdf({
          filename: `Daily_Expenses_Report_${today}.pdf`,
          company: activeCompany,
          documentTitle: 'DAILY EXPENSES REPORT',
          subtitle: `Expense Statement (${projLabel})`,
          documentDate: today,
          preparedBy,
          orientation,
          projectInfo: singleProjectInfo ? buildProjectInfoRows(singleProjectInfo) : undefined,
          metadata: [
            { label: 'Expense Count', value: String(dailyReport.count) },
            { label: 'Project Scope', value: projLabel },
            { label: 'Date From', value: dailyFrom ? formatDisplayDate(dailyFrom) : 'All Dates' },
            { label: 'Date To', value: dailyTo ? formatDisplayDate(dailyTo) : 'All Dates' },
          ],
          columns: pdfCols,
          rows: dailyReport.rows.map((r) =>
            activeColumns.map((col) => {
              switch (col.key) {
                case 'date':
                  return formatDisplayDate(r.expense_date);
                case 'project':
                  return `${r.project_code} (${r.project_name})`;
                case 'type':
                  return r.expense_type || 'Other Project Expenses';
                case 'description':
                  return r.description;
                case 'method':
                  return r.payment_method;
                case 'ref':
                  return r.reference_number || '—';
                case 'currency':
                  return r.currency || 'USD';
                case 'sh':
                  return r.sh_amount !== null && r.sh_amount !== undefined ? formatShilling(r.sh_amount) : '—';
                case 'usd':
                  return formatUsd(r.usd_amount ?? r.amount);
                default:
                  return '';
              }
            })
          ),
          columnAlignments: columnAlignmentsForPdf,
          summaryRows: [
            { label: 'Total Expenses (USD)', value: formatUsd(dailyReport.totalAmount), highlight: 'navy' },
          ],
          note: 'All grand totals are calculated strictly in USD ($).',
        });
      } else if (reportType === 'supplier-purchases' && supReport) {
        const supLabel =
          purchaseSupplierId === 'all'
            ? 'All Suppliers'
            : suppliers.find((s) => String(s.id) === purchaseSupplierId)?.name || 'Selected Supplier';
        const projLabel =
          purchaseProjectId === 'all'
            ? 'All Projects'
            : singleProjectInfo
            ? `${singleProjectInfo.project_code} — ${singleProjectInfo.project_name}`
            : 'Selected Project';
        await exportA4Pdf({
          filename: `Supplier_Purchase_Report_${today}.pdf`,
          company: activeCompany,
          documentTitle: 'SUPPLIER PURCHASE REPORT',
          subtitle: `${supLabel} · ${projLabel}`,
          documentDate: today,
          preparedBy,
          orientation,
          projectInfo: singleProjectInfo ? buildProjectInfoRows(singleProjectInfo) : undefined,
          metadata: [
            { label: 'Purchase Orders', value: String(supReport.count) },
            { label: 'Supplier', value: supLabel },
            { label: 'Date From', value: purchaseFrom ? formatDisplayDate(purchaseFrom) : 'All Dates' },
            { label: 'Date To', value: purchaseTo ? formatDisplayDate(purchaseTo) : 'All Dates' },
          ],
          columns: pdfCols,
          rows: supReport.rows.map((r) =>
            activeColumns.map((col) => {
              switch (col.key) {
                case 'date':
                  return formatDisplayDate(r.purchase_date);
                case 'supplier':
                  return r.supplier_name || '';
                case 'project':
                  return r.project_code || '';
                case 'description':
                  return r.item_description;
                case 'qty':
                  return `${r.quantity} ${r.unit_label}`;
                case 'status':
                  return r.payment_status;
                case 'currency':
                  return r.currency || 'USD';
                case 'sh':
                  return r.sh_amount !== null && r.sh_amount !== undefined ? formatShilling(r.sh_amount) : '—';
                case 'usd':
                  return formatUsd(r.usd_amount ?? r.total_amount);
                default:
                  return '';
              }
            })
          ),
          columnAlignments: columnAlignmentsForPdf,
          summaryRows: [
            { label: 'Total Purchased (USD)', value: formatUsd(supReport.totalAmount), highlight: 'navy' },
          ],
          note: 'All grand totals are calculated strictly in USD ($).',
        });
      } else if (reportType === 'all-projects' && allReport) {
        await exportA4Pdf({
          filename: `All_Projects_Financial_Report_${today}.pdf`,
          company: activeCompany,
          documentTitle: 'ALL PROJECTS FINANCIAL REPORT',
          subtitle: `Portfolio Status: ${allProjectsStatus}`,
          documentDate: today,
          preparedBy,
          orientation,
          metadata: [
            { label: 'Project Filter', value: allProjectsStatus },
            { label: 'Projects Count', value: String(allReport.projects.length) },
          ],
          columns: pdfCols,
          rows: allReport.projects.map((p) =>
            activeColumns.map((col) => {
              switch (col.key) {
                case 'code':
                  return p.project_code;
                case 'name':
                  return p.project_name;
                case 'budget':
                  return formatUsd(p.project_budget);
                case 'expenses':
                  return formatUsd(p.total_expenses);
                case 'purchases':
                  return formatUsd(p.total_purchases);
                case 'total_cost':
                  return formatUsd(p.total_project_cost);
                case 'remaining':
                  return formatUsd(p.remaining_budget);
                default:
                  return '';
              }
            })
          ),
          columnAlignments: columnAlignmentsForPdf,
          summaryRows: [
            { label: 'Total Contract Value (USD)', value: formatUsd(allReport.totals.contractAmount) },
            { label: 'Total Budget (USD)', value: formatUsd(allReport.totals.projectBudget) },
            { label: 'Total Expenses (USD)', value: formatUsd(allReport.totals.totalExpenses) },
            { label: 'Total Purchases (USD)', value: formatUsd(allReport.totals.totalPurchases) },
            { label: 'Combined Cost (USD)', value: formatUsd(allReport.totals.totalCost), highlight: 'navy' },
            {
              label: 'Remaining Balance (USD)',
              value: formatUsd(allReport.totals.remainingBudget),
              highlight: allReport.totals.remainingBudget >= 0 ? 'positive' : 'negative',
            },
          ],
        });
      }
    } finally {
      setExporting(false);
    }
  };

  const reportTitles: Record<ReportType, string> = {
    'project-financial': 'PROJECT FINANCIAL REPORT',
    'daily-expenses': 'DAILY EXPENSES REPORT',
    'supplier-purchases': 'SUPPLIER PURCHASE REPORT',
    'all-projects': 'ALL PROJECTS FINANCIAL REPORT',
  };

  const renderProjectInfoSection = (p: Project) => {
    const infoRows = buildProjectInfoRows(p);
    return (
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#0F2342] mb-1.5">
          PROJECT INFORMATION
        </h3>
        <div className="overflow-hidden border border-slate-300 rounded">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold text-[#0F2342]">
                <th className="py-1.5 px-3 w-48 border-r border-slate-200">Field</th>
                <th className="py-1.5 px-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {infoRows.map((row) => (
                <tr key={row.field}>
                  <td className="py-1.5 px-3 font-semibold text-slate-600 bg-slate-50/70 border-r border-slate-200 whitespace-nowrap">
                    {row.field}
                  </td>
                  <td className="py-1.5 px-3 font-medium text-slate-900 font-mono tabular-nums">
                    {row.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Dynamic @page print orientation */}
      <style>{`@media print { @page { size: A4 ${orientation}; margin: 11mm 12mm; } }`}</style>

      {/* Controls Header */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Financial Reports</h2>
          <p className="text-sm text-slate-600">
            Customize columns, choose currency display and A4 paper layout, then print or download as PDF.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>Print A4 ({orientation === 'portrait' ? 'Vertical' : 'Horizontal'})</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Generating PDF...' : 'Download PDF'}</span>
          </button>
        </div>
      </div>

      {/* Report Type Selector, Filters, Paper Layout & Customize Report Columns */}
      <div className="no-print bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
            {[
              { id: 'project-financial', label: 'A. Project Financial' },
              { id: 'daily-expenses', label: 'B. Daily Expenses' },
              { id: 'supplier-purchases', label: 'C. Supplier Purchases' },
              { id: 'all-projects', label: 'D. All Projects Summary' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setReportType(item.id as ReportType)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  reportType === item.id ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Paper Orientation Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600">Paper Layout:</span>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    orientation === 'portrait' ? 'bg-[#0F2342] text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Portrait (Vertical)
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    orientation === 'landscape' ? 'bg-[#0F2342] text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Landscape (Horizontal)
                </button>
              </div>
            </div>

            {/* Currency Display Selector */}
            {reportType !== 'all-projects' && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Currency Display:</span>
                <select
                  value={currencyMode}
                  onChange={(e) => handleCurrencyModeChange(e.target.value as CurrencyDisplayMode)}
                  className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-800"
                >
                  <option value="both">Both (SH. &amp; USD)</option>
                  <option value="usd">US Dollar (USD)</option>
                  <option value="sh">Somaliland Shilling (SH.)</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Report Specific Filters */}
        {reportType === 'project-financial' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Select Project</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.project_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {reportType === 'daily-expenses' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date From</label>
              <input
                type="date"
                value={dailyFrom}
                onChange={(e) => setDailyFrom(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date To</label>
              <input
                type="date"
                value={dailyTo}
                onChange={(e) => setDailyTo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Project</label>
              <select
                value={dailyProjectId}
                onChange={(e) => setDailyProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.project_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {reportType === 'supplier-purchases' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date From</label>
              <input
                type="date"
                value={purchaseFrom}
                onChange={(e) => setPurchaseFrom(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date To</label>
              <input
                type="date"
                value={purchaseTo}
                onChange={(e) => setPurchaseTo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Supplier</label>
              <select
                value={purchaseSupplierId}
                onChange={(e) => setPurchaseSupplierId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Project</label>
              <select
                value={purchaseProjectId}
                onChange={(e) => setPurchaseProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.project_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {reportType === 'all-projects' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Project Status</label>
              <select
                value={allProjectsStatus}
                onChange={(e) => setAllProjectsStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Planning">Planning</option>
                <option value="On Hold">On Hold</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        )}

        {/* Customize Report Columns */}
        <div className="pt-3 border-t border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#0F2342]" />
              <span className="text-xs font-bold text-slate-800">Customize Report Columns</span>
              <span className="text-[11px] text-slate-500">
                (Unchecked columns are excluded from Print Preview and PDF download)
              </span>
            </div>
            <button
              type="button"
              onClick={selectAllColumns}
              className="text-xs font-medium text-[#0F2342] hover:underline"
            >
              Show All Columns
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {REPORT_COLUMNS[reportType].map((col) => {
              const checked = selectedColumnsByReport[reportType].includes(col.key);
              const isOnlyLeft = checked && selectedColumnsByReport[reportType].length <= 1;
              return (
                <label
                  key={col.key}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer select-none transition-colors ${
                    checked
                      ? 'bg-[#0F2342]/5 border-[#0F2342]/40 text-[#0F2342]'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                  } ${isOnlyLeft ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isOnlyLeft}
                    onChange={() => toggleColumn(col.key)}
                    className="rounded border-slate-300 text-[#0F2342] focus:ring-[#0F2342]"
                  />
                  <span>{col.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* A4 Printable Preview Frame */}
      <div
        className={`print-container bg-white border border-slate-200 rounded-lg p-6 sm:p-8 mx-auto shadow-sm transition-all ${
          orientation === 'landscape' ? 'max-w-[297mm]' : 'max-w-[210mm]'
        }`}
      >
        {/* Company Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 pb-5 border-b-2 border-[#0F2342]">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <CompanyLogo src={activeCompany?.logo_url} className="w-20 h-20 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-[#0F2342] leading-tight">
                {activeCompany?.company_name || 'A-MIISAAN CONSTRUCTION CO.'}
              </h1>
              <p className="text-xs text-slate-600 mt-0.5 leading-snug">{activeCompany?.address}</p>
              <p className="text-xs text-slate-600 leading-snug">
                {activeCompany?.phone} · {activeCompany?.email}
              </p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#0086D7] mt-1.5">
                {reportTitles[reportType]}
              </p>
            </div>
          </div>

          <div className="shrink-0 sm:min-w-[205px] bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 font-medium">Date</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">{formatDisplayDate(today)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 font-medium">Prepared By</span>
              <span className="font-semibold text-slate-900 text-right">{preparedBy}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 font-medium">Currency</span>
              <span className="font-mono font-semibold text-slate-900">USD ($)</span>
            </div>
            {singleProjectInfo && (
              <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-200">
                <span className="text-slate-500 font-medium">Project</span>
                <span className="font-mono font-bold text-[#0F2342]">{singleProjectInfo.project_code}</span>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Generating report...</div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* REPORT A: PROJECT FINANCIAL */}
            {reportType === 'project-financial' && projReport && (
              <>
                {renderProjectInfoSection(projReport.project)}

                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-4">
                    <span>
                      Location: <strong className="text-slate-900">{projReport.project.location || '—'}</strong>
                    </span>
                    <span>
                      Status: <strong className="text-slate-900">{projReport.project.status}</strong>
                    </span>
                  </div>
                  <span>
                    Transactions: <strong className="font-mono text-[#0F2342]">{projReport.transactions.length}</strong>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0F2342] text-white font-semibold">
                        {activeColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`py-2 px-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {projReport.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={activeColumns.length} className="py-8 text-center text-slate-500">
                            No transactions recorded for this project.
                          </td>
                        </tr>
                      ) : (
                        projReport.transactions.map((t, idx) => (
                          <tr key={`${t.category}-${t.id}-${idx}`} className="even:bg-slate-50/70">
                            {activeColumns.map((col) => {
                              switch (col.key) {
                                case 'date':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                                      {formatDisplayDate(t.date)}
                                    </td>
                                  );
                                case 'type':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-medium whitespace-nowrap">
                                      {t.category}
                                    </td>
                                  );
                                case 'description':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-slate-900">
                                      {t.description}
                                    </td>
                                  );
                                case 'method':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 whitespace-nowrap">
                                      {t.payment_method}
                                    </td>
                                  );
                                case 'ref':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-mono text-slate-500 whitespace-nowrap">
                                      {t.reference || '—'}
                                    </td>
                                  );
                                case 'currency':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 font-mono font-medium text-slate-700 whitespace-nowrap"
                                    >
                                      {t.currency || 'USD'}
                                    </td>
                                  );
                                case 'sh':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap"
                                    >
                                      {t.sh_amount !== null && t.sh_amount !== undefined ? formatShilling(t.sh_amount) : '—'}
                                    </td>
                                  );
                                case 'usd':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap"
                                    >
                                      {formatUsd(t.usd_amount ?? t.amount)}
                                    </td>
                                  );
                                default:
                                  return null;
                              }
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Total Expenses (USD)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatUsd(projReport.project.total_expenses)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Total Purchases (USD)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatUsd(projReport.project.total_purchases)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-slate-200">
                      <span className="font-bold text-[#0F2342]">Total Project Cost (USD)</span>
                      <span className="font-mono font-bold text-[#0F2342] tabular-nums">
                        {formatUsd(projReport.project.total_project_cost)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Contract Amount (USD)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatUsd(projReport.project.contract_amount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Remaining Budget (USD)</span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          projReport.project.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {formatUsd(projReport.project.remaining_budget)}
                      </span>
                    </div>
                    {(() => {
                      const projProfitLoss =
                        projReport.project.profit_loss ??
                        projReport.project.contract_amount - projReport.project.total_project_cost;
                      return (
                        <div className="flex justify-between pt-1.5 border-t border-slate-200">
                          <span className="font-semibold text-slate-700">Profit / Loss (USD)</span>
                          <span
                            className={`font-mono font-bold tabular-nums ${
                              projProfitLoss >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {formatUsd(projProfitLoss)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}

            {/* REPORT B: DAILY EXPENSES */}
            {reportType === 'daily-expenses' && dailyReport && (
              <>
                {singleProjectInfo && renderProjectInfoSection(singleProjectInfo)}

                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-4">
                    <span>
                      From:{' '}
                      <strong className="font-mono text-slate-900">
                        {dailyFrom ? formatDisplayDate(dailyFrom) : 'All Dates'}
                      </strong>
                    </span>
                    <span>
                      To:{' '}
                      <strong className="font-mono text-slate-900">
                        {dailyTo ? formatDisplayDate(dailyTo) : 'All Dates'}
                      </strong>
                    </span>
                    <span>
                      Scope:{' '}
                      <strong className="text-slate-900">
                        {singleProjectInfo
                          ? `${singleProjectInfo.project_code} — ${singleProjectInfo.project_name}`
                          : 'All Projects'}
                      </strong>
                    </span>
                  </div>
                  <div className="px-2.5 py-1 bg-[#0F2342] text-white rounded font-mono font-semibold text-xs">
                    Expense Count: {dailyReport.count}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0F2342] text-white font-semibold">
                        {activeColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`py-2 px-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {dailyReport.rows.length === 0 ? (
                        <tr>
                          <td colSpan={activeColumns.length} className="py-8 text-center text-slate-500">
                            No expenses found for the selected date range.
                          </td>
                        </tr>
                      ) : (
                        dailyReport.rows.map((r) => (
                          <tr key={r.id} className="even:bg-slate-50/70">
                            {activeColumns.map((col) => {
                              switch (col.key) {
                                case 'date':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                                      {formatDisplayDate(r.expense_date)}
                                    </td>
                                  );
                                case 'project':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 whitespace-nowrap">
                                      <strong className="font-mono text-[#0F2342]">{r.project_code}</strong> · {r.project_name}
                                    </td>
                                  );
                                case 'type':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-slate-700 whitespace-nowrap">
                                      {r.expense_type || 'Other Project Expenses'}
                                    </td>
                                  );
                                case 'description':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-slate-900">
                                      {r.description}
                                    </td>
                                  );
                                case 'method':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 whitespace-nowrap">
                                      {r.payment_method}
                                    </td>
                                  );
                                case 'ref':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-mono text-slate-500 whitespace-nowrap">
                                      {r.reference_number || '—'}
                                    </td>
                                  );
                                case 'currency':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 font-mono font-medium text-slate-700 whitespace-nowrap"
                                    >
                                      {r.currency || 'USD'}
                                    </td>
                                  );
                                case 'sh':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap"
                                    >
                                      {r.sh_amount !== null && r.sh_amount !== undefined ? formatShilling(r.sh_amount) : '—'}
                                    </td>
                                  );
                                case 'usd':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap"
                                    >
                                      {formatUsd(r.usd_amount ?? r.amount)}
                                    </td>
                                  );
                                default:
                                  return null;
                              }
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-3.5 flex justify-between text-xs">
                    <span className="font-bold text-[#0F2342]">Total Period Expenses (USD)</span>
                    <span className="font-mono font-bold text-[#0F2342] tabular-nums">
                      {formatUsd(dailyReport.totalAmount)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* REPORT C: SUPPLIER PURCHASES */}
            {reportType === 'supplier-purchases' && supReport && (
              <>
                {singleProjectInfo && renderProjectInfoSection(singleProjectInfo)}

                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-4">
                    <span>
                      From:{' '}
                      <strong className="font-mono text-slate-900">
                        {purchaseFrom ? formatDisplayDate(purchaseFrom) : 'All Dates'}
                      </strong>
                    </span>
                    <span>
                      To:{' '}
                      <strong className="font-mono text-slate-900">
                        {purchaseTo ? formatDisplayDate(purchaseTo) : 'All Dates'}
                      </strong>
                    </span>
                    <span>
                      Scope:{' '}
                      <strong className="text-slate-900">
                        {singleProjectInfo
                          ? `${singleProjectInfo.project_code} — ${singleProjectInfo.project_name}`
                          : 'All Projects'}
                      </strong>
                    </span>
                  </div>
                  <div className="px-2.5 py-1 bg-[#0F2342] text-white rounded font-mono font-semibold text-xs">
                    Purchase Orders: {supReport.count}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0F2342] text-white font-semibold">
                        {activeColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`py-2 px-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {supReport.rows.length === 0 ? (
                        <tr>
                          <td colSpan={activeColumns.length} className="py-8 text-center text-slate-500">
                            No supplier purchases found for the selected filters.
                          </td>
                        </tr>
                      ) : (
                        supReport.rows.map((r) => (
                          <tr key={r.id} className="even:bg-slate-50/70">
                            {activeColumns.map((col) => {
                              switch (col.key) {
                                case 'date':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                                      {formatDisplayDate(r.purchase_date)}
                                    </td>
                                  );
                                case 'supplier':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-medium text-slate-900">
                                      {r.supplier_name}
                                    </td>
                                  );
                                case 'project':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 whitespace-nowrap font-mono text-[#0F2342]">
                                      {r.project_code}
                                    </td>
                                  );
                                case 'description':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-slate-800">
                                      {r.item_description}
                                    </td>
                                  );
                                case 'qty':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      {r.quantity} {r.unit_label}
                                    </td>
                                  );
                                case 'status':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 whitespace-nowrap">
                                      {r.payment_status}
                                    </td>
                                  );
                                case 'currency':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 font-mono font-medium text-slate-700 whitespace-nowrap"
                                    >
                                      {r.currency || 'USD'}
                                    </td>
                                  );
                                case 'sh':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap"
                                    >
                                      {r.sh_amount !== null && r.sh_amount !== undefined ? formatShilling(r.sh_amount) : '—'}
                                    </td>
                                  );
                                case 'usd':
                                  return (
                                    <td
                                      key={col.key}
                                      className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap"
                                    >
                                      {formatUsd(r.usd_amount ?? r.total_amount)}
                                    </td>
                                  );
                                default:
                                  return null;
                              }
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-3.5 flex justify-between text-xs">
                    <span className="font-bold text-[#0F2342]">Total Purchased Amount (USD)</span>
                    <span className="font-mono font-bold text-[#0F2342] tabular-nums">
                      {formatUsd(supReport.totalAmount)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* REPORT D: ALL PROJECTS (never displays single-project information block) */}
            {reportType === 'all-projects' && allReport && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0F2342] text-white font-semibold">
                        {activeColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`py-2 px-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {allReport.projects.length === 0 ? (
                        <tr>
                          <td colSpan={activeColumns.length} className="py-8 text-center text-slate-500">
                            No projects match the selected status filter.
                          </td>
                        </tr>
                      ) : (
                        allReport.projects.map((p) => (
                          <tr key={p.id} className="even:bg-slate-50/70">
                            {activeColumns.map((col) => {
                              switch (col.key) {
                                case 'code':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 font-mono font-semibold text-[#0F2342] whitespace-nowrap">
                                      {p.project_code}
                                    </td>
                                  );
                                case 'name':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-slate-900">
                                      <span className="font-medium">{p.project_name}</span>
                                      <span className="block text-[10px] text-slate-500">
                                        {p.client_name} · {p.status}
                                      </span>
                                    </td>
                                  );
                                case 'budget':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      {formatUsd(p.project_budget)}
                                    </td>
                                  );
                                case 'expenses':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      {formatUsd(p.total_expenses)}
                                    </td>
                                  );
                                case 'purchases':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                                      {formatUsd(p.total_purchases)}
                                    </td>
                                  );
                                case 'total_cost':
                                  return (
                                    <td key={col.key} className="py-1.5 px-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                                      {formatUsd(p.total_project_cost)}
                                    </td>
                                  );
                                case 'remaining':
                                  return (
                                    <td
                                      key={col.key}
                                      className={`py-1.5 px-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                        p.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-700'
                                      }`}
                                    >
                                      {formatUsd(p.remaining_budget)}
                                    </td>
                                  );
                                default:
                                  return null;
                              }
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Total Allocated Budget (USD)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatUsd(allReport.totals.projectBudget)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Total Expenses (USD)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatUsd(allReport.totals.totalExpenses)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Total Purchases (USD)</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {formatUsd(allReport.totals.totalPurchases)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-slate-200">
                      <span className="font-bold text-[#0F2342]">Combined Portfolio Cost (USD)</span>
                      <span className="font-mono font-bold text-[#0F2342] tabular-nums">
                        {formatUsd(allReport.totals.totalCost)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-700">Remaining Portfolio Balance (USD)</span>
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          allReport.totals.remainingBudget >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {formatUsd(allReport.totals.remainingBudget)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Signature & Footer */}
        <div className="mt-10 pt-5 border-t border-slate-200 grid grid-cols-2 gap-8 text-xs">
          <div>
            <div className="border-t border-slate-400 w-48 pt-1.5">
              <p className="font-semibold text-slate-900">Prepared By: {preparedBy}</p>
              <p className="text-slate-500">Accountant / Finance Office</p>
            </div>
          </div>
          <div className="flex justify-end">
            <div className="border-t border-slate-400 w-48 pt-1.5 text-right">
              <p className="font-semibold text-slate-900">{activeCompany?.signature_name}</p>
              <p className="text-slate-500">{activeCompany?.signature_title}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-2.5 border-t border-slate-200 text-center text-[11px] text-slate-500">
          {activeCompany?.footer_text}
        </div>
      </div>
    </div>
  );
}
