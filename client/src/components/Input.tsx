import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || label.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-1.5">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "block w-full rounded-lg border px-3.5 py-2.5 text-sm",
            "bg-white dark:bg-gray-900",
            "text-gray-900 dark:text-gray-100",
            "placeholder:text-gray-400 dark:placeholder:text-gray-500",
            "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500",
            "transition-colors",
            error
              ? "border-red-500 focus:ring-red-500 focus:border-red-500"
              : "border-gray-300 dark:border-gray-700",
            className
          )}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
