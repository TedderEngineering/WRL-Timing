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
import { RaceDetailPage, RaceDetailRedirect } from "./pages/RaceDetailPage";
import { QualifyingListPage } from "./pages/QualifyingListPage";
import { QualifyingDetailPage } from "./pages/QualifyingDetailPage";
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
import { AdminQualifyingUploadPage } from "./pages/admin/AdminQualifyingUploadPage";

// Finding Grip (tire pressure & damper tools) — its own shell under /grip
import { GripAppLayout, GripPublicLayout } from "./features/grip/GripLayout";
import { GripHomePage, GripPricingPage } from "./pages/grip/GripPublicPages";
import { GripDashboardPage } from "./pages/grip/GripDashboardPage";
import { GripSessionsPage } from "./pages/grip/GripSessionsPage";
import { GripSessionFormPage } from "./pages/grip/GripSessionFormPage";
import { GripCalculatorPage } from "./pages/grip/GripCalculatorPage";
import { GripConvertPage } from "./pages/grip/GripConvertPage";
import { GripDamperPage } from "./pages/grip/GripDamperPage";
import { GripGuidePage } from "./pages/grip/GripGuidePage";
import { GripSettingsPage } from "./pages/grip/GripSettingsPage";
import { GripAdminPage } from "./pages/grip/GripAdminPage";

export function App() {
  return (
    <Routes>
      {/* Finding Grip — public pages */}
      <Route element={<GripPublicLayout />}>
        <Route path="/grip" element={<GripHomePage />} />
        <Route path="/grip/pricing" element={<GripPricingPage />} />
      </Route>

      {/* Finding Grip — signed-in app (login and access are checked in the layout) */}
      <Route element={<GripAppLayout />}>
        <Route path="/grip/dashboard" element={<GripDashboardPage />} />
        <Route path="/grip/sessions" element={<GripSessionsPage />} />
        <Route path="/grip/sessions/new" element={<GripSessionFormPage />} />
        <Route path="/grip/sessions/:id/edit" element={<GripSessionFormPage />} />
        <Route path="/grip/calculate" element={<GripCalculatorPage />} />
        <Route path="/grip/calculations/:id/convert" element={<GripConvertPage />} />
        <Route path="/grip/damper" element={<GripDamperPage />} />
        <Route path="/grip/guide" element={<GripGuidePage />} />
        <Route path="/grip/settings" element={<GripSettingsPage />} />
        <Route
          path="/grip/admin"
          element={
            <ProtectedRoute requireAdmin>
              <GripAdminPage />
            </ProtectedRoute>
          }
        />
      </Route>

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
        <Route path="/chart" element={<RaceDetailPage />} />
        {/* Redirect old bookmarked /races/:id URLs to /chart?race=:id */}
        <Route path="/races/:id" element={<RaceDetailRedirect />} />

        {/* Qualifying routes (public — auth optional) */}
        <Route path="/qualifying" element={<QualifyingListPage />} />
        <Route path="/qualifying/:id" element={<QualifyingDetailPage />} />

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
          <Route path="qualifying/new" element={<AdminQualifyingUploadPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="audit-log" element={<AdminAuditLogPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
