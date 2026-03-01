import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { AuthLayout } from "../features/auth/AuthLayout";
import { useForm } from "../hooks/useForm";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";
import { cn } from "../lib/utils";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", met: password.length >= 8 },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
  ];

  if (!password) return null;

  const metCount = checks.filter((c) => c.met).length;

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-1.5">
        {checks.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < metCount
                ? metCount <= 2
                  ? "bg-red-400"
                  : metCount === 3
                    ? "bg-yellow-400"
                    : "bg-green-400"
                : "bg-gray-200 dark:bg-gray-700"
            )}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {checks.map((check) => (
          <p
            key={check.label}
            className={cn(
              "text-xs",
              check.met
                ? "text-green-600 dark:text-green-400"
                : "text-gray-400 dark:text-gray-500"
            )}
          >
            {check.met ? "✓" : "○"} {check.label}
          </p>
        ))}
      </div>
    </div>
  );
}

export function SignUpPage() {
  const { register, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <AuthLayout title="Create your account" subtitle="Start analyzing race data for free">
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </AuthLayout>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const { values, errors, globalError, isSubmitting, handleChange, handleSubmit } =
    useForm({
      initialValues: { displayName: "", email: "", password: "", confirmPassword: "" },
      validate: (vals) => {
        const errs: Record<string, string> = {};
        if (!vals.email) errs.email = "Email is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.email))
          errs.email = "Invalid email address";
        if (!vals.password) errs.password = "Password is required";
        else if (vals.password.length < 8)
          errs.password = "Password must be at least 8 characters";
        else if (!/[a-z]/.test(vals.password))
          errs.password = "Must contain a lowercase letter";
        else if (!/[A-Z]/.test(vals.password))
          errs.password = "Must contain an uppercase letter";
        else if (!/[0-9]/.test(vals.password))
          errs.password = "Must contain a number";
        if (vals.password !== vals.confirmPassword)
          errs.confirmPassword = "Passwords don't match";
        return errs;
      },
      onSubmit: async (vals) => {
        await register(vals.email, vals.password, vals.displayName || undefined);
        navigate("/onboarding", { replace: true });
      },
    });

  return (
    <AuthLayout title="Create your account" subtitle="Start analyzing race data for free">
      <form onSubmit={handleSubmit} className="space-y-5">
        {globalError && <Alert variant="error">{globalError}</Alert>}

        <Input
          label="Name"
          name="displayName"
          type="text"
          autoComplete="name"
          placeholder="Your name (optional)"
          value={values.displayName}
          onChange={handleChange}
          error={errors.displayName}
        />

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

        <div>
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={values.password}
            onChange={handleChange}
            error={errors.password}
          />
          <PasswordStrength password={values.password} />
        </div>

        <Input
          label="Confirm Password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={values.confirmPassword}
          onChange={handleChange}
          error={errors.confirmPassword}
        />

        <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
        Already have an account?{" "}
        <Link to="/login" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
