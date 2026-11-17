import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db, type UserPermissions } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'amiisaan-construction-accounting-secret-2026';

export interface AuthUser {
  id: number;
  full_name: string;
  username: string;
  email: string;
  role: 'admin' | 'accountant';
  permissions: UserPermissions;
  is_active: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
}

export function parsePermissions(raw: string, role: string): UserPermissions {
  try {
    const parsed = JSON.parse(raw) as Partial<UserPermissions>;
    const isAdmin = role === 'admin';
    return {
      dashboard: isAdmin ? true : Boolean(parsed.dashboard ?? true),
      projects: isAdmin ? true : Boolean(parsed.projects ?? true),
      expenses: isAdmin ? true : Boolean(parsed.expenses ?? true),
      quotations: isAdmin ? true : Boolean(parsed.quotations ?? false),
      purchases: isAdmin ? true : Boolean(parsed.purchases ?? false),
      reports: isAdmin ? true : Boolean(parsed.reports ?? false),
      settings: isAdmin ? true : Boolean(parsed.settings ?? false),
      allowedProjectIds: isAdmin
        ? 'all'
        : parsed.allowedProjectIds === 'all' || !Array.isArray(parsed.allowedProjectIds)
        ? 'all'
        : parsed.allowedProjectIds.map(Number).filter((n) => Number.isFinite(n)),
    };
  } catch {
    return {
      dashboard: true,
      projects: true,
      expenses: true,
      quotations: role === 'admin',
      purchases: role === 'admin',
      reports: role === 'admin',
      settings: role === 'admin',
      allowedProjectIds: 'all',
    };
  }
}

export function loadUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(
      'SELECT id, full_name, username, email, role, permissions_json, is_active FROM users WHERE id = ?'
    )
    .get(userId) as
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

  if (!row || !row.is_active) {
    return null;
  }

  return {
    id: row.id,
    full_name: row.full_name,
    username: row.username,
    email: row.email,
    role: row.role,
    permissions: parsePermissions(row.permissions_json, row.role),
    is_active: Boolean(row.is_active),
  };
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    const user = loadUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: 'Account is inactive or no longer exists.' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token. Please sign in again.' });
  }
}

export function requirePermission(permissionKey: keyof Omit<UserPermissions, 'allowedProjectIds'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.user.role === 'admin' || req.user.permissions[permissionKey]) {
      next();
      return;
    }
    res.status(403).json({
      error: `Access denied. You do not have permission to access ${permissionKey}.`,
    });
  };
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator privileges required for this action.' });
    return;
  }
  next();
}

export function isProjectAllowed(user: AuthUser, projectId: number): boolean {
  if (user.role === 'admin') return true;
  if (user.permissions.allowedProjectIds === 'all') return true;
  return user.permissions.allowedProjectIds.includes(projectId);
}

export function recordAuditLog(params: {
  user?: AuthUser;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT';
  entityType: 'project' | 'expense' | 'purchase' | 'supplier' | 'user' | 'settings';
  entityId?: number | null;
  summary: string;
  details?: unknown;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.user?.id ?? null,
    params.user?.full_name ?? 'System',
    params.action,
    params.entityType,
    params.entityId ?? null,
    params.summary,
    JSON.stringify(params.details ?? {})
  );
}
