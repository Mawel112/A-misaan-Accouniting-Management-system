import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, ArrowUpRight, X } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { formatCurrency, formatDisplayDate, todayIsoDate } from '../utils/format.ts';
import type { Project, ProjectStatus } from '../types/index.ts';

const STATUS_OPTIONS: ProjectStatus[] = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'];

interface ProjectFormState {
  project_code: string;
  project_name: string;
  client_name: string;
  location: string;
  start_date: string;
  expected_completion_date: string;
  contract_amount: string;
  recorded_revenue: string;
  project_budget: string;
  description: string;
  status: ProjectStatus;
}

const emptyForm = (): ProjectFormState => ({
  project_code: '',
  project_name: '',
  client_name: '',
  location: '',
  start_date: todayIsoDate(),
  expected_completion_date: '',
  contract_amount: '',
  recorded_revenue: '',
  project_budget: '',
  description: '',
  status: 'Active',
});

export function ProjectsPage() {
  const { user, company } = useAuth();
  const { showSuccess, showError } = useToast();
  const isAdmin = user?.role === 'admin';
  const symbol = company?.currency_symbol || '$';

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Project[]>('/projects', {
        params: { search: search || undefined, status: statusFilter !== 'All' ? statusFilter : undefined },
      });
      setProjects(res.data);
    } catch (err) {
      showError(extractApiError(err, 'Failed to load projects.'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, showError]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const openCreate = () => {
    setEditingProject(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditingProject(p);
    setForm({
      project_code: p.project_code,
      project_name: p.project_name,
      client_name: p.client_name,
      location: p.location,
      start_date: p.start_date,
      expected_completion_date: p.expected_completion_date,
      contract_amount: String(p.contract_amount),
      recorded_revenue: p.recorded_revenue !== null && p.recorded_revenue !== undefined ? String(p.recorded_revenue) : '',
      project_budget: String(p.project_budget),
      description: p.description || '',
      status: p.status,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        project_code: form.project_code.trim().toUpperCase(),
        contract_amount: Number(form.contract_amount || 0),
        recorded_revenue: form.recorded_revenue.trim() === '' ? null : Number(form.recorded_revenue),
        project_budget: Number(form.project_budget || 0),
      };
      if (editingProject) {
        await api.put(`/projects/${editingProject.id}`, payload);
        showSuccess(`Updated project ${payload.project_code}.`);
      } else {
        await api.post('/projects', payload);
        showSuccess(`Created project ${payload.project_code}.`);
      }
      setModalOpen(false);
      await loadProjects();
    } catch (err) {
      showError(extractApiError(err, 'Failed to save project.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/projects/${deleteTarget.id}`);
      showSuccess(`Deleted project ${deleteTarget.project_code}.`);
      setDeleteTarget(null);
      await loadProjects();
    } catch (err) {
      showError(extractApiError(err, 'Cannot delete project.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Projects Directory</h2>
          <p className="text-sm text-slate-600">
            Manage construction contracts, budgets, timelines, and linked financial activity.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code (PR1), project name, client, or location..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md overflow-x-auto">
          {['All', ...STATUS_OPTIONS].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === status
                  ? 'bg-white text-[#0F2342] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Project &amp; Client</th>
                <th className="py-3 px-4">Timeline</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Budget</th>
                <th className="py-3 px-4 text-right">Total Cost</th>
                <th className="py-3 px-4 text-right">Remaining</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="py-4 px-4">
                      <div className="h-5 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    No matching projects found.
                  </td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-[#0F2342] whitespace-nowrap">
                      <Link to={`/projects/${p.id}`} className="hover:underline">
                        {p.project_code}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4">
                      <Link to={`/projects/${p.id}`} className="font-semibold text-slate-900 hover:text-[#0F2342]">
                        {p.project_name}
                      </Link>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {p.client_name} · {p.location}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {formatDisplayDate(p.start_date)} – {formatDisplayDate(p.expected_completion_date)}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                      <span
                        className={
                          p.status === 'Active'
                            ? 'text-emerald-700'
                            : p.status === 'Completed'
                            ? 'text-[#0F2342]'
                            : p.status === 'On Hold'
                            ? 'text-amber-700'
                            : p.status === 'Cancelled'
                            ? 'text-red-700'
                            : 'text-slate-600'
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {formatCurrency(p.project_budget, symbol)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900 font-medium whitespace-nowrap">
                      {formatCurrency(p.total_project_cost, symbol)}
                    </td>
                    <td
                      className={`py-3.5 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        p.remaining_budget >= 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {formatCurrency(p.remaining_budget, symbol)}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          to={`/projects/${p.id}`}
                          className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                          title="Open Project Ledger"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </Link>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                              title="Edit Project"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(p)}
                              className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
                              title="Delete Project"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingProject ? `Edit Project — ${editingProject.project_code}` : 'Create New Project'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project Code *</label>
                  <input
                    type="text"
                    required
                    value={form.project_code}
                    onChange={(e) => setForm({ ...form, project_code: e.target.value.toUpperCase() })}
                    placeholder="PR1"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project Name *</label>
                  <input
                    type="text"
                    required
                    value={form.project_name}
                    onChange={(e) => setForm({ ...form, project_name: e.target.value })}
                    placeholder="Building Construction"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Client Name *</label>
                  <input
                    type="text"
                    required
                    value={form.client_name}
                    onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project Location *</label>
                  <input
                    type="text"
                    required
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date *</label>
                  <input
                    type="date"
                    required
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Expected Completion *</label>
                  <input
                    type="date"
                    required
                    value={form.expected_completion_date}
                    onChange={(e) => setForm({ ...form, expected_completion_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project Status *</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  >
                    {STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contract Amount ({symbol}) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.contract_amount}
                    onChange={(e) => setForm({ ...form, contract_amount: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project Budget ({symbol}) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.project_budget}
                    onChange={(e) => setForm({ ...form, project_budget: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Recorded Revenue ({symbol}) <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.recorded_revenue}
                    onChange={(e) => setForm({ ...form, recorded_revenue: e.target.value })}
                    placeholder="Pending if empty"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Project Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                  {saving ? 'Saving...' : editingProject ? 'Update Project' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete Project ${deleteTarget?.project_code}?`}
        description="Only projects without linked expenses or purchases can be removed. This action is logged in the audit trail."
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
