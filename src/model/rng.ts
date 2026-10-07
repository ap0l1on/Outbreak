// Seeded PRNG: mulberry32 + helpers (poisson, binomial, gamma, normal).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private f: () => number;
  constructor(seed: number) { this.f = mulberry32(seed); }
  uniform(): number { return this.f(); }
  normal(): number {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = this.f();
    while (v === 0) v = this.f();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0; let p = 1;
      do { k++; p *= this.f(); } while (p > L);
      return k - 1;
    }
    // normal approx for large lambda
    const z = this.normal();
    const v = lambda + Math.sqrt(lambda) * z;
    return Math.max(0, Math.round(v));
  }
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return Math.round(n);
    const ni = Math.floor(n);
    if (ni < 100) {
      let c = 0;
      for (let i = 0; i < ni; i++) if (this.f() < p) c++;
      // fractional remainder
      const frac = n - ni;
      if (frac > 0 && this.f() < p * frac) c += 1;
      return c;
    }
    const mean = n * p;
    if (mean < 30) return this.poisson(mean);
    const v = mean + Math.sqrt(n * p * (1 - p)) * this.normal();
    return Math.max(0, Math.min(ni, Math.round(v)));
  }
  gamma(shape: number, scale = 1): number {
    // Marsaglia-Tsang for shape>=1, boost for <1
    if (shape <= 0) return 0;
    if (shape < 1) {
      // Gamma(s) = Gamma(s+1) * U^(1/s)
      const g = this.gamma(shape + 1, scale);
      const u = this.f();
      return g * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = this.normal();
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = this.f();
      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
}
