"use client";

import { clsx } from "clsx";
import { sanitizeText } from "@/lib/security";
import type { SplitProject } from "@/lib/stellar";

export interface ProjectCardProps {
  project: SplitProject;
  userEarnings?: string;
  onDistribute?: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
}

export function ProjectCard({ project, userEarnings, onDistribute, onSelect, isSelected }: ProjectCardProps) {
  const Compact = Boolean(userEarnings);

  const outerClass = Compact
    ? "bg-white/5 rounded-2xl p-5 border border-white/5 flex justify-between items-center"
    : "glass-card rounded-[2.5rem] p-8 text-left hover:bg-white/5 transition-all";

  const Content = (
    <>
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h3 className={clsx(Compact ? "font-bold text-xs truncate max-w-[120px]" : "font-display text-xl mb-1")}>
            {sanitizeText(project.title)}
          </h3>
          <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted border border-white/5">
            {sanitizeText(project.projectType)}
          </span>
          {project.locked && (
            <span className="ml-2 rounded-full bg-amber-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300 border border-amber-400/20">
              Locked
            </span>
          )}
        </div>

        {!Compact && <p className="font-mono text-[10px] text-muted mb-4">{project.projectId}</p>}

        <div className={clsx(Compact ? "flex items-center justify-between w-full" : "flex justify-between border-t border-white/5 pt-4")}>
          <div>
            <p className={clsx(Compact ? "text-xl font-display" : "text-xl font-display text-greenBright")}>
              {Number(project.balance).toLocaleString()}
            </p>
            {Compact && <p className="text-[10px] font-mono text-muted">{userEarnings ? `+${Number(userEarnings).toLocaleString()}` : ""}</p>}
          </div>

          <div className="text-right">
            <p className="text-[10px] uppercase text-muted">{Compact ? "Earnings" : "Available"}</p>
            <p className="text-[10px] text-muted">{project.collaborators.length} collaborator{project.collaborators.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {!Compact && onDistribute && (
          <div className="mt-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDistribute();
              }}
              disabled={Number(project.balance) <= 0}
              className="premium-button rounded-2xl bg-greenBright py-3 px-6 text-xs font-black uppercase tracking-[0.3em] text-[#0a0a09] shadow-xl shadow-greenBright/10 disabled:opacity-30"
            >
              Trigger Distribution
            </button>
          </div>
        )}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={outerClass}
      >
        {Content}
      </button>
    );
  }

  return <div className={outerClass}>{Content}</div>;
}
