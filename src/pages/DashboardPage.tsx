import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  Cell,
} from 'recharts';
import { motion } from 'motion/react';
import {
  Building2,
  Receipt,
  ShoppingCart,
  FileSpreadsheet,
  Wallet,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowUpRight,
  Plus,
} from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { formatDisplayDate, formatUsd } from '../utils/format.ts';

interface DashboardResponse {
  summary: {
    totalProjects: number;
    totalExpenses: number;
    totalPurchases: number | null;
    totalQuotations: number | null;
    totalBudget: number;
    totalProjectCost: number;
    remainingBalance: number;
    totalProfit: number | null;
    calculableProfitCount: number;
    pendingRevenueCount: number;
  };
  projectsBreakdown: Array<{
    id: number;
    project_code: string;
    project_name: string;
    budget: number;
    expenses: number;
    purchases: number;
    total_cost: number;
    remaining_budget: number;
    status: string;
  }>;
  monthlyTrend: Array<{
    month: string;
    expenses: number;
    purchases: number;
    total: number;
  }>;
  recentTransactions: Array<{
    id: string;
    date: string;
    type: 'Expense' | 'Purchase';
    project_code: string;
    project_name: string;
    description: string;
    amount: number;
  }>;
}

type StatusFilter = 'All' | 'Active' | 'Planning' | 'Completed' | 'On Hold';
type TrendView = 'split' | 'combined';
type TxFilter = 'All' | 'Expense' | 'Purchase';

