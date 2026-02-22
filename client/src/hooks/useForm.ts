import { useState, type ChangeEvent, type FormEvent } from "react";

interface UseFormOptions<T> {
  initialValues: T;
  onSubmit: (values: T) => Promise<void>;
  validate?: (values: T) => Partial<Record<keyof T, string>>;
}

export function useForm<T extends Record<string, string>>({
  initialValues,
  onSubmit,
  validate,
}: UseFormOptions<T>) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (errors[name as keyof T]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    if (globalError) setGlobalError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGlobalError(null);

    // Run validation
    if (validate) {
      const validationErrors = validate(values);
      const hasErrors = Object.values(validationErrors).some(Boolean);
      if (hasErrors) {
        setErrors(validationErrors);
        return;
      }
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      await onSubmit(values);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "message" in err) {
        setGlobalError((err as { message: string }).message);
      } else {
        setGlobalError("Something went wrong. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    values,
    errors,
    globalError,
    isSubmitting,
    handleChange,
    handleSubmit,
    setGlobalError,
  };
}
