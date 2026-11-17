import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express, { type Response } from 'express';
import bcrypt from 'bcryptjs';
import { db, DEFAULT_ACCOUNTANT_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS, type UserPermissions } from './db.ts';
import {
  authenticate,
  isProjectAllowed,
  parsePermissions,
  recordAuditLog,
  requireAdmin,
  requirePermission,
  signToken,
  type AuthenticatedRequest,
} from './auth.ts';

export const apiRouter = express.Router();

const VALID_EXPENSE_TYPES = [
  'Material Purchases',
  'Labour Expenses',
  'Transportation Expenses',
  'Fuel Expenses',
  'Machinery & Equipment',
  'Subcontractor Expenses',
  'Site Expenses',
  'Maintenance & Repairs',
  'Electrical Materials',
  'Plumbing Materials',
  'Safety Equipment',
  'Tools & Equipment Purchases',
  'Professional Fees',
  'Office & Administrative Expenses',
  'Petty Cash Expenses',
  'Staff Salaries & Benefits',
  'Store & Inventory',
  'Legal & Government Fees',
  'Insurance Expenses',
  'Other Project Expenses',
];

function normalizeExpenseType(raw: unknown): string {
  const clean = String(raw ?? '').trim();
  if (!clean) return 'Other Project Expenses';
  const exact = VALID_EXPENSE_TYPES.find((t) => t.toLowerCase() === clean.toLowerCase());
  return exact ?? clean;
}

type TransactionCurrency = 'USD' | 'SH.';

function normalizeCurrency(raw: unknown): TransactionCurrency {
  const clean = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (clean === 'SH' || clean === 'SH.' || clean === 'SLSH' || clean === 'SOS' || clean === 'SHILLING' || clean === 'SOMALILANDSHILLING') {
    return 'SH.';
  }
  return 'USD';
}

