"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export interface PieChartEntry {
  alias: string;
  basisPoints: number;
}

interface BasisPointsPieChartProps {
  collaborators: PieChartEntry[];
  totalBasisPoints: number;
}

const SLICE_COLOURS = [
  "#22c55e","#3b82f6","#f59e0b","#ec4899","#8b5cf6",
  "#06b6d4","#f97316","#a3e635","#e879f9","#38bdf8",
];

const MAX_BP = 10_000;

export function BasisPointsPieChart({ collaborators, totalBasisPoints }: BasisPointsPieChartProps) {
  const hasData = collaborators.some((c) => c.basisPoints > 0);
  const chartData = hasData
    ? collaborators.filter((c) => c.basisPoints > 0).map((c) => ({ name: c.alias || "Unnamed", value: c.basisPoints }))
    : [{ name: "Unallocated", value: MAX_BP }];

  const isExact = totalBasisPoints === MAX_BP;
  const isOver  = totalBasisPoints > MAX_BP;
  const isUnder = totalBasisPoints < MAX_BP && totalBasisPoints > 0;

  const statusText = isExact ? "Fully allocated \u2713" : isOver ? "Over-allocated \u2717" : isUnder ? "Under-allocated" : "No allocation yet";
  const statusColour = isExact ? "text-green-400" : isOver ? "text-red-400" : "text-amber-400";
  const formattedTotal = totalBasisPoints.toLocaleString("en");

  return (
    <div
      className="flex flex-col items-center gap-4 rounded-3xl border border-white/5 bg-white/2 p-6"
      role="img"
      aria-label={`Basis points chart. ${statusText}. Total: ${formattedTotal} of 10,000 bp.`}
    >
      <p className="sr-only">
        {collaborators.filter((c) => c.basisPoints > 0).map((c) => `${c.alias}: ${c.basisPoints} bp`).join(", ")}
      </p>
      <h3 className="self-start text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Share Visualisation</h3>
      <div className="w-full" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} cx="50%" cy="50%" innerRadius="50%" outerRadius="80%" paddingAngle={hasData ? 3 : 0} dataKey="value" isAnimationActive={true}>
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={hasData ? SLICE_COLOURS[index % SLICE_COLOURS.length] : "rgba(255,255,255,0.05)"} stroke="transparent" />
              ))}
            </Pie>
            {hasData && (
              <Tooltip
                contentStyle={{ background: "#111110", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", fontSize: "11px" }}
                formatter={(value: number) => [`${value.toLocaleString()} bp (${(value / 100).toFixed(2)}%)`, ""]}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>
      {hasData && (
        <ul className="w-full space-y-1.5" aria-label="Collaborator legend">
          {collaborators.filter((c) => c.basisPoints > 0).map((c, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }} aria-hidden="true" />
                <span className="truncate max-w-[120px] font-medium">{c.alias || "Unnamed"}</span>
              </span>
              <span className="font-mono text-muted">{c.basisPoints.toLocaleString()} bp</span>
            </li>
          ))}
        </ul>
      )}
      <div
        className={`w-full rounded-2xl px-4 py-3 font-mono text-sm font-bold text-center ${isExact ? "bg-green-500/10 text-green-400" : isOver ? "bg-red-500/10 text-red-400" : "bg-white/5 text-amber-400"}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {formattedTotal} / 10,000 bp
        <span className={`ml-3 text-[10px] uppercase tracking-widest ${statusColour}`}>{statusText}</span>
      </div>
    </div>
  );
}