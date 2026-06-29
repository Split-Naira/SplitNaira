"use client";

import { clsx } from "clsx";

export interface ProjectCardProps {
  id: string;
  name: string;
  status: "active" | "locked" | "inactive";
  balance: string;
  collaboratorCount: number;
  onDistribute?: (id: string) => void;
}

const statusClasses: Record<ProjectCardProps["status"], string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  locked: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  inactive: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
};

export function ProjectCard({ id, name, status, balance, collaboratorCount, onDistribute }: ProjectCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{name}</h3>
        <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize", statusClasses[status])}>
          {status}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>Balance: <span className="font-medium text-gray-900 dark:text-white">{balance}</span></span>
        <span>{collaboratorCount} collaborator{collaboratorCount !== 1 ? "s" : ""}</span>
      </div>

      {onDistribute && (
        <button
          onClick={() => onDistribute(id)}
          className="mt-1 w-full rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium py-1.5 transition-colors"
        >
          Distribute
        </button>
      )}
    </div>
  );
}