function getExchangeRate(): number {
  const row = db.prepare('SELECT exchange_rate FROM company_settings WHERE id = 1').get() as
    | { exchange_rate?: number }
    | undefined;
  const rate = Number(row?.exchange_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 8500;
}

function convertEntryToUsd(enteredAmount: number, currency: TransactionCurrency, exchangeRate: number): number {
  if (currency === 'SH.') {
    const converted = Number((enteredAmount / exchangeRate).toFixed(2));
    if (enteredAmount > 0 && converted <= 0) {
      return Number(Math.max(0.0001, enteredAmount / exchangeRate).toFixed(4));
    }
    return converted;
  }
  return Number(enteredAmount.toFixed(2));
}

function decorateExpenseRow<T extends { currency?: string; original_amount?: number | null; amount: number }>(row: T) {
  const currency = normalizeCurrency(row.currency);
  const originalAmount = row.original_amount !== null && row.original_amount !== undefined ? Number(row.original_amount) : Number(row.amount);
  const usdAmount = Number(row.amount || 0);
  return {
    ...row,
    currency,
    original_amount: originalAmount,
    sh_amount: currency === 'SH.' ? originalAmount : null,
    usd_amount: usdAmount,
  };
}

function decoratePurchaseRow<T extends { currency?: string; original_unit_price?: number | null; original_total_amount?: number | null; unit_price: number; total_amount: number }>(row: T) {
  const currency = normalizeCurrency(row.currency);
  const originalUnitPrice = row.original_unit_price !== null && row.original_unit_price !== undefined ? Number(row.original_unit_price) : Number(row.unit_price);
  const originalTotalAmount = row.original_total_amount !== null && row.original_total_amount !== undefined ? Number(row.original_total_amount) : Number(row.total_amount);
  const usdAmount = Number(row.total_amount || 0);
  return {
    ...row,
    currency,
    original_unit_price: originalUnitPrice,
    original_total_amount: originalTotalAmount,
    sh_amount: currency === 'SH.' ? originalTotalAmount : null,
    usd_amount: usdAmount,
  };
}

interface ProjectRow {
  id: number;
  project_code: string;
  project_name: string;
  client_name: string;
  location: string;
  start_date: string;
  expected_completion_date: string;
  contract_amount: number;
  recorded_revenue: number | null;
  project_budget: number;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function buildProjectFinancials(project: ProjectRow) {
  const expRow = db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE project_id = ?')
    .get(project.id) as { total: number; count: number };

  const purRow = db
    .prepare('SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count FROM purchases WHERE project_id = ?')
    .get(project.id) as { total: number; count: number };

  const totalExpenses = Number(expRow.total || 0);
  const totalPurchases = Number(purRow.total || 0);
  const totalCost = totalExpenses + totalPurchases;
  const remainingBudget = Number(project.project_budget || 0) - totalCost;

  const contractAmount = Number(project.contract_amount || 0);
  const profitLoss = Number((contractAmount - totalCost).toFixed(2));

  return {
    ...project,
    total_expenses: totalExpenses,
    expense_count: expRow.count,
    total_purchases: totalPurchases,
    purchase_count: purRow.count,
    total_project_cost: totalCost,
    remaining_budget: remainingBudget,
    is_profit_calculable: true,
    profit_loss: profitLoss,
  };
}

function getAllowedProjectsClause(req: AuthenticatedRequest, column = 'id'): { clause: string; params: unknown[] } {
  const user = req.user!;
  if (user.role === 'admin' || user.permissions.allowedProjectIds === 'all') {
    return { clause: '1=1', params: [] };
  }
  const ids = user.permissions.allowedProjectIds;
  if (!ids || ids.length === 0) {
    return { clause: '1=0', params: [] };
  }
  return {
    clause: `${column} IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  };
}

function normalizeDateInput(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial date fallback
    const utcDays = Math.floor(raw - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    const numM = Number(month);
    const numD = Number(day);
    if (numM >= 1 && numM <= 12 && numD >= 1 && numD <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function computeImportHash(date: string, projectCode: string, amount: number, description: string, ref: string): string {
  const normalized = [
    date.trim(),
    projectCode.trim().toUpperCase(),
    amount.toFixed(2),
    description.trim().toLowerCase().replace(/\s+/g, ' '),
    ref.trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Health check
apiRouter.get('/health', (_req, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication
apiRouter.post('/auth/login', (req, res: Response) => {
  const { identifier, password } = req.body as { identifier?: string; password?: string };
  if (!identifier || !password) {
    res.status(400).json({ error: 'Email or username and password are required.' });
    return;
  }

  const cleanId = identifier.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(username) = ?')
    .get(cleanId, cleanId) as
    | {
        id: number;
        full_name: string;
        username: string;
        email: string;
        password_hash: string;
        role: 'admin' | 'accountant';
        permissions_json: string;
        is_active: number;
      }
    | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials. Check your email/username and password.' });
    return;
  }

  if (!row.is_active) {
    res.status(403).json({ error: 'This user account has been deactivated. Contact an administrator.' });
    return;
  }

  const token = signToken(row.id);
  const company = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();

  res.json({
    token,
    user: {
      id: row.id,
      full_name: row.full_name,
      username: row.username,
      email: row.email,
      role: row.role,
      permissions: parsePermissions(row.permissions_json, row.role),
      is_active: Boolean(row.is_active),
    },
    company,
  });
});

apiRouter.get('/auth/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const company = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
  res.json({ user: req.user, company });
});

// Dashboard
apiRouter.get('/dashboard', authenticate, requirePermission('dashboard'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'id');
  const projects = db
    .prepare(`SELECT * FROM projects WHERE ${clause} ORDER BY start_date DESC, id DESC`)
    .all(...params) as ProjectRow[];

  const enriched = projects.map(buildProjectFinancials);

  const totalProjects = enriched.length;
  const totalExpenses = enriched.reduce((sum, p) => sum + p.total_expenses, 0);
  const totalPurchases = enriched.reduce((sum, p) => sum + p.total_purchases, 0);
  const totalQuotations = enriched.length; // Each project has a live linked quotation document
  const totalBudget = enriched.reduce((sum, p) => sum + Number(p.project_budget || 0), 0);
  const totalProjectCost = totalExpenses + totalPurchases;
  const remainingBalance = totalBudget - totalProjectCost;

  const totalContractAmount = enriched.reduce((sum, p) => sum + Number(p.contract_amount || 0), 0);
  const totalProfit = Number((totalContractAmount - totalProjectCost).toFixed(2));

  // Monthly financial trend from real expenses & purchases
  const allowedIds = enriched.map((p) => p.id);
  let monthlyTrend: Array<{ month: string; expenses: number; purchases: number; total: number }> = [];
  let recentTransactions: Array<{
    id: string;
    date: string;
    type: 'Expense' | 'Purchase';
    project_code: string;
    project_name: string;
    description: string;
    amount: number;
  }> = [];

  if (allowedIds.length > 0) {
    const placeholders = allowedIds.map(() => '?').join(',');
    const expMonthly = db
      .prepare(
        `SELECT substr(expense_date, 1, 7) as month, SUM(amount) as total
         FROM expenses WHERE project_id IN (${placeholders})
         GROUP BY substr(expense_date, 1, 7)`
      )
      .all(...allowedIds) as Array<{ month: string; total: number }>;

    const purMonthly = db
      .prepare(
        `SELECT substr(purchase_date, 1, 7) as month, SUM(total_amount) as total
         FROM purchases WHERE project_id IN (${placeholders})
         GROUP BY substr(purchase_date, 1, 7)`
      )
      .all(...allowedIds) as Array<{ month: string; total: number }>;

    const monthMap = new Map<string, { expenses: number; purchases: number }>();
    for (const row of expMonthly) {
      const curr = monthMap.get(row.month) || { expenses: 0, purchases: 0 };
      curr.expenses += Number(row.total || 0);
      monthMap.set(row.month, curr);
    }
    for (const row of purMonthly) {
      const curr = monthMap.get(row.month) || { expenses: 0, purchases: 0 };
      curr.purchases += Number(row.total || 0);
      monthMap.set(row.month, curr);
    }

    monthlyTrend = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, vals]) => ({
        month,
        expenses: vals.expenses,
        purchases: vals.purchases,
        total: vals.expenses + vals.purchases,
      }));

    const recentExp = db
      .prepare(
        `SELECT 'exp-' || e.id as id, e.expense_date as date, 'Expense' as type,
                p.project_code, p.project_name, e.description, e.amount
         FROM expenses e
         JOIN projects p ON p.id = e.project_id
         WHERE e.project_id IN (${placeholders})
         ORDER BY e.expense_date DESC, e.id DESC LIMIT 8`
      )
      .all(...allowedIds) as typeof recentTransactions;

    const recentPur = db
      .prepare(
        `SELECT 'pur-' || pu.id as id, pu.purchase_date as date, 'Purchase' as type,
                p.project_code, p.project_name,
                pu.item_description || ' (' || s.name || ')' as description,
                pu.total_amount as amount
         FROM purchases pu
         JOIN projects p ON p.id = pu.project_id
         JOIN suppliers s ON s.id = pu.supplier_id
         WHERE pu.project_id IN (${placeholders})
         ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT 8`
      )
      .all(...allowedIds) as typeof recentTransactions;

    recentTransactions = [...recentExp, ...recentPur]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
  }

  const canViewPurchases = req.user!.role === 'admin' || req.user!.permissions.purchases;
  const canViewQuotations = req.user!.role === 'admin' || req.user!.permissions.quotations;

  res.json({
    summary: {
      totalProjects,
      totalExpenses,
      totalPurchases: canViewPurchases ? totalPurchases : null,
      totalQuotations: canViewQuotations ? totalQuotations : null,
      totalBudget,
      totalProjectCost,
      remainingBalance,
      totalProfit,
      calculableProfitCount: enriched.length,
      pendingRevenueCount: 0,
    },
    projectsBreakdown: enriched.map((p) => ({
      id: p.id,
      project_code: p.project_code,
      project_name: p.project_name,
      budget: p.project_budget,
      expenses: p.total_expenses,
      purchases: p.total_purchases,
      total_cost: p.total_project_cost,
      remaining_budget: p.remaining_budget,
      status: p.status,
    })),
    monthlyTrend,
    recentTransactions,
  });
});

// Projects CRUD
apiRouter.get('/projects', authenticate, requirePermission('projects'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'id');
  const search = String(req.query.search || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();

  let rows = db
    .prepare(`SELECT * FROM projects WHERE ${clause} ORDER BY created_at DESC, id DESC`)
    .all(...params) as ProjectRow[];

  if (search) {
    rows = rows.filter(
      (p) =>
        p.project_code.toLowerCase().includes(search) ||
        p.project_name.toLowerCase().includes(search) ||
        p.client_name.toLowerCase().includes(search) ||
        p.location.toLowerCase().includes(search)
    );
  }
  if (status && status !== 'All') {
    rows = rows.filter((p) => p.status === status);
  }

  res.json(rows.map(buildProjectFinancials));
});

apiRouter.get('/projects/:id', authenticate, requirePermission('projects'), (req: AuthenticatedRequest, res: Response) => {
  const projectId = Number(req.params.id);
  if (!Number.isFinite(projectId)) {
    res.status(400).json({ error: 'Invalid project ID.' });
    return;
  }
  if (!isProjectAllowed(req.user!, projectId)) {
    res.status(403).json({ error: 'Access denied for this project.' });
    return;
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const expenses = db
    .prepare(
      `SELECT e.*, u.full_name as created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.project_id = ?
       ORDER BY e.expense_date DESC, e.id DESC`
    )
    .all(projectId) as Array<{ currency?: string; original_amount?: number | null; amount: number }>;

  const purchases = db
    .prepare(
      `SELECT pu.*, s.name as supplier_name, u.full_name as created_by_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       LEFT JOIN users u ON u.id = pu.created_by
       WHERE pu.project_id = ?
       ORDER BY pu.purchase_date DESC, pu.id DESC`
    )
    .all(projectId) as Array<{
    currency?: string;
    original_unit_price?: number | null;
    original_total_amount?: number | null;
    unit_price: number;
    total_amount: number;
  }>;

  res.json({
    project: buildProjectFinancials(project),
    expenses: expenses.map(decorateExpenseRow),
    purchases: purchases.map(decoratePurchaseRow),
  });
});

apiRouter.post('/projects', authenticate, requirePermission('projects'), (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Only administrators can create new projects.' });
    return;
  }
  const {
    project_code,
    project_name,
    client_name,
    location,
    start_date,
    expected_completion_date,
    contract_amount,
    recorded_revenue,
    project_budget,
    description,
    status,
  } = req.body as Partial<ProjectRow>;

  if (!project_code?.trim() || !project_name?.trim() || !client_name?.trim() || !location?.trim() || !start_date || !expected_completion_date) {
    res.status(400).json({ error: 'Project Code, Name, Client, Location, Start Date, and Expected Completion Date are required.' });
    return;
  }

  const cleanCode = project_code.trim().toUpperCase();
  const existing = db.prepare('SELECT id FROM projects WHERE upper(project_code) = ?').get(cleanCode);
  if (existing) {
    res.status(409).json({ error: `Project Code "${cleanCode}" already exists. Each project must have a unique code.` });
    return;
  }

  const parsedRevenue =
    recorded_revenue === null || recorded_revenue === undefined || String(recorded_revenue) === ''
      ? null
      : Number(recorded_revenue);

  const result = db
    .prepare(
      `INSERT INTO projects (
        project_code, project_name, client_name, location, start_date, expected_completion_date,
        contract_amount, recorded_revenue, project_budget, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanCode,
      project_name.trim(),
      client_name.trim(),
      location.trim(),
      start_date,
      expected_completion_date,
      Number(contract_amount || 0),
      parsedRevenue,
      Number(project_budget || 0),
      (description || '').trim(),
      status || 'Active'
    );

  const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(result.lastInsertRowid)) as ProjectRow;
  recordAuditLog({
    user: req.user,
    action: 'CREATE',
    entityType: 'project',
    entityId: created.id,
    summary: `Created project ${created.project_code} — ${created.project_name}`,
    details: created,
  });

  res.status(201).json(buildProjectFinancials(created));
});

apiRouter.put('/projects/:id', authenticate, requirePermission('projects'), (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Only administrators can edit projects.' });
    return;
  }
  const projectId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const body = req.body as Partial<ProjectRow>;
  const cleanCode = (body.project_code ?? existing.project_code).trim().toUpperCase();
  const duplicate = db.prepare('SELECT id FROM projects WHERE upper(project_code) = ? AND id != ?').get(cleanCode, projectId);
  if (duplicate) {
    res.status(409).json({ error: `Project Code "${cleanCode}" is already assigned to another project.` });
    return;
  }

  const parsedRevenue =
    body.recorded_revenue === null || body.recorded_revenue === undefined || String(body.recorded_revenue) === ''
      ? null
      : Number(body.recorded_revenue);

  db.prepare(
    `UPDATE projects SET
      project_code = ?, project_name = ?, client_name = ?, location = ?,
      start_date = ?, expected_completion_date = ?, contract_amount = ?,
      recorded_revenue = ?, project_budget = ?, description = ?, status = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    cleanCode,
    (body.project_name ?? existing.project_name).trim(),
    (body.client_name ?? existing.client_name).trim(),
    (body.location ?? existing.location).trim(),
    body.start_date ?? existing.start_date,
    body.expected_completion_date ?? existing.expected_completion_date,
    Number(body.contract_amount ?? existing.contract_amount),
    parsedRevenue,
    Number(body.project_budget ?? existing.project_budget),
    (body.description ?? existing.description).trim(),
    body.status ?? existing.status,
    projectId
  );

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow;
  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'project',
    entityId: projectId,
    summary: `Updated project ${updated.project_code} — ${updated.project_name}`,
    details: { before: existing, after: updated },
  });

  res.json(buildProjectFinancials(updated));
});

apiRouter.delete('/projects/:id', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const projectId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const expCount = (db.prepare('SELECT COUNT(*) as c FROM expenses WHERE project_id = ?').get(projectId) as { c: number }).c;
  const purCount = (db.prepare('SELECT COUNT(*) as c FROM purchases WHERE project_id = ?').get(projectId) as { c: number }).c;

  if (expCount > 0 || purCount > 0) {
    res.status(409).json({
      error: `Cannot delete ${existing.project_code} while it has ${expCount} expenses and ${purCount} purchases linked. Remove or reassign transactions first.`,
    });
    return;
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  recordAuditLog({
    user: req.user,
    action: 'DELETE',
    entityType: 'project',
    entityId: projectId,
    summary: `Deleted project ${existing.project_code} — ${existing.project_name}`,
    details: existing,
  });

  res.json({ success: true });
});

// Expenses CRUD & Excel Import
apiRouter.get('/expenses', authenticate, requirePermission('expenses'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'e.project_id');
  const conditions = [clause];
  const queryParams: unknown[] = [...params];

  if (req.query.projectId && req.query.projectId !== 'all') {
    const pid = Number(req.query.projectId);
    if (!isProjectAllowed(req.user!, pid)) {
      res.status(403).json({ error: 'Access denied for selected project.' });
      return;
    }
    conditions.push('e.project_id = ?');
    queryParams.push(pid);
  }

  if (req.query.from) {
    conditions.push('e.expense_date >= ?');
    queryParams.push(String(req.query.from));
  }
  if (req.query.to) {
    conditions.push('e.expense_date <= ?');
    queryParams.push(String(req.query.to));
  }
  if (req.query.paymentMethod && req.query.paymentMethod !== 'All') {
    conditions.push('e.payment_method = ?');
    queryParams.push(String(req.query.paymentMethod));
  }
  if (req.query.expenseType && req.query.expenseType !== 'All') {
    conditions.push('e.expense_type = ?');
    queryParams.push(String(req.query.expenseType));
  }
  if (req.query.currency && req.query.currency !== 'All') {
    conditions.push('e.currency = ?');
    queryParams.push(normalizeCurrency(req.query.currency));
  }
  if (req.query.search) {
    const term = `%${String(req.query.search).trim().toLowerCase()}%`;
    conditions.push(
      '(lower(e.description) LIKE ? OR lower(e.expense_type) LIKE ? OR lower(e.reference_number) LIKE ? OR lower(p.project_code) LIKE ? OR lower(p.project_name) LIKE ?)'
    );
    queryParams.push(term, term, term, term, term);
  }

  const rows = db
    .prepare(
      `SELECT e.*, p.project_code, p.project_name, u.full_name as created_by_name
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.expense_date DESC, e.id DESC`
    )
    .all(...queryParams) as Array<{ currency?: string; original_amount?: number | null; amount: number }>;

  res.json(rows.map(decorateExpenseRow));
});

apiRouter.post('/expenses', authenticate, requirePermission('expenses'), (req: AuthenticatedRequest, res: Response) => {
  const { expense_date, expense_type, description, project_id, currency, amount, payment_method, reference_number, notes } = req.body as {
    expense_date?: string;
    expense_type?: string;
    description?: string;
    project_id?: number;
    currency?: string;
    amount?: number;
    payment_method?: string;
    reference_number?: string;
    notes?: string;
  };

  const pid = Number(project_id);
  const enteredAmount = Number(amount);
  const cleanDate = normalizeDateInput(expense_date);
  const cleanType = normalizeExpenseType(expense_type);
  const cleanCurrency = normalizeCurrency(currency);
  const exchangeRate = getExchangeRate();

  if (!cleanDate || !description?.trim() || !Number.isFinite(pid) || !Number.isFinite(enteredAmount) || enteredAmount <= 0 || !payment_method?.trim()) {
    res.status(400).json({ error: 'Date, expense type, description, valid project, positive amount, and payment method are required.' });
    return;
  }

  if (!isProjectAllowed(req.user!, pid)) {
    res.status(403).json({ error: 'You are not authorized to record expenses for this project.' });
    return;
  }

  const project = db.prepare('SELECT id, project_code, project_name FROM projects WHERE id = ?').get(pid) as
    | { id: number; project_code: string; project_name: string }
    | undefined;
  if (!project) {
    res.status(404).json({ error: 'Selected project does not exist.' });
    return;
  }

  const usdAmount = convertEntryToUsd(enteredAmount, cleanCurrency, exchangeRate);

  const result = db
    .prepare(
      `INSERT INTO expenses (expense_date, expense_type, description, project_id, currency, original_amount, amount, payment_method, reference_number, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanDate,
      cleanType,
      description.trim(),
      pid,
      cleanCurrency,
      enteredAmount,
      usdAmount,
      payment_method.trim(),
      (reference_number || '').trim(),
      (notes || '').trim(),
      req.user!.id
    );

  const created = db
    .prepare(
      `SELECT e.*, p.project_code, p.project_name, u.full_name as created_by_name
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = ?`
    )
    .get(Number(result.lastInsertRowid)) as { currency?: string; original_amount?: number | null; amount: number };

  const decorated = decorateExpenseRow(created);

  recordAuditLog({
    user: req.user,
    action: 'CREATE',
    entityType: 'expense',
    entityId: Number(result.lastInsertRowid),
    summary: `Recorded ${cleanType} expense ${cleanCurrency === 'SH.' ? `SH. ${enteredAmount.toLocaleString('en-US')} ($${usdAmount.toFixed(2)})` : `$${usdAmount.toFixed(2)}`} for ${project.project_code}: ${description.trim()}`,
    details: decorated,
  });

  res.status(201).json(decorated);
});

apiRouter.put('/expenses/:id', authenticate, requirePermission('expenses'), (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as
    | {
        id: number;
        expense_date: string;
        expense_type: string;
        description: string;
        project_id: number;
        currency: string;
        original_amount: number | null;
        amount: number;
        payment_method: string;
        reference_number: string;
        notes: string;
      }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Expense record not found.' });
    return;
  }

  if (!isProjectAllowed(req.user!, existing.project_id)) {
    res.status(403).json({ error: 'Access denied for this expense.' });
    return;
  }

  const body = req.body as Partial<typeof existing>;
  const pid = Number(body.project_id ?? existing.project_id);
  const cleanCurrency = normalizeCurrency(body.currency ?? existing.currency);
  const enteredAmount = Number(body.amount ?? existing.original_amount ?? existing.amount);
  const cleanDate = normalizeDateInput(body.expense_date ?? existing.expense_date);
  const cleanType = normalizeExpenseType(body.expense_type ?? existing.expense_type);
  const exchangeRate = getExchangeRate();

  if (!cleanDate || !(body.description ?? existing.description).trim() || !Number.isFinite(enteredAmount) || enteredAmount <= 0) {
    res.status(400).json({ error: 'Valid date, description, and positive amount are required.' });
    return;
  }
  if (!isProjectAllowed(req.user!, pid)) {
    res.status(403).json({ error: 'Target project is not permitted for your account.' });
    return;
  }

  const usdAmount = convertEntryToUsd(enteredAmount, cleanCurrency, exchangeRate);

  db.prepare(
    `UPDATE expenses SET
      expense_date = ?, expense_type = ?, description = ?, project_id = ?, currency = ?, original_amount = ?, amount = ?,
      payment_method = ?, reference_number = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    cleanDate,
    cleanType,
    (body.description ?? existing.description).trim(),
    pid,
    cleanCurrency,
    enteredAmount,
    usdAmount,
    (body.payment_method ?? existing.payment_method).trim(),
    (body.reference_number ?? existing.reference_number).trim(),
    (body.notes ?? existing.notes).trim(),
    id
  );

  const updated = db
    .prepare(
      `SELECT e.*, p.project_code, p.project_name, u.full_name as created_by_name
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = ?`
    )
    .get(id) as { currency?: string; original_amount?: number | null; amount: number };

  const decorated = decorateExpenseRow(updated);

  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'expense',
    entityId: id,
    summary: `Updated expense #${id} ($${existing.amount.toFixed(2)} -> $${usdAmount.toFixed(2)})`,
    details: { before: existing, after: decorated },
  });

  res.json(decorated);
});

