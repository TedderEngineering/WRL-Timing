import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthContext";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { Button } from "@/components/Button";
import { Alert } from "@/components/Alert";

type Status = "verifying" | "success" | "error" | "no-token";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>(token ? "verifying" : "no-token");
  const [errorMsg, setErrorMsg] = useState("");
  const { refreshUser } = useAuth();

  useEffect(() => {
    if (!token) return;

    api
      .post("/auth/verify-email", { token })
      .then(() => {
        setStatus("success");
        // Refresh user data so emailVerified updates
        refreshUser();
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(
          err?.message || "Verification failed. The link may be expired or invalid."
        );
      });
  }, [token, refreshUser]);

  if (status === "no-token") {
    return (
      <AuthLayout title="Invalid link">
        <Alert variant="error">
          This verification link is missing a token. Please check your email for the
          correct link or request a new one.
        </Alert>
      </AuthLayout>
    );
  }

  if (status === "verifying") {
    return (
      <AuthLayout title="Verifying your email...">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
        </div>
      </AuthLayout>
    );
  }

  if (status === "error") {
    return (
      <AuthLayout title="Verification failed">
        <Alert variant="error">{errorMsg}</Alert>
        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          <Link
            to="/dashboard"
            className="text-brand-600 dark:text-brand-400 hover:underline"
          >
            Go to dashboard
          </Link>{" "}
          — you can resend the verification email from your settings.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Email verified!">
      <Alert variant="success">Your email has been verified successfully.</Alert>
      <div className="mt-6">
        <Link to="/dashboard">
          <Button className="w-full" size="lg">
            Go to dashboard
          </Button>
        </Link>
      </div>
    </AuthLayout>
  );
}
