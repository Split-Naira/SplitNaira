"use client";

import { clsx } from "clsx";
import type { FieldError } from "react-hook-form";

interface FormFieldErrorProps {
  error?: FieldError | { message?: string };
  className?: string;
}

export function FormFieldError({ error, className }: FormFieldErrorProps) {
  if (!error?.message) return null;

  return (
    <p
      role="alert"
      className={clsx("mt-1 text-xs font-medium text-red-600 dark:text-red-400", className)}
    >
      {error.message}
    </p>
  );
}
