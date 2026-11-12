'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Small SVG charts for the admin dashboard (no chart library needed).
// Mark specs: 2px lines with round joins, 10% area wash, columns <= 24px with a
// 4px rounded top, 2px surface gaps between stacked segments, hairline grid,
// crosshair tooltip on lines, per-column tooltip on bars, table view for all.

export const SERIES = {
  classic: '#7b3fe4',
  hunt: '#1a8fbd',
  swap: '#e0437f',
  single: '#7b3fe4',
};

const PAD = { top: 16, right: 44, bottom: 26, left: 36 };

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** clean ticks: 0 .. max in 3–5 steps of 1/2/5 × 10^n */
function niceTicks(max) {
  const m = Math.max(1, max);
  const raw = m / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= raw) || pow * 10;
  const stepInt = Math.max(1, Math.round(step * 100) / 100);
  const top = Math.ceil(m / stepInt) * stepInt;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += stepInt) ticks.push(Math.round(v * 100) / 100);
  return { ticks, top };
}

const fmtNum = (lang) => (v) => (v === null || v === undefined ? '–' : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(v));

export function timeFormatter(lang, step) {
  if (step >= 86400_000) return (t) => new Date(t).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  if (step >= 6 * 3600_000) return (t) => new Date(t).toLocaleString(lang, { weekday: 'short', hour: '2-digit' });
  return (t) => new Date(t).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

function Tooltip({ x, y, width, title, rows }) {
  if (x === null) return null;
  const left = Math.min(Math.max(8, x + 14), width - 170);
  return (
    <div className="viz-tooltip" style={{ left, top: Math.max(0, y - 10) }} role="status">
      <div className="viz-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="viz-tip-row">
          <span className="viz-key" style={{ background: r.color }} />
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <ul className="viz-legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className={`viz-swatch ${s.line ? 'is-line' : ''}`} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartTable({ caption, columns, rows, label }) {
  return (
    <details className="viz-table">
      <summary>{label}</summary>
      <div className="viz-table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** time series lines (optionally with a 10% area wash for a single series) */
export function LineChart({ data, series, height = 200, lang = 'en', step, area = false, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const fmt = fmtNum(lang);
  const fmtT = timeFormatter(lang, step);
  const w = Math.max(width, 200);
  const innerW = w - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0)));
  const { ticks, top } = niceTicks(max);
  const x = (i) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - (v / top) * innerH;

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = '';
        let areaD = '';
        let segStart = null;
        data.forEach((p, i) => {
          const v = p[s.key];
          if (v === null || v === undefined) {
            if (segStart !== null && area) areaD += `L${x(i - 1)},${y(0)}L${x(segStart)},${y(0)}Z`;
            segStart = null;
            return;
          }
          if (segStart === null) {
            d += `M${x(i)},${y(v)}`;
            if (area) areaD += `M${x(i)},${y(v)}`;
            segStart = i;
          } else {
            d += `L${x(i)},${y(v)}`;
            if (area) areaD += `L${x(i)},${y(v)}`;
          }
        });
        if (segStart !== null && area) areaD += `L${x(data.length - 1)},${y(0)}L${x(segStart)},${y(0)}Z`;
        return { ...s, d, areaD };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, series, w, height, top],
  );

  const lastIndex = (key) => {
    for (let i = data.length - 1; i >= 0; i--) if (data[i][key] !== null && data[i][key] !== undefined) return i;
    return -1;
  };
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 90))));

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  return (
    <div className="viz" ref={ref}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {fmt(t)}
              </text>
            </g>
          ))}
          {data.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={p.t} className="viz-tick" x={x(i)} y={height - 8} textAnchor="middle">
                {fmtT(p.t)}
              </text>
            ) : null,
          )}
          {paths.map((s) => (
            <g key={s.key}>
              {area && <path d={s.areaD} fill={s.color} fillOpacity="0.1" />}
              <path d={s.d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {series.map((s) => {
            const li = lastIndex(s.key);
            if (li < 0) return null;
            const v = data[li][s.key];
            return (
              <g key={`end-${s.key}`}>
                <circle cx={x(li)} cy={y(v)} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />
                <text className="viz-end" x={x(li) + 8} y={y(v)} dominantBaseline="middle">
                  {fmt(v)}
                </text>
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
              {series.map((s) =>
                data[hover][s.key] === null || data[hover][s.key] === undefined ? null : (
                  <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key])} r="4" fill={s.color} stroke="var(--viz-surface)" strokeWidth="2" />
                ),
              )}
            </g>
          )}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          x={x(hover)}
          y={PAD.top}
          width={w}
          title={fmtT(data[hover].t)}
          rows={series.map((s) => ({ label: s.label, color: s.color, value: fmt(data[hover][s.key]) }))}
        />
      )}
    </div>
  );
}