export function DashboardPage() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Dynamic dashboard controls
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [trendView, setTrendView] = useState<TrendView>('split');
  const [txFilter, setTxFilter] = useState<TxFilter>('All');

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.get<DashboardResponse>('/dashboard');
      setData(res.data);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load dashboard summary.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  const filteredProjects = useMemo(() => {
    if (!data) return [];
    if (statusFilter === 'All') return data.projectsBreakdown;
    return data.projectsBreakdown.filter((p) => p.status === statusFilter);
  }, [data, statusFilter]);

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    if (txFilter === 'All') return data.recentTransactions;
    return data.recentTransactions.filter((t) => t.type === txFilter);
  }, [data, txFilter]);

  const projectIdByCode = useMemo(() => {
    if (!data) return new Map<string, number>();
    return new Map(data.projectsBreakdown.map((p) => [p.project_code, p.id]));
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 bg-gradient-to-r from-[#0F2342] to-[#1e3a6e] rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse p-5" />
          ))}
        </div>
        <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-700">
        {error || 'Dashboard data unavailable.'}
      </div>
    );
  }

  const { summary, monthlyTrend } = data;
  const utilizationPct =
    summary.totalBudget > 0 ? Math.min(100, Math.round((summary.totalProjectCost / summary.totalBudget) * 100)) : 0;
  const expensesShare =
    summary.totalProjectCost > 0 ? Math.round((summary.totalExpenses / summary.totalProjectCost) * 100) : 0;
  const purchasesShare =
    summary.totalProjectCost > 0 && summary.totalPurchases !== null ? 100 - expensesShare : 0;

  return (
    <div className="space-y-6">
      {/* Executive Color Banner Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative overflow-hidden rounded-xl bg-gradient-to-r from-[#0F2342] via-[#163461] to-[#1D4E89] text-white p-6 shadow-sm"
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Company Financial Overview
            </h2>
            <p className="text-sm text-slate-100 mt-1.5 leading-relaxed">
              Live project budgets, operating expenses, supplier procurement, and net balances in USD ($).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void loadDashboard(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            {hasPermission('expenses') && (
              <Link
                to="/expenses"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0F2342] bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Record Expense</span>
              </Link>
            )}
            {hasPermission('purchases') && (
              <Link
                to="/purchases"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Record Purchase</span>
              </Link>
            )}
            {hasPermission('reports') && (
              <Link
                to="/reports"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-white/12 hover:bg-white/20 border border-white/20 rounded-lg transition-colors whitespace-nowrap"
              >
                <span>Reports</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </motion.div>

      {/* Primary KPI Grid with Distinct Color Accents & Interactive Hover */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.03 }}
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 border-t-4 border-t-[#0F2342] rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Projects</p>
              <p className="mt-2 text-2xl font-bold text-[#0F2342] font-mono tabular-nums">
                {summary.totalProjects}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-indigo-50 text-[#0F2342]">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Active &amp; planned contracts</span>
            {hasPermission('projects') && (
              <Link to="/projects" className="text-[#0F2342] font-semibold hover:underline">
                View
              </Link>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.06 }}
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 border-t-4 border-t-rose-500 rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Expenses</p>
              <p className="mt-2 text-2xl font-bold text-rose-700 font-mono tabular-nums">
                {formatUsd(summary.totalExpenses)}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-50 text-rose-600">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{expensesShare}% of total project spend</span>
            {hasPermission('expenses') && (
              <Link to="/expenses" className="text-rose-700 font-semibold hover:underline">
                Ledger
              </Link>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.09 }}
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 border-t-4 border-t-amber-500 rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Purchases</p>
              <p className="mt-2 text-2xl font-bold text-amber-700 font-mono tabular-nums">
                {summary.totalPurchases !== null ? formatUsd(summary.totalPurchases) : 'Restricted'}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600">
              <ShoppingCart className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{summary.totalPurchases !== null ? `${purchasesShare}% of total project spend` : 'Supplier procurement'}</span>
            {hasPermission('purchases') && (
              <Link to="/purchases" className="text-amber-700 font-semibold hover:underline">
                Orders
              </Link>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.12 }}
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 border-t-4 border-t-sky-500 rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Quotations</p>
              <p className="mt-2 text-2xl font-bold text-sky-700 font-mono tabular-nums">
                {summary.totalQuotations !== null ? summary.totalQuotations : 'Restricted'}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50 text-sky-600">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Live linked project summaries</span>
            {hasPermission('quotations') && (
              <Link to="/quotations" className="text-sky-700 font-semibold hover:underline">
                Open
              </Link>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.15 }}
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 border-t-4 border-t-blue-600 rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Budget</p>
              <p className="mt-2 text-2xl font-bold text-blue-800 font-mono tabular-nums">
                {formatUsd(summary.totalBudget)}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50 text-blue-700">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span>Utilization</span>
              <span className="font-mono font-semibold text-slate-800">{utilizationPct}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  utilizationPct > 95 ? 'bg-red-500' : utilizationPct > 75 ? 'bg-amber-500' : 'bg-blue-600'
                }`}
                style={{ width: `${utilizationPct}%` }}
              />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.18 }}
          whileHover={{ y: -2 }}
          className={`bg-white border border-slate-200 border-t-4 ${
            summary.remainingBalance >= 0 ? 'border-t-emerald-500' : 'border-t-red-500'
          } rounded-xl p-5 shadow-xs hover:shadow-md transition-shadow`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remaining Balance</p>
              <p
                className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
                  summary.remainingBalance >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatUsd(summary.remainingBalance)}
              </p>
            </div>
            <div
              className={`p-2.5 rounded-lg ${
                summary.remainingBalance >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
              }`}
            >
              {summary.remainingBalance >= 0 ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <TrendingDown className="w-5 h-5" />
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500 font-mono tabular-nums">
            Total Cost: {formatUsd(summary.totalProjectCost)}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.21 }}
          whileHover={{ y: -2 }}
          className={`bg-gradient-to-br ${
            (summary.totalProfit ?? 0) >= 0
              ? 'from-emerald-50/70 to-white border-t-emerald-600'
              : 'from-red-50/70 to-white border-t-red-600'
          } border border-slate-200 border-t-4 rounded-xl p-5 sm:col-span-2 shadow-xs hover:shadow-md transition-shadow`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Profit / Loss (USD)</p>
              <p
                className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
                  (summary.totalProfit ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatUsd(summary.totalProfit ?? 0)}
              </p>
              <p className="mt-1.5 text-xs text-slate-600">
                Calculated as Contract Amount − Total Project Cost.
              </p>
            </div>

            <div className="shrink-0 bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs space-y-1.5 min-w-[200px]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-500">Expenses Share</span>
                <span className="font-mono font-semibold text-rose-700">{expensesShare}%</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-500">Purchases Share</span>
                <span className="font-mono font-semibold text-amber-700">{purchasesShare}%</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                <div className="bg-rose-500 h-full" style={{ width: `${expensesShare}%` }} />
                <div className="bg-amber-500 h-full" style={{ width: `${purchasesShare}%` }} />
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Project Financial Breakdown</h3>
              <p className="text-xs text-slate-500">Budget vs. operating expenses &amp; supplier purchases</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {(['All', 'Active', 'Planning', 'Completed'] as StatusFilter[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === st ? 'bg-[#0F2342] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-slate-500">
              No projects match "{statusFilter}".
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredProjects} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="project_code" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip
                    formatter={(val) => formatUsd(Number(val ?? 0))}
                    contentStyle={{
                      borderColor: '#CBD5E1',
                      borderRadius: '8px',
                      fontSize: '12px',
                      boxShadow: '0 4px 12px rgba(15,35,66,0.08)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="budget" name="Budget" fill="#60A5FA" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#E11D48" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" name="Purchases" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Monthly Spend Trend</h3>
              <p className="text-xs text-slate-500">Monthly cash outflow across expenses &amp; purchases</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setTrendView('split')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  trendView === 'split' ? 'bg-[#0F2342] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Split View
              </button>
              <button
                type="button"
                onClick={() => setTrendView('combined')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  trendView === 'combined' ? 'bg-[#0F2342] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Combined Total
              </button>
            </div>
          </div>

          {monthlyTrend.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-slate-500">
              No monthly financial activity recorded yet.
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyTrend} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#E11D48" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#E11D48" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="purGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="totGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.34} />
                      <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip
                    formatter={(val) => formatUsd(Number(val ?? 0))}
                    contentStyle={{
                      borderColor: '#CBD5E1',
                      borderRadius: '8px',
                      fontSize: '12px',
                      boxShadow: '0 4px 12px rgba(15,35,66,0.08)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {trendView === 'split' ? (
                    <>
                      <Area
                        type="monotone"
                        dataKey="expenses"
                        name="Expenses"
                        stroke="#E11D48"
                        strokeWidth={2.2}
                        fill="url(#expGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="purchases"
                        name="Purchases"
                        stroke="#F59E0B"
                        strokeWidth={2.2}
                        fill="url(#purGrad)"
                      />
                    </>
                  ) : (
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Total Monthly Outflow"
                      stroke="#0284C7"
                      strokeWidth={2.5}
                      fill="url(#totGrad)"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Project Budget Health Bars & Remaining Budget Comparison */}
      {filteredProjects.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Project Budget Health</h3>
                <p className="text-xs text-slate-500">Live spend utilization per project — click any project to inspect</p>
              </div>
              <span className="text-xs font-mono text-slate-500">{filteredProjects.length} project(s)</span>
            </div>

            <div className="space-y-3.5">
              {filteredProjects.map((p) => {
                const pct = p.budget > 0 ? Math.min(100, Math.round((p.total_cost / p.budget) * 100)) : 0;
                const barColor =
                  p.remaining_budget < 0 || pct >= 95
                    ? 'bg-rose-500'
                    : pct >= 75
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';
                return (
                  <Link
                    key={p.id}
                    to={`/projects/${p.id}`}
                    className="block p-3 rounded-lg border border-slate-100 hover:border-slate-300 hover:bg-slate-50/80 transition-all"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-bold text-[#0F2342]">{p.project_code}</span>
                        <span className="font-medium text-slate-800 truncate">{p.project_name}</span>
                        <span className="text-slate-400">· {p.status}</span>
                      </div>
                      <div className="font-mono tabular-nums shrink-0 text-slate-700">
                        <strong className="text-slate-900">{formatUsd(p.total_cost)}</strong> / {formatUsd(p.budget)} (
                        <span className={p.remaining_budget >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                          {pct}%
                        </span>
                        )
                      </div>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">Remaining Balance by Project</h3>
              <p className="text-xs text-slate-500">Emerald = within budget · Red = over budget</p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredProjects} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis type="category" dataKey="project_code" width={48} tick={{ fontSize: 12, fill: '#0F2342', fontWeight: 600 }} />
                  <Tooltip
                    formatter={(val) => formatUsd(Number(val ?? 0))}
                    contentStyle={{ borderColor: '#CBD5E1', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Bar dataKey="remaining_budget" name="Remaining (USD)" radius={[0, 4, 4, 0]}>
                    {filteredProjects.map((entry) => (
                      <Cell key={entry.id} fill={entry.remaining_budget >= 0 ? '#10B981' : '#EF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Recent Financial Transactions</h3>
            <p className="text-xs text-slate-500">Latest verified entries across permitted projects (USD Base)</p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            {(['All', 'Expense', 'Purchase'] as TxFilter[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTxFilter(type)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  txFilter === type ? 'bg-[#0F2342] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {type === 'All' ? 'All Entries' : `${type}s`}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4 text-right">Amount (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No transactions recorded for this filter.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const targetProjectId = projectIdByCode.get(tx.project_code);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {formatDisplayDate(tx.date)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {targetProjectId ? (
                          <Link to={`/projects/${targetProjectId}`} className="hover:underline">
                            <span className="font-mono font-semibold text-[#0F2342]">{tx.project_code}</span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            <span className="text-slate-700">{tx.project_name}</span>
                          </Link>
                        ) : (
                          <>
                            <span className="font-mono font-semibold text-[#0F2342]">{tx.project_code}</span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            <span className="text-slate-700">{tx.project_name}</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                        <span className={tx.type === 'Expense' ? 'text-rose-700' : 'text-amber-700'}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-800">{tx.description}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatUsd(tx.amount)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
