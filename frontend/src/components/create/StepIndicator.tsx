"use client";

import { clsx } from "clsx";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <nav aria-label="Progress" className="w-full">
      <ol className="flex items-center">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <li key={label} className={clsx("flex items-center", index < steps.length - 1 && "flex-1")}>
              <div className="flex flex-col items-center gap-1">
                <div
                  aria-current={isCurrent ? "step" : undefined}
                  className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold border-2 transition-colors",
                    isCompleted && "bg-violet-600 border-violet-600 text-white",
                    isCurrent && "border-violet-600 text-violet-600 bg-white dark:bg-gray-900",
                    !isCompleted && !isCurrent && "border-gray-300 text-gray-400 dark:border-gray-600"
                  )}
                >
                  {isCompleted ? (
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : stepNumber}
                </div>
                <span className={clsx(
                  "text-[10px] font-medium hidden sm:block",
                  isCurrent ? "text-violet-600" : "text-gray-400 dark:text-gray-500"
                )}>
                  {label}
                </span>
              </div>

              {index < steps.length - 1 && (
                <div className={clsx(
                  "flex-1 h-0.5 mx-2 transition-colors",
                  isCompleted ? "bg-violet-600" : "bg-gray-200 dark:bg-gray-700"
                )} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