apiRouter.delete('/expenses/:id', authenticate, requirePermission('expenses'), (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare(
      `SELECT e.*, p.project_code, p.project_name
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       WHERE e.id = ?`
    )
    .get(id) as
    | { id: number; project_id: number; project_code: string; description: string; amount: number; expense_date: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Expense record not found.' });
    return;
  }
  if (!isProjectAllowed(req.user!, existing.project_id)) {
    res.status(403).json({ error: 'Access denied for this expense.' });
    return;
  }

  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  recordAuditLog({
    user: req.user,
    action: 'DELETE',
    entityType: 'expense',
    entityId: id,
    summary: `Deleted expense $${existing.amount.toFixed(2)} on ${existing.project_code} (${existing.description})`,
    details: existing,
  });

  res.json({ success: true });
});

// Excel Import Validate & Commit
interface RawImportRow {
  rowIndex: number;
  expense_date?: unknown;
  expense_type?: unknown;
  description?: unknown;
  project_code?: unknown;
  currency?: unknown;
  amount?: unknown;
  payment_method?: unknown;
  reference_number?: unknown;
  notes?: unknown;
}

apiRouter.post('/expenses/import/validate', authenticate, requirePermission('expenses'), (req: AuthenticatedRequest, res: Response) => {
  const { rows } = req.body as { rows?: RawImportRow[] };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'No rows found in uploaded spreadsheet.' });
    return;
  }

  const exchangeRate = getExchangeRate();
  const allProjects = db.prepare('SELECT id, project_code, project_name FROM projects').all() as Array<{
    id: number;
    project_code: string;
    project_name: string;
  }>;
  const projectByCode = new Map(allProjects.map((p) => [p.project_code.toUpperCase(), p]));

  const existingHashes = new Set(
    (db.prepare('SELECT import_hash FROM expenses WHERE import_hash IS NOT NULL').all() as Array<{ import_hash: string }>).map(
      (r) => r.import_hash
    )
  );
  const existingNaturalKeys = new Set(
    (
      db
        .prepare('SELECT expense_date, project_id, COALESCE(original_amount, amount) as orig_amt, currency, lower(trim(description)) as desc FROM expenses')
        .all() as Array<{ expense_date: string; project_id: number; orig_amt: number; currency: string; desc: string }>
    ).map((r) => `${r.expense_date}|${r.project_id}|${normalizeCurrency(r.currency)}|${Number(r.orig_amt).toFixed(2)}|${r.desc}`)
  );

  const seenInBatch = new Set<string>();

  const validated = rows.map((row, idx) => {
    const errors: string[] = [];
    const cleanDate = normalizeDateInput(row.expense_date);
    if (!cleanDate) errors.push('Invalid or missing Date');

    const expenseType = normalizeExpenseType(row.expense_type);
    const currency = normalizeCurrency(row.currency);

    const desc = String(row.description ?? '').trim();
    if (!desc) errors.push('Missing Description');

    const rawCode = String(row.project_code ?? '').trim().toUpperCase();
    const project = projectByCode.get(rawCode);
    if (!rawCode) {
      errors.push('Missing Project Code');
    } else if (!project) {
      errors.push(`Project Code "${rawCode}" does not exist`);
    } else if (!isProjectAllowed(req.user!, project.id)) {
      errors.push(`No access to project "${rawCode}"`);
    }

    const numAmount = Number(String(row.amount ?? '').replace(/[$,\s]/g, ''));
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      errors.push('Amount must be greater than 0');
    }

    const usdAmount = Number.isFinite(numAmount) && numAmount > 0 ? convertEntryToUsd(numAmount, currency, exchangeRate) : 0;
    const shAmount = currency === 'SH.' && Number.isFinite(numAmount) && numAmount > 0 ? numAmount : null;

    const paymentMethod = String(row.payment_method ?? 'Cash').trim() || 'Cash';
    const refNumber = String(row.reference_number ?? '').trim();
    const notes = String(row.notes ?? '').trim();

    let status: 'valid' | 'duplicate' | 'invalid' = errors.length > 0 ? 'invalid' : 'valid';
    let importHash = '';

    if (status === 'valid' && cleanDate && project) {
      importHash = computeImportHash(cleanDate, project.project_code, numAmount, `${currency}|${desc}`, refNumber);
      const naturalKey = `${cleanDate}|${project.id}|${currency}|${numAmount.toFixed(2)}|${desc.toLowerCase().replace(/\s+/g, ' ')}`;
      if (existingHashes.has(importHash) || existingNaturalKeys.has(naturalKey) || seenInBatch.has(importHash) || seenInBatch.has(naturalKey)) {
        status = 'duplicate';
        errors.push('Duplicate expense already exists in database or file');
      } else {
        seenInBatch.add(importHash);
        seenInBatch.add(naturalKey);
      }
    }

    return {
      rowNumber: row.rowIndex ?? idx + 1,
      expense_date: cleanDate ?? String(row.expense_date ?? ''),
      expense_type: expenseType,
      description: desc,
      project_code: rawCode,
      project_id: project?.id ?? null,
      project_name: project?.project_name ?? '',
      currency,
      original_amount: Number.isFinite(numAmount) ? numAmount : 0,
      sh_amount: shAmount,
      usd_amount: usdAmount,
      amount: usdAmount,
      payment_method: paymentMethod,
      reference_number: refNumber,
      notes,
      import_hash: importHash,
      status,
      errors,
    };
  });

  res.json({
    exchangeRate,
    summary: {
      total: validated.length,
      valid: validated.filter((r) => r.status === 'valid').length,
      duplicate: validated.filter((r) => r.status === 'duplicate').length,
      invalid: validated.filter((r) => r.status === 'invalid').length,
    },
    rows: validated,
  });
});

