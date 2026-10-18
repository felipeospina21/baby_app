"use client";

/**
 * Pure-SVG charts for the nap dashboard, matching the night charts' look and
 * the tap-to-select interaction (mobile has no hover). All metrics come from
 * `nap-analytics`; these components are presentation-only.
 *
 * Charts aggregate per local day over a trailing window, so empty days render
 * as gaps. Tapping a day selects it and shows a detail panel below.
 */

import { useState } from "react";

import { formatDuration, formatTime } from "./nap-utils";
import { formatDayShort, type NapDayPoint } from "./nap-analytics";

// Shared geometry (SVG user units; actual size comes from CSS via viewBox).
const WIDTH = 360;
const HEIGHT = 200;
const PAD_X = 28;
const PAD_TOP = 16;
const PAD_BOTTOM = 30;
const PLOT_W = WIDTH - PAD_X * 2;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const BASELINE = PAD_TOP + PLOT_H;

/** A palette for stacked nap segments (cycles if a day has many naps). */
const NAP_COLORS = [
  "fill-teal-400",
  "fill-emerald-400",
  "fill-cyan-400",
  "fill-green-400",
  "fill-lime-400",
];

function niceHoursCeil(ms: number): number {
  return Math.max(1, Math.ceil(ms / 3_600_000));
}

/** Evenly spaced band layout: x-center, bar width, and slot width for N bars. */
function band(index: number, count: number) {
  const slot = PLOT_W / Math.max(1, count);
  const barWidth = Math.min(28, slot * 0.6);
  const center = PAD_X + slot * (index + 0.5);
  return { center, barWidth, slot };
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-center text-sm text-white/50">
      {label}
    </div>
  );
}

/**
 * Sparse day-axis label: with a 14-day window, labelling every day is noisy, so
 * only show roughly every other label plus the selected one. Rotated for fit.
 */
function DayTick({
  x,
  text,
  show,
  active,
}: {
  x: number;
  text: string;
  show: boolean;
  active: boolean;
}) {
  if (!show && !active) return null;
  return (
    <text
      x={x}
      y={HEIGHT - 8}
      textAnchor="middle"
      className={active ? "fill-white" : "fill-white/40"}
      fontSize={8}
      fontWeight={active ? 600 : 400}
    >
      {text}
    </text>
  );
}

function HourGrid({
  topHours,
  scale,
}: {
  topHours: number;
  scale: (ms: number) => number;
}) {
  // Avoid cramming gridlines when the top is large; step to keep ~<=6 lines.
  const step = Math.ceil(topHours / 6);
  const lines: number[] = [];
  for (let h = 0; h <= topHours; h += step) lines.push(h);
  return (
    <>
      {lines.map((h) => {
        const y = BASELINE - scale(h * 3_600_000);
        return (
          <g key={h}>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y}
              y2={y}
              className="stroke-white/10"
              strokeWidth={1}
            />
            <text
              x={PAD_X - 4}
              y={y + 3}
              textAnchor="end"
              className="fill-white/30"
              fontSize={8}
            >
              {h}h
            </text>
          </g>
        );
      })}
    </>
  );
}

