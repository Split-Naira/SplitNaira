"use client";

import { useEffect, useSyncExternalStore } from "react";
import NProgress from "nprogress";
import "nprogress/nprogress.css";

export interface LoadingBarFlags {
  isLoadingDashboard: boolean;
  isLoadingProjectsList: boolean;
  isFetchingProject: boolean;
}

const defaultFlags: LoadingBarFlags = {
  isLoadingDashboard: false,
  isLoadingProjectsList: false,
  isFetchingProject: false,
};

let currentFlags: LoadingBarFlags = defaultFlags;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function reportLoadingFlags(flags: LoadingBarFlags) {
  currentFlags = flags;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentFlags;
}

function getServerSnapshot() {
  return defaultFlags;
}

function isAnyLoading(flags: LoadingBarFlags) {
  return flags.isLoadingDashboard || flags.isLoadingProjectsList || flags.isFetchingProject;
}

NProgress.configure({ showSpinner: false, trickleSpeed: 200 });

export function LoadingBar() {
  const flags = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const loading = isAnyLoading(flags);

  useEffect(() => {
    if (loading) {
      NProgress.start();
    } else {
      NProgress.done();
    }
  }, [loading]);

  return (
    <style>{`
      #nprogress {
        pointer-events: none;
      }

      #nprogress .bar {
        background: var(--brand-accent) !important;
        height: 2px;
        z-index: 9999;
      }

      #nprogress .peg {
        box-shadow:
          0 0 10px var(--brand-accent),
          0 0 5px var(--brand-accent) !important;
      }
    `}</style>
  );
}
