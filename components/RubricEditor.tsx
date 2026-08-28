/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useMemo } from "react";
import {
  RUBRIC_PRESETS,
  RUBRIC_TOTAL,
  bandWeight,
  rubricErrors,
  rubricTotal,
  type RubricBand,
  type RubricConfig,
} from "@/lib/rubric";

/**
 * The rubric a quiz's written answers are marked against.
 *
 * Weights are percentages and must add up to 100 — which is what lets one
 * rubric mark a 5-mark paragraph and a 40-mark essay without rewriting it. The
 * running total is shown at all times rather than only complained about on
 * save, because a teacher moving weight between bands wants to see the balance
 * as they go.
 */
export default function RubricEditor({
  value,
  onChange,
  heading = "Rubric",
  note,
}: {
  value: RubricConfig;
  onChange: (next: RubricConfig) => void;
  heading?: string;
  note?: string;
}) {
  const total = rubricTotal(value);
  const errors = useMemo(() => rubricErrors(value), [value]);
  const off = Math.round((RUBRIC_TOTAL - total) * 10) / 10;

  const setBands = (bands: RubricBand[]) => onChange({ bands });

  const patchBand = (bandIndex: number, patch: Partial<RubricBand>) =>
    setBands(value.bands.map((b, i) => (i === bandIndex ? { ...b, ...patch } : b)));

  const patchParam = (bandIndex: number, paramIndex: number, patch: Partial<RubricBand["params"][number]>) =>
    patchBand(bandIndex, {
      params: value.bands[bandIndex].params.map((p, j) => (j === paramIndex ? { ...p, ...patch } : p)),
    });

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{heading}</p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            errors.length ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
          }`}
        >
          {total}% of {RUBRIC_TOTAL}
          {off !== 0 ? ` · ${off > 0 ? "add" : "remove"} ${Math.abs(off)}` : " ✓"}
        </span>
      </div>
      {note && <p className="text-xs text-slate-500">{note}</p>}

      <div className="flex flex-wrap gap-2">
        {RUBRIC_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(p.config)}
            title={p.description}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            {p.name}
          </button>
        ))}
      </div>

      {value.bands.map((band, bi) => (
        <div key={band.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={band.label}
              onChange={(e) => patchBand(bi, { label: e.target.value })}
              placeholder="Band, e.g. Content & Correctness"
              className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
            />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              {bandWeight(band)}%
            </span>
            <button
              onClick={() => setBands(value.bands.filter((_, i) => i !== bi))}
              disabled={value.bands.length < 2}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Remove band
            </button>
          </div>

          <div className="mt-2 space-y-1.5">
            {band.params.map((param, pi) => (
              <div key={param.id} className="flex flex-wrap items-center gap-2">
                <input
                  value={param.label}
                  onChange={(e) => patchParam(bi, pi, { label: e.target.value })}
                  placeholder="Parameter"
                  className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <label className="text-xs text-slate-500">
                  weight
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={param.weight}
                    onChange={(e) => patchParam(bi, pi, { weight: Number(e.target.value) || 0 })}
                    className="ml-1.5 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                  />
                </label>
                <button
                  onClick={() => patchBand(bi, { params: band.params.filter((_, j) => j !== pi) })}
                  disabled={band.params.length < 2}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  aria-label={`Remove ${param.label}`}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                patchBand(bi, {
                  params: [...band.params, { id: `${band.id}${Date.now()}`, label: "", weight: 0 }],
                })
              }
              disabled={band.params.length >= 10}
              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              Add parameter
            </button>
          </div>
        </div>
      ))}

      <button
        onClick={() =>
          setBands([
            ...value.bands,
            {
              id: `b${Date.now()}`,
              label: "",
              params: [{ id: `p${Date.now()}`, label: "", weight: 0 }],
            },
          ])
        }
        disabled={value.bands.length >= 8}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
      >
        Add band
      </button>

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
