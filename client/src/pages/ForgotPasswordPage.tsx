import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useForm } from "@/hooks/useForm";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Alert } from "@/components/Alert";

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const { values, errors, globalError, isSubmitting, handleChange, handleSubmit } =
    useForm({
      initialValues: { email: "" },
      validate: (vals) => {
        const errs: Record<string, string> = {};
        if (!vals.email) errs.email = "Email is required";
        return errs;
      },
      onSubmit: async (vals) => {
        await api.post("/auth/forgot-password", { email: vals.email });
        setSent(true);
      },
    });

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <Alert variant="success">
          If an account with <strong>{values.email}</strong> exists, we've sent a password
          reset link. Check your inbox (and spam folder).
        </Alert>
        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          <Link to="/login" className="text-brand-600 dark:text-brand-400 hover:underline">
            Back to login
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link"
    >
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

        <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
        Remember your password?{" "}
        <Link to="/login" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
