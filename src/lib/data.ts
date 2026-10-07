import type { Edge, Region, VirusPreset } from '../model/types';

export function baseUrl(): string {
  const b = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL || '/';
  return b.endsWith('/') ? b : b + '/';
}

export interface DataPack {
  regions: Region[];
  edges: Edge[];
  viruses: { viruses: VirusPreset[] };
  islands: { remote: Record<string, string>[]; history: Record<string, string>[] };
  meta: Record<string, unknown>;
  rhoMedian: number;
}

export async function loadDataPack(): Promise<DataPack> {
  const b = baseUrl();
  const [r, e, v, isl, meta] = await Promise.all([
    fetch(`${b}data/regions.json`).then((x) => x.json()),
    fetch(`${b}data/edges.json`).then((x) => x.json()),
    fetch(`${b}data/viruses.json`).then((x) => x.json()),
    fetch(`${b}data/islands.json`).then((x) => x.json()),
    fetch(`${b}data/meta.json`).then((x) => x.json()),
  ]);
  const regions = r.regions as Region[];
  const dens = regions.map((x) => x.density).filter((d) => d > 0).sort((a, z) => a - z);
  const rhoMedian = dens.length ? dens[Math.floor(dens.length / 2)] : 100;
  return { regions, edges: e.edges as Edge[], viruses: v, islands: isl, meta, rhoMedian };
}

export function defaultIslandSelection(regions: Region[], remoteIds: Set<string>, count = 12): number[] {
  // 10-15 least-connected inhabited island regions by inbound weight + remote_islands.csv
  const scored = regions
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.population > 500 && (r.isIsland || r.isRemote || remoteIds.has(r.parentUnit) || remoteIds.has(r.id)));
  scored.sort((a, b) => a.r.inW - b.r.inW);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const s of scored.slice(0, count)) { out.push(s.i); seen.add(s.i); }
  // ensure every remote unit represented at least once
  for (const uid of remoteIds) {
    const idx = regions.findIndex((r) => r.id === uid || r.parentUnit === uid);
    if (idx >= 0 && !seen.has(idx) && regions[idx].population > 0) { out.push(idx); seen.add(idx); }
  }
  return out.slice(0, Math.max(count, remoteIds.size + 3));
}

export function findSeedRegion(regions: Region[], preferred: string[] = ['CHN', 'ENG', 'USA']): number {
  // dense well-connected hub: max pop*outW among candidates, fallback global max outW
  let best = 0; let bs = -1;
  for (let i = 0; i < regions.length; i++) {
    const s = Math.log1p(regions[i].population) + Math.log1p(regions[i].outW);
    if (s > bs) { bs = s; best = i; }
  }
  for (const p of preferred) {
    const cands = regions.map((r, i) => ({ r, i })).filter(({ r }) => r.parentUnit === p);
    if (cands.length) {
      cands.sort((a, b) => b.r.population - a.r.population);
      return cands[0].i;
    }
  }
  return best;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return headers.map(esc).join(',') + '\n' + rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const EDGE_LABEL: Record<number, string> = { 0: 'observed', 1: 'synthetic', 2: 'estimated' };
