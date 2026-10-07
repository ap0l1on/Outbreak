import { downloadCsv, toCsv } from '../lib/data';

function Frame({ title, csvName, headers, rows, children, note }: {
  title: string; csvName: string; headers: string[]; rows: (string | number)[][];
  children: React.ReactNode; note?: string;
}) {
  return (
    <div className="chart">
      <div className="chart-head">
        <h4>{title}</h4>
        <button className="btn xs" title="Download the plotted data as CSV for your IA analysis"
          onClick={() => downloadCsv(csvName, toCsv(headers, rows))}>CSV</button>
      </div>
      {children}
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

function axes(w: number, h: number, pad: number) {
  return { x0: pad, y0: 8, x1: w - 8, y1: h - 24 };
}

export function SeriesChart({ title, xs, series, csvName, note, logy }: {
  title: string; xs: number[]; series: { label: string; color: string; ys: number[] }[];
  csvName: string; note?: string; logy?: boolean;
}) {
  const w = 520, h = 220, pad = 44;
  const { x0, y0, x1, y1 } = axes(w, h, pad);
  const all = series.flatMap((s) => s.ys);
  let ymin = Math.min(...all, 0), ymax = Math.max(...all, 1e-9);
  if (logy) { ymin = Math.max(1e-7, Math.min(...all.filter((v) => v > 0), 1e-6)); }
  const X = (x: number) => x0 + ((x - xs[0]) / Math.max(1e-9, xs[xs.length - 1] - xs[0])) * (x1 - x0);
  const Y = (y: number) => {
    if (logy) {
      const l0 = Math.log10(ymin), l1 = Math.log10(ymax);
      return y1 - ((Math.log10(Math.max(ymin, y)) - l0) / Math.max(1e-9, l1 - l0)) * (y1 - y0);
    }
    return y1 - ((y - ymin) / Math.max(1e-9, ymax - ymin)) * (y1 - y0);
  };
  const rows = xs.map((x, i) => [x, ...series.map((s) => s.ys[i] ?? '')]);
  return (
    <Frame title={title} csvName={csvName} headers={['day', ...series.map((s) => s.label)]} rows={rows} note={note}>
      <svg viewBox={`0 0 ${w} ${h}`} className="svg">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={x0} x2={x1} y1={y0 + f * (y1 - y0)} y2={y0 + f * (y1 - y0)} stroke="#223" />
        ))}
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={1.6}
            points={xs.map((x, i) => `${X(x).toFixed(1)},${Y(s.ys[i] ?? 0).toFixed(1)}`).join(' ')} />
        ))}
        <text x={x0} y={h - 8} fill="#8fa" fontSize={10}>day {xs[0]} → {xs[xs.length - 1]}</text>
        <text x={4} y={14} fill="#8fa" fontSize={10}>{logy ? 'log scale' : `max ${ymax.toExponential(1)}`}</text>
      </svg>
      <div className="legend">{series.map((s) => (
        <span key={s.label} className="leg"><i style={{ background: s.color }} />{s.label}</span>
      ))}</div>
    </Frame>
  );
}

export function ArrivalTimeline({ title, names, arrivals, csvName }: {
  title: string; names: string[]; arrivals: number[]; csvName: string;
}) {
  const w = 520, h = Math.max(120, names.length * 22 + 40);
  const order = names.map((n, i) => ({ n, a: arrivals[i], i })).sort((x, y) => (x.a < 0 ? 1e9 : x.a) - (y.a < 0 ? 1e9 : y.a));
  const maxD = Math.max(30, ...arrivals.filter((a) => a >= 0));
  const X = (d: number) => 150 + (d / (maxD * 1.05)) * (w - 170);
  return (
    <Frame title={title} csvName={csvName} headers={['island', 'arrival_day']} rows={names.map((n, i) => [n, arrivals[i]])}
      note="Single run. −1 = not reached by end of run.">
      <svg viewBox={`0 0 ${w} ${h}`} className="svg">
        {order.map((o, k) => (
          <g key={o.i}>
            <text x={4} y={20 + k * 22} fill="#cde" fontSize={11}>{o.n.slice(0, 22)}</text>
            <line x1={150} x2={w - 20} y1={16 + k * 22} y2={16 + k * 22} stroke="#223" />
            {o.a >= 0
              ? <circle cx={X(o.a)} cy={16 + k * 22} r={4} fill="#ffd166" />
              : <text x={w - 60} y={20 + k * 22} fill="#f88" fontSize={10}>unreached</text>}
            {o.a >= 0 && <text x={Math.min(w - 40, X(o.a) + 7)} y={20 + k * 22} fill="#8fa" fontSize={10}>d{o.a.toFixed(0)}</text>}
          </g>
        ))}
      </svg>
    </Frame>
  );
}