apiRouter.post('/expenses/import/commit', authenticate, requirePermission('expenses'), (req: AuthenticatedRequest, res: Response) => {
  const { rows } = req.body as {
    rows?: Array<{
      expense_date: string;
      expense_type?: string;
      description: string;
      project_id: number;
      project_code: string;
      currency?: string;
      original_amount?: number;
      amount: number;
      payment_method: string;
      reference_number: string;
      notes: string;
      import_hash: string;
    }>;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'No validated rows provided for import.' });
    return;
  }

  const exchangeRate = getExchangeRate();

  const insertStmt = db.prepare(
    `INSERT INTO expenses (
      expense_date, expense_type, description, project_id, currency, original_amount, amount, payment_method, reference_number, notes, import_hash, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let importedCount = 0;
  let skippedCount = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      if (!row.project_id || !isProjectAllowed(req.user!, Number(row.project_id))) {
        skippedCount++;
        continue;
      }
      const cleanDate = normalizeDateInput(row.expense_date);
      const cleanCurrency = normalizeCurrency(row.currency);
      const enteredAmount = Number(row.original_amount ?? row.amount);
      if (!cleanDate || !row.description?.trim() || !Number.isFinite(enteredAmount) || enteredAmount <= 0) {
        skippedCount++;
        continue;
      }

      const usdAmount = convertEntryToUsd(enteredAmount, cleanCurrency, exchangeRate);

      const hash =
        row.import_hash ||
        computeImportHash(cleanDate, row.project_code || '', enteredAmount, `${cleanCurrency}|${row.description}`, row.reference_number || '');

      const duplicate = db.prepare('SELECT id FROM expenses WHERE import_hash = ?').get(hash);
      if (duplicate) {
        skippedCount++;
        continue;
      }

      insertStmt.run(
        cleanDate,
        normalizeExpenseType(row.expense_type),
        row.description.trim(),
        Number(row.project_id),
        cleanCurrency,
        enteredAmount,
        usdAmount,
        (row.payment_method || 'Cash').trim(),
        (row.reference_number || '').trim(),
        (row.notes || '').trim(),
        hash,
        req.user!.id
      );
      importedCount++;
    }
  });

  tx();

  recordAuditLog({
    user: req.user,
    action: 'IMPORT',
    entityType: 'expense',
    entityId: null,
    summary: `Imported ${importedCount} expenses from Excel/CSV (${skippedCount} skipped)`,
    details: { importedCount, skippedCount },
  });

  res.json({ importedCount, skippedCount });
});

// Suppliers CRUD
apiRouter.get('/suppliers', authenticate, requirePermission('purchases'), (_req: AuthenticatedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT s.*,
        COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id), 0) as purchase_count,
        COALESCE((SELECT SUM(p.total_amount) FROM purchases p WHERE p.supplier_id = s.id), 0) as total_purchased
       FROM suppliers s
       ORDER BY s.name ASC`
    )
    .all();
  res.json(rows);
});

apiRouter.post('/suppliers', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const { name, contact_person, phone, email, address, notes } = req.body as {
    name?: string;
    contact_person?: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Supplier name is required.' });
    return;
  }
  const existing = db.prepare('SELECT id FROM suppliers WHERE lower(name) = ?').get(name.trim().toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'A supplier with this name already exists.' });
    return;
  }

  const result = db
    .prepare('INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      name.trim(),
      (contact_person || '').trim(),
      (phone || '').trim(),
      (email || '').trim(),
      (address || '').trim(),
      (notes || '').trim()
    );

  const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(result.lastInsertRowid));
  recordAuditLog({
    user: req.user,
    action: 'CREATE',
    entityType: 'supplier',
    entityId: Number(result.lastInsertRowid),
    summary: `Registered supplier: ${name.trim()}`,
    details: created,
  });
  res.status(201).json(created);
});

apiRouter.put('/suppliers/:id', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as
    | { id: number; name: string; contact_person: string; phone: string; email: string; address: string; notes: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Supplier not found.' });
    return;
  }
  const body = req.body as Partial<typeof existing>;
  const cleanName = (body.name ?? existing.name).trim();
  if (!cleanName) {
    res.status(400).json({ error: 'Supplier name cannot be empty.' });
    return;
  }

  db.prepare('UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?').run(
    cleanName,
    (body.contact_person ?? existing.contact_person).trim(),
    (body.phone ?? existing.phone).trim(),
    (body.email ?? existing.email).trim(),
    (body.address ?? existing.address).trim(),
    (body.notes ?? existing.notes).trim(),
    id
  );

  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'supplier',
    entityId: id,
    summary: `Updated supplier: ${cleanName}`,
    details: { before: existing, after: updated },
  });
  res.json(updated);
});

apiRouter.delete('/suppliers/:id', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as { id: number; name: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Supplier not found.' });
    return;
  }
  const count = (db.prepare('SELECT COUNT(*) as c FROM purchases WHERE supplier_id = ?').get(id) as { c: number }).c;
  if (count > 0) {
    res.status(409).json({ error: `Cannot delete ${existing.name} because ${count} purchases are linked to it.` });
    return;
  }
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  recordAuditLog({
    user: req.user,
    action: 'DELETE',
    entityType: 'supplier',
    entityId: id,
    summary: `Deleted supplier: ${existing.name}`,
    details: existing,
  });
  res.json({ success: true });
});

