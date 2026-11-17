import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound, Upload, X, Download, Database, RotateCcw, ArrowRightLeft } from 'lucide-react';
import { api, extractApiError } from '../services/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { CompanyLogo } from '../components/CompanyLogo.tsx';
import { convertShToUsd, formatShilling, formatUsd } from '../utils/format.ts';
import type { AuditLog, AuthUser, CompanySettings, Project, UserPermissions } from '../types/index.ts';

const PERMISSION_LABELS: Array<{ key: keyof Omit<UserPermissions, 'allowedProjectIds'>; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
  { key: 'expenses', label: 'Expenses & Excel Import' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'purchases', label: 'Purchases & Suppliers' },
  { key: 'reports', label: 'Reports & PDF Export' },
  { key: 'settings', label: 'Users & Settings' },
];

const DEFAULT_ACCOUNTANT_PERMS: UserPermissions = {
  dashboard: true,
  projects: true,
  expenses: true,
  quotations: false,
  purchases: false,
  reports: false,
  settings: false,
  allowedProjectIds: 'all',
};

export function SettingsPage() {
  const { user: currentUser, setCompany, refreshSession } = useAuth();
  const { showSuccess, showError } = useToast();

  const [tab, setTab] = useState<'users' | 'company' | 'currency' | 'backup' | 'audit'>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [companyForm, setCompanyForm] = useState<CompanySettings | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);
  const [converterShInput, setConverterShInput] = useState('85000');

  // Backup & Restore state
  const [backupSummary, setBackupSummary] = useState<{
    counts: { projects: number; expenses: number; purchases: number; suppliers: number; users: number; audit_logs: number };
    sizeBytes: number;
  } | null>(null);
  const [downloadingBackup, setDownloadingBackup] = useState<'sqlite' | 'json' | null>(null);
  const [pendingRestorePayload, setPendingRestorePayload] = useState<{
    filename: string;
    data: Record<string, unknown>;
    counts: { projects: number; expenses: number; purchases: number; users: number };
  } | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);

  // User modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [userForm, setUserForm] = useState({
    full_name: '',
    username: '',
    email: '',
    password: '',
    role: 'accountant' as 'admin' | 'accountant',
    is_active: true,
    permissions: DEFAULT_ACCOUNTANT_PERMS,
  });
  const [savingUser, setSavingUser] = useState(false);

  // Password modal
  const [passwordTarget, setPasswordTarget] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Delete user
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [usersRes, settingsRes, projRes, auditRes, backupRes] = await Promise.all([
        api.get<AuthUser[]>('/users'),
        api.get<CompanySettings>('/settings'),
        api.get<Project[]>('/projects'),
        api.get<AuditLog[]>('/audit-logs', { params: { limit: 100 } }),
        api.get<{
          counts: { projects: number; expenses: number; purchases: number; suppliers: number; users: number; audit_logs: number };
          sizeBytes: number;
        }>('/backup/summary'),
      ]);
      setUsers(usersRes.data);
      setCompanyForm(settingsRes.data);
      setProjects(projRes.data);
      setAuditLogs(auditRes.data);
      setBackupSummary(backupRes.data);
    } catch (err) {
      showError(extractApiError(err, 'Failed to load settings data.'));
    }
  }, [showError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm) return;
    setSavingCompany(true);
    try {
      const res = await api.put<CompanySettings>('/settings', companyForm);
      setCompanyForm(res.data);
      setCompany(res.data);
      showSuccess('Company information and document settings saved.');
      await loadAll();
    } catch (err) {
      showError(extractApiError(err, 'Failed to update company settings.'));
    } finally {
      setSavingCompany(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyForm) return;
    if (file.size > 2 * 1024 * 1024) {
      showError('Logo image must be smaller than 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCompanyForm({ ...companyForm, logo_url: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const openNewUser = () => {
    setEditingUser(null);
    setUserForm({
      full_name: '',
      username: '',
      email: '',
      password: '',
      role: 'accountant',
      is_active: true,
      permissions: { ...DEFAULT_ACCOUNTANT_PERMS },
    });
    setUserModalOpen(true);
  };

  const openEditUser = (u: AuthUser) => {
    setEditingUser(u);
    setUserForm({
      full_name: u.full_name,
      username: u.username,
      email: u.email,
      password: '',
      role: u.role,
      is_active: u.is_active,
      permissions: { ...u.permissions },
    });
    setUserModalOpen(true);
  };

  const toggleProjectScope = (projectId: number) => {
    const curr = userForm.permissions.allowedProjectIds;
    if (curr === 'all') {
      setUserForm({
        ...userForm,
        permissions: { ...userForm.permissions, allowedProjectIds: [projectId] },
      });
      return;
    }
    const exists = curr.includes(projectId);
    const next = exists ? curr.filter((id) => id !== projectId) : [...curr, projectId];
    setUserForm({
      ...userForm,
      permissions: { ...userForm.permissions, allowedProjectIds: next },
    });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUser(true);
    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, {
          full_name: userForm.full_name,
          username: userForm.username,
          email: userForm.email,
          role: userForm.role,
          is_active: userForm.is_active,
          permissions: userForm.permissions,
        });
        showSuccess(`Updated user ${userForm.full_name}.`);
      } else {
        await api.post('/users', userForm);
        showSuccess(`Created user ${userForm.full_name}.`);
      }
      setUserModalOpen(false);
      await loadAll();
    } catch (err) {
      showError(extractApiError(err, 'Failed to save user.'));
    } finally {
      setSavingUser(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget) return;
    setSavingPassword(true);
    try {
      await api.patch(`/users/${passwordTarget.id}/password`, { password: newPassword });
      showSuccess(`Password updated for ${passwordTarget.full_name}.`);
      setPasswordTarget(null);
      setNewPassword('');
    } catch (err) {
      showError(extractApiError(err, 'Failed to update password.'));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeletingUser(true);
    try {
      await api.delete(`/users/${deleteTarget.id}`);
      showSuccess(`Deleted user ${deleteTarget.full_name}.`);
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      showError(extractApiError(err, 'Failed to delete user.'));
    } finally {
      setDeletingUser(false);
    }
  };

  const handleDownloadBackup = async (format: 'sqlite' | 'json') => {
    setDownloadingBackup(format);
    try {
      const res = await api.get(`/backup/${format}`, { responseType: 'blob' });
      const dateStamp = new Date().toISOString().slice(0, 10);
      const filename = format === 'sqlite' ? `A-MIISAAN_Backup_${dateStamp}.db` : `A-MIISAAN_Backup_${dateStamp}.json`;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showSuccess(`Backup downloaded: ${filename}`);
      await loadAll();
    } catch (err) {
      showError(extractApiError(err, 'Failed to download backup.'));
    } finally {
      setDownloadingBackup(null);
    }
  };

  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        tables?: {
          projects?: unknown[];
          expenses?: unknown[];
          purchases?: unknown[];
          suppliers?: unknown[];
          users?: unknown[];
        };
      };
      if (
        !parsed?.tables ||
        !Array.isArray(parsed.tables.projects) ||
        !Array.isArray(parsed.tables.expenses) ||
        !Array.isArray(parsed.tables.purchases) ||
        !Array.isArray(parsed.tables.suppliers) ||
        !Array.isArray(parsed.tables.users)
      ) {
        showError('Invalid JSON backup file. Missing required database tables.');
        return;
      }
      setPendingRestorePayload({
        filename: file.name,
        data: parsed as Record<string, unknown>,
        counts: {
          projects: parsed.tables.projects.length,
          expenses: parsed.tables.expenses.length,
          purchases: parsed.tables.purchases.length,
          users: parsed.tables.users.length,
        },
      });
    } catch {
      showError('Could not parse backup file. Please select a valid .json backup exported from A-MIISAAN.');
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestorePayload) return;
    setRestoringBackup(true);
    try {
      await api.post('/backup/restore-json', pendingRestorePayload.data);
      showSuccess('Database backup restored successfully.');
      setPendingRestorePayload(null);
      await Promise.all([loadAll(), refreshSession()]);
    } catch (err) {
      showError(extractApiError(err, 'Failed to restore backup.'));
    } finally {
      setRestoringBackup(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Users, Permissions &amp; Settings</h2>
          <p className="text-sm text-slate-600">
            Control staff access permissions, company branding for A4 PDFs, backups, and audit history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-md w-fit">
          {[
            { id: 'users', label: 'Users & Permissions' },
            { id: 'company', label: 'Company & Documents' },
            { id: 'currency', label: 'Currency & Rate Converter' },
            { id: 'backup', label: 'Backup & Restore' },
            { id: 'audit', label: 'Audit Logs' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as 'users' | 'company' | 'currency' | 'backup' | 'audit')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                tab === item.id ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: USERS & PERMISSIONS */}
      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openNewUser}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md"
            >
              <Plus className="w-4 h-4" />
              <span>Create User</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Full Name</th>
                    <th className="py-3 px-4">Username &amp; Email</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Module Access</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {users.map((u) => {
                    const enabledModules = PERMISSION_LABELS.filter((p) => u.role === 'admin' || u.permissions[p.key]).map(
                      (p) => p.label.split(' ')[0]
                    );
                    return (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-semibold text-slate-900">{u.full_name}</td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <div className="font-mono text-slate-900">@{u.username}</div>
                          <div>{u.email}</div>
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold text-[#0F2342]">
                          {u.role === 'admin' ? 'Admin' : 'Accountant'}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                          {u.role === 'admin' ? 'Full System Access' : enabledModules.join(' · ') || 'None'}
                        </td>
                        <td className="py-3 px-4 text-xs font-medium">
                          <span className={u.is_active ? 'text-emerald-700' : 'text-red-700'}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                              title="Edit User & Permissions"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPasswordTarget(u);
                                setNewPassword('');
                              }}
                              className="p-1.5 text-slate-600 hover:text-[#0F2342] rounded hover:bg-slate-100"
                              title="Change Password"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                            {u.id !== currentUser?.id && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(u)}
                                className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
                                title="Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: COMPANY & DOCUMENT SETTINGS */}
      {tab === 'company' && companyForm && (
        <form onSubmit={handleSaveCompany} className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 pb-6 border-b border-slate-200">
            <CompanyLogo src={companyForm.logo_url} className="w-20 h-20 p-1" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Company Logo &amp; Branding</h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Automatically applied to the navigation sidebar and all generated A4 PDF Quotations &amp; Reports.
              </p>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload New Logo</span>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name</label>
              <input
                type="text"
                required
                value={companyForm.company_name}
                onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Email</label>
              <input
                type="email"
                value={companyForm.email}
                onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
              <input
                type="text"
                value={companyForm.phone}
                onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company Address</label>
              <input
                type="text"
                value={companyForm.address}
                onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Currency Code</label>
              <input
                type="text"
                value={companyForm.currency}
                onChange={(e) => setCompanyForm({ ...companyForm, currency: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Currency Symbol</label>
              <input
                type="text"
                value={companyForm.currency_symbol}
                onChange={(e) => setCompanyForm({ ...companyForm, currency_symbol: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Company Description</label>
            <textarea
              rows={2}
              value={companyForm.description}
              onChange={(e) => setCompanyForm({ ...companyForm, description: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div className="pt-4 border-t border-slate-200">
            <h4 className="text-sm font-semibold text-slate-900 mb-3">A4 Document &amp; Signature Settings</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Quotation Header Title</label>
                <input
                  type="text"
                  value={companyForm.quotation_header}
                  onChange={(e) => setCompanyForm({ ...companyForm, quotation_header: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Report Header Title</label>
                <input
                  type="text"
                  value={companyForm.report_header}
                  onChange={(e) => setCompanyForm({ ...companyForm, report_header: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Authorized Signatory Name</label>
                <input
                  type="text"
                  value={companyForm.signature_name}
                  onChange={(e) => setCompanyForm({ ...companyForm, signature_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Authorized Signatory Title</label>
                <input
                  type="text"
                  value={companyForm.signature_title}
                  onChange={(e) => setCompanyForm({ ...companyForm, signature_title: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Document Footer Text</label>
                <input
                  type="text"
                  value={companyForm.footer_text}
                  onChange={(e) => setCompanyForm({ ...companyForm, footer_text: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingCompany}
              className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
            >
              {savingCompany ? 'Saving Settings...' : 'Save Company Settings'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2B: CURRENCY & RATE CONVERTER */}
      {tab === 'currency' && companyForm && (
        <form onSubmit={handleSaveCompany} className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
            <div className="flex items-start gap-3 pb-4 border-b border-slate-200">
              <div className="p-2.5 rounded-md bg-slate-100 text-[#0F2342] shrink-0">
                <ArrowRightLeft className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Unified Currency &amp; Exchange Rate Converter (USD ↔ SH.)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Configure the Somaliland Shilling (SH.) exchange rate used automatically across Expenses, Purchases, Quotations, and Reports.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Base Accounting Currency</label>
                  <input
                    type="text"
                    readOnly
                    value="USD ($) — US Dollar (Used for all grand totals)"
                    className="w-full px-3 py-2 text-sm bg-slate-50 text-slate-700 border border-slate-200 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Exchange Rate (1 USD = ? Somaliland Shilling SH.) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={companyForm.exchange_rate ?? 8500}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, exchange_rate: Number(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-base font-mono font-bold text-[#0F2342] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                  <p className="text-xs text-slate-500 mt-1.5">
                    Conversion formula: <span className="font-mono font-semibold text-slate-700">USD = SH. ÷ Exchange Rate</span>
                  </p>
                </div>

                <div className="bg-amber-50/70 border border-amber-200 rounded-md p-3 text-xs text-amber-900">
                  Saving a new exchange rate automatically updates the converted USD values for all recorded Somaliland Shilling (SH.) transactions across Quotations, Expenses, Purchases, and Reports.
                </div>
              </div>

              {/* Interactive Rate Converter Test Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Rate Converter Preview</h4>
                  <p className="text-xs text-slate-500">Test SH. to USD conversion at the current rate.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Amount in Somaliland Shilling (SH.)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={converterShInput}
                    onChange={(e) => setConverterShInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0F2342]"
                  />
                </div>

                <div className="bg-white border border-slate-200 rounded-md p-4 space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Entered SH.</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatShilling(Number(converterShInput || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Exchange Rate</span>
                    <span className="font-mono text-slate-700 tabular-nums">
                      1 USD = {Number(companyForm.exchange_rate || 8500).toLocaleString('en-US')} SH.
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                    <span className="font-semibold text-[#0F2342]">Converted USD</span>
                    <span className="text-base font-mono font-bold text-[#0F2342] tabular-nums">
                      {formatUsd(
                        convertShToUsd(Number(converterShInput || 0), Number(companyForm.exchange_rate || 8500))
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="submit"
                disabled={savingCompany}
                className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
              >
                {savingCompany ? 'Saving Rate & Updating...' : 'Save Exchange Rate'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 3: BACKUP & RESTORE */}
      {tab === 'backup' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-md bg-slate-100 text-[#0F2342] shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Download Full Data Backup</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Save a complete snapshot of all Projects, Expenses, Purchases, Suppliers, Users, Settings, and Audit Logs.
                  </p>
                </div>
              </div>
              {backupSummary && (
                <div className="text-xs font-mono text-slate-600 whitespace-nowrap">
                  Database Size: <strong className="text-slate-900">{(backupSummary.sizeBytes / 1024).toFixed(1)} KB</strong>
                </div>
              )}
            </div>

            {backupSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Projects', value: backupSummary.counts.projects },
                  { label: 'Expenses', value: backupSummary.counts.expenses },
                  { label: 'Purchases', value: backupSummary.counts.purchases },
                  { label: 'Suppliers', value: backupSummary.counts.suppliers },
                  { label: 'Users', value: backupSummary.counts.users },
                  { label: 'Audit Logs', value: backupSummary.counts.audit_logs },
                ].map((item) => (
                  <div key={item.label} className="border border-slate-200 rounded-md p-3 bg-slate-50">
                    <span className="block text-xs text-slate-500">{item.label}</span>
                    <span className="mt-1 block text-lg font-bold font-mono tabular-nums text-[#0F2342]">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="border border-slate-200 rounded-md p-4 flex flex-col justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">JSON Full Archive (.json)</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Recommended for easy backup and one-click restore directly inside the system. Human-readable and portable.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={downloadingBackup !== null}
                  onClick={() => handleDownloadBackup('json')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadingBackup === 'json' ? 'Preparing JSON...' : 'Download JSON Backup'}</span>
                </button>
              </div>

              <div className="border border-slate-200 rounded-md p-4 flex flex-col justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">SQLite Database Snapshot (.db)</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Creates a consistent binary snapshot of the live SQLite database file for offline archival or server migration.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={downloadingBackup !== null}
                  onClick={() => handleDownloadBackup('sqlite')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadingBackup === 'sqlite' ? 'Creating Snapshot...' : 'Download SQLite (.db)'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-md bg-amber-50 text-amber-700 shrink-0">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Restore from JSON Backup</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Upload a previously exported <span className="font-mono">.json</span> backup file to restore your company data. Restoring replaces current records atomically.
                  </p>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer shrink-0 whitespace-nowrap">
                <Upload className="w-4 h-4" />
                <span>Select .json Backup File</span>
                <input type="file" accept=".json,application/json" onChange={handleSelectRestoreFile} className="hidden" />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT LOGS */}
      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">System Audit Trail</h3>
            <p className="text-xs text-slate-500">
              Immutable record of created, updated, imported, and deleted projects, expenses, purchases, and users.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{log.created_at}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 whitespace-nowrap">{log.user_name}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold whitespace-nowrap">
                      <span
                        className={
                          log.action === 'DELETE'
                            ? 'text-red-700'
                            : log.action === 'UPDATE'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{log.entity_type}</td>
                    <td className="py-2.5 px-4 text-slate-800">{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Create / Edit Modal */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingUser ? `Edit User — ${editingUser.full_name}` : 'Create Staff Account'}
              </h3>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={userForm.full_name}
                    onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Username *</label>
                  <input
                    type="text"
                    required
                    value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                {!editingUser && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Password *</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value as 'admin' | 'accountant' })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    <option value="accountant">Accountant / Expense Entry</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.is_active}
                      onChange={(e) => setUserForm({ ...userForm, is_active: e.target.checked })}
                      className="rounded border-slate-300 text-[#0F2342]"
                    />
                    <span>Account Active</span>
                  </label>
                </div>
              </div>

              {userForm.role === 'accountant' && (
                <div className="border-t border-slate-200 pt-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-2">Permitted System Modules</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {PERMISSION_LABELS.filter((p) => p.key !== 'settings').map((perm) => (
                        <label key={perm.key} className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(userForm.permissions[perm.key])}
                            onChange={(e) =>
                              setUserForm({
                                ...userForm,
                                permissions: { ...userForm.permissions, [perm.key]: e.target.checked },
                              })
                            }
                            className="rounded border-slate-300 text-[#0F2342]"
                          />
                          <span>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-2">Allowed Projects Scope</p>
                    <div className="flex items-center gap-4 mb-2 text-xs">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={userForm.permissions.allowedProjectIds === 'all'}
                          onChange={() =>
                            setUserForm({
                              ...userForm,
                              permissions: { ...userForm.permissions, allowedProjectIds: 'all' },
                            })
                          }
                        />
                        <span>All Projects</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={userForm.permissions.allowedProjectIds !== 'all'}
                          onChange={() =>
                            setUserForm({
                              ...userForm,
                              permissions: {
                                ...userForm.permissions,
                                allowedProjectIds: projects.map((p) => p.id),
                              },
                            })
                          }
                        />
                        <span>Specific Projects Only</span>
                      </label>
                    </div>

                    {userForm.permissions.allowedProjectIds !== 'all' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto border border-slate-200 rounded-md p-3 bg-slate-50">
                        {projects.map((p) => (
                          <label key={p.id} className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={
                                Array.isArray(userForm.permissions.allowedProjectIds) &&
                                userForm.permissions.allowedProjectIds.includes(p.id)
                              }
                              onChange={() => toggleProjectScope(p.id)}
                            />
                            <span className="font-mono font-semibold text-[#0F2342]">{p.project_code}</span>
                            <span className="truncate">{p.project_name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0F2342] hover:bg-[#17335e] rounded-md disabled:opacity-50"
                >
                  {savingUser ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Change Password — {passwordTarget.full_name}
            </h3>
            <p className="text-xs text-slate-500 mb-4">Minimum 6 characters required.</p>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPasswordTarget(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0F2342] rounded-md disabled:opacity-50"
                >
                  {savingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete User ${deleteTarget?.full_name}?`}
        description="This permanently removes the user account. Past audit logs and transactions created by this user will remain intact."
        loading={deletingUser}
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingRestorePayload)}
        title="Restore Database from Backup?"
        description={
          pendingRestorePayload
            ? `Restoring "${pendingRestorePayload.filename}" will replace current records with ${pendingRestorePayload.counts.projects} project(s), ${pendingRestorePayload.counts.expenses} expense(s), ${pendingRestorePayload.counts.purchases} purchase(s), and ${pendingRestorePayload.counts.users} user(s). Download a current backup first if needed.`
            : ''
        }
        confirmLabel="Restore Backup"
        loading={restoringBackup}
        onConfirm={handleConfirmRestore}
        onCancel={() => setPendingRestorePayload(null)}
      />
    </div>
  );
}
