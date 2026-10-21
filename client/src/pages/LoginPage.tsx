import { Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { AuthLayout } from "../features/auth/AuthLayout";
import { useForm } from "../hooks/useForm";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { peekPostAuthRedirect, clearPostAuthRedirect } from "../lib/postAuthRedirect";
import { OAuthButtons, oauthMessage } from "../features/auth/OAuthButtons";
import { takeSignedOutNotice } from "../lib/signedOutNotice";
import { useState } from "react";
import { IS_GRIP_SITE } from "../lib/site";
import { AuthShowcase } from "../features/auth/AuthShowcase";
import { gateObject, gateTarget, useGateRace } from "../features/auth/gate";

export function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [signedOutNotice] = useState(takeSignedOutNotice);
  const navigate = useNavigate();
  const location = useLocation();

  // Where the visitor was heading, query included (a shared race link: /chart?race=…&car=…).
  const asked = (location.state as { from?: { pathname: string; search?: string; hash?: string } })?.from;
  const from = (asked?.pathname ? `${asked.pathname}${asked.search ?? ""}${asked.hash ?? ""}` : null) || peekPostAuthRedirect() || "/dashboard";
  // What the visitor's link opens: named in the title, and shown beside the form.
  const target = IS_GRIP_SITE || from.startsWith("/grip") ? null : gateTarget(from);
  const gateRace = useGateRace(target);
  const opens = gateObject(target, gateRace);
  const title = opens ? `Log in to open ${opens}` : "Welcome back";
  const subtitle = opens ? "New here? A free account opens it too." : "Log in to your account";
  const aside = IS_GRIP_SITE || from.startsWith("/grip") ? undefined : <AuthShowcase target={target} race={gateRace} />;

  const { values, errors, globalError, isSubmitting, handleChange, handleSubmit } =
    useForm({
      initialValues: { email: "", password: "" },
      validate: (vals) => {
        const errs: Record<string, string> = {};
        if (!vals.email) errs.email = "Email is required";
        if (!vals.password) errs.password = "Password is required";
        return errs;
      },
      onSubmit: async (vals) => {
        await login(vals.email, vals.password);
        clearPostAuthRedirect();
        navigate(from, { replace: true });
      },
    });

  if (isLoading) {
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </AuthLayout>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return (
    <AuthLayout title={title} subtitle={subtitle} aside={aside}>
      {oauthMessage(location.search) && (
        <div className="mb-5">
          <Alert variant="error">{oauthMessage(location.search)}</Alert>
        </div>
      )}
      {signedOutNotice && (
        <div className="mb-5">
          <Alert variant="info">{signedOutNotice}</Alert>
        </div>
      )}
      <OAuthButtons next={from} />
      <form onSubmit={handleSubmit} className="space-y-5">
        {globalError && <Alert variant="error">{globalError}</Alert>}

        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={handleChange}
          error={errors.email}
        />

        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={values.password}
          onChange={handleChange}
          error={errors.password}
        />

        <div className="flex items-center justify-end">
          <Link
            to="/forgot-password"
            className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
          Log in
        </Button>
      </form>

      <div className="mt-6 rounded-lg border border-gray-200 px-4 py-3 text-center text-sm dark:border-gray-800">
        <span className="text-gray-600 dark:text-gray-400">New to {IS_GRIP_SITE ? "Finding Grip" : "RaceTrace"}?</span>{" "}
        <Link to="/signup" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Create a free account
        </Link>
      </div>
    </AuthLayout>
  );
}