// Purchases CRUD
apiRouter.get('/purchases', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'pu.project_id');
  const conditions = [clause];
  const queryParams: unknown[] = [...params];

  if (req.query.projectId && req.query.projectId !== 'all') {
    const pid = Number(req.query.projectId);
    if (!isProjectAllowed(req.user!, pid)) {
      res.status(403).json({ error: 'Access denied for selected project.' });
      return;
    }
    conditions.push('pu.project_id = ?');
    queryParams.push(pid);
  }
  if (req.query.supplierId && req.query.supplierId !== 'all') {
    conditions.push('pu.supplier_id = ?');
    queryParams.push(Number(req.query.supplierId));
  }
  if (req.query.from) {
    conditions.push('pu.purchase_date >= ?');
    queryParams.push(String(req.query.from));
  }
  if (req.query.to) {
    conditions.push('pu.purchase_date <= ?');
    queryParams.push(String(req.query.to));
  }
  if (req.query.paymentStatus && req.query.paymentStatus !== 'All') {
    conditions.push('pu.payment_status = ?');
    queryParams.push(String(req.query.paymentStatus));
  }
  if (req.query.currency && req.query.currency !== 'All') {
    conditions.push('pu.currency = ?');
    queryParams.push(normalizeCurrency(req.query.currency));
  }
  if (req.query.search) {
    const term = `%${String(req.query.search).trim().toLowerCase()}%`;
    conditions.push(
      '(lower(pu.item_description) LIKE ? OR lower(pu.invoice_number) LIKE ? OR lower(s.name) LIKE ? OR lower(p.project_code) LIKE ?)'
    );
    queryParams.push(term, term, term, term);
  }

  const rows = db
    .prepare(
      `SELECT pu.*, s.name as supplier_name, p.project_code, p.project_name, u.full_name as created_by_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN projects p ON p.id = pu.project_id
       LEFT JOIN users u ON u.id = pu.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY pu.purchase_date DESC, pu.id DESC`
    )
    .all(...queryParams) as Array<{
    currency?: string;
    original_unit_price?: number | null;
    original_total_amount?: number | null;
    unit_price: number;
    total_amount: number;
  }>;

  res.json(rows.map(decoratePurchaseRow));
});

apiRouter.post('/purchases', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const {
    purchase_date,
    supplier_id,
    project_id,
    item_description,
    quantity,
    unit_label,
    currency,
    unit_price,
    payment_status,
    payment_method,
    invoice_number,
    notes,
  } = req.body as {
    purchase_date?: string;
    supplier_id?: number;
    project_id?: number;
    item_description?: string;
    quantity?: number;
    unit_label?: string;
    currency?: string;
    unit_price?: number;
    payment_status?: 'Paid' | 'Pending' | 'Partial';
    payment_method?: string;
    invoice_number?: string;
    notes?: string;
  };

  const cleanDate = normalizeDateInput(purchase_date);
  const sid = Number(supplier_id);
  const pid = Number(project_id);
  const qty = Number(quantity);
  const enteredUnitPrice = Number(unit_price);
  const cleanCurrency = normalizeCurrency(currency);
  const exchangeRate = getExchangeRate();

  if (!cleanDate || !Number.isFinite(sid) || !Number.isFinite(pid) || !item_description?.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(enteredUnitPrice) || enteredUnitPrice < 0) {
    res.status(400).json({ error: 'Date, supplier, project, item description, positive quantity, and valid unit price are required.' });
    return;
  }
  if (!isProjectAllowed(req.user!, pid)) {
    res.status(403).json({ error: 'Not authorized to record purchases for this project.' });
    return;
  }

  const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(sid) as { id: number; name: string } | undefined;
  const project = db.prepare('SELECT id, project_code FROM projects WHERE id = ?').get(pid) as { id: number; project_code: string } | undefined;
  if (!supplier || !project) {
    res.status(404).json({ error: 'Valid supplier and project must be selected.' });
    return;
  }

  const originalTotalAmount = Number((qty * enteredUnitPrice).toFixed(2));
  const usdUnitPrice = cleanCurrency === 'SH.' ? Number((enteredUnitPrice / exchangeRate).toFixed(4)) : Number(enteredUnitPrice.toFixed(2));
  const usdTotalAmount = cleanCurrency === 'SH.' ? Number((originalTotalAmount / exchangeRate).toFixed(2)) : originalTotalAmount;

  const result = db
    .prepare(
      `INSERT INTO purchases (
        purchase_date, supplier_id, project_id, item_description, quantity, unit_label,
        currency, original_unit_price, original_total_amount, unit_price, total_amount,
        payment_status, payment_method, invoice_number, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanDate,
      sid,
      pid,
      item_description.trim(),
      qty,
      (unit_label || 'Units').trim(),
      cleanCurrency,
      enteredUnitPrice,
      originalTotalAmount,
      usdUnitPrice,
      usdTotalAmount,
      payment_status || 'Paid',
      (payment_method || 'Bank Transfer').trim(),
      (invoice_number || '').trim(),
      (notes || '').trim(),
      req.user!.id
    );

  const created = db
    .prepare(
      `SELECT pu.*, s.name as supplier_name, p.project_code, p.project_name, u.full_name as created_by_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN projects p ON p.id = pu.project_id
       LEFT JOIN users u ON u.id = pu.created_by
       WHERE pu.id = ?`
    )
    .get(Number(result.lastInsertRowid)) as {
    currency?: string;
    original_unit_price?: number | null;
    original_total_amount?: number | null;
    unit_price: number;
    total_amount: number;
  };

  const decorated = decoratePurchaseRow(created);

  recordAuditLog({
    user: req.user,
    action: 'CREATE',
    entityType: 'purchase',
    entityId: Number(result.lastInsertRowid),
    summary: `Recorded purchase $${usdTotalAmount.toFixed(2)} (${cleanCurrency}) from ${supplier.name} for ${project.project_code}: ${item_description.trim()}`,
    details: decorated,
  });

  res.status(201).json(decorated);
});

apiRouter.put('/purchases/:id', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as
    | {
        id: number;
        purchase_date: string;
        supplier_id: number;
        project_id: number;
        item_description: string;
        quantity: number;
        unit_label: string;
        currency: string;
        original_unit_price: number | null;
        original_total_amount: number | null;
        unit_price: number;
        total_amount: number;
        payment_status: string;
        payment_method: string;
        invoice_number: string;
        notes: string;
      }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Purchase record not found.' });
    return;
  }
  if (!isProjectAllowed(req.user!, existing.project_id)) {
    res.status(403).json({ error: 'Access denied for this purchase.' });
    return;
  }

  const body = req.body as Partial<typeof existing>;
  const cleanDate = normalizeDateInput(body.purchase_date ?? existing.purchase_date);
  const sid = Number(body.supplier_id ?? existing.supplier_id);
  const pid = Number(body.project_id ?? existing.project_id);
  const qty = Number(body.quantity ?? existing.quantity);
  const cleanCurrency = normalizeCurrency(body.currency ?? existing.currency);
  const enteredUnitPrice = Number(body.unit_price ?? existing.original_unit_price ?? existing.unit_price);
  const exchangeRate = getExchangeRate();

  if (!cleanDate || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(enteredUnitPrice) || enteredUnitPrice < 0) {
    res.status(400).json({ error: 'Valid date, positive quantity, and non-negative unit price are required.' });
    return;
  }
  if (!isProjectAllowed(req.user!, pid)) {
    res.status(403).json({ error: 'Target project is not permitted.' });
    return;
  }

  const originalTotalAmount = Number((qty * enteredUnitPrice).toFixed(2));
  const usdUnitPrice = cleanCurrency === 'SH.' ? Number((enteredUnitPrice / exchangeRate).toFixed(4)) : Number(enteredUnitPrice.toFixed(2));
  const usdTotalAmount = cleanCurrency === 'SH.' ? Number((originalTotalAmount / exchangeRate).toFixed(2)) : originalTotalAmount;

  db.prepare(
    `UPDATE purchases SET
      purchase_date = ?, supplier_id = ?, project_id = ?, item_description = ?,
      quantity = ?, unit_label = ?, currency = ?, original_unit_price = ?, original_total_amount = ?,
      unit_price = ?, total_amount = ?, payment_status = ?, payment_method = ?, invoice_number = ?, notes = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    cleanDate,
    sid,
    pid,
    (body.item_description ?? existing.item_description).trim(),
    qty,
    (body.unit_label ?? existing.unit_label).trim(),
    cleanCurrency,
    enteredUnitPrice,
    originalTotalAmount,
    usdUnitPrice,
    usdTotalAmount,
    body.payment_status ?? existing.payment_status,
    (body.payment_method ?? existing.payment_method).trim(),
    (body.invoice_number ?? existing.invoice_number).trim(),
    (body.notes ?? existing.notes).trim(),
    id
  );

  const updated = db
    .prepare(
      `SELECT pu.*, s.name as supplier_name, p.project_code, p.project_name, u.full_name as created_by_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN projects p ON p.id = pu.project_id
       LEFT JOIN users u ON u.id = pu.created_by
       WHERE pu.id = ?`
    )
    .get(id) as {
    currency?: string;
    original_unit_price?: number | null;
    original_total_amount?: number | null;
    unit_price: number;
    total_amount: number;
  };

  const decorated = decoratePurchaseRow(updated);

  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'purchase',
    entityId: id,
    summary: `Updated purchase #${id} ($${existing.total_amount.toFixed(2)} -> $${usdTotalAmount.toFixed(2)})`,
    details: { before: existing, after: decorated },
  });

  res.json(decorated);
});

apiRouter.delete('/purchases/:id', authenticate, requirePermission('purchases'), (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare(
      `SELECT pu.*, s.name as supplier_name, p.project_code
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN projects p ON p.id = pu.project_id
       WHERE pu.id = ?`
    )
    .get(id) as
    | { id: number; project_id: number; project_code: string; supplier_name: string; item_description: string; total_amount: number }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Purchase record not found.' });
    return;
  }
  if (!isProjectAllowed(req.user!, existing.project_id)) {
    res.status(403).json({ error: 'Access denied for this purchase.' });
    return;
  }

  db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
  recordAuditLog({
    user: req.user,
    action: 'DELETE',
    entityType: 'purchase',
    entityId: id,
    summary: `Deleted purchase $${existing.total_amount.toFixed(2)} (${existing.item_description}) on ${existing.project_code}`,
    details: existing,
  });

  res.json({ success: true });
});

