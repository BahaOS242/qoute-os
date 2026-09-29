"use client";
/**
 * Dependency-free SVG/HTML charts for the dashboard.
 * Palette (validated with the dataviz validator, light surface): series-1 #2a78d6, series-2 #eb6834.
 * Text always uses ink tokens; color marks carry identity. Every chart has a hover layer.
 */
import { useMemo, useRef, useState } from "react";

const SERIES = ["#2a78d6", "#eb6834"] as const;
const INK = { primary: "#0f172a", secondary: "#475569", muted: "#94a3b8", grid: "#eef2f6" };

function Tooltip({ x, y, children, containerWidth }: { x: number; y: number; children: React.ReactNode; containerWidth: number }) {
  const flip = x > containerWidth - 170;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left: flip ? undefined : x + 12, right: flip ? containerWidth - x + 12 : undefined, top: Math.max(0, y - 10) }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend: daily starts vs leads (one shared axis - both are counts)
// ---------------------------------------------------------------------------

export function TrendChart({ data }: { data: { date: string; starts: number; leads: number }[] }) {
  const series = [
    { key: "starts" as const, label: "Quotes started", color: SERIES[0] },
    { key: "leads" as const, label: "Leads", color: SERIES[1] },
  ];
  const W = 720;
  const H = 220;
  const pad = { l: 32, r: 118, t: 12, b: 26 };
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const max = Math.max(1, ...data.flatMap((d) => [d.starts, d.leads]));
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax);
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];
  const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const paths = useMemo(
    () => series.map((s) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`).join("")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, niceMax],
  );

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const last = data.length - 1;
  const endLabels = series.map((s) => ({ ...s, y: y(data[last]?.[s.key] ?? 0) }));
  if (endLabels.length === 2 && Math.abs(endLabels[0].y - endLabels[1].y) < 16) {
    const mid = (endLabels[0].y + endLabels[1].y) / 2;
    const upper = endLabels[0].y <= endLabels[1].y ? 0 : 1;
    endLabels[upper].y = mid - 8;
    endLabels[1 - upper].y = mid + 8;
    for (const l of endLabels) l.y = Math.min(Math.max(l.y, pad.t + 4), H - pad.b - 4);
  }
  const containerWidth = wrap.current?.clientWidth ?? W;
  const hoverPx = hover === null ? 0 : (x(hover) / W) * containerWidth;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <button type="button" onClick={() => setShowTable((v) => !v)} className="ml-auto text-slate-500 underline-offset-2 hover:underline">
          {showTable ? "Show chart" : "View as table"}
        </button>
      </div>
      {showTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr>
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 text-right font-medium">Quotes started</th>
                <th className="py-1.5 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-slate-100 text-slate-700">
                  <td className="py-1">{fmtDay(d.date)}</td>
                  <td className="py-1 text-right tabular-nums">{d.starts}</td>
                  <td className="py-1 text-right tabular-nums">{d.leads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none"
            role="img"
            aria-label="Daily quotes started and leads"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
                <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill={INK.muted}>
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % Math.ceil(data.length / 6) === 0 || i === last ? (
                <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === last ? "end" : "middle"} fontSize={10} fill={INK.muted}>
                  {fmtDay(d.date)}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={INK.muted} strokeWidth={1} />}
            {series.map((s, si) => (
              <path key={s.key} d={paths[si]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover !== null &&
              series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key])} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
              ))}
            {endLabels.map((s) => (
              <text key={s.key} x={W - pad.r + 8} y={s.y + 3} fontSize={11} fill={INK.secondary}>
                {s.label} · {data[last]?.[s.key] ?? 0}
              </text>
            ))}
          </svg>
          {hover !== null && (
            <Tooltip x={hoverPx} y={16} containerWidth={containerWidth}>
              <p className="mb-1 font-semibold text-slate-900">{fmtDay(data[hover].date)}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">{data[hover][s.key]}</span>
                </p>
              ))}
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars (single series): funnel stages, services, sources
// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  /** Right-aligned text shown next to the value (e.g. conversion from previous step). */
  note?: string;
  /** Extra lines for the tooltip. */
  detail?: string[];
}

export function BarList({ data, format = (v) => v.toLocaleString("en-US"), emptyLabel = "No data yet" }: { data: BarDatum[]; format?: (v: number) => string; emptyLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>;
  return (
    <ul className="space-y-2.5" onPointerLeave={() => setHover(null)}>
      {data.map((d, i) => (
        <li
          key={d.label}
          tabIndex={0}
          className="relative outline-none"
          onPointerEnter={() => setHover(i)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          aria-label={`${d.label}: ${format(d.value)}${d.note ? `, ${d.note}` : ""}`}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{d.label}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium text-slate-900">{format(d.value)}</span>
              {d.note && <span className="ml-2 text-xs text-slate-500">{d.note}</span>}
            </span>
          </div>
          <div className="h-2 rounded bg-slate-100">
            <div
              className="h-2 rounded transition-[filter]"
              style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100)}%`, background: SERIES[0], filter: hover === i ? "brightness(1.15)" : undefined }}
            />
          </div>
          {hover === i && d.detail && (
            <div role="status" className="pointer-events-none absolute right-0 top-full z-10 mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-lg">
              <p className="font-semibold text-slate-900">{d.label}</p>
              {d.detail.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