/** stacked columns per time bucket */
export function StackedColumns({ data, series, height = 200, lang = 'en', step, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const fmt = fmtNum(lang);
  const fmtT = timeFormatter(lang, step);
  const w = Math.max(width, 200);
  const innerW = w - PAD.left - PAD.right + 30;
  const innerH = height - PAD.top - PAD.bottom;
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d[s.key] || 0), 0));
  const { ticks, top } = niceTicks(Math.max(...totals, 1));
  const band = innerW / data.length;
  const barW = Math.min(24, Math.max(3, band * 0.62));
  const y = (v) => PAD.top + innerH - (v / top) * innerH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70))));
  const maxIndex = totals.indexOf(Math.max(...totals));
  const GAP = 2;

  return (
    <div className="viz" ref={ref}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={PAD.left} x2={w - 14} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {fmt(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let acc = 0;
            const segs = series.map((s) => ({ ...s, v: d[s.key] || 0 })).filter((s) => s.v > 0);
            return (
              <g
                key={d.t}
                className={`viz-col ${hover === i ? 'is-hover' : ''}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={totals[i] ? 0 : -1}
              >
                <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH} fill="transparent" />
                {segs.map((s, k) => {
                  const y0 = y(acc);
                  acc += s.v;
                  const y1 = y(acc);
                  const isTop = k === segs.length - 1;
                  const h = Math.max(1, y0 - y1 - (k > 0 ? GAP : 0));
                  const yTop = y1;
                  const r = isTop ? Math.min(4, h, barW / 2) : 0;
                  const xL = cx - barW / 2;
                  const d2 = r
                    ? `M${xL},${yTop + h}V${yTop + r}Q${xL},${yTop} ${xL + r},${yTop}H${xL + barW - r}Q${xL + barW},${yTop} ${xL + barW},${yTop + r}V${yTop + h}Z`
                    : `M${xL},${yTop + h}V${yTop}H${xL + barW}V${yTop + h}Z`;
                  return <path key={s.key} d={d2} fill={s.color} />;
                })}
                {i === maxIndex && totals[i] > 0 && (
                  <text className="viz-end" x={cx} y={y(totals[i]) - 6} textAnchor="middle">
                    {fmt(totals[i])}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text className="viz-tick" x={cx} y={height - 8} textAnchor="middle">
                    {fmtT(d.t)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && totals[hover] > 0 && (
        <Tooltip
          x={PAD.left + band * hover + band / 2}
          y={Math.max(PAD.top, y(totals[hover]) - 40)}
          width={w}
          title={fmtT(data[hover].t)}
          rows={[
            ...series.map((s) => ({ label: s.label, color: s.color, value: fmt(data[hover][s.key] || 0) })),
          ]}
        />
      )}
    </div>
  );
}

/** horizontal bars with the value at the tip */
export function HBars({ items, lang = 'en' }) {
  const fmt = fmtNum(lang);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="viz-hbars">
      {items.map((it) => (
        <li key={it.key} title={`${it.label}: ${fmt(it.value)}`}>
          <span className="viz-hbar-label">{it.label}</span>
          <span className="viz-hbar-track">
            <span className="viz-hbar" style={{ width: `${Math.max(it.value ? 1.5 : 0, (it.value / max) * 100)}%`, background: it.color }} />
            <span className="viz-hbar-value">{fmt(it.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({ label, value, sub, icon, tone }) {
  return (
    <div className={`stat-tile admin-tile ${tone || ''}`}>
      {icon}
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}
