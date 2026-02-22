import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useForm } from "@/hooks/useForm";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Alert } from "@/components/Alert";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [success, setSuccess] = useState(false);

  const { values, errors, globalError, isSubmitting, handleChange, handleSubmit } =
    useForm({
      initialValues: { password: "", confirmPassword: "" },
      validate: (vals) => {
        const errs: Record<string, string> = {};
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
        await api.post("/auth/reset-password", {
          token,
          password: vals.password,
        });
        setSuccess(true);
      },
    });

  if (!token) {
    return (
      <AuthLayout title="Invalid link">
        <Alert variant="error">
          This password reset link is invalid or missing a token. Please request a new one.
        </Alert>
        <p className="mt-6 text-center">
          <Link
            to="/forgot-password"
            className="text-brand-600 dark:text-brand-400 hover:underline"
          >
            Request a new reset link
          </Link>
        </p>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Password reset!">
        <Alert variant="success">
          Your password has been updated. You can now log in with your new password.
        </Alert>
        <div className="mt-6">
          <Link to="/login">
            <Button className="w-full" size="lg">
              Go to login
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password for your account">
      <form onSubmit={handleSubmit} className="space-y-5">
        {globalError && <Alert variant="error">{globalError}</Alert>}

        <Input
          label="New Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={values.password}
          onChange={handleChange}
          error={errors.password}
        />

        <Input
          label="Confirm New Password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={values.confirmPassword}
          onChange={handleChange}
          error={errors.confirmPassword}
        />

        <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
