import { cn } from "@/lib/utils";

interface AlertProps {
  variant: "success" | "error" | "warning" | "info";
  children: React.ReactNode;
  className?: string;
}

const variantStyles = {
  success: "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800",
  error: "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800",
  warning: "bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800",
  info: "bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800",
};

export function Alert({ variant, children, className }: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        variantStyles[variant],
        className
      )}
      role="alert"
    >
      {children}
    </div>
  );
}
