import { useEffect, useRef } from 'react';
import { geoEqualEarth, geoPath, geoContains } from 'd3-geo';
import type { Region } from '../model/types';

export type MapMode = 'density' | 'S' | 'E' | 'I' | 'R' | 'D';

interface Arc { s: number; d: number; t0: number; }

interface Props {
  regions: Region[];
  mode: MapMode;
  values: Float32Array | number[] | null; // per-region proportion for compartment mode
  reached: Uint8Array | boolean[] | null;
  day: number;
  arcs: Arc[];
  selected: number;
  showRoutes: boolean;
  edgesTop: { s: number; d: number }[];
  onSelect: (idx: number) => void;
  focusKey: string; // 'pacific' | 'atlantic' | 'reset' | counter
}

function seqColor(t: number): string {
  // colour-blind-safe YlGnBu approx
  const stops: [number, [number, number, number]][] = [
    [0, [255, 255, 217]], [0.25, [199, 233, 180]], [0.5, [127, 205, 187]],
    [0.75, [65, 182, 196]], [1, [8, 48, 107]],
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1]; const [x1, c1] = stops[i];
      const f = (x - x0) / Math.max(1e-9, x1 - x0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(8,48,107)';
}

export default function MapView(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef({ k: 1, x: 0, y: 0 });
  const anim = useRef(0);

  // focus jumps
  useEffect(() => {
    const v = view.current;
    if (props.focusKey === 'reset') { v.k = 1; v.x = 0; v.y = 0; }
    else if (props.focusKey.startsWith('pacific')) { v.k = 2.2; v.x = -40; v.y = 30; }
    else if (props.focusKey.startsWith('atlantic')) { v.k = 2.2; v.x = 120; v.y = -60; }
  }, [props.focusKey]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let drag: { x: number; y: number; vx: number; vy: number } | null = null;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(300, r.width) * dpr;
      canvas.height = 460 * dpr;
      canvas.style.width = `${Math.max(300, r.width)}px`;
      canvas.style.height = '460px';
    };
    resize();
    window.addEventListener('resize', resize);

    const proj = geoEqualEarth().rotate([-160, 0]).precision(0.1);

    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.width, H = canvas.height;
      proj.fitExtent([[10 * dpr, 10 * dpr], [W - 10 * dpr, H - 10 * dpr]], { type: 'Sphere' } as never);
      const base = proj.scale();
      proj.scale(base * view.current.k).translate([
        proj.translate()[0] + view.current.x * dpr,
        proj.translate()[1] + view.current.y * dpr,
      ]);
      const path = geoPath(proj as never, ctx);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, W, H);
      // sphere outline
      ctx.beginPath(); path({ type: 'Sphere' } as never);
      ctx.fillStyle = '#101830'; ctx.fill();
      // faint air routes
      if (props.showRoutes) {
        ctx.strokeStyle = 'rgba(150,180,220,0.12)';
        ctx.lineWidth = 0.6 * dpr;
        for (const e of props.edgesTop) {
          const a = props.regions[e.s]?.centroid; const b = props.regions[e.d]?.centroid;
          if (!a || !b) continue;
          const pa = proj(a as [number, number]); const pb = proj(b as [number, number]);
          if (!pa || !pb) continue;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        }
      }
      const vals = props.values;
      // densities for density mode
      let dmin = Infinity, dmax = -Infinity;
      if (props.mode === 'density') {
        for (const r of props.regions) {
          if (r.population <= 0) continue;
          const l = Math.log10(Math.max(1, r.density));
          if (l < dmin) dmin = l; if (l > dmax) dmax = l;
        }
      } else if (vals) {
        // fixed log-ish scale per compartment handled per value with sqrt
      }
      // draw regions
      for (let i = 0; i < props.regions.length; i++) {
        const r = props.regions[i];
        let fill = '#223';
        if (props.mode === 'density') {
          if (r.population <= 0 || r.areaKm2 <= 0) fill = '#1a2233';
          else {
            const l = Math.log10(Math.max(1, r.density));
            fill = seqColor((l - dmin) / Math.max(1e-9, dmax - dmin));
          }
        } else if (vals) {
          const v = (vals as number[])[i] ?? 0;
          const t = Math.min(1, Math.sqrt(Math.max(0, v)) * 6);
          fill = v <= 0 ? '#1a2233' : seqColor(Math.min(1, 0.08 + t));
        }
        const isSel = i === props.selected;
        if (r.geom && !r.point) {
          ctx.beginPath();
          try { path({ type: 'Feature', properties: {}, geometry: r.geom } as never); } catch { continue; }
          ctx.fillStyle = fill;
          ctx.fill();
          const isReached = props.reached ? !!(props.reached as { [k: number]: unknown })[i] : false;
          if (isReached || isSel) {
            ctx.strokeStyle = isSel ? '#ffd166' : 'rgba(255,255,255,0.75)';
            ctx.lineWidth = (isSel ? 2 : 1) * dpr;
            if (isReached && !isSel) ctx.setLineDash([3 * dpr, 2 * dpr]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        } else {
          const p = proj(r.centroid as [number, number]);
          if (!p) continue;
          const isReached = props.reached ? !!(props.reached as { [k: number]: unknown })[i] : false;
          ctx.beginPath();
          ctx.arc(p[0], p[1], (isSel ? 5 : 3.2) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = isSel ? '#ffd166' : isReached ? '#ffffff' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }
      }
      // arcs (fading imports)
      const t = props.day;
      for (const a of props.arcs) {
        const age = t - a.t0;
        if (age < 0 || age > 25) continue;
        const alpha = Math.max(0, 0.9 * (1 - age / 25));
        const A = props.regions[a.s]?.centroid; const B = props.regions[a.d]?.centroid;
        if (!A || !B) continue;
        const pa = proj(A as [number, number]); const pb = proj(B as [number, number]);
        if (!pa || !pb) continue;
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2 - 30 * dpr;
        ctx.strokeStyle = `rgba(255,209,102,${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.quadraticCurveTo(mx, my, pb[0], pb[1]); ctx.stroke();
      }
      void now;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.k = Math.max(0.8, Math.min(8, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    };
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      view.current.x = drag.vx + (e.clientX - drag.x);
      view.current.y = drag.vy + (e.clientY - drag.y);
    };
    const onUp = () => { drag = null; };
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      // invert via rough search: use projection invert
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.width, H = canvas.height;
      proj.fitExtent([[10 * dpr, 10 * dpr], [W - 10 * dpr, H - 10 * dpr]], { type: 'Sphere' } as never);
      const base = proj.scale();
      proj.scale(base * view.current.k).translate([
        proj.translate()[0] + view.current.x * dpr,
        proj.translate()[1] + view.current.y * dpr,
      ]);
      const inv = (proj.invert as ((p: [number, number]) => [number, number] | null))([px * dpr, py * dpr]);
      let best = -1;
      if (inv) {
        let lon = inv[0];
        while (lon > 180) lon -= 360; while (lon < -180) lon += 360;
        const lat = Math.max(-90, Math.min(90, inv[1]));
        // polygon hit first (smallest area)
        let bestArea = Infinity;
        for (let i = 0; i < props.regions.length; i++) {
          const r = props.regions[i];
          if (r.geom && !r.point) {
            try {
              if (geoContains({ type: 'Feature', properties: {}, geometry: r.geom } as never, [lon, lat])) {
                if (r.areaKm2 < bestArea) { bestArea = r.areaKm2; best = i; }
              }
            } catch { /* ignore */ }
          }
        }
        if (best < 0) {
          // nearest point within 12px
          let bd = 14;
          for (let i = 0; i < props.regions.length; i++) {
            const r = props.regions[i];
            const p = proj(r.centroid as [number, number]);
            if (!p) continue;
            const d = Math.hypot(p[0] / dpr - px, p[1] / dpr - py);
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0) props.onSelect(best);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('click', onClick);
    anim.current = raf;
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.regions, props.mode, props.values, props.reached, props.day, props.arcs, props.selected, props.showRoutes, props.focusKey]);

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: 460, borderRadius: 8, cursor: 'grab' }} />
    </div>
  );
}
