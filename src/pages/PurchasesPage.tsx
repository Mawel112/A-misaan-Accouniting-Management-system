import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { convertShToUsd, formatCurrency, formatDisplayDate, formatShilling, formatUsd, todayIsoDate } from '../utils/format.ts';
import type { Project, Purchase, Supplier, TransactionCurrency } from '../types/index.ts';

const PAYMENT_STATUSES: Array<'Paid' | 'Pending' | 'Partial'> = ['Paid', 'Pending', 'Partial'];
const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Mobile Money'];

export function PurchasesPage() {
  const { company } = useAuth();
  const { showSuccess, showError } = useToast();
  const symbol = company?.currency_symbol || '$';
  const exchangeRate = Number(company?.exchange_rate || 8500);

  const [tab, setTab] = useState<'purchases' | 'suppliers'>('purchases');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('All');
  const [currencyFilter, setCurrencyFilter] = useState('All');

  // Purchase modal
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [pForm, setPForm] = useState({
    purchase_date: todayIsoDate(),
    supplier_id: '',
    project_id: '',
    item_description: '',
    quantity: '1',
    unit_label: 'Bags',
    currency: 'USD' as TransactionCurrency,
    unit_price: '0',
    payment_status: 'Paid' as 'Paid' | 'Pending' | 'Partial',
    payment_method: 'Bank Transfer',
    invoice_number: '',
    notes: '',
  });
  const [savingPurchase, setSavingPurchase] = useState(false);

  // Supplier modal
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [sForm, setSForm] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
  });
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Delete dialogs
  const [deletePurchase, setDeletePurchase] = useState<Purchase | null>(null);
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBaseData = useCallback(async () => {
    try {
      const [supRes, projRes] = await Promise.all([
        api.get<Supplier[]>('/suppliers'),
        api.get<Project[]>('/projects'),
      ]);
      setSuppliers(supRes.data);
      setProjects(projRes.data);
    } catch (err) {
      showError(extractApiError(err, 'Failed to load suppliers and projects.'));
    }
  }, [showError]);

  const loadPurchases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Purchase[]>('/purchases', {
        params: {
          search: search || undefined,
          projectId: projectFilter !== 'all' ? projectFilter : undefined,
          supplierId: supplierFilter !== 'all' ? supplierFilter : undefined,
          paymentStatus: statusFilter !== 'All' ? statusFilter : undefined,
          currency: currencyFilter !== 'All' ? currencyFilter : undefined,
        },
      });
      setPurchases(res.data);
    } catch (err) {
      showError(extractApiError(err, 'Failed to load purchases.'));
    } finally {
      setLoading(false);
    }
  }, [search, projectFilter, supplierFilter, statusFilter, currencyFilter, showError]);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    void loadPurchases();
  }, [loadPurchases]);

  const computedTotal = Number(pForm.quantity || 0) * Number(pForm.unit_price || 0);
  const computedUsdTotal =
    pForm.currency === 'SH.'
      ? convertShToUsd(Number.isFinite(computedTotal) ? computedTotal : 0, exchangeRate)
      : Number((Number.isFinite(computedTotal) ? computedTotal : 0).toFixed(2));

  const openNewPurchase = () => {
    setEditingPurchase(null);
    setPForm({
      purchase_date: todayIsoDate(),
      supplier_id: suppliers[0] ? String(suppliers[0].id) : '',
      project_id: projects[0] ? String(projects[0].id) : '',
      item_description: '',
      quantity: '1',
      unit_label: 'Bags',
      currency: 'USD',
      unit_price: '',
      payment_status: 'Paid',
      payment_method: 'Bank Transfer',
      invoice_number: '',
      notes: '',
    });
    setPurchaseModalOpen(true);
  };

  const openEditPurchase = (pu: Purchase) => {
    setEditingPurchase(pu);
    setPForm({
      purchase_date: pu.purchase_date,
      supplier_id: String(pu.supplier_id),
      project_id: String(pu.project_id),
      item_description: pu.item_description,
      quantity: String(pu.quantity),
      unit_label: pu.unit_label || 'Units',
      currency: pu.currency || 'USD',
      unit_price: String(pu.original_unit_price ?? pu.unit_price),
      payment_status: pu.payment_status,
      payment_method: pu.payment_method,
      invoice_number: pu.invoice_number || '',
      notes: pu.notes || '',
    });
    setPurchaseModalOpen(true);
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPurchase(true);
    try {
      const payload = {
        ...pForm,
        supplier_id: Number(pForm.supplier_id),
        project_id: Number(pForm.project_id),
        quantity: Number(pForm.quantity),
        unit_price: Number(pForm.unit_price),
      };
      if (editingPurchase) {
        await api.put(`/purchases/${editingPurchase.id}`, payload);
        showSuccess('Purchase updated successfully.');
      } else {
        await api.post('/purchases', payload);
        showSuccess('Purchase recorded and linked to project & supplier.');
      }
      setPurchaseModalOpen(false);
      await Promise.all([loadPurchases(), loadBaseData()]);
    } catch (err) {
      showError(extractApiError(err, 'Failed to save purchase.'));
    } finally {
      setSavingPurchase(false);
    }
  };

  const openNewSupplier = () => {
    setEditingSupplier(null);
    setSForm({ name: '', contact_person: '', phone: '', email: '', address: '', notes: '' });
    setSupplierModalOpen(true);
  };

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSForm({
      name: s.name,
      contact_person: s.contact_person || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      notes: s.notes || '',
    });
    setSupplierModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSupplier(true);
    try {
      if (editingSupplier) {
        await api.put(`/suppliers/${editingSupplier.id}`, sForm);
        showSuccess('Supplier updated.');
      } else {
        await api.post('/suppliers', sForm);
        showSuccess('Supplier added to directory.');
      }
      setSupplierModalOpen(false);
      await loadBaseData();
    } catch (err) {
      showError(extractApiError(err, 'Failed to save supplier.'));
    } finally {
      setSavingSupplier(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      if (deletePurchase) {
        await api.delete(`/purchases/${deletePurchase.id}`);
        showSuccess('Purchase deleted.');
        setDeletePurchase(null);
        await Promise.all([loadPurchases(), loadBaseData()]);
      } else if (deleteSupplier) {
        await api.delete(`/suppliers/${deleteSupplier.id}`);
        showSuccess('Supplier deleted.');
        setDeleteSupplier(null);
        await loadBaseData();
      }
    } catch (err) {
      showError(extractApiError(err, 'Delete operation failed.'));
    } finally {
      setDeleting(false);
    }
  };

  const totalPurchasesAmountUsd = purchases.reduce((sum, p) => sum + Number(p.usd_amount ?? p.total_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Purchases &amp; Suppliers</h2>
          <p className="text-sm text-slate-600">
            Track construction material procurement in USD ($) or Somaliland Shilling (SH.) with automatic totals.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-md">
            <button
              type="button"
              onClick={() => setTab('purchases')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                tab === 'purchases' ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Purchases ({purchases.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('suppliers')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                tab === 'suppliers' ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Suppliers ({suppliers.length})
            </button>
          </div>

          {tab === 'purchases' ? (
            <button
              type="button"
              onClick={openNewPurchase}
              disabled={projects.length === 0 || suppliers.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Record Purchase</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openNewSupplier}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier</span>
            </button>
          )}
        </div>
      </div>

      {tab === 'purchases' ? (
        <>
          <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item, invoice, or supplier..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
              />
            </div>

            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_code} — {p.project_name}
                </option>
              ))}
            </select>

            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
            >
              <option value="all">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
            >
              <option value="All">All Payment Statuses</option>
              {PAYMENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
            >
              <option value="All">All Currencies</option>
              <option value="USD">USD ($)</option>
              <option value="SH.">SH. (Somaliland Shilling)</option>
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Showing <strong className="text-slate-900">{purchases.length}</strong> purchase order(s)
              </span>
              <span className="font-mono tabular-nums">
                Filtered Total (USD): <strong className="text-[#0F2342] text-sm">{formatUsd(totalPurchasesAmountUsd)}</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Supplier</th>
                    <th className="py-3 px-4">Project</th>
                    <th className="py-3 px-4">Item Description</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4">Currency</th>
                    <th className="py-3 px-4 text-right">Total (SH.)</th>
                    <th className="py-3 px-4 text-right">Total (USD)</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="py-6 px-4 text-center text-slate-400">
                        Loading purchases...
                      </td>
                    </tr>
                  ) : purchases.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-slate-500">
                        No purchases found.
                      </td>
                    </tr>
                  ) : (
                    purchases.map((pu) => (
                      <tr key={pu.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {formatDisplayDate(pu.purchase_date)}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">{pu.supplier_name}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono font-semibold text-[#0F2342]">{pu.project_code}</span>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-slate-900">{pu.item_description}</p>
                          <p className="text-xs font-mono text-slate-500">
                            {pu.currency === 'SH.'
                              ? `Unit: ${formatShilling(pu.original_unit_price ?? 0)}`
                              : `Unit: ${formatUsd(pu.unit_price)}`}
                            {pu.invoice_number ? ` · Inv: ${pu.invoice_number}` : ''}
                          </p>
                        </td>
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
                        <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                          <span
                            className={
                              pu.payment_status === 'Paid'
                                ? 'text-emerald-700'
                                : pu.payment_status === 'Partial'
                                ? 'text-amber-700'
                                : 'text-red-700'
                            }
                          >
                            {pu.payment_status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditPurchase(pu)}
                              className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                              title="Edit Purchase"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletePurchase(pu)}
                              className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
                              title="Delete Purchase"
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
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Supplier Name</th>
                  <th className="py-3 px-4">Contact Person</th>
                  <th className="py-3 px-4">Phone &amp; Email</th>
                  <th className="py-3 px-4">Address</th>
                  <th className="py-3 px-4 text-right">Orders</th>
                  <th className="py-3 px-4 text-right">Total Purchased</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      No suppliers registered yet.
                    </td>
                  </tr>
                ) : (
                  suppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-900">{s.name}</td>
                      <td className="py-3 px-4 text-slate-700">{s.contact_person || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div>{s.phone || '—'}</div>
                        <div>{s.email || ''}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{s.address || '—'}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{s.purchase_count ?? 0}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums">
                        {formatCurrency(s.total_purchased ?? 0, symbol)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditSupplier(s)}
                            className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteSupplier(s)}
                            className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
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
      )}

      {/* Purchase Modal */}
      {purchaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingPurchase ? 'Edit Purchase Order' : 'Record New Purchase'}
              </h3>
              <button
                type="button"
                onClick={() => setPurchaseModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePurchase} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Purchase Date *</label>
                  <input
                    type="date"
                    required
                    value={pForm.purchase_date}
                    onChange={(e) => setPForm({ ...pForm, purchase_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Supplier *</label>
                  <select
                    required
                    value={pForm.supplier_id}
                    onChange={(e) => setPForm({ ...pForm, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project *</label>
                  <select
                    required
                    value={pForm.project_id}
                    onChange={(e) => setPForm({ ...pForm, project_id: e.target.value })}
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

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Item Description *</label>
                <input
                  type="text"
                  required
                  value={pForm.item_description}
                  onChange={(e) => setPForm({ ...pForm, item_description: e.target.value })}
                  placeholder="e.g., Cement"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Currency *</label>
                  <select
                    value={pForm.currency}
                    onChange={(e) => setPForm({ ...pForm, currency: e.target.value as TransactionCurrency })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    <option value="USD">USD ($) — US Dollar</option>
                    <option value="SH.">SH. — Somaliland Shilling</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit Price ({pForm.currency === 'SH.' ? 'SH.' : 'USD $'}) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={pForm.unit_price}
                    onChange={(e) => setPForm({ ...pForm, unit_price: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={pForm.quantity}
                    onChange={(e) => setPForm({ ...pForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Unit</label>
                  <input
                    type="text"
                    value={pForm.unit_label}
                    onChange={(e) => setPForm({ ...pForm, unit_label: e.target.value })}
                    placeholder="Bags / Tons"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total ({pForm.currency === 'SH.' ? 'SH.' : 'USD'})
                  </label>
                  <div className="px-3 py-2 text-sm font-mono font-bold text-[#0F2342] bg-slate-50 border border-slate-200 rounded-md tabular-nums">
                    {pForm.currency === 'SH.'
                      ? formatShilling(Number.isFinite(computedTotal) ? computedTotal : 0)
                      : formatUsd(Number.isFinite(computedTotal) ? computedTotal : 0)}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Total (USD Base)</label>
                  <div className="px-3 py-2 text-sm font-mono font-bold text-emerald-700 bg-emerald-50/50 border border-slate-200 rounded-md tabular-nums">
                    {formatUsd(computedUsdTotal)}
                  </div>
                </div>
              </div>

              {pForm.currency === 'SH.' && (
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-700 font-mono">
                  Rate: 1 USD = {exchangeRate.toLocaleString('en-US')} SH. ·{' '}
                  {formatShilling(Number.isFinite(computedTotal) ? computedTotal : 0)} ÷ {exchangeRate.toLocaleString('en-US')} ={' '}
                  <strong className="text-[#0F2342]">{formatUsd(computedUsdTotal)}</strong>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Status</label>
                  <select
                    value={pForm.payment_status}
                    onChange={(e) =>
                      setPForm({ ...pForm, payment_status: e.target.value as 'Paid' | 'Pending' | 'Partial' })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    {PAYMENT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={pForm.payment_method}
                    onChange={(e) => setPForm({ ...pForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Invoice Number</label>
                  <input
                    type="text"
                    value={pForm.invoice_number}
                    onChange={(e) => setPForm({ ...pForm, invoice_number: e.target.value })}
                    placeholder="INV-2026-030"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={pForm.notes}
                  onChange={(e) => setPForm({ ...pForm, notes: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPurchaseModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPurchase}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
                >
                  {savingPurchase ? 'Saving...' : editingPurchase ? 'Update Purchase' : 'Save Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      {supplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setSupplierModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplier} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Supplier Name *</label>
                <input
                  type="text"
                  required
                  value={sForm.name}
                  onChange={(e) => setSForm({ ...sForm, name: e.target.value })}
                  placeholder="ABC Building Materials"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={sForm.contact_person}
                    onChange={(e) => setSForm({ ...sForm, contact_person: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={sForm.phone}
                    onChange={(e) => setSForm({ ...sForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={sForm.email}
                    onChange={(e) => setSForm({ ...sForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={sForm.address}
                    onChange={(e) => setSForm({ ...sForm, address: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSupplierModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSupplier}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
                >
                  {savingSupplier ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletePurchase || deleteSupplier)}
        title={deletePurchase ? 'Delete Purchase Order?' : `Delete Supplier ${deleteSupplier?.name}?`}
        description="This action cannot be undone and will be logged in the audit trail."
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeletePurchase(null);
          setDeleteSupplier(null);
        }}
      />
    </div>
  );
}
