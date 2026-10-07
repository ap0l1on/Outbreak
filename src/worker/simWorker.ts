import type { Edge, Region, SimParams } from '../model/types';
import { simulateOne } from '../model/simulation';
import { wilsonCI, quartiles, mean } from '../model/stats';

export interface SweepConfig {
  kind: 'm' | 'L' | 'gamma' | 'mu';
  values: number[];
  runsPer: number;
  baseParams: SimParams;
  islandIdx: number[];
  baseSeed: number;
}

export interface SweepIslandStat {
  island: number;
  m?: number;
  value?: number;
  prob: number;
  ci: [number, number];
  arrivals: number[];
  medArrival: number;
  q1: number;
  q3: number;
  meanPeakI: number;
  meanDead: number;
}

export interface ProgressMsg { type: 'progress'; id: number; frac: number; label: string; day?: number; global?: number[]; regionI?: number[]; arrivals?: number[]; }
export interface DoneMsg { type: 'done'; id: number; result: unknown; }

let regions: Region[] = [];
let edges: Edge[] = [];
let loaded = false;

async function ensureData(base: string) {
  if (loaded) return;
  const [r, e] = await Promise.all([
    fetch(`${base}data/regions.json`).then((x) => x.json()),
    fetch(`${base}data/edges.json`).then((x) => x.json()),
  ]);
  regions = r.regions; edges = e.edges;
  loaded = true;
}

function paramsWithSweep(base: SimParams, kind: string, value: number): SimParams {
  const p = { ...base, quarantined: [...base.quarantined] };
  if (kind === 'm') p.m = value;
  else if (kind === 'L') p.sigma = 1 / value;
  else if (kind === 'gamma') {
    // vary gamma holding mu fixed
    p.gamma = value;
  } else if (kind === 'mu') {
    p.mu = value;
  }
  return p;
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg.type === 'run') {
      await ensureData(msg.base);
      const params = msg.params as SimParams;
      const islandIdx: number[] = msg.islandIdx ?? [];
      const recordIdx: number[] = [...new Set([...(msg.recordIdx ?? []), ...islandIdx, params.seedRegion])].slice(0, 40);
      const result = simulateOne(params, { regions, edges }, (day, global, regionI, full) => {
        // stream every 5 days to keep UI alive
        if (day % 5 === 0 || day >= params.durationDays) {
          // arrival tracked inside sim only at end; send compartment props
          (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
            type: 'progress', id: msg.id, frac: day / params.durationDays,
            label: `day ${day}`, day, global, regionI: Array.from(regionI),
            full: full ? {
              S: Array.from(full.S), E: Array.from(full.E),
              I: Array.from(full.I), R: Array.from(full.R), D: Array.from(full.D),
            } : undefined,
          });
        }
      }, recordIdx);
      (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: 'done', id: msg.id, result });
    } else if (msg.type === 'sweep') {
      await ensureData(msg.base);
      const cfg = msg.config as SweepConfig;
      const out: SweepIslandStat[][] = [];
      const total = cfg.values.length * cfg.runsPer;
      let done = 0;
      for (const v of cfg.values) {
        const perIsland: SweepIslandStat[] = [];
        // collect arrivals per island across runs
        const hits: number[][] = cfg.islandIdx.map(() => []);
        const peaks: number[][] = cfg.islandIdx.map(() => []);
        const deads: number[][] = cfg.islandIdx.map(() => []);
        const reachedCount: number[] = [];
        for (let r = 0; r < cfg.runsPer; r++) {
          const p = paramsWithSweep(cfg.baseParams, cfg.kind, v);
          p.seed = cfg.baseSeed + r;
          const res = simulateOne(p, { regions, edges });
          cfg.islandIdx.forEach((ri, k) => {
            const s = res.summaries[ri];
            if (s.arrival >= 0 && s.arrival <= p.durationDays) hits[k].push(s.arrival);
            peaks[k].push(res.peakIProp);
            deads[k].push(s.finalDead);
          });
          reachedCount.push(res.reached[res.reached.length - 1] ?? 0);
          done++;
          (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
            type: 'progress', id: msg.id, frac: done / total,
            label: `${cfg.kind}=${v} run ${r + 1}/${cfg.runsPer}`,
          });
        }
        cfg.islandIdx.forEach((ri, k) => {
          const h = hits[k];
          const prob = h.length / cfg.runsPer;
          const ci = wilsonCI(h.length, cfg.runsPer);
          const q = quartiles(h);
          perIsland.push({
            island: ri, value: v, m: cfg.kind === 'm' ? v : undefined,
            prob, ci, arrivals: h,
            medArrival: h.length ? q.med : NaN, q1: q.q1, q3: q.q3,
            meanPeakI: mean(peaks[k]), meanDead: mean(deads[k]),
          });
        });
        out.push(perIsland);
      }
      (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: 'done', id: msg.id, result: out });
    } else if (msg.type === 'ping') {
      (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: 'done', id: msg.id, result: 'pong' });
    }
  } catch (err) {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'done', id: msg.id, result: { error: String(err) },
    });
  }
};
