import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="container-page py-20 text-center">
      <h1 className="text-6xl font-bold text-gray-300 dark:text-gray-700 mb-4">
        404
      </h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
        This page doesn't exist.
      </p>
      <Link
        to="/"
        className="text-brand-600 dark:text-brand-400 hover:underline"
      >
        Go back home
      </Link>
    </div>
  );
}