// Quotations (Live linked to Projects + Expenses + Purchases)
apiRouter.get('/quotations', authenticate, requirePermission('quotations'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'id');
  const search = String(req.query.search || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();

  let projects = db.prepare(`SELECT * FROM projects WHERE ${clause} ORDER BY project_code ASC`).all(...params) as ProjectRow[];
  if (search) {
    projects = projects.filter(
      (p) =>
        p.project_code.toLowerCase().includes(search) ||
        p.project_name.toLowerCase().includes(search) ||
        p.client_name.toLowerCase().includes(search)
    );
  }
  if (status && status !== 'All') {
    projects = projects.filter((p) => p.status === status);
  }

  res.json(projects.map(buildProjectFinancials));
});

apiRouter.get('/quotations/:projectId', authenticate, requirePermission('quotations'), (req: AuthenticatedRequest, res: Response) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) {
    res.status(400).json({ error: 'Invalid project ID.' });
    return;
  }
  if (!isProjectAllowed(req.user!, projectId)) {
    res.status(403).json({ error: 'Access denied for this project quotation.' });
    return;
  }

  const projectRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!projectRow) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const project = buildProjectFinancials(projectRow);
  const company = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
  const exchangeRate = getExchangeRate();

  const expensesRaw = db
    .prepare(
      `SELECT id, expense_date as date, description, currency, original_amount, amount, payment_method, reference_number, 'Expense' as source_type
       FROM expenses WHERE project_id = ?`
    )
    .all(projectId) as Array<{
    id: number;
    date: string;
    description: string;
    currency: string;
    original_amount: number | null;
    amount: number;
    payment_method: string;
    reference_number: string;
    source_type: 'Expense';
  }>;

  const expenses = expensesRaw.map((e) => {
    const currency = normalizeCurrency(e.currency);
    const orig = e.original_amount !== null && e.original_amount !== undefined ? Number(e.original_amount) : Number(e.amount);
    return {
      id: e.id,
      date: e.date,
      description: e.description,
      currency,
      sh_amount: currency === 'SH.' ? orig : null,
      usd_amount: Number(e.amount),
      amount: Number(e.amount),
      payment_method: e.payment_method,
      reference_number: e.reference_number,
      source_type: e.source_type,
    };
  });

  const purchasesRaw = db
    .prepare(
      `SELECT pu.id, pu.purchase_date as date,
              pu.item_description || ' (' || pu.quantity || ' ' || pu.unit_label || ' · ' || s.name || ')' as description,
              pu.currency, pu.original_total_amount, pu.total_amount as amount, pu.payment_method, pu.invoice_number as reference_number, 'Purchase' as source_type
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       WHERE pu.project_id = ?`
    )
    .all(projectId) as Array<{
    id: number;
    date: string;
    description: string;
    currency: string;
    original_total_amount: number | null;
    amount: number;
    payment_method: string;
    reference_number: string;
    source_type: 'Purchase';
  }>;

  const purchases = purchasesRaw.map((p) => {
    const currency = normalizeCurrency(p.currency);
    const orig = p.original_total_amount !== null && p.original_total_amount !== undefined ? Number(p.original_total_amount) : Number(p.amount);
    return {
      id: p.id,
      date: p.date,
      description: p.description,
      currency,
      sh_amount: currency === 'SH.' ? orig : null,
      usd_amount: Number(p.amount),
      amount: Number(p.amount),
      payment_method: p.payment_method,
      reference_number: p.reference_number,
      source_type: p.source_type,
    };
  });

  const items = [...expenses, ...purchases].sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    company,
    exchangeRate,
    project,
    documentDate: new Date().toISOString().slice(0, 10),
    preparedBy: req.user!.full_name,
    items,
  });
});

// Reports
apiRouter.get('/reports/project-financial', authenticate, requirePermission('reports'), (req: AuthenticatedRequest, res: Response) => {
  const projectId = Number(req.query.projectId);
  if (!Number.isFinite(projectId)) {
    res.status(400).json({ error: 'Please select a valid project.' });
    return;
  }
  if (!isProjectAllowed(req.user!, projectId)) {
    res.status(403).json({ error: 'Access denied for this project.' });
    return;
  }

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const exchangeRate = getExchangeRate();

  const expensesRaw = db
    .prepare(
      `SELECT id, expense_date as date, 'Expense' as category, description, payment_method, reference_number as reference, currency, original_amount, amount
       FROM expenses WHERE project_id = ?`
    )
    .all(projectId) as Array<{
    id: number;
    date: string;
    category: string;
    description: string;
    payment_method: string;
    reference: string;
    currency: string;
    original_amount: number | null;
    amount: number;
  }>;

  const expenses = expensesRaw.map((e) => {
    const currency = normalizeCurrency(e.currency);
    const orig = e.original_amount !== null && e.original_amount !== undefined ? Number(e.original_amount) : Number(e.amount);
    return {
      ...e,
      currency,
      sh_amount: currency === 'SH.' ? orig : null,
      usd_amount: Number(e.amount),
    };
  });

  const purchasesRaw = db
    .prepare(
      `SELECT pu.id, pu.purchase_date as date, 'Purchase' as category,
              pu.item_description || ' — ' || s.name || ' (' || pu.quantity || ' ' || pu.unit_label || ')' as description,
              pu.payment_method, pu.invoice_number as reference, pu.currency, pu.original_total_amount, pu.total_amount as amount
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       WHERE pu.project_id = ?`
    )
    .all(projectId) as Array<{
    id: number;
    date: string;
    category: string;
    description: string;
    payment_method: string;
    reference: string;
    currency: string;
    original_total_amount: number | null;
    amount: number;
  }>;

  const purchases = purchasesRaw.map((p) => {
    const currency = normalizeCurrency(p.currency);
    const orig = p.original_total_amount !== null && p.original_total_amount !== undefined ? Number(p.original_total_amount) : Number(p.amount);
    return {
      ...p,
      currency,
      sh_amount: currency === 'SH.' ? orig : null,
      usd_amount: Number(p.amount),
    };
  });

  const transactions = [...expenses, ...purchases].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  res.json({
    exchangeRate,
    project: buildProjectFinancials(row),
    transactions,
  });
});

apiRouter.get('/reports/daily-expenses', authenticate, requirePermission('reports'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'e.project_id');
  const conditions = [clause];
  const queryParams: unknown[] = [...params];

  if (req.query.from) {
    conditions.push('e.expense_date >= ?');
    queryParams.push(String(req.query.from));
  }
  if (req.query.to) {
    conditions.push('e.expense_date <= ?');
    queryParams.push(String(req.query.to));
  }
  if (req.query.projectId && req.query.projectId !== 'all') {
    const pid = Number(req.query.projectId);
    if (!isProjectAllowed(req.user!, pid)) {
      res.status(403).json({ error: 'Access denied for selected project.' });
      return;
    }
    conditions.push('e.project_id = ?');
    queryParams.push(pid);
  }

  const exchangeRate = getExchangeRate();
  const rowsRaw = db
    .prepare(
      `SELECT e.*, p.project_code, p.project_name
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.expense_date ASC, e.id ASC`
    )
    .all(...queryParams) as Array<{ currency?: string; original_amount?: number | null; amount: number }>;

  const rows = rowsRaw.map(decorateExpenseRow);
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.usd_amount || 0), 0);

  res.json({
    exchangeRate,
    rows,
    totalAmount,
    count: rows.length,
  });
});

apiRouter.get('/reports/supplier-purchases', authenticate, requirePermission('reports'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'pu.project_id');
  const conditions = [clause];
  const queryParams: unknown[] = [...params];

  if (req.query.from) {
    conditions.push('pu.purchase_date >= ?');
    queryParams.push(String(req.query.from));
  }
  if (req.query.to) {
    conditions.push('pu.purchase_date <= ?');
    queryParams.push(String(req.query.to));
  }
  if (req.query.projectId && req.query.projectId !== 'all') {
    const pid = Number(req.query.projectId);
    if (!isProjectAllowed(req.user!, pid)) {
      res.status(403).json({ error: 'Access denied for selected project.' });
      return;
    }
    conditions.push('pu.project_id = ?');
    queryParams.push(pid);
  }
  if (req.query.supplierId && req.query.supplierId !== 'all') {
    conditions.push('pu.supplier_id = ?');
    queryParams.push(Number(req.query.supplierId));
  }

  const exchangeRate = getExchangeRate();
  const rowsRaw = db
    .prepare(
      `SELECT pu.*, s.name as supplier_name, p.project_code, p.project_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN projects p ON p.id = pu.project_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY pu.purchase_date ASC, pu.id ASC`
    )
    .all(...queryParams) as Array<{
    currency?: string;
    original_unit_price?: number | null;
    original_total_amount?: number | null;
    unit_price: number;
    total_amount: number;
  }>;

  const rows = rowsRaw.map(decoratePurchaseRow);
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.usd_amount || 0), 0);

  res.json({
    exchangeRate,
    rows,
    totalAmount,
    count: rows.length,
  });
});

