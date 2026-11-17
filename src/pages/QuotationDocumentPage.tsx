import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useToast } from '../context/ToastContext.tsx';
import { CompanyLogo } from '../components/CompanyLogo.tsx';
import { formatDisplayDate, formatShilling, formatUsd } from '../utils/format.ts';
import { exportA4Pdf } from '../utils/pdfExport.ts';
import type { QuotationDocument } from '../types/index.ts';

export function QuotationDocumentPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { showError } = useToast();
  const [doc, setDoc] = useState<QuotationDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<QuotationDocument>(`/quotations/${projectId}`);
        if (active) setDoc(res.data);
      } catch (err) {
        if (active) showError(extractApiError(err, 'Failed to load quotation document.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, showError]);

  if (loading) {
    return <div className="h-96 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  if (!doc) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6">
        <p className="text-sm text-red-700">Quotation document could not be loaded.</p>
        <Link to="/quotations" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#0F2342] hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Quotations
        </Link>
      </div>
    );
  }

  const { company, project, documentDate, preparedBy, items } = doc;

  const handleDownloadPdf = async () => {
    setExporting(true);
    try {
      await exportA4Pdf({
        filename: `${project.project_code}_Quotation_Summary.pdf`,
        company,
        documentTitle: company.quotation_header || 'PROJECT QUOTATION / FINANCIAL SUMMARY',
        subtitle: `${project.project_code} — ${project.project_name}`,
        documentDate,
        preparedBy,
        metadata: [
          { label: 'Project Name', value: project.project_name },
          { label: 'Project Code', value: project.project_code },
          { label: 'Client Name', value: project.client_name },
          { label: 'Location', value: project.location },
          { label: 'Start Date', value: formatDisplayDate(project.start_date) },
          { label: 'Expected End', value: formatDisplayDate(project.expected_completion_date) },
        ],
        columns: ['Date', 'Type', 'Description', 'Reference', 'Currency', 'Total (SH.)', 'Total (USD)'],
        rows: items.map((item) => [
          formatDisplayDate(item.date),
          item.source_type,
          item.description,
          item.reference_number || '—',
          item.currency || 'USD',
          item.sh_amount !== null && item.sh_amount !== undefined ? formatShilling(item.sh_amount) : '—',
          formatUsd(item.usd_amount ?? item.amount),
        ]),
        columnAlignments: { 5: 'right', 6: 'right' },
        summaryRows: [
          { label: 'Total Expenses (USD)', value: formatUsd(project.total_expenses) },
          { label: 'Total Purchases (USD)', value: formatUsd(project.total_purchases) },
          { label: 'Total Project Cost (USD)', value: formatUsd(project.total_project_cost), highlight: 'navy' },
          { label: 'Contract Amount (USD)', value: formatUsd(project.contract_amount) },
          {
            label: 'Remaining Budget (USD)',
            value: formatUsd(project.remaining_budget),
            highlight: project.remaining_budget >= 0 ? 'positive' : 'negative',
          },
          {
            label: 'Profit / Loss (USD)',
            value: formatUsd(project.profit_loss ?? project.contract_amount - project.total_project_cost),
            highlight: (project.profit_loss ?? project.contract_amount - project.total_project_cost) >= 0 ? 'positive' : 'negative',
          },
        ],
        note: 'All grand totals are calculated in USD ($). Profit / Loss = Contract Amount − Total Project Cost.',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar (hidden in print) */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link to="/quotations" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#0F2342]">
          <ArrowLeft className="w-4 h-4" /> All Project Quotations
        </Link>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>Print A4</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Generating PDF...' : 'Download PDF'}</span>
          </button>
        </div>
      </div>

      {/* A4 Document Sheet */}
      <div className="print-container bg-white border border-slate-200 rounded-lg p-6 sm:p-10 max-w-[210mm] mx-auto shadow-sm">
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 pb-6 border-b-2 border-[#0F2342]">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <CompanyLogo src={company.logo_url} className="w-20 h-20 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#0F2342] leading-tight">
                {company.company_name}
              </h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{company.address}</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {company.phone} · {company.email}
              </p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#0086D7] mt-2">
                {company.quotation_header || 'PROJECT QUOTATION / FINANCIAL SUMMARY'}
              </p>
            </div>
          </div>

          <div className="shrink-0 sm:min-w-[215px] bg-slate-50 border border-slate-200 rounded-md px-4 py-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 font-medium">Document Date</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatDisplayDate(documentDate)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 font-medium">Project Code</span>
              <span className="font-mono font-bold text-[#0F2342]">{project.project_code}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500 font-medium">Currency</span>
              <span className="font-mono font-semibold text-slate-900">USD ($)</span>
            </div>
          </div>
        </div>

        {/* Project Information Block */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 bg-slate-50 border border-slate-200 rounded-md p-4 my-6 text-xs">
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-500">Project Name:</span>
            <span className="font-semibold text-slate-900 text-right">{project.project_name}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-500">Client Name:</span>
            <span className="font-medium text-slate-900 text-right">{project.client_name}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-500">Project Start Date:</span>
            <span className="font-mono text-slate-900">{formatDisplayDate(project.start_date)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-500">Expected Completion:</span>
            <span className="font-mono text-slate-900">{formatDisplayDate(project.expected_completion_date)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-500">Location:</span>
            <span className="text-slate-900 text-right">{project.location}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="font-semibold text-slate-500">Project Budget (USD):</span>
            <span className="font-mono font-semibold text-slate-900">{formatUsd(project.project_budget)}</span>
          </div>
        </div>

        {/* Itemized Costs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#0F2342] text-white text-xs font-semibold">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3">Reference</th>
                <th className="py-2.5 px-3">Currency</th>
                <th className="py-2.5 px-3 text-right">Total (SH.)</th>
                <th className="py-2.5 px-3 text-right">Total (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No expenses or purchases recorded for this project yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={`${item.source_type}-${item.id}`} className="even:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {formatDisplayDate(item.date)}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap">{item.source_type}</td>
                    <td className="py-2.5 px-3 text-slate-900">{item.description}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {item.reference_number || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-700 whitespace-nowrap">
                      {item.currency || 'USD'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                      {item.sh_amount !== null && item.sh_amount !== undefined ? formatShilling(item.sh_amount) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatUsd(item.usd_amount ?? item.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Financial Summary */}
        <div className="mt-8 flex flex-col sm:flex-row justify-between gap-6 items-start">
          <div className="text-xs text-slate-600 max-w-sm space-y-1.5">
            <p className="font-semibold text-slate-800">Financial Calculation Note</p>
            <p>
              All figures are calculated directly from live verified project expenses and supplier purchase records without double-counting. Grand totals are calculated strictly in USD ($). Profit / Loss = Contract Amount − Total Project Cost.
            </p>
          </div>

          <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">Total Expenses (USD)</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatUsd(project.total_expenses)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Total Purchases (USD)</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatUsd(project.total_purchases)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <span className="font-bold text-[#0F2342]">Total Project Cost (USD)</span>
              <span className="font-mono font-bold text-[#0F2342] tabular-nums">
                {formatUsd(project.total_project_cost)}
              </span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-slate-600">Contract Amount (USD)</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatUsd(project.contract_amount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Remaining Budget (USD)</span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  project.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatUsd(project.remaining_budget)}
              </span>
            </div>
            {(() => {
              const profitLoss = project.profit_loss ?? project.contract_amount - project.total_project_cost;
              return (
                <div className="flex justify-between pt-2 border-t border-slate-200">
                  <span className="font-semibold text-slate-700">Profit / Loss (USD)</span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      profitLoss >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {formatUsd(profitLoss)}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Signature & Footer */}
        <div className="mt-14 pt-6 border-t border-slate-200 grid grid-cols-2 gap-8 text-xs">
          <div>
            <div className="border-t border-slate-400 w-48 pt-2">
              <p className="font-semibold text-slate-900">Prepared By: {preparedBy}</p>
              <p className="text-slate-500">Accountant / Finance Department</p>
            </div>
          </div>
          <div className="flex justify-end">
            <div className="border-t border-slate-400 w-48 pt-2 text-right">
              <p className="font-semibold text-slate-900">{company.signature_name}</p>
              <p className="text-slate-500">{company.signature_title}</p>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-3 border-t border-slate-200 text-center text-[11px] text-slate-500">
          {company.footer_text}
        </div>
      </div>
    </div>
  );
}
