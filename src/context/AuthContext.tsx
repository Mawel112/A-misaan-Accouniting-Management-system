import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, TOKEN_STORAGE_KEY } from '../services/api.ts';
import type { AuthUser, CompanySettings, UserPermissions } from '../types/index.ts';

interface AuthContextValue {
  user: AuthUser | null;
  company: CompanySettings | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  setCompany: React.Dispatch<React.SetStateAction<CompanySettings | null>>;
  hasPermission: (key: keyof Omit<UserPermissions, 'allowedProjectIds'>) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  id: 1,
  company_name: 'A-MIISAAN CONSTRUCTION CO.',
  logo_url: '/src/assets/images/amiisaan_logo_1794870104636.jpg',
  address: 'KM4 Junction, Hodan District, Mogadishu',
  phone: '+252 61 500 4420',
  email: 'finance@amiisaan.com',
  currency: 'USD',
  currency_symbol: '$',
  exchange_rate: 8500,
  description: 'Civil engineering, commercial building construction, and infrastructure contracting.',
  report_header: 'OFFICIAL FINANCIAL REPORT',
  quotation_header: 'PROJECT QUOTATION / FINANCIAL SUMMARY',
  footer_text: 'A-MIISAAN CONSTRUCTION CO. · Certified Financial & Project Accounting Record',
  signature_name: 'Eng. Abdirahman Farah',
  signature_title: 'Managing Director / Chief Finance Officer',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(DEFAULT_COMPANY_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<{ user: AuthUser; company: CompanySettings }>('/auth/me');
      setUser(res.data.user);
      if (res.data.company) {
        setCompany(res.data.company);
      }
    } catch {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser; company: CompanySettings }>('/auth/login', {
      identifier,
      password,
    });
    localStorage.setItem(TOKEN_STORAGE_KEY, res.data.token);
    setUser(res.data.user);
    if (res.data.company) {
      setCompany(res.data.company);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (key: keyof Omit<UserPermissions, 'allowedProjectIds'>) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      return Boolean(user.permissions?.[key]);
    },
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, company, loading, login, logout, refreshSession, setCompany, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
