// Wilson 95% CI, median, IQR, mean/range helpers.

export function wilsonCI(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const d = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - d) / denom), Math.min(1, (centre + d) / denom)];
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quartiles(xs: number[]): { q1: number; med: number; q3: number } {
  if (!xs.length) return { q1: NaN, med: NaN, q3: NaN };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx); const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return { q1: q(0.25), med: q(0.5), q3: q(0.75) };
}

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function range(xs: number[]): [number, number] {
  if (!xs.length) return [NaN, NaN];
  return [Math.min(...xs), Math.max(...xs)];
}
