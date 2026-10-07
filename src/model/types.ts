export interface Region {
  id: string;
  name: string;
  parentUnit: string;
  population: number;
  areaKm2: number;
  density: number;
  centroid: [number, number]; // [lon, lat]
  isIsland: boolean;
  isRemote: boolean;
  airports: string[];
  inW: number;
  outW: number;
  point: boolean;
  geom: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } | null;
}

export interface Edge {
  s: number; // region index
  d: number;
  w: number; // daily travellers at m=1
  t: 0 | 1 | 2; // 0 observed, 1 synthetic, 2 estimated
  a?: number | null;
  dkm?: number | null;
}

export interface VirusPreset {
  id: string;
  name: string;
  R0_reported?: string;
  R0_preset: number;
  latent_L_days_preset: number;
  infectious_T_days_preset: number;
  death_share_p_preset: number;
  fatality_measure?: string;
  airborne_share_a: number;
  sigma: number;
  gamma: number;
  mu: number;
  beta_total: number;
  beta_air: number;
  beta_contact: number;
  sources?: string;
  incubation_days_reported?: string;
  fatality_reported?: string;
  routes?: string;
}

export interface SimParams {
  betaAir: number;
  betaContact: number;
  sigma: number; // 1/L
  gamma: number;
  mu: number;
  m: number; // mobility multiplier
  kDensity: number;
  superspreading: boolean;
  kSuperspread: number; // dispersion, default 0.2
  dt: number; // days per step
  durationDays: number;
  seed: number;
  seedRegion: number; // region index
  startExposed: number;
  quarantined: number[]; // region indices with edges zeroed
  rhoMedian: number;
}

export interface RegionSummary {
  arrival: number; // -1 if never
  source: number; // region index or -1
  peakI: number; // proportion
  peakDay: number;
  finalAttack: number; // (E+I+R+D)/N final? or (R+D)/N? use 1 - S/N
  finalDead: number; // D/N
}

export interface RunResult {
  days: number[];
  S: number[]; E: number[]; I: number[]; R: number[]; D: number[];
  reached: number[];
  summaries: RegionSummary[];
  peakIProp: number;
  peakDay: number;
  seed: number;
  recSeries?: Record<number, { S: number[]; E: number[]; I: number[]; R: number[]; D: number[] }>;
}
