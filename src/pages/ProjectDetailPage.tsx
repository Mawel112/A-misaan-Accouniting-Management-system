import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { formatCurrency, formatDisplayDate, formatShilling, formatUsd } from '../utils/format.ts';
import type { Expense, Project, Purchase } from '../types/index.ts';

interface ProjectDetailResponse {
  project: Project;
  expenses: Expense[];
  purchases: Purchase[];
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { company, hasPermission } = useAuth();
  const symbol = company?.currency_symbol || '$';

  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'expenses' | 'purchases'>('expenses');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get<ProjectDetailResponse>(`/projects/${id}`);
        if (active) setDetail(res.data);
      } catch (err) {
        if (active) setError(extractApiError(err, 'Failed to load project ledger.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  if (error || !detail) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6">
        <p className="text-sm text-red-700">{error || 'Project not found.'}</p>
        <Link to="/projects" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#0F2342] hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Projects
        </Link>
      </div>
    );
  }

  const { project, expenses, purchases } = detail;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F2342] mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Projects
          </Link>
          <h2 className="text-xl font-bold text-slate-900">
            <span className="font-mono text-[#0F2342] mr-2">{project.project_code}</span>
            {project.project_name}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {project.client_name} · {project.location} · {formatDisplayDate(project.start_date)} –{' '}
            {formatDisplayDate(project.expected_completion_date)} · {project.status}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {hasPermission('quotations') && (
            <Link
              to={`/quotations/${project.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Open Live Quotation</span>
            </Link>
          )}
        </div>
      </div>

      {/* Project Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Contract Amount &amp; Budget</p>
          <p className="mt-1.5 text-lg font-bold text-[#0F2342] font-mono tabular-nums">
            {formatCurrency(project.project_budget, symbol)} <span className="text-xs font-normal text-slate-500">Budget</span>
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            Contract Value: {formatCurrency(project.contract_amount, symbol)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Total Project Cost (Expenses + Purchases)</p>
          <p className="mt-1.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {formatCurrency(project.total_project_cost, symbol)}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            Expenses: {formatCurrency(project.total_expenses, symbol)} · Purchases: {formatCurrency(project.total_purchases, symbol)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Remaining Budget &amp; Profit/Loss</p>
          <p className={`mt-1.5 text-lg font-bold font-mono tabular-nums ${project.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatCurrency(project.remaining_budget, symbol)} <span className="text-xs font-normal text-slate-500">Remaining</span>
          </p>
          {(() => {
            const profitLoss = project.profit_loss ?? Number((project.contract_amount - project.total_project_cost).toFixed(2));
            return (
              <p className={`text-xs mt-1 font-mono tabular-nums font-medium ${profitLoss >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                Profit/Loss: {formatCurrency(profitLoss, symbol)} (Contract {formatCurrency(project.contract_amount, symbol)} − Cost {formatCurrency(project.total_project_cost, symbol)})
              </p>
            );
          })()}
        </div>
      </div>

      {project.description && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
          <span className="font-semibold text-slate-900 mr-2">Scope:</span>
          {project.description}
        </div>
      )}

      {/* Linked Activity Tabs */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setActiveTab('expenses')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                activeTab === 'expenses' ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Expenses ({expenses.length})
            </button>
            {hasPermission('purchases') && (
              <button
                type="button"
                onClick={() => setActiveTab('purchases')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  activeTab === 'purchases' ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Purchases ({purchases.length})
              </button>
            )}
          </div>
        </div>

        {activeTab === 'expenses' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Expense Type</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Currency</th>
                  <th className="py-3 px-4 text-right">Total (SH.)</th>
                  <th className="py-3 px-4 text-right">Total (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No expenses recorded for {project.project_code} yet.
                    </td>
                  </tr>
                ) : (
                  expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {formatDisplayDate(exp.expense_date)}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {exp.expense_type || 'Other Project Expenses'}
                      </td>
                      <td className="py-3 px-4 text-slate-900">{exp.description}</td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{exp.payment_method}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {exp.reference_number || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                        {exp.currency || 'USD'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                        {exp.sh_amount !== null && exp.sh_amount !== undefined ? formatShilling(exp.sh_amount) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatUsd(exp.usd_amount ?? exp.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Supplier</th>
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4">Currency</th>
                  <th className="py-3 px-4 text-right">Total (SH.)</th>
                  <th className="py-3 px-4 text-right">Total (USD)</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No purchases recorded for {project.project_code} yet.
                    </td>
                  </tr>
                ) : (
                  purchases.map((pu) => (
                    <tr key={pu.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {formatDisplayDate(pu.purchase_date)}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">{pu.supplier_name}</td>
                      <td className="py-3 px-4 text-slate-800">{pu.item_description}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {pu.quantity} {pu.unit_label}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                        {pu.currency || 'USD'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                        {pu.sh_amount !== null && pu.sh_amount !== undefined ? formatShilling(pu.sh_amount) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatUsd(pu.usd_amount ?? pu.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">{pu.payment_status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
