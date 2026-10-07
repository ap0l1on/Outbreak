import { Rng } from './rng';
import type { Edge, Region, RunResult, SimParams } from './types';

const BIG = 1e4;

export interface SimData {
  regions: Region[];
  edges: Edge[];
}

/** Single stochastic metapopulation SEIRD run. Keeps per-region N constant via balanced travel swaps. */
export function simulateOne(
  params: SimParams,
  data: SimData,
  onDay?: (
    day: number,
    global: [number, number, number, number, number],
    regionI: Float32Array,
    full?: { S: Float32Array; E: Float32Array; I: Float32Array; R: Float32Array; D: Float32Array },
  ) => void,
  recordIdx: number[] = [],
): RunResult & { recSeries?: Record<number, { S: number[]; E: number[]; I: number[]; R: number[]; D: number[] }> } {
  const n = data.regions.length;
  const N = new Float64Array(n);
  const S = new Float64Array(n);
  const E = new Float64Array(n);
  const I = new Float64Array(n);
  const R = new Float64Array(n);
  const D = new Float64Array(n);
  const rho = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(1, data.regions[i].population);
    N[i] = p; S[i] = p;
    rho[i] = data.regions[i].density || 0;
  }
  const rng = new Rng(params.seed);
  const quar = new Uint8Array(n);
  for (const q of params.quarantined) if (q >= 0 && q < n) quar[q] = 1;

  // seed
  const s0 = params.seedRegion;
  const e0 = Math.min(params.startExposed, S[s0]);
  S[s0] -= e0; E[s0] += e0;

  const arrival = new Float64Array(n).fill(-1);
  const source = new Int32Array(n).fill(-1);
  arrival[s0] = 0;
  const peakI = new Float64Array(n);
  const peakDay = new Float64Array(n);
  // track current infected proportion for peak
  const recordPeak = (day: number) => {
    for (let i = 0; i < n; i++) {
      const prop = I[i] / N[i];
      if (prop > peakI[i]) { peakI[i] = prop; peakDay[i] = day; }
    }
  };

  // edge arrays (filter quarantined lazily in loop)
  const es = data.edges;
  const m = params.m;
  const dt = params.dt;
  const stepsPerDay = Math.max(1, Math.round(1 / dt));
  const totalDays = Math.round(params.durationDays);
  const totalSteps = Math.round(params.durationDays / dt);

  const days: number[] = [0];
  const gS: number[] = []; const gE: number[] = []; const gI: number[] = [];
  const gR: number[] = []; const gD: number[] = [];
  const reached: number[] = [];
  const rec: Record<number, { S: number[]; E: number[]; I: number[]; R: number[]; D: number[] }> = {};
  for (const ri of recordIdx) rec[ri] = { S: [], E: [], I: [], R: [], D: [] };
  const sumAll = (a: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const pushDay = (day: number) => {
    gS.push(sumAll(S)); gE.push(sumAll(E)); gI.push(sumAll(I)); gR.push(sumAll(R)); gD.push(sumAll(D));
    let rc = 0;
    for (let i = 0; i < n; i++) if (arrival[i] >= 0) rc++;
    reached.push(rc);
    days.push(day);
    for (const ri of recordIdx) {
      if (ri >= 0 && ri < n) {
        rec[ri].S.push(S[ri]); rec[ri].E.push(E[ri]); rec[ri].I.push(I[ri]); rec[ri].R.push(R[ri]); rec[ri].D.push(D[ri]);
      }
    }
    if (onDay) {
      const ri = new Float32Array(n);
      for (let i = 0; i < n; i++) ri[i] = I[i] / N[i];
      const fS = new Float32Array(n); const fE = new Float32Array(n);
      const fI = new Float32Array(n); const fR = new Float32Array(n); const fD = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const Ni = N[i] || 1;
        fS[i] = S[i] / Ni; fE[i] = E[i] / Ni; fI[i] = I[i] / Ni; fR[i] = R[i] / Ni; fD[i] = D[i] / Ni;
      }
      onDay(day, [gS[gS.length-1], gE[gE.length-1], gI[gI.length-1], gR[gR.length-1], gD[gD.length-1]], ri, { S: fS, E: fE, I: fI, R: fR, D: fD });
    }
  };

  const betaAir = params.betaAir, betaContact = params.betaContact;
  const { sigma, gamma, mu } = params;
  const rhoMed = Math.max(1e-6, params.rhoMedian);
  const exitRate = gamma + mu;
  const pExit = 1 - Math.exp(-exitRate * dt);
  const pSigma = 1 - Math.exp(-sigma * dt);
  const fracR = exitRate > 0 ? gamma / exitRate : 1;

  let day = 0;
  recordPeak(0);
  for (let step = 0; step < totalSteps; step++) {
    const t = (step + 1) * dt;
    day = t;
    // --- travel (Poisson imports, balanced swap with S to keep N constant) ---
    if (m > 0) {
      for (let k = 0; k < es.length; k++) {
        const e = es[k];
        const j = e.s, i = e.d;
        if (quar[j] || quar[i]) continue;
        const Nj = N[j];
        if (Nj <= 0) continue;
        const Ej = E[j], Ij = I[j];
        if (Ej <= 0 && Ij <= 0) continue;
        const flow = m * e.w * dt;
        let nE = 0, nI = 0;
        if (Ej > 0) {
          const lam = (flow * Ej) / Nj;
          if (lam > 0) nE = rng.poisson(lam);
        }
        if (Ij > 0) {
          const lam = (flow * Ij) / Nj;
          if (lam > 0) nI = rng.poisson(lam);
        }
        if (nE <= 0 && nI <= 0) continue;
        nE = Math.min(nE, E[j]); nI = Math.min(nI, I[j]);
        const tot = nE + nI;
        if (tot <= 0) continue;
        // balanced swap needs S[i] >= tot; clamp
        let move = tot;
        if (S[i] < move) {
          const scale = S[i] / move;
          nE = Math.floor(nE * scale); nI = Math.floor(nI * scale);
          move = nE + nI;
        }
        if (move <= 0) continue;
        E[j] -= nE; I[j] -= nI; S[j] += move;
        S[i] -= move;
        E[i] += nE; I[i] += nI;
        if (arrival[i] < 0 && E[i] + I[i] > 0) { arrival[i] = t; source[i] = j; }
      }
    }
    // --- local SEIRD (tau-leap binomial / deterministic above 1e4) ---
    for (let i = 0; i < n; i++) {
      const Ni = N[i];
      let mult = 1;
      if (params.superspreading && I[i] > 0) {
        mult = rng.gamma(params.kSuperspread, 1 / params.kSuperspread);
      }
      const densF = rhoMed > 0 ? Math.pow(Math.max(0, rho[i]) / rhoMed, params.kDensity) : 1;
      const beta = betaAir * densF * mult + betaContact * mult;
      const lam = (beta * I[i]) / Ni;
      const pInf = lam > 0 ? 1 - Math.exp(-lam * dt) : 0;
      let nSE = 0, nEI = 0, nEx = 0;
      if (pInf > 0 && S[i] > 0 && I[i] > 0) {
        nSE = S[i] > BIG ? S[i] * pInf : rng.binomial(S[i], pInf);
        nSE = Math.min(nSE, S[i]);
      }
      if (E[i] > 0) {
        nEI = E[i] > BIG ? E[i] * pSigma : rng.binomial(E[i], pSigma);
        nEI = Math.min(nEI, E[i]);
      }
      if (I[i] > 0 && pExit > 0) {
        nEx = I[i] > BIG ? I[i] * pExit : rng.binomial(I[i], pExit);
        nEx = Math.min(nEx, I[i]);
      }
      let nR = 0, nD = 0;
      if (nEx > 0) {
        if (nEx > BIG) { nR = nEx * fracR; nD = nEx - nR; }
        else { nR = rng.binomial(nEx, fracR); nD = nEx - nR; }
      }
      S[i] -= nSE; E[i] += nSE - nEI; I[i] += nEI - nEx; R[i] += nR; D[i] += nD;
      if (S[i] < 0) S[i] = 0; if (E[i] < 0) E[i] = 0; if (I[i] < 0) I[i] = 0;
      if (arrival[i] < 0 && E[i] + I[i] + R[i] + D[i] > 0.5 && (nSE > 0 || nEI > 0)) {
        // local first case without recorded import (shouldn't happen except seed); mark
        arrival[i] = t; source[i] = -2;
      }
    }
    recordPeak(t);
    if ((step + 1) % stepsPerDay === 0) pushDay(Math.round(t));
  }

  const summaries = new Array(n);
  for (let i = 0; i < n; i++) {
    summaries[i] = {
      arrival: arrival[i],
      source: source[i],
      peakI: peakI[i],
      peakDay: peakDay[i],
      finalAttack: 1 - S[i] / N[i],
      finalDead: D[i] / N[i],
    };
  }
  let pk = 0, pkd = 0;
  const totN = sumAll(N);
  for (let k = 0; k < gI.length; k++) {
    const p = gI[k] / totN;
    if (p > pk) { pk = p; pkd = days[Math.min(k + 1, days.length - 1)] ?? k; }
  }
  return { days: days.slice(1), S: gS, E: gE, I: gI, R: gR, D: gD, reached, summaries, peakIProp: pk, peakDay: pkd, seed: params.seed, recSeries: rec };
}
