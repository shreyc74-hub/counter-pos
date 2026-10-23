"use client";

import { useEffect, useRef, useState } from "react";

// Small SVG chart kit for the dashboard. Follows the house rules: thin bars (≤24px)
// with a 4px rounded top, hairline solid grid, one y-axis, a legend for 2+ series,
// a hover/focus readout on every column, and a table view for every chart.

export const SERIES = {
  blue: "#2a78d6",
  orange: "#eb6834",
  aqua: "#1baf7a",
  gray: "#c3c2b7",
} as const;

export interface Series {
  name: string;
  color: string;
  values: number[];
}

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  if (series.length < 2) return null;
  return (
    <div className="viz-legend">
      {series.map((s) => (
        <span key={s.name}>
          <span className="viz-swatch" style={{ background: s.color }} aria-hidden="true" />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function ColumnChart({
  title,
  categories,
  series,
  format,
  axisFormat = format,
  height = 220,
  labelEvery,
}: {
  title: string;
  categories: string[];
  series: Series[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  /** Show every nth x label (auto by default). */
  labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 48, r: 8, t: 10, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const n = categories.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const band = plotW / Math.max(1, n);
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const every = labelEvery ?? Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <figure className="viz" aria-label={title} style={{ margin: 0 }}>
      <Legend series={series} />
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={width} height={height} role="img" aria-label={`${title}. Use the table below for exact values.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c3c2b7" : "#e1e0d9"} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="viz-tick">
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {categories.map((c, i) => {
            const x0 = pad.l + i * band + (band - groupW) / 2;
            return (
              <g key={c + i}>
                {hover === i ? <rect x={pad.l + i * band} y={pad.t} width={band} height={plotH} fill="#f1ede4" /> : null}
                {series.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  return <path key={s.name} d={barPath(x0 + si * (barW + gap), y(v), barW, pad.t + plotH - y(v))} fill={s.color} />;
                })}
                {i % every === 0 ? (
                  <text x={pad.l + i * band + band / 2} y={height - 8} textAnchor="middle" className="viz-tick">
                    {c}
                  </text>
                ) : null}
                <rect
                  x={pad.l + i * band}
                  y={pad.t}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${c}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(", ")}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {hover != null ? (
          <div
            className="viz-tip"
            style={{
              left: Math.min(width - 170, Math.max(0, pad.l + hover * band + band / 2 - 80)),
              top: 0,
            }}
          >
            <div className="viz-tip-title">{categories[hover]}</div>
            {series.map((s) => (
              <div key={s.name} className="viz-tip-row">
                <span className="viz-key" style={{ background: s.color }} aria-hidden="true" />
                <strong>{format(s.values[hover] ?? 0)}</strong>
                <span className="muted">{s.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <details className="viz-table">
        <summary>Table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col"> </th>
              {series.map((s) => (
                <th key={s.name} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => (
              <tr key={c + i}>
                <th scope="row">{c}</th>
                {series.map((s) => (
                  <td key={s.name}>{format(s.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Horizontal bars for ranked lists (items, expense categories). Single series, value at the tip. */
export function BarList({
  rows,
  format,
  color = SERIES.blue,
}: {
  rows: { label: string; value: number; note?: string }[];
  format: (n: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div key={r.label} className="barlist-row">
          <span className="barlist-label">{r.label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
            <span className="barlist-value">{format(r.value)}</span>
          </span>
          {r.note ? <span className="barlist-note small muted">{r.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Part-to-whole for two or three parts: one stacked bar with a 2px gap and labelled legend. */
export function ShareBar({ parts, format }: { parts: { name: string; value: number; color: string }[]; format: (n: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="sharebar" role="img" aria-label={parts.map((p) => `${p.name} ${format(p.value)}`).join(", ")}>
        {shown.map((p) => (
          <span key={p.name} style={{ flexGrow: p.value, background: p.color }} title={`${p.name}: ${format(p.value)}`} />
        ))}
        {total === 0 ? <span style={{ flexGrow: 1, background: "#e1e0d9" }} /> : null}
      </div>
      <div className="viz-legend" style={{ marginBottom: 0 }}>
        {parts.map((p) => (
          <span key={p.name}>
            <span className="viz-swatch" style={{ background: p.color }} aria-hidden="true" />
            {p.name} <strong>{format(p.value)}</strong>
            <span className="muted"> · {total ? Math.round((p.value / total) * 100) : 0}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