function HitArea({
  center,
  slot,
  label,
  selected,
  onSelect,
}: {
  center: number;
  slot: number;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const w = Math.min(slot, 40);
  return (
    <rect
      x={center - w / 2}
      y={PAD_TOP}
      width={w}
      height={PLOT_H}
      fill="transparent"
      className="cursor-pointer outline-none [&:focus-visible]:stroke-white/60"
      strokeWidth={1}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    />
  );
}

/** Shared detail panel for a selected nap day. */
function DayDetail({ point }: { point: NapDayPoint }) {
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold text-white/80">
          {formatDayShort(point.date)}
        </p>
        <p className="text-xs text-white/50">
          {point.napCount} nap{point.napCount === 1 ? "" : "s"} ·{" "}
          {formatDuration(point.totalMs)} total
        </p>
      </div>
      {point.napCount === 0 ? (
        <p className="mt-1 text-xs text-white/40">No naps this day.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-white/70">
          {point.naps.map((n, i) => (
            <li key={n.id} className="flex justify-between">
              <span>
                Nap #{i + 1} · {formatTime(n.start)} – {formatTime(n.end)}
              </span>
              <span className="tabular-nums text-white/50">
                {formatDuration(n.durationMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Chart 1 — total nap time per day, stacked by individual nap so you can see
 * both the day's total (bar height) and how it split across naps. Nap count is
 * labelled above each bar.
 */
export function NapTotalsChart({ data }: { data: NapDayPoint[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  if (data.every((d) => d.napCount === 0))
    return <EmptyState label="No finished naps to chart yet." />;

  const maxMs = Math.max(...data.map((d) => d.totalMs), 1);
  const topHours = niceHoursCeil(maxMs);
  const topMs = topHours * 3_600_000;
  const scale = (ms: number) => (ms / topMs) * PLOT_H;
  const hasSelection = selectedDay !== null;
  const selected = data.find((d) => d.day === selectedDay) ?? null;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-manipulation"
        role="img"
        aria-label="Total nap time per day, stacked by individual nap, with nap counts. Tap a bar for details."
      >
        <HourGrid topHours={topHours} scale={scale} />

        {data.map((d, i) => {
          const { center, barWidth, slot } = band(i, data.length);
          const x = center - barWidth / 2;
          const isSel = d.day === selectedDay;
          const dim = hasSelection && !isSel ? 0.4 : 1;

          // Stack the day's naps from the baseline up.
          let cursorY = BASELINE;
          const segments = d.naps.map((n, idx) => {
            const h = scale(n.durationMs);
            cursorY -= h;
            return { y: cursorY, h, color: NAP_COLORS[idx % NAP_COLORS.length] };
          });
          const topY = cursorY;

          return (
            <g key={d.day} opacity={dim}>
              {segments.map((s, idx) => (
                <rect
                  key={idx}
                  x={x}
                  y={s.y}
                  width={barWidth}
                  height={s.h}
                  rx={1.5}
                  className={s.color}
                  stroke="#0f0f23"
                  strokeWidth={0.5}
                />
              ))}
              {isSel && d.napCount > 0 && (
                <rect
                  x={x - 2}
                  y={topY - 2}
                  width={barWidth + 4}
                  height={BASELINE - topY + 4}
                  rx={3}
                  fill="none"
                  className="stroke-white"
                  strokeWidth={1.5}
                />
              )}
              {d.napCount > 0 && (
                <text
                  x={center}
                  y={topY - 4}
                  textAnchor="middle"
                  className="fill-white/70"
                  fontSize={9}
                  fontWeight={600}
                >
                  {d.napCount}
                </text>
              )}
              <DayTick
                x={center}
                text={formatDayShort(d.date)}
                show={i % 2 === data.length % 2}
                active={isSel}
              />
              <HitArea
                center={center}
                slot={slot}
                label={`${formatDayShort(d.date)}: ${formatDuration(d.totalMs)} total, ${d.napCount} naps`}
                selected={isSel}
                onSelect={() => setSelectedDay(isSel ? null : d.day)}
              />
            </g>
          );
        })}
      </svg>

      {selected ? (
        <DayDetail point={selected} />
      ) : (
        <figcaption className="mt-2 text-center text-xs text-white/40">
          Bar height = total nap time · number = naps · tap a day for details
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Chart 2 — average nap length per day (bar height) with the nap count labelled
 * above each bar. Reveals whether naps are getting longer/fewer over time.
 */
export function NapAvgChart({ data }: { data: NapDayPoint[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  if (data.every((d) => d.napCount === 0))
    return <EmptyState label="No finished naps to chart yet." />;

  const maxMs = Math.max(...data.map((d) => d.avgMs), 1);
  const topHours = niceHoursCeil(maxMs);
  const topMs = topHours * 3_600_000;
  const scale = (ms: number) => (ms / topMs) * PLOT_H;
  const hasSelection = selectedDay !== null;
  const selected = data.find((d) => d.day === selectedDay) ?? null;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-manipulation"
        role="img"
        aria-label="Average nap length per day, with nap counts. Tap a bar for details."
      >
        <HourGrid topHours={topHours} scale={scale} />

        {data.map((d, i) => {
          const { center, barWidth, slot } = band(i, data.length);
          const x = center - barWidth / 2;
          const h = scale(d.avgMs);
          const y = BASELINE - h;
          const isSel = d.day === selectedDay;
          const dim = hasSelection && !isSel ? 0.4 : 1;
          return (
            <g key={d.day} opacity={dim}>
              {d.napCount > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  rx={2}
                  className="fill-teal-400"
                />
              )}
              {isSel && d.napCount > 0 && (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width={barWidth + 4}
                  height={BASELINE - y + 4}
                  rx={3}
                  fill="none"
                  className="stroke-white"
                  strokeWidth={1.5}
                />
              )}
              {d.napCount > 0 && (
                <text
                  x={center}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-white/70"
                  fontSize={9}
                  fontWeight={600}
                >
                  {d.napCount}
                </text>
              )}
              <DayTick
                x={center}
                text={formatDayShort(d.date)}
                show={i % 2 === data.length % 2}
                active={isSel}
              />
              <HitArea
                center={center}
                slot={slot}
                label={`${formatDayShort(d.date)}: avg ${formatDuration(d.avgMs)}, ${d.napCount} naps`}
                selected={isSel}
                onSelect={() => setSelectedDay(isSel ? null : d.day)}
              />
            </g>
          );
        })}
      </svg>

      {selected ? (
        <DayDetail point={selected} />
      ) : (
        <figcaption className="mt-2 text-center text-xs text-white/40">
          Bar height = average nap length · number = naps · tap a day for details
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Chart 3 — average awake time *between* naps per day (bar height). Only days
 * with ≥2 naps have a measurable gap; single-nap/empty days render no bar. The
 * number of gaps (naps − 1) is labelled above each bar.
 */
export function NapBetweenChart({ data }: { data: NapDayPoint[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  if (data.every((d) => d.avgBetweenMs === 0))
    return (
      <EmptyState label="Need at least two naps in a day to measure the gap." />
    );

  const maxMs = Math.max(...data.map((d) => d.avgBetweenMs), 1);
  const topHours = niceHoursCeil(maxMs);
  const topMs = topHours * 3_600_000;
  const scale = (ms: number) => (ms / topMs) * PLOT_H;
  const hasSelection = selectedDay !== null;
  const selected = data.find((d) => d.day === selectedDay) ?? null;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-manipulation"
        role="img"
        aria-label="Average awake time between naps per day. Tap a bar for details."
      >
        <HourGrid topHours={topHours} scale={scale} />

        {data.map((d, i) => {
          const { center, barWidth, slot } = band(i, data.length);
          const x = center - barWidth / 2;
          const has = d.avgBetweenMs > 0;
          const h = scale(d.avgBetweenMs);
          const y = BASELINE - h;
          const isSel = d.day === selectedDay;
          const dim = hasSelection && !isSel ? 0.4 : 1;
          const gaps = Math.max(0, d.napCount - 1);
          return (
            <g key={d.day} opacity={dim}>
              {has && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  rx={2}
                  className="fill-violet-400"
                />
              )}
              {isSel && has && (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width={barWidth + 4}
                  height={BASELINE - y + 4}
                  rx={3}
                  fill="none"
                  className="stroke-white"
                  strokeWidth={1.5}
                />
              )}
              {has && (
                <text
                  x={center}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-white/70"
                  fontSize={9}
                  fontWeight={600}
                >
                  {gaps}
                </text>
              )}
              <DayTick
                x={center}
                text={formatDayShort(d.date)}
                show={i % 2 === data.length % 2}
                active={isSel}
              />
              <HitArea
                center={center}
                slot={slot}
                label={`${formatDayShort(d.date)}: avg ${formatDuration(d.avgBetweenMs)} between naps, ${gaps} gap${gaps === 1 ? "" : "s"}`}
                selected={isSel}
                onSelect={() => setSelectedDay(isSel ? null : d.day)}
              />
            </g>
          );
        })}
      </svg>

      {selected ? (
        <DayDetail point={selected} />
      ) : (
        <figcaption className="mt-2 text-center text-xs text-white/40">
          Bar height = avg awake time between naps · number = gaps · tap a day
          for details
        </figcaption>
      )}
    </figure>
  );
}

// --- Timeline ---------------------------------------------------------------

const TL_PAD_L = 44; // room for day labels
const TL_PAD_R = 8;
const TL_PAD_TOP = 18; // room for hour axis
const TL_ROW_H = 16;
const TL_ROW_GAP = 4;
const TL_DAY_START = 6; // chart spans 6:00 .. 22:00 (typical waking day)
const TL_DAY_END = 22;

/**
 * Nap timeline — one row per day, each nap drawn as a horizontal bar positioned
 * by clock time (6:00–22:00). Reveals the daily rhythm: when naps happen, not
 * just how long. Tap a nap to select its day and see details.
 */
export function NapTimeline({ data }: { data: NapDayPoint[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  if (data.every((d) => d.napCount === 0))
    return <EmptyState label="No finished naps to chart yet." />;

  const hoursSpan = TL_DAY_END - TL_DAY_START;
  const width = WIDTH;
  const plotW = width - TL_PAD_L - TL_PAD_R;
  const rows = data.length;
  const height = TL_PAD_TOP + rows * (TL_ROW_H + TL_ROW_GAP);

  /** Fraction (0..1) of the visible day for a given Date's local clock time. */
  const xFrac = (date: Date) => {
    const hrs = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const clamped = Math.min(TL_DAY_END, Math.max(TL_DAY_START, hrs));
    return (clamped - TL_DAY_START) / hoursSpan;
  };
  const xPos = (date: Date) => TL_PAD_L + xFrac(date) * plotW;

  const selected = data.find((d) => d.day === selectedDay) ?? null;
  const hourTicks = [6, 9, 12, 15, 18, 21];

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-manipulation"
        role="img"
        aria-label="Nap timeline: when naps occur each day between 6am and 10pm. Tap a nap for details."
      >
        {/* Hour axis + vertical gridlines. */}
        {hourTicks.map((h) => {
          const x = TL_PAD_L + ((h - TL_DAY_START) / hoursSpan) * plotW;
          const label = h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
          return (
            <g key={h}>
              <line
                x1={x}
                x2={x}
                y1={TL_PAD_TOP}
                y2={height}
                className="stroke-white/10"
                strokeWidth={1}
              />
              <text
                x={x}
                y={12}
                textAnchor="middle"
                className="fill-white/30"
                fontSize={8}
              >
                {label}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const rowY = TL_PAD_TOP + i * (TL_ROW_H + TL_ROW_GAP);
          const isSel = d.day === selectedDay;
          const barY = rowY + 2;
          const barH = TL_ROW_H - 4;
          return (
            <g key={d.day} opacity={selectedDay && !isSel ? 0.45 : 1}>
              {/* Day label (show every other to reduce clutter). */}
              {(i % 2 === data.length % 2 || isSel) && (
                <text
                  x={TL_PAD_L - 6}
                  y={rowY + TL_ROW_H / 2 + 3}
                  textAnchor="end"
                  className={isSel ? "fill-white" : "fill-white/40"}
                  fontSize={8}
                  fontWeight={isSel ? 600 : 400}
                >
                  {formatDayShort(d.date)}
                </text>
              )}
              {/* Row baseline. */}
              <line
                x1={TL_PAD_L}
                x2={width - TL_PAD_R}
                y1={rowY + TL_ROW_H / 2}
                y2={rowY + TL_ROW_H / 2}
                className="stroke-white/5"
                strokeWidth={TL_ROW_H}
              />
              {/* Nap bars. */}
              {d.naps.map((n, idx) => {
                const nx = xPos(n.start);
                const nw = Math.max(2, xPos(n.end) - nx);
                return (
                  <rect
                    key={n.id}
                    x={nx}
                    y={barY}
                    width={nw}
                    height={barH}
                    rx={2}
                    className={NAP_COLORS[idx % NAP_COLORS.length]}
                  />
                );
              })}
              {/* Full-row hit area for selection. */}
              {d.napCount > 0 && (
                <rect
                  x={TL_PAD_L}
                  y={rowY}
                  width={width - TL_PAD_L - TL_PAD_R}
                  height={TL_ROW_H}
                  fill="transparent"
                  className="cursor-pointer outline-none [&:focus-visible]:stroke-white/60"
                  strokeWidth={1}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSel}
                  aria-label={`${formatDayShort(d.date)}: ${d.napCount} naps`}
                  onClick={() => setSelectedDay(isSel ? null : d.day)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedDay(isSel ? null : d.day);
                    }
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {selected ? (
        <DayDetail point={selected} />
      ) : (
        <figcaption className="mt-2 text-center text-xs text-white/40">
          Each row is a day · bars show when naps happened · tap a row for
          details
        </figcaption>
      )}
    </figure>
  );
}
