import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Plus, Search, Upload, Download, Pencil, Trash2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { convertShToUsd, formatDisplayDate, formatShilling, formatUsd, todayIsoDate } from '../utils/format.ts';
import { EXPENSE_TYPES } from '../constants/expenses.ts';
import type { Expense, Project, TransactionCurrency } from '../types/index.ts';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Mobile Money', 'Cheque'];

interface ExpenseFormState {
  expense_date: string;
  expense_type: string;
  description: string;
  project_id: string;
  currency: TransactionCurrency;
  amount: string;
  payment_method: string;
  reference_number: string;
  notes: string;
}

interface ValidatedImportRow {
  rowNumber: number;
  expense_date: string;
  expense_type: string;
  description: string;
  project_code: string;
  project_id: number | null;
  project_name: string;
  currency: TransactionCurrency;
  original_amount: number;
  sh_amount: number | null;
  usd_amount: number;
  amount: number;
  payment_method: string;
  reference_number: string;
  notes: string;
  import_hash: string;
  status: 'valid' | 'duplicate' | 'invalid';
  errors: string[];
}

interface ValidationResult {
  summary: {
    total: number;
    valid: number;
    duplicate: number;
    invalid: number;
  };
  rows: ValidatedImportRow[];
}

export function ExpensesPage() {
  const { company } = useAuth();
  const { showSuccess, showError } = useToast();
  const exchangeRate = Number(company?.exchange_rate || 8500);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [projectIdFilter, setProjectIdFilter] = useState('all');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState('All');
  const [currencyFilter, setCurrencyFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Create / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseFormState>({
    expense_date: todayIsoDate(),
    expense_type: '',
    description: '',
    project_id: '',
    currency: 'USD',
    amount: '',
    payment_method: 'Cash',
    reference_number: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Excel Import modal
  const [importOpen, setImportOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api.get<Project[]>('/projects');
      setProjects(res.data);
    } catch {
      // Handled by expenses load if error
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Expense[]>('/expenses', {
        params: {
          search: search || undefined,
          projectId: projectIdFilter !== 'all' ? projectIdFilter : undefined,
          expenseType: expenseTypeFilter !== 'All' ? expenseTypeFilter : undefined,
          currency: currencyFilter !== 'All' ? currencyFilter : undefined,
          paymentMethod: paymentFilter !== 'All' ? paymentFilter : undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
        },
      });
      setExpenses(res.data);
    } catch (err) {
      showError(extractApiError(err, 'Failed to load expenses.'));
    } finally {
      setLoading(false);
    }
  }, [search, projectIdFilter, expenseTypeFilter, currencyFilter, paymentFilter, dateFrom, dateTo, showError]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const openCreate = () => {
    setEditingExpense(null);
    setForm({
      expense_date: todayIsoDate(),
      expense_type: '',
      description: '',
      project_id: projects[0] ? String(projects[0].id) : '',
      currency: 'USD',
      amount: '',
      payment_method: 'Cash',
      reference_number: '',
      notes: '',
    });
    setModalOpen(true);
  };

  const openEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setForm({
      expense_date: exp.expense_date,
      expense_type: exp.expense_type || 'Other Project Expenses',
      description: exp.description,
      project_id: String(exp.project_id),
      currency: exp.currency || 'USD',
      amount: String(exp.original_amount ?? exp.amount),
      payment_method: exp.payment_method,
      reference_number: exp.reference_number || '',
      notes: exp.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        expense_date: form.expense_date,
        expense_type: form.expense_type,
        description: form.description.trim(),
        project_id: Number(form.project_id),
        currency: form.currency,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        reference_number: form.reference_number.trim(),
        notes: form.notes.trim(),
      };
      if (editingExpense) {
        await api.put(`/expenses/${editingExpense.id}`, payload);
        showSuccess('Expense updated successfully.');
      } else {
        await api.post('/expenses', payload);
        showSuccess('Expense recorded and project totals updated.');
      }
      setModalOpen(false);
      await loadExpenses();
    } catch (err) {
      showError(extractApiError(err, 'Failed to save expense.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/expenses/${deleteTarget.id}`);
      showSuccess('Expense deleted and logged in audit history.');
      setDeleteTarget(null);
      await loadExpenses();
    } catch (err) {
      showError(extractApiError(err, 'Failed to delete expense.'));
    } finally {
      setDeleting(false);
    }
  };

  const downloadSampleTemplate = () => {
    const sampleRows = [
      {
        Date: '2026-11-17',
        'Expense Type': 'Labour Expenses',
        Description: 'Labor Payment — Block Masonry',
        'Project Code': projects[0]?.project_code || 'PR1',
        Currency: 'USD',
        Amount: 500,
        'Payment Method': 'Cash',
        'Reference Number': 'EXP-2026-88',
        Notes: 'Weekly mason crew payment',
      },
      {
        Date: '2026-11-18',
        'Expense Type': 'Fuel Expenses',
        Description: 'Site Water & Generator Fuel',
        'Project Code': projects[0]?.project_code || 'PR1',
        Currency: 'SH.',
        Amount: 1572500,
        'Payment Method': 'Mobile Money',
        'Reference Number': 'EXP-2026-89',
        Notes: 'Paid in Somaliland Shilling',
      },
    ];
    const sheet = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Expenses');
    XLSX.writeFile(wb, 'A-MIISAAN_Expenses_Template.xlsx');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setValidating(true);
    setValidationResult(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });

      if (rawJson.length === 0) {
        showError('The uploaded file contains no rows.');
        setValidating(false);
        return;
      }

      const pickField = (row: Record<string, unknown>, candidates: string[]): unknown => {
        const keys = Object.keys(row);
        for (const candidate of candidates) {
          const found = keys.find((k) => k.trim().toLowerCase().replace(/[_\s]+/g, '') === candidate);
          if (found !== undefined) return row[found];
        }
        return '';
      };

      const mappedRows = rawJson.map((row, index) => ({
        rowIndex: index + 2,
        expense_date: pickField(row, ['expensedate', 'date', 'txdate']),
        expense_type: pickField(row, ['expensetype', 'category', 'type']),
        description: pickField(row, ['description', 'desc', 'details', 'item']),
        project_code: pickField(row, ['projectcode', 'project', 'code', 'projectid']),
        currency: pickField(row, ['currency', 'curr']),
        amount: pickField(row, ['amount', 'total', 'cost', 'price']),
        payment_method: pickField(row, ['paymentmethod', 'method', 'payment']),
        reference_number: pickField(row, ['referencenumber', 'reference', 'ref', 'receipt']),
        notes: pickField(row, ['notes', 'note', 'remarks']),
      }));

      const res = await api.post<ValidationResult>('/expenses/import/validate', { rows: mappedRows });
      setValidationResult(res.data);
    } catch (err) {
      showError(extractApiError(err, 'Failed to read or validate Excel/CSV file.'));
    } finally {
      setValidating(false);
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!validationResult) return;
    const validRows = validationResult.rows.filter((r) => r.status === 'valid');
    if (validRows.length === 0) {
      showError('No valid non-duplicate rows to import.');
      return;
    }

    setCommitting(true);
    try {
      const res = await api.post<{ importedCount: number; skippedCount: number }>('/expenses/import/commit', {
        rows: validRows,
      });
      showSuccess(`Imported ${res.data.importedCount} expense(s) successfully.`);
      setImportOpen(false);
      setValidationResult(null);
      setImportFileName('');
      await loadExpenses();
    } catch (err) {
      showError(extractApiError(err, 'Failed to commit imported expenses.'));
    } finally {
      setCommitting(false);
    }
  };

  const totalFilteredUsd = expenses.reduce((sum, item) => sum + Number(item.usd_amount ?? item.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Expenses Management</h2>
          <p className="text-sm text-slate-600">
            Record, filter, and import daily project expenses in USD ($) or Somaliland Shilling (SH.).
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setValidationResult(null);
              setImportFileName('');
              setImportOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            <span>Import Excel / CSV</span>
          </button>
          <button
            type="button"
            onClick={openCreate}
            disabled={projects.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Record Expense</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
        <div className="relative lg:col-span-3">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expense, type, reference..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
          />
        </div>

        <select
          value={projectIdFilter}
          onChange={(e) => setProjectIdFilter(e.target.value)}
          className="lg:col-span-2 px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_code} — {p.project_name}
            </option>
          ))}
        </select>

        <select
          value={expenseTypeFilter}
          onChange={(e) => setExpenseTypeFilter(e.target.value)}
          aria-label="Filter by expense type"
          className="lg:col-span-2 px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
        >
          <option value="All">All Expense Types</option>
          {EXPENSE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <select
          value={currencyFilter}
          onChange={(e) => setCurrencyFilter(e.target.value)}
          aria-label="Filter by currency"
          className="lg:col-span-1 px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
        >
          <option value="All">All Curr.</option>
          <option value="USD">USD</option>
          <option value="SH.">SH.</option>
        </select>

        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          className="lg:col-span-2 px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
        >
          <option value="All">All Methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className="lg:col-span-2 flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
            className="w-full px-2 py-2 text-xs font-mono border border-slate-300 rounded-md"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
            className="w-full px-2 py-2 text-xs font-mono border border-slate-300 rounded-md"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing <strong className="text-slate-900">{expenses.length}</strong> expense record(s)
          </span>
          <span className="font-mono tabular-nums">
            Filtered Total (USD): <strong className="text-[#0F2342] text-sm">{formatUsd(totalFilteredUsd)}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Expense Type</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Currency</th>
                <th className="py-3 px-4 text-right">Total (SH.)</th>
                <th className="py-3 px-4 text-right">Total (USD)</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={10} className="py-4 px-4">
                      <div className="h-5 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    No expenses recorded for the selected filters.
                  </td>
                </tr>
              ) : (
                expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {formatDisplayDate(exp.expense_date)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono font-semibold text-[#0F2342]">{exp.project_code}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-700">{exp.project_name}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      {exp.expense_type || 'Other Project Expenses'}
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-slate-900 font-medium">{exp.description}</p>
                      {exp.notes && <p className="text-xs text-slate-500 mt-0.5">{exp.notes}</p>}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{exp.payment_method}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {exp.reference_number || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                      {exp.currency || 'USD'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                      {exp.currency === 'SH.' ? formatShilling(exp.sh_amount ?? exp.original_amount) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatUsd(exp.usd_amount ?? exp.amount)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(exp)}
                          className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                          title="Edit Expense"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(exp)}
                          className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
                          title="Delete Expense"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Expense Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingExpense ? 'Edit Expense Entry' : 'Record New Expense'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Date *</label>
                  <input
                    type="date"
                    required
                    value={form.expense_date}
                    onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project *</label>
                  <select
                    required
                    value={form.project_id}
                    onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_code} — {p.project_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Type *</label>
                <select
                  required
                  value={form.expense_type}
                  onChange={(e) => setForm({ ...form, expense_type: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                >
                  <option value="" disabled>
                    Select expense type...
                  </option>
                  {EXPENSE_TYPES.map((type, idx) => (
                    <option key={type} value={type}>
                      {idx + 1}. {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description *</label>
                <input
                  type="text"
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g., Labor Payment"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Currency *</label>
                  <select
                    required
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value as TransactionCurrency })}
                    className="w-full px-3 py-2 text-sm font-medium border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  >
                    <option value="USD">USD ($) — US Dollar</option>
                    <option value="SH.">SH. — Somaliland Shilling</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount ({form.currency === 'SH.' ? 'SH.' : 'USD $'}) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder={form.currency === 'SH.' ? '85000' : '500.00'}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method *</label>
                  <select
                    value={form.payment_method}
                    onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {form.currency === 'SH.' && (
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5 flex items-center justify-between text-xs">
                  <span className="text-slate-600">
                    Converted USD (Rate: <span className="font-mono">1 USD = {exchangeRate.toLocaleString('en-US')} SH.</span>)
                  </span>
                  <span className="font-mono font-bold text-[#0F2342] text-sm tabular-nums">
                    {formatUsd(convertShToUsd(Number(form.amount || 0), exchangeRate))}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reference Number <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.reference_number}
                  onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                  placeholder="EXP-1008"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notes <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingExpense ? 'Update Expense' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel / CSV Import Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-lg shadow-xl my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Import Expenses from Excel / CSV</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Required columns: Date, Description, Project Code, Amount (optional: Currency [USD or SH.], Expense Type, Payment Method, Reference Number, Notes)
                </p>
              </div>
              <button type="button" onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-slate-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md p-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {importFileName ? `Selected file: ${importFileName}` : 'Upload an .xlsx or .csv file to preview and validate'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    System checks project codes, converts SH. to USD (1 USD = {exchangeRate.toLocaleString('en-US')} SH.), and prevents duplicates.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={downloadSampleTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Sample Template</span>
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{validating ? 'Validating...' : 'Choose File'}</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={validating}
                    />
                  </label>
                </div>
              </div>

              {validationResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="border border-slate-200 rounded-md p-3">
                      <span className="text-slate-500 block">Total Rows</span>
                      <span className="text-lg font-bold font-mono text-slate-900">{validationResult.summary.total}</span>
                    </div>
                    <div className="border border-emerald-200 bg-emerald-50/40 rounded-md p-3">
                      <span className="text-emerald-700 block">Valid &amp; Ready</span>
                      <span className="text-lg font-bold font-mono text-emerald-700">{validationResult.summary.valid}</span>
                    </div>
                    <div className="border border-amber-200 bg-amber-50/40 rounded-md p-3">
                      <span className="text-amber-700 block">Duplicates Skipped</span>
                      <span className="text-lg font-bold font-mono text-amber-700">{validationResult.summary.duplicate}</span>
                    </div>
                    <div className="border border-red-200 bg-red-50/40 rounded-md p-3">
                      <span className="text-red-700 block">Invalid Rows</span>
                      <span className="text-lg font-bold font-mono text-red-700">{validationResult.summary.invalid}</span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-md overflow-x-auto max-h-72">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr className="text-slate-600 font-semibold">
                          <th className="py-2.5 px-3">Row</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Project</th>
                          <th className="py-2.5 px-3">Expense Type</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Currency</th>
                          <th className="py-2.5 px-3 text-right">Total (SH.)</th>
                          <th className="py-2.5 px-3 text-right">Total (USD)</th>
                          <th className="py-2.5 px-3">Validation Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {validationResult.rows.map((row) => (
                          <tr key={row.rowNumber} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono text-slate-500">#{row.rowNumber}</td>
                            <td className="py-2 px-3 font-mono">{row.expense_date || '—'}</td>
                            <td className="py-2 px-3 font-mono font-semibold text-[#0F2342]">{row.project_code || '—'}</td>
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{row.expense_type || 'Other Project Expenses'}</td>
                            <td className="py-2 px-3 text-slate-800">{row.description || '—'}</td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-700">{row.currency || 'USD'}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              {row.currency === 'SH.' ? formatShilling(row.sh_amount ?? row.original_amount) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                              {formatUsd(row.usd_amount ?? row.amount)}
                            </td>
                            <td className="py-2 px-3">
                              {row.status === 'valid' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                                </span>
                              ) : row.status === 'duplicate' ? (
                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                  <AlertTriangle className="w-3.5 h-3.5" /> Duplicate
                                </span>
                              ) : (
                                <span className="text-red-700 font-medium">{row.errors.join('; ')}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={!validationResult || validationResult.summary.valid === 0 || committing}
                  onClick={handleConfirmImport}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
                >
                  {committing
                    ? 'Importing...'
                    : `Confirm Import (${validationResult?.summary.valid ?? 0} Valid Rows)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Expense Record?"
        description={`Remove "${deleteTarget?.description}" (${formatUsd(deleteTarget?.usd_amount ?? deleteTarget?.amount)}) from ${deleteTarget?.project_code}? This change will be recorded in the audit log.`}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
