import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./features/auth";

// Public pages
import { HomePage } from "./pages/HomePage";
import { PricingPage } from "./pages/PricingPage";
import { TermsPage } from "./pages/TermsPage";
import { PrivacyPage } from "./pages/PrivacyPage";

// Auth pages
import { LoginPage } from "./pages/LoginPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";

// Protected pages
import { OnboardingPage } from "./pages/OnboardingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RaceListPage } from "./pages/RaceListPage";
import { RaceDetailPage } from "./pages/RaceDetailPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// Settings pages
import { SettingsLayout } from "./pages/settings/SettingsLayout";
import { AccountSettingsPage } from "./pages/settings/AccountSettingsPage";
import { PreferencesPage } from "./pages/settings/PreferencesPage";
import { BillingSettingsPage } from "./pages/settings/BillingSettingsPage";

// Admin pages
import { AdminLayout } from "./features/admin/AdminLayout";
import { AdminDashboardPage } from "./pages/admin/AdminDashboardPage";
import { AdminRacesPage } from "./pages/admin/AdminRacesPage";
import { AdminUploadPage } from "./pages/admin/AdminUploadPage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminAuditLogPage } from "./pages/admin/AdminAuditLogPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />

        {/* Auth routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Onboarding (protected) */}
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingPage />
            </ProtectedRoute>
          }
        />

        {/* Dashboard (protected) */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Race routes (public — auth optional for favorites) */}
        <Route path="/races" element={<RaceListPage />} />
        <Route path="/races/:id" element={<RaceDetailPage />} />

        {/* Settings (protected, nested layout) */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="account" replace />} />
          <Route path="account" element={<AccountSettingsPage />} />
          <Route path="preferences" element={<PreferencesPage />} />
          <Route path="billing" element={<BillingSettingsPage />} />
        </Route>

        {/* Admin routes (protected, admin only, nested layout) */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="races" element={<AdminRacesPage />} />
          <Route path="races/new" element={<AdminUploadPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="audit-log" element={<AdminAuditLogPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
