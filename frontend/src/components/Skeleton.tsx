"use client";

import { clsx } from "clsx";

export type SkeletonVariant = "rect" | "line" | "circle" | "text" | "avatar" | "button";

interface SkeletonProps {
  className?: string;
  variant?: SkeletonVariant;
  animated?: boolean;
}

const BASE = "bg-gray-200 dark:bg-gray-700 animate-pulse";

const variantClasses: Record<SkeletonVariant, string> = {
  rect: "rounded",
  line: "h-4 rounded",
  circle: "rounded-full aspect-square",
  text: "h-3 rounded w-3/4",
  avatar: "h-10 w-10 rounded-full",
  button: "h-9 rounded-lg w-24",
};

export function Skeleton({ className, variant = "rect", animated = true }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(BASE, !animated && "animate-none", variantClasses[variant], className)}
    />
  );
}

export function SummaryCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <Skeleton variant="line" className="w-1/2" />
      <Skeleton variant="rect" className="h-8 w-full" />
      <Skeleton variant="text" />
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="line" className="w-full" />
      ))}
    </div>
  );
}

export function DashboardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <SummaryCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton variant="rect" className="h-12 w-full" />
      <Skeleton variant="line" className="w-2/3" />
      <ListSkeleton rows={4} />
    </div>
  );
}
