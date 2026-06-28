"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";

interface GlobalLoadingBarProps {
  loading: boolean;
}

export function GlobalLoadingBar({ loading }: GlobalLoadingBarProps) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (loading) {
      setVisible(true);
      setWidth(0);
      const t1 = setTimeout(() => setWidth(70), 50);
      const t2 = setTimeout(() => setWidth(90), 400);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else {
      setWidth(100);
      const t = setTimeout(() => { setVisible(false); setWidth(0); }, 300);
      return () => clearTimeout(t);
    }
  }, [loading]);

  if (!visible) return null;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      aria-label="Loading"
      className="fixed top-0 left-0 z-50 h-0.5 bg-violet-500 transition-all duration-300 ease-out"
      style={{ width: width + "%" }}
    />
  );
}
