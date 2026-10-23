import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "./features/auth";
import { App } from "./App";
import "./styles/globals.css";
import { noteVisit } from "./lib/analytics";
import { landingCode } from "./lib/visit-landing";

// One anonymous visit per page load, with where it came from (lib/analytics.ts noteVisit).
noteVisit(landingCode);

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return children;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
