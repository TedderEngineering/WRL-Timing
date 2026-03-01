import { Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import { AuthLayout } from "../features/auth/AuthLayout";
import { useForm } from "../hooks/useForm";
import { Input } from "../components/Input";
import { Button } from "../components/Button";
import { Alert } from "../components/Alert";

export function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || "/dashboard";

  if (isLoading) {
    return (
      <AuthLayout title="Welcome back" subtitle="Log in to your account">
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </AuthLayout>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

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
        navigate(from, { replace: true });
      },
    });

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to your account">
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

      <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
        Don't have an account?{" "}
        <Link to="/signup" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