apiRouter.get('/reports/all-projects', authenticate, requirePermission('reports'), (req: AuthenticatedRequest, res: Response) => {
  const { clause, params } = getAllowedProjectsClause(req, 'id');
  const status = String(req.query.status || '').trim();
  const exchangeRate = getExchangeRate();
  let rows = db.prepare(`SELECT * FROM projects WHERE ${clause} ORDER BY project_code ASC`).all(...params) as ProjectRow[];
  if (status && status !== 'All') {
    rows = rows.filter((p) => p.status === status);
  }

  const projects = rows.map(buildProjectFinancials);
  const totals = {
    contractAmount: projects.reduce((s, p) => s + Number(p.contract_amount || 0), 0),
    projectBudget: projects.reduce((s, p) => s + Number(p.project_budget || 0), 0),
    totalExpenses: projects.reduce((s, p) => s + p.total_expenses, 0),
    totalPurchases: projects.reduce((s, p) => s + p.total_purchases, 0),
    totalCost: projects.reduce((s, p) => s + p.total_project_cost, 0),
    remainingBudget: projects.reduce((s, p) => s + p.remaining_budget, 0),
  };

  res.json({ exchangeRate, projects, totals });
});

// Audit Logs
apiRouter.get('/audit-logs', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit || 100), 300);
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

// Users & Permissions (Admin only)
apiRouter.get('/users', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT id, full_name, username, email, role, permissions_json, is_active, created_at FROM users ORDER BY id ASC')
    .all() as Array<{
    id: number;
    full_name: string;
    username: string;
    email: string;
    role: 'admin' | 'accountant';
    permissions_json: string;
    is_active: number;
    created_at: string;
  }>;

  res.json(
    rows.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      username: u.username,
      email: u.email,
      role: u.role,
      permissions: parsePermissions(u.permissions_json, u.role),
      is_active: Boolean(u.is_active),
      created_at: u.created_at,
    }))
  );
});

apiRouter.post('/users', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { full_name, username, email, password, role, permissions } = req.body as {
    full_name?: string;
    username?: string;
    email?: string;
    password?: string;
    role?: 'admin' | 'accountant';
    permissions?: UserPermissions;
  };

  if (!full_name?.trim() || !username?.trim() || !email?.trim() || !password || password.length < 6) {
    res.status(400).json({ error: 'Full name, username, email, and password (min 6 characters) are required.' });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUser = username.trim().toLowerCase();
  const duplicate = db
    .prepare('SELECT id FROM users WHERE lower(email) = ? OR lower(username) = ?')
    .get(cleanEmail, cleanUser);
  if (duplicate) {
    res.status(409).json({ error: 'Email or username already exists.' });
    return;
  }

  const assignedRole = role === 'admin' ? 'admin' : 'accountant';
  const resolvedPerms =
    assignedRole === 'admin'
      ? DEFAULT_ADMIN_PERMISSIONS
      : { ...DEFAULT_ACCOUNTANT_PERMISSIONS, ...(permissions || {}) };

  const hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare(
      `INSERT INTO users (full_name, username, email, password_hash, role, permissions_json, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(full_name.trim(), cleanUser, cleanEmail, hash, assignedRole, JSON.stringify(resolvedPerms));

  recordAuditLog({
    user: req.user,
    action: 'CREATE',
    entityType: 'user',
    entityId: Number(result.lastInsertRowid),
    summary: `Created ${assignedRole} user: ${full_name.trim()} (${cleanEmail})`,
    details: { username: cleanUser, email: cleanEmail, role: assignedRole },
  });

  res.status(201).json({
    id: Number(result.lastInsertRowid),
    full_name: full_name.trim(),
    username: cleanUser,
    email: cleanEmail,
    role: assignedRole,
    permissions: resolvedPerms,
    is_active: true,
  });
});

apiRouter.put('/users/:id', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | {
        id: number;
        full_name: string;
        username: string;
        email: string;
        role: 'admin' | 'accountant';
        permissions_json: string;
        is_active: number;
      }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const body = req.body as {
    full_name?: string;
    username?: string;
    email?: string;
    role?: 'admin' | 'accountant';
    permissions?: UserPermissions;
    is_active?: boolean;
  };

  if (id === req.user!.id && body.is_active === false) {
    res.status(400).json({ error: 'You cannot deactivate your own active admin account.' });
    return;
  }

  const nextRole = body.role === 'admin' ? 'admin' : body.role === 'accountant' ? 'accountant' : existing.role;
  const nextPerms =
    nextRole === 'admin'
      ? DEFAULT_ADMIN_PERMISSIONS
      : body.permissions ?? parsePermissions(existing.permissions_json, nextRole);

  const nextActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;

  db.prepare(
    `UPDATE users SET
      full_name = ?, username = ?, email = ?, role = ?, permissions_json = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    (body.full_name ?? existing.full_name).trim(),
    (body.username ?? existing.username).trim().toLowerCase(),
    (body.email ?? existing.email).trim().toLowerCase(),
    nextRole,
    JSON.stringify(nextPerms),
    nextActive,
    id
  );

  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'user',
    entityId: id,
    summary: `Updated user permissions/profile for ${(body.full_name ?? existing.full_name).trim()}`,
    details: { role: nextRole, is_active: Boolean(nextActive), permissions: nextPerms },
  });

  res.json({
    id,
    full_name: (body.full_name ?? existing.full_name).trim(),
    username: (body.username ?? existing.username).trim().toLowerCase(),
    email: (body.email ?? existing.email).trim().toLowerCase(),
    role: nextRole,
    permissions: nextPerms,
    is_active: Boolean(nextActive),
  });
});

apiRouter.patch('/users/:id/password', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { password } = req.body as { password?: string };
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }
  const existing = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(id) as { id: number; full_name: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, id);

  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'user',
    entityId: id,
    summary: `Changed password for user ${existing.full_name}`,
    details: {},
  });

  res.json({ success: true });
});

apiRouter.delete('/users/:id', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own active account.' });
    return;
  }
  const existing = db.prepare('SELECT id, full_name, email FROM users WHERE id = ?').get(id) as
    | { id: number; full_name: string; email: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  recordAuditLog({
    user: req.user,
    action: 'DELETE',
    entityType: 'user',
    entityId: id,
    summary: `Deleted user ${existing.full_name} (${existing.email})`,
    details: existing,
  });
  res.json({ success: true });
});

// Company Settings
apiRouter.get('/settings', authenticate, (_req: AuthenticatedRequest, res: Response) => {
  const company = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
  res.json(company);
});

apiRouter.put('/settings', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM company_settings WHERE id = 1').get() as Record<string, unknown>;
  const body = req.body as Record<string, unknown>;

  const nextRate = body.exchange_rate !== undefined ? Number(body.exchange_rate) : Number(existing.exchange_rate || 8500);
  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    res.status(400).json({ error: 'Exchange rate must be a positive number (e.g., 8500).' });
    return;
  }

  const updateSettingsTx = db.transaction(() => {
    db.prepare(
      `UPDATE company_settings SET
        company_name = ?, logo_url = ?, address = ?, phone = ?, email = ?,
        currency = ?, currency_symbol = ?, exchange_rate = ?, description = ?, report_header = ?,
        quotation_header = ?, footer_text = ?, signature_name = ?, signature_title = ?,
        updated_at = datetime('now')
       WHERE id = 1`
    ).run(
      String(body.company_name ?? existing.company_name).trim(),
      String(body.logo_url ?? existing.logo_url),
      String(body.address ?? existing.address).trim(),
      String(body.phone ?? existing.phone).trim(),
      String(body.email ?? existing.email).trim(),
      String(body.currency ?? existing.currency).trim() || 'USD',
      String(body.currency_symbol ?? existing.currency_symbol).trim() || '$',
      nextRate,
      String(body.description ?? existing.description).trim(),
      String(body.report_header ?? existing.report_header).trim(),
      String(body.quotation_header ?? existing.quotation_header).trim(),
      String(body.footer_text ?? existing.footer_text).trim(),
      String(body.signature_name ?? existing.signature_name).trim(),
      String(body.signature_title ?? existing.signature_title).trim()
    );

    // Recalculate USD amounts for all Somaliland Shilling (SH.) transactions using the unified exchange rate
    const shExpenses = db
      .prepare("SELECT id, COALESCE(original_amount, amount) as orig FROM expenses WHERE currency = 'SH.'")
      .all() as Array<{ id: number; orig: number }>;
    const updateExpStmt = db.prepare('UPDATE expenses SET amount = ? WHERE id = ?');
    for (const exp of shExpenses) {
      updateExpStmt.run(convertEntryToUsd(Number(exp.orig), 'SH.', nextRate), exp.id);
    }

    const shPurchases = db
      .prepare(
        "SELECT id, COALESCE(original_unit_price, unit_price) as orig_unit, COALESCE(original_total_amount, total_amount) as orig_total FROM purchases WHERE currency = 'SH.'"
      )
      .all() as Array<{ id: number; orig_unit: number; orig_total: number }>;
    const updatePurStmt = db.prepare('UPDATE purchases SET unit_price = ?, total_amount = ? WHERE id = ?');
    for (const pur of shPurchases) {
      const nextUsdUnit = Number((Number(pur.orig_unit) / nextRate).toFixed(4));
      const nextUsdTotal = convertEntryToUsd(Number(pur.orig_total), 'SH.', nextRate);
      updatePurStmt.run(nextUsdUnit, nextUsdTotal, pur.id);
    }
  });

  updateSettingsTx();

  const updated = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
  recordAuditLog({
    user: req.user,
    action: 'UPDATE',
    entityType: 'settings',
    entityId: 1,
    summary: `Updated company settings & exchange rate (1 USD = ${nextRate} SH.)`,
    details: { company_name: (updated as Record<string, string>).company_name, exchange_rate: nextRate },
  });

  res.json(updated);
});

