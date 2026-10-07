import { describe, it, expect } from 'vitest';
import { simulateOne } from './simulation';
import { presetToRates } from './params';
import type { Region, Edge } from './types';

function toy(): { regions: Region[]; edges: Edge[] } {
  const mk = (id: string, pop: number): Region => ({
    id, name: id, parentUnit: id, population: pop, areaKm2: 1000, density: pop / 1000,
    centroid: [0, 0], isIsland: false, isRemote: false, airports: [], inW: 0, outW: 0, point: true, geom: null,
  });
  const regions = [mk('A', 1e6), mk('B', 5e5), mk('C', 1e4)];
  const edges: Edge[] = [
    { s: 0, d: 1, w: 50, t: 0 },
    { s: 1, d: 0, w: 50, t: 0 },
  ];
  return { regions, edges };
}

const base = {
  betaAir: 0.3, betaContact: 0.2, sigma: 0.667, gamma: 0.244, mu: 0.006,
  m: 1, kDensity: 0, superspreading: false, kSuperspread: 0.2,
  dt: 0.25, durationDays: 60, seed: 42, seedRegion: 0, startExposed: 10,
  quarantined: [] as number[], rhoMedian: 500,
};

describe('conservation', () => {
  it('S+E+I+R+D = N per region at end and global constant', () => {
    const { regions, edges } = toy();
    const r = simulateOne({ ...base }, { regions, edges });
    const tot0 = regions.reduce((a, x) => a + x.population, 0);
    const tot1 = r.S[r.S.length - 1] + r.E[r.E.length - 1] + r.I[r.I.length - 1] + r.R[r.R.length - 1] + r.D[r.D.length - 1];
    expect(Math.abs(tot1 - tot0) / tot0).toBeLessThan(1e-6);
    // per-region final sums equal N (balanced travel)
    for (let i = 0; i < regions.length; i++) {
      const rec = r.recSeries?.[i];
      if (rec) {
        const k = rec.S.length - 1;
        const s = rec.S[k] + rec.E[k] + rec.I[k] + rec.R[k] + rec.D[k];
        expect(Math.abs(s - regions[i].population) / regions[i].population).toBeLessThan(1e-6);
      } else {
        const s = r.summaries[i];
        // attack - dead = recovered proportion sanity
        expect(s.finalAttack).toBeGreaterThanOrEqual(s.finalDead - 1e-9);
      }
    }
  });
  it('no negative or oversized compartments', () => {
    const { regions, edges } = toy();
    const r = simulateOne({ ...base, seed: 1, durationDays: 120 }, { regions, edges }, undefined, [0, 1, 2]);
    for (const k of [0, 1, 2]) {
      const s = r.recSeries?.[k];
      if (!s) continue;
      for (let d = 0; d < s.S.length; d++) {
        for (const v of [s.S[d], s.E[d], s.I[d], s.R[d], s.D[d]]) {
          expect(v).toBeGreaterThanOrEqual(-1e-6);
          expect(v).toBeLessThanOrEqual(regions[k].population + 1e-6);
        }
      }
    }
    for (const g of [...r.S, ...r.E, ...r.I, ...r.R, ...r.D]) expect(g).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe('isolation', () => {
  it('region with no links is never infected unless seed', () => {
    const { regions, edges } = toy();
    for (let trial = 0; trial < 5; trial++) {
      const r = simulateOne({ ...base, seed: 100 + trial, seedRegion: 0 }, { regions, edges });
      expect(r.summaries[2].arrival).toBe(-1);
    }
    const r2 = simulateOne({ ...base, seedRegion: 2 }, { regions, edges });
    expect(r2.summaries[2].arrival).toBe(0);
  });
});

describe('preset conversion', () => {
  it('matches spec table (1918, covid ancestral, measles)', () => {
    const f1918 = presetToRates({ R0: 2.0, L: 1.5, T: 4, p: 0.025, a: 0.6 });
    expect(f1918.sigma).toBeCloseTo(0.667, 2);
    expect(f1918.gamma).toBeCloseTo(0.244, 2);
    expect(f1918.mu).toBeCloseTo(0.0063, 3);
    expect(f1918.betaAir + f1918.betaContact).toBeCloseTo(0.5, 3);
    const cov = presetToRates({ R0: 2.5, L: 4, T: 7, p: 0.007, a: 0.6 });
    expect(cov.sigma).toBeCloseTo(0.25, 3);
    expect(cov.betaAir + cov.betaContact).toBeCloseTo(0.357, 2);
    const mea = presetToRates({ R0: 15, L: 10, T: 8, p: 0.002, a: 0.9 });
    expect(mea.betaAir + mea.betaContact).toBeCloseTo(1.875, 3);
  });
});
