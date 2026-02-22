import { Link } from "react-router-dom";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="container-page flex items-center justify-center min-h-[80vh] py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex flex-col items-center gap-2">
            <img src="/te-logo-white.png" alt="Tedder Engineering" className="h-10 invert dark:invert-0" />
            <span className="text-lg font-bold text-gray-900 dark:text-gray-100">RaceTrace</span>
          </Link>
          <h1 className="mt-6 text-2xl font-semibold text-gray-900 dark:text-gray-50">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