export function SweepChart({ title, mVals, perM, islandNames, csvName }: {
  title: string; mVals: number[]; perM: { prob: number; ci: [number, number]; med: number; q1: number; q3: number }[][]; islandNames: string[]; csvName: string;
}) {
  const w = 520, h = 260, pad = 44;
  const { x0, y0, x1, y1 } = axes(w, h, pad);
  const X = (m: number) => x0 + (m / 1.5) * (x1 - x0);
  const Y = (p: number) => y1 - p * (y1 - y0);
  const cols = ['#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#9b5de5', '#f15bb5', '#00bbf9', '#80ed99', '#ff9f1c', '#c8b6ff', '#90be6d', '#f94144', '#577590', '#43aa8b', '#f3722c'];
  const rows: (string | number)[][] = [];
  perM.forEach((arr, mi) => arr.forEach((s, k) => rows.push([islandNames[k], mVals[mi], s.prob, s.ci[0], s.ci[1], s.med])));
  return (
    <Frame title={title} csvName={csvName} headers={['island', 'm', 'prob', 'ci_lo', 'ci_hi', 'median_arrival']}
      rows={rows} note="Mean of N runs per m. Error bars: Wilson 95% CI. Median arrival among reached runs.">
      <svg viewBox={`0 0 ${w} ${h}`} className="svg">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}><line x1={x0} x2={x1} y1={y1 - f * (y1 - y0)} y2={y1 - f * (y1 - y0)} stroke="#223" />
            <text x={4} y={y1 - f * (y1 - y0) + 3} fill="#8fa" fontSize={10}>{(f * 100).toFixed(0)}%</text></g>
        ))}
        {mVals.map((m) => <text key={m} x={X(m)} y={h - 8} fill="#8fa" fontSize={10} textAnchor="middle">{m}</text>)}
        {islandNames.map((_, k) => (
          <g key={k}>
            <polyline fill="none" stroke={cols[k % cols.length]} strokeWidth={1.5}
              points={mVals.map((m, mi) => `${X(m).toFixed(1)},${Y(perM[mi][k].prob).toFixed(1)}`).join(' ')} />
            {mVals.map((m, mi) => {
              const s = perM[mi][k];
              return <line key={m} x1={X(m)} x2={X(m)} y1={Y(s.ci[1])} y2={Y(s.ci[0])} stroke={cols[k % cols.length]} strokeWidth={2} />;
            })}
          </g>
        ))}
      </svg>
      <div className="legend">{islandNames.slice(0, 8).map((n, k) => (
        <span key={n} className="leg"><i style={{ background: cols[k % cols.length] }} />{n.slice(0, 18)}</span>
      ))}</div>
    </Frame>
  );
}

export function ScatterR0({ presets }: { presets: { name: string; R0: number; p: number; unverified: boolean }[] }) {
  const w = 520, h = 240, pad = 48;
  const { x0, y0, x1, y1 } = axes(w, h, pad);
  const l0 = Math.log10(0.2), l1 = Math.log10(16);
  const X = (r: number) => x0 + ((Math.log10(Math.max(0.2, r)) - l0) / (l1 - l0)) * (x1 - x0);
  const Y = (p: number) => y1 - Math.min(1, p / 0.7) * (y1 - y0);
  return (
    <div className="chart">
      <div className="chart-head"><h4>R0 vs fatality (presets, log x)</h4></div>
      <svg viewBox={`0 0 ${w} ${h}`} className="svg">
        {[0.3, 1, 3, 10].map((v) => (
          <g key={v}><line x1={X(v)} x2={X(v)} y1={y0} y2={y1} stroke="#223" />
            <text x={X(v)} y={h - 8} fill="#8fa" fontSize={10} textAnchor="middle">{v}</text></g>
        ))}
        {presets.map((p) => (
          <g key={p.name}>
            <circle cx={X(p.R0)} cy={Y(p.p)} r={5} fill={p.unverified ? '#888' : '#ffd166'} stroke="#000" strokeWidth={0.5} />
            <text x={X(p.R0) + 7} y={Y(p.p) + 3} fill="#cde" fontSize={9}>{p.name.replace(' (', '\n').slice(0, 18)}</text>
          </g>
        ))}
      </svg>
      <div className="muted small">Trade-off between transmissibility and lethality. Grey = unverified textbook values.</div>
    </div>
  );
}
