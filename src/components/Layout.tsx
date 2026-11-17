import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Receipt,
  FileSpreadsheet,
  ShoppingCart,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { CompanyLogo } from './CompanyLogo.tsx';
import type { UserPermissions } from '../types/index.ts';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: keyof Omit<UserPermissions, 'allowedProjectIds'>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, permission: 'dashboard' },
  { label: 'Projects', to: '/projects', icon: Building2, permission: 'projects' },
  { label: 'Expenses', to: '/expenses', icon: Receipt, permission: 'expenses' },
  { label: 'Quotations', to: '/quotations', icon: FileSpreadsheet, permission: 'quotations' },
  { label: 'Purchases', to: '/purchases', icon: ShoppingCart, permission: 'purchases' },
  { label: 'Reports', to: '/reports', icon: BarChart3, permission: 'reports' },
  { label: 'Users & Settings', to: '/settings', icon: Settings, permission: 'settings' },
];

const PAGE_TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: '/projects/', title: 'Projects / Financial Ledger' },
  { prefix: '/projects', title: 'Projects Management' },
  { prefix: '/expenses', title: 'Expenses Management' },
  { prefix: '/quotations/', title: 'Quotations / Project Financial Summary' },
  { prefix: '/quotations', title: 'Quotations Management' },
  { prefix: '/purchases', title: 'Purchases & Suppliers' },
  { prefix: '/reports', title: 'Financial Reports & A4 Printing' },
  { prefix: '/settings', title: 'Users, Permissions & Company Settings' },
  { prefix: '/', title: 'Financial Overview' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, company, logout, hasPermission } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const visibleNav = NAV_ITEMS.filter((item) => hasPermission(item.permission));
  const pageTitle =
    PAGE_TITLES.find((entry) =>
      entry.prefix === '/' ? location.pathname === '/' : location.pathname.startsWith(entry.prefix)
    )?.title ?? 'Accountant Workspace';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="no-print fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Left Navy Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 w-64 bg-[#0F2342] text-slate-100 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <CompanyLogo src={company?.logo_url} className="w-11 h-11 bg-white" />
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-white truncate">
                {company?.company_name || 'A-MIISAAN CONSTRUCTION CO.'}
              </p>
              <p className="text-xs text-amber-400 font-medium truncate">Accountant System</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-slate-300 hover:text-white p-1"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main Navigation">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-white/12 text-white border border-white/15'
                      : 'text-slate-300 hover:bg-white/6 hover:text-white border border-transparent'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0 text-amber-400" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="mb-3 px-1">
            <p className="text-sm font-semibold text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-slate-300 truncate">
              {user?.role === 'admin' ? 'Administrator' : 'Accountant'} · {user?.email}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 bg-white/8 hover:bg-white/15 rounded-md transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0 whitespace-nowrap">
            <span className="hidden sm:inline font-mono">
              Currency: <strong className="text-slate-900">{company?.currency || 'USD'}</strong>
            </span>
            <span className="hidden sm:inline text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              Role: <strong className="text-slate-900">{user?.role === 'admin' ? 'Admin' : 'Accountant'}</strong>
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
