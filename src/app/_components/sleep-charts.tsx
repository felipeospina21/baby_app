"use client";

/**
 * Pure-SVG bar charts for the night-sleep dashboard. No chart dependency: each
 * chart renders a `viewBox`-scaled SVG so it stays crisp and responsive on
 * mobile. Charts are presentation-only — all metrics come from
 * `sleep-analytics`.
 *
 * Mobile has no hover, so details are revealed by *tapping* a bar: each bar has
 * a full-height transparent hit area; tapping selects the night (tap again to
 * deselect) and renders a detail panel below the chart. The hit areas are
 * focusable for keyboard/switch access.
 */

import { useState } from "react";

import { formatDay, formatDuration } from "./nap-utils";
import type { NightPoint } from "./sleep-analytics";

// Shared geometry (SVG user units; actual size comes from CSS via viewBox).
const WIDTH = 360;
const HEIGHT = 200;
const PAD_X = 28;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const PLOT_W = WIDTH - PAD_X * 2;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const BASELINE = PAD_TOP + PLOT_H;

/** Round a duration (ms) up to a "nice" hour so the axis top isn't ragged. */
function niceHoursCeil(ms: number): number {
  const hours = ms / 3_600_000;
  return Math.max(1, Math.ceil(hours));
}

/** Evenly spaced band layout: returns the x-center, width, and slot for N bars. */
function band(index: number, count: number) {
  const slot = PLOT_W / Math.max(1, count);
  const barWidth = Math.min(36, slot * 0.6);
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

function AxisLabel({
  x,
  text,
  active,
}: {
  x: number;
  text: string;
  active: boolean;
}) {
  return (
    <text
      x={x}
      y={HEIGHT - 10}
      textAnchor="middle"
      className={active ? "fill-white" : "fill-white/40"}
      fontSize={9}
      fontWeight={active ? 600 : 400}
    >
      {text}
    </text>
  );
}

/** y-axis hour gridlines shared by both charts. */
function HourGrid({
  topHours,
  scale,
}: {
  topHours: number;
  scale: (ms: number) => number;
}) {
  return (
    <>
      {Array.from({ length: topHours + 1 }, (_, h) => {
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

/**
 * A full-height transparent tap/focus target for a bar's column. Larger than
 * the visible bar so it's an easy touch target on mobile.
 */
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
  const w = Math.min(slot, 44);
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

/**
 * Chart 1 — total night time per night, split into asleep (base) and awake
 * (top) segments as a stacked bar. The wake-up count is labelled above each
 * bar. Tap a bar to see that night's breakdown below.
 */
export function NightDurationChart({ data }: { data: NightPoint[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (data.length === 0)
    return <EmptyState label="No finished nights to chart yet." />;

  const maxMs = Math.max(...data.map((d) => d.totalMs), 1);
  const topHours = niceHoursCeil(maxMs);
  const topMs = topHours * 3_600_000;
  const scale = (ms: number) => (ms / topMs) * PLOT_H;
  const hasSelection = selectedId !== null;
  const selected = data.find((d) => d.id === selectedId) ?? null;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-manipulation"
        role="img"
        aria-label="Total sleep time per night, split into asleep and awake time, with wake-up counts. Tap a bar for details."
      >
        <HourGrid topHours={topHours} scale={scale} />

        {data.map((d, i) => {
          const { center, barWidth, slot } = band(i, data.length);
          const x = center - barWidth / 2;
          const asleepH = scale(d.asleepMs);
          const awakeH = scale(d.awakeMs);
          const asleepY = BASELINE - asleepH;
          const awakeY = asleepY - awakeH;
          const isSel = d.id === selectedId;
          const dim = hasSelection && !isSel ? 0.4 : 1;
          return (
            <g key={d.id} opacity={dim}>
              {/* asleep (base) */}
              <rect
                x={x}
                y={asleepY}
                width={barWidth}
                height={asleepH}
                rx={2}
                className="fill-indigo-400"
              />
              {/* awake (stacked on top) */}
              {d.awakeMs > 0 && (
                <rect
                  x={x}
                  y={awakeY}
                  width={barWidth}
                  height={awakeH}
                  rx={2}
                  className="fill-amber-400"
                />
              )}
              {/* selection outline */}
              {isSel && (
                <rect
                  x={x - 2}
                  y={awakeY - 2}
                  width={barWidth + 4}
                  height={BASELINE - awakeY + 4}
                  rx={3}
                  fill="none"
                  className="stroke-white"
                  strokeWidth={1.5}
                />
              )}
              {/* wake-up count badge */}
              <text
                x={center}
                y={awakeY - 4}
                textAnchor="middle"
                className="fill-white/70"
                fontSize={9}
                fontWeight={600}
              >
                {d.wakeCount}
              </text>
              <AxisLabel x={center} text={formatDay(d.start)} active={isSel} />
              <HitArea
                center={center}
                slot={slot}
                label={`${formatDay(d.start)}: ${formatDuration(d.totalMs)} total, ${d.wakeCount} wake-ups`}
                selected={isSel}
                onSelect={() => setSelectedId(isSel ? null : d.id)}
              />
            </g>
          );
        })}
      </svg>

      {selected ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <p className="font-semibold text-white/80">
            {formatDay(selected.start)}
          </p>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/60">
            <dt>Total night</dt>
            <dd className="text-right tabular-nums text-white/80">
              {formatDuration(selected.totalMs)}
            </dd>
            <dt>Asleep</dt>
            <dd className="text-right tabular-nums text-indigo-300">
              {formatDuration(selected.asleepMs)}
            </dd>
            <dt>Awake</dt>
            <dd className="text-right tabular-nums text-amber-300">
              {formatDuration(selected.awakeMs)}
            </dd>
            <dt>Wake-ups</dt>
            <dd className="text-right tabular-nums text-white/80">
              {selected.wakeCount}
            </dd>
          </dl>
        </div>
      ) : (
        <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-white/50">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-indigo-400" />
            Asleep
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-amber-400" />
            Awake
          </span>
          <span className="text-white/40">tap a bar for details</span>
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Chart 2 — average asleep stretch ("time between awakes") per night as the bar
 * height, with the total number of wake-ups labelled above each bar. Tap a bar
 * to see that night's numbers below.
 */
export function NightAwakesChart({ data }: { data: NightPoint[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (data.length === 0)
    return <EmptyState label="No finished nights to chart yet." />;

  const maxMs = Math.max(...data.map((d) => d.avgBetweenAwakesMs), 1);
  const topHours = niceHoursCeil(maxMs);
  const topMs = topHours * 3_600_000;
  const scale = (ms: number) => (ms / topMs) * PLOT_H;
  const hasSelection = selectedId !== null;
  const selected = data.find((d) => d.id === selectedId) ?? null;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-manipulation"
        role="img"
        aria-label="Average time asleep between wake-ups per night, with total wake-up counts. Tap a bar for details."
      >
        <HourGrid topHours={topHours} scale={scale} />

        {data.map((d, i) => {
          const { center, barWidth, slot } = band(i, data.length);
          const x = center - barWidth / 2;
          const h = scale(d.avgBetweenAwakesMs);
          const y = BASELINE - h;
          const isSel = d.id === selectedId;
          const dim = hasSelection && !isSel ? 0.4 : 1;
          return (
            <g key={d.id} opacity={dim}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                rx={2}
                className="fill-sky-400"
              />
              {isSel && (
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
              {/* total awakes badge */}
              <text
                x={center}
                y={y - 4}
                textAnchor="middle"
                className="fill-white/70"
                fontSize={9}
                fontWeight={600}
              >
                {d.wakeCount}
              </text>
              <AxisLabel x={center} text={formatDay(d.start)} active={isSel} />
              <HitArea
                center={center}
                slot={slot}
                label={`${formatDay(d.start)}: avg ${formatDuration(d.avgBetweenAwakesMs)} between awakes, ${d.wakeCount} wake-ups`}
                selected={isSel}
                onSelect={() => setSelectedId(isSel ? null : d.id)}
              />
            </g>
          );
        })}
      </svg>

      {selected ? (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <p className="font-semibold text-white/80">
            {formatDay(selected.start)}
          </p>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/60">
            <dt>Avg between awakes</dt>
            <dd className="text-right tabular-nums text-sky-300">
              {formatDuration(selected.avgBetweenAwakesMs)}
            </dd>
            <dt>Total awakes</dt>
            <dd className="text-right tabular-nums text-white/80">
              {selected.wakeCount}
            </dd>
            <dt>Asleep</dt>
            <dd className="text-right tabular-nums text-white/80">
              {formatDuration(selected.asleepMs)}
            </dd>
          </dl>
        </div>
      ) : (
        <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-white/50">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-sky-400" />
            Avg time between awakes
          </span>
          <span className="text-white/40">tap a bar for details</span>
        </figcaption>
      )}
    </figure>
  );
}