// Database Backup & Restore (Admin only)
apiRouter.get('/backup/summary', authenticate, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const counts = {
    projects: (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c,
    expenses: (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as { c: number }).c,
    purchases: (db.prepare('SELECT COUNT(*) as c FROM purchases').get() as { c: number }).c,
    suppliers: (db.prepare('SELECT COUNT(*) as c FROM suppliers').get() as { c: number }).c,
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c,
    audit_logs: (db.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number }).c,
  };

  const dbFilePath = path.resolve(process.cwd(), 'data', 'amiisaan.db');
  let sizeBytes = 0;
  try {
    if (fs.existsSync(dbFilePath)) {
      sizeBytes = fs.statSync(dbFilePath).size;
    }
  } catch {
    sizeBytes = 0;
  }

  res.json({
    counts,
    sizeBytes,
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/backup/sqlite', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const tempFile = path.join(os.tmpdir(), `amiisaan-backup-${Date.now()}.db`);
  const downloadName = `A-MIISAAN_Backup_${dateStamp}.db`;

  try {
    await db.backup(tempFile);
    recordAuditLog({
      user: req.user,
      action: 'CREATE',
      entityType: 'settings',
      entityId: 1,
      summary: `Downloaded full SQLite database backup (${downloadName})`,
      details: { format: 'sqlite', filename: downloadName },
    });

    res.download(tempFile, downloadName, (err) => {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        // Ignore temp cleanup failure
      }
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Failed to stream SQLite backup file.' });
      }
    });
  } catch {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {
      // Ignore
    }
    res.status(500).json({ error: 'Failed to create SQLite database backup.' });
  }
});

apiRouter.get('/backup/json', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `A-MIISAAN_Backup_${dateStamp}.json`;

  const payload = {
    app: 'A-MIISAAN CONSTRUCTION CO. Accountant Management System',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: req.user!.full_name,
    tables: {
      company_settings: db.prepare('SELECT * FROM company_settings').all(),
      users: db.prepare('SELECT * FROM users').all(),
      projects: db.prepare('SELECT * FROM projects').all(),
      suppliers: db.prepare('SELECT * FROM suppliers').all(),
      expenses: db.prepare('SELECT * FROM expenses').all(),
      purchases: db.prepare('SELECT * FROM purchases').all(),
      audit_logs: db.prepare('SELECT * FROM audit_logs').all(),
    },
  };

  recordAuditLog({
    user: req.user,
    action: 'CREATE',
    entityType: 'settings',
    entityId: 1,
    summary: `Exported JSON full data backup (${filename})`,
    details: { format: 'json', filename },
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

apiRouter.post('/backup/restore-json', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as {
    app?: string;
    tables?: {
      company_settings?: Array<Record<string, unknown>>;
      users?: Array<Record<string, unknown>>;
      projects?: Array<Record<string, unknown>>;
      suppliers?: Array<Record<string, unknown>>;
      expenses?: Array<Record<string, unknown>>;
      purchases?: Array<Record<string, unknown>>;
      audit_logs?: Array<Record<string, unknown>>;
    };
  };

  const tables = body?.tables;
  const projectsList = tables?.projects;
  const expensesList = tables?.expenses;
  const purchasesList = tables?.purchases;
  const suppliersList = tables?.suppliers;
  const usersList = tables?.users;

  if (
    !tables ||
    !Array.isArray(projectsList) ||
    !Array.isArray(expensesList) ||
    !Array.isArray(purchasesList) ||
    !Array.isArray(suppliersList) ||
    !Array.isArray(usersList)
  ) {
    res.status(400).json({ error: 'Invalid backup file structure. Please upload a valid A-MIISAAN JSON backup.' });
    return;
  }

  const hasActiveAdmin = usersList.some((u) => u.role === 'admin' && Number(u.is_active) === 1);
  if (!hasActiveAdmin) {
    res.status(400).json({ error: 'Restore rejected: backup must include at least one active Administrator account.' });
    return;
  }

  try {
    const restoreTx = db.transaction(() => {
      db.prepare('DELETE FROM expenses').run();
      db.prepare('DELETE FROM purchases').run();
      db.prepare('DELETE FROM suppliers').run();
      db.prepare('DELETE FROM projects').run();
      db.prepare('DELETE FROM audit_logs').run();
      db.prepare('DELETE FROM users').run();
      db.prepare('DELETE FROM company_settings').run();

      if (Array.isArray(tables.company_settings)) {
        const stmt = db.prepare(
          `INSERT INTO company_settings (
            id, company_name, logo_url, address, phone, email, currency, currency_symbol, exchange_rate,
            description, report_header, quotation_header, footer_text, signature_name, signature_title, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const row of tables.company_settings) {
          stmt.run(
            row.id ?? 1,
            row.company_name,
            row.logo_url,
            row.address,
            row.phone,
            row.email,
            row.currency,
            row.currency_symbol,
            row.exchange_rate ?? 8500,
            row.description,
            row.report_header,
            row.quotation_header,
            row.footer_text,
            row.signature_name,
            row.signature_title,
            row.updated_at ?? new Date().toISOString()
          );
        }
      }

      const insertUser = db.prepare(
        `INSERT INTO users (id, full_name, username, email, password_hash, role, permissions_json, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const u of usersList) {
        insertUser.run(
          u.id,
          u.full_name,
          u.username,
          u.email,
          u.password_hash,
          u.role,
          u.permissions_json,
          u.is_active ?? 1,
          u.created_at ?? new Date().toISOString(),
          u.updated_at ?? new Date().toISOString()
        );
      }

      const insertProject = db.prepare(
        `INSERT INTO projects (
          id, project_code, project_name, client_name, location, start_date, expected_completion_date,
          contract_amount, recorded_revenue, project_budget, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of projectsList) {
        insertProject.run(
          p.id,
          p.project_code,
          p.project_name,
          p.client_name,
          p.location,
          p.start_date,
          p.expected_completion_date,
          p.contract_amount ?? 0,
          p.recorded_revenue ?? null,
          p.project_budget ?? 0,
          p.description ?? '',
          p.status ?? 'Active',
          p.created_at ?? new Date().toISOString(),
          p.updated_at ?? new Date().toISOString()
        );
      }

      const insertSupplier = db.prepare(
        `INSERT INTO suppliers (id, name, contact_person, phone, email, address, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of suppliersList) {
        insertSupplier.run(
          s.id,
          s.name,
          s.contact_person ?? '',
          s.phone ?? '',
          s.email ?? '',
          s.address ?? '',
          s.notes ?? '',
          s.created_at ?? new Date().toISOString()
        );
      }

      const insertExpense = db.prepare(
        `INSERT INTO expenses (
          id, expense_date, expense_type, description, project_id, currency, original_amount, amount, payment_method, reference_number, notes, import_hash, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of expensesList) {
        insertExpense.run(
          e.id,
          e.expense_date,
          e.expense_type ?? 'Other Project Expenses',
          e.description,
          e.project_id,
          e.currency ?? 'USD',
          e.original_amount ?? e.amount,
          e.amount,
          e.payment_method,
          e.reference_number ?? '',
          e.notes ?? '',
          e.import_hash ?? null,
          e.created_by ?? null,
          e.created_at ?? new Date().toISOString(),
          e.updated_at ?? new Date().toISOString()
        );
      }

      const insertPurchase = db.prepare(
        `INSERT INTO purchases (
          id, purchase_date, supplier_id, project_id, item_description, quantity, unit_label,
          currency, original_unit_price, original_total_amount, unit_price, total_amount, payment_status, payment_method, invoice_number, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const pu of purchasesList) {
        insertPurchase.run(
          pu.id,
          pu.purchase_date,
          pu.supplier_id,
          pu.project_id,
          pu.item_description,
          pu.quantity,
          pu.unit_label ?? 'Units',
          pu.currency ?? 'USD',
          pu.original_unit_price ?? pu.unit_price,
          pu.original_total_amount ?? pu.total_amount,
          pu.unit_price,
          pu.total_amount,
          pu.payment_status ?? 'Paid',
          pu.payment_method ?? 'Bank Transfer',
          pu.invoice_number ?? '',
          pu.notes ?? '',
          pu.created_by ?? null,
          pu.created_at ?? new Date().toISOString(),
          pu.updated_at ?? new Date().toISOString()
        );
      }

      if (Array.isArray(tables.audit_logs)) {
        const insertLog = db.prepare(
          `INSERT INTO audit_logs (id, user_id, user_name, action, entity_type, entity_id, summary, details_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const l of tables.audit_logs) {
          insertLog.run(
            l.id,
            l.user_id ?? null,
            l.user_name,
            l.action,
            l.entity_type,
            l.entity_id ?? null,
            l.summary,
            l.details_json ?? '{}',
            l.created_at ?? new Date().toISOString()
          );
        }
      }
    });

    restoreTx();

    recordAuditLog({
      user: req.user,
      action: 'IMPORT',
      entityType: 'settings',
      entityId: 1,
      summary: `Restored full system backup (${projectsList.length} projects, ${expensesList.length} expenses, ${purchasesList.length} purchases)`,
      details: {
        projects: projectsList.length,
        expenses: expensesList.length,
        purchases: purchasesList.length,
      },
    });

    res.json({
      success: true,
      restored: {
        projects: projectsList.length,
        expenses: expensesList.length,
        purchases: purchasesList.length,
        suppliers: suppliersList.length,
      },
    });
  } catch (err) {
    res.status(400).json({
      error: `Restore failed: ${err instanceof Error ? err.message : 'Invalid data relations in backup file.'}`,
    });
  }
});
