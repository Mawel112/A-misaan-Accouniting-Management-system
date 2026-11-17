import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import { Layout } from './components/Layout.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ProjectsPage } from './pages/ProjectsPage.tsx';
import { ProjectDetailPage } from './pages/ProjectDetailPage.tsx';
import { ExpensesPage } from './pages/ExpensesPage.tsx';
import { QuotationsPage } from './pages/QuotationsPage.tsx';
import { QuotationDocumentPage } from './pages/QuotationDocumentPage.tsx';
import { PurchasesPage } from './pages/PurchasesPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import type { UserPermissions } from './types/index.ts';

function ProtectedRoute({
  permission,
  children,
}: {
  permission?: keyof Omit<UserPermissions, 'allowedProjectIds'>;
  children: React.ReactNode;
}) {
  const { user, loading, hasPermission } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading workspace...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (permission && !hasPermission(permission)) {
    return (
      <Layout>
        <div className="bg-white border border-slate-200 rounded-lg p-8 max-w-lg mx-auto mt-10 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-50 text-red-700 flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your account does not have permission to access this module. Contact your Administrator if you require access.
          </p>
          <Link
            to="/"
            className="mt-5 inline-block px-4 py-2 text-sm font-medium text-white bg-[#0F2342] rounded-md hover:bg-[#17335e]"
          >
            Return to Dashboard
          </Link>
        </div>
      </Layout>
    );
  }

  return <Layout>{children}</Layout>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginPage />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute permission="dashboard">
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects"
              element={
                <ProtectedRoute permission="projects">
                  <ProjectsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/projects/:id"
              element={
                <ProtectedRoute permission="projects">
                  <ProjectDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/expenses"
              element={
                <ProtectedRoute permission="expenses">
                  <ExpensesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/quotations"
              element={
                <ProtectedRoute permission="quotations">
                  <QuotationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/quotations/:projectId"
              element={
                <ProtectedRoute permission="quotations">
                  <QuotationDocumentPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases"
              element={
                <ProtectedRoute permission="purchases">
                  <PurchasesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute permission="reports">
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute permission="settings">
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
