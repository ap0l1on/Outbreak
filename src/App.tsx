import { useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type MapMode } from './components/MapView';
import { SeriesChart, ArrivalTimeline, SweepChart, ScatterR0 } from './components/Charts';
import { MathPanel, DataPanel, SourcesPanel, HistoryPanel } from './components/Panels';
import { loadDataPack, defaultIslandSelection, findSeedRegion, downloadCsv, toCsv, baseUrl, EDGE_LABEL } from './lib/data';
import { presetToRates, ratesToDerived } from './model/params';
import type { Region, RunResult, SimParams, VirusPreset } from './model/types';

const M_SWEEP = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.5];
const RQ_DEFAULT = 'How does interregional travel connectivity affect the probability and arrival time of a hypothetical outbreak in remote island regions in a population-weighted global SEIRD model?';

interface Frame { day: number; global: number[]; full: Record<'S' | 'E' | 'I' | 'R' | 'D', number[]>; }

function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  if (Math.abs(n) >= 1) return n.toFixed(n >= 100 ? 0 : 1);
  if (n === 0) return '0';
  return n.toExponential(1);
}
function fmtP(p: number): string {
  if (!isFinite(p)) return '—';
  if (p === 0) return '0%';
  if (p < 0.0001) return (p * 100).toExponential(1) + '%';
  return (p * 100).toFixed(p < 0.01 ? 2 : 1) + '%';
}

export default function App() {
  const [pack, setPack] = useState<Awaited<ReturnType<typeof loadDataPack>> | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [rq, setRq] = useState(RQ_DEFAULT);
  // disease params (primary)
  const [presetId, setPresetId] = useState('influenza_1918');
  const [R0, setR0] = useState(2.0);
  const [L, setL] = useState(1.5);
  const [T, setT] = useState(4);
  const [p, setP] = useState(0.025);
  const [aShare, setAShare] = useState(0.6);
  // mobility etc
  const [m, setM] = useState(1);
  const [kD, setKD] = useState(0);
  const [ss, setSS] = useState(false);
  const [kSS, setKSS] = useState(0.2);
  const [dur, setDur] = useState(365);
  const [dt, setDt] = useState(0.25);
  const [seed, setSeed] = useState(7);
  const [seedRegion, setSeedRegion] = useState(0);
  const [startExp, setStartExp] = useState(10);
  const [quar, setQuar] = useState<number[]>([]);
  // ui
  const [mode, setMode] = useState<MapMode>('I');
  const [showRoutes, setShowRoutes] = useState(false);
  const [focusKey, setFocusKey] = useState('reset');
  const [selected, setSelected] = useState(0);
  const [islandIdx, setIslandIdx] = useState<number[]>([]);
  const [seedSearch, setSeedSearch] = useState('');
  // run state
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(1);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ frac: number; label: string }>({ frac: 0, label: '' });
  const [result, setResult] = useState<RunResult | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const [playIdx, setPlayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30); // days per second
  const [dayOverride, setDayOverride] = useState<number | null>(null);
  // sweeps
  const [runsPer, setRunsPer] = useState(30);
  const [mSweep, setMSweep] = useState<{ prob: number; ci: [number, number]; med: number; q1: number; q3: number }[][] | null>(null);
  const [sensKind, setSensKind] = useState<'L' | 'gamma' | 'mu'>('L');
  const [sensRes, setSensRes] = useState<{ vals: number[]; peak: { mean: number; lo: number; hi: number }[]; dead: { mean: number; lo: number; hi: number }[] } | null>(null);
  const [baseline, setBaseline] = useState<{ label: string; I: number[]; days: number[] } | null>(null);
  const [tab, setTab] = useState<'charts' | 'math' | 'data' | 'sources' | 'history'>('charts');

  const derived = useMemo(() => presetToRates({ R0, L, T, p, a: aShare }), [R0, L, T, p, aShare]);

  useEffect(() => {
    loadDataPack().then((d) => {
      setPack(d);
      const remoteIds = new Set(d.islands.remote.map((r) => String(r.map_unit_id)));
      setIslandIdx(defaultIslandSelection(d.regions, remoteIds, 12));
      const s = findSeedRegion(d.regions);
      // prefer Guangdong-like: largest CHN admin1; fallback
      const chn = d.regions.map((r, i) => ({ r, i })).filter(({ r }) => r.parentUnit === 'CHN')
        .sort((x, y) => y.r.population - x.r.population);
      setSeedRegion(chn.length ? chn[0].i : s);
      setSelected(chn.length ? chn[0].i : s);
    }).catch((e) => setLoadErr(String(e)));
    const w = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  // apply preset
  const applyPreset = (id: string) => {
    setPresetId(id);
    if (!pack || id === 'custom') return;
    const v = pack.viruses.viruses.find((x) => x.id === id);
    if (!v) return;
    setR0(v.R0_preset); setL(v.latent_L_days_preset); setT(v.infectious_T_days_preset);
    setP(v.death_share_p_preset); setAShare(v.airborne_share_a);
  };

  const buildParams = (over: Partial<SimParams> = {}): SimParams => ({
    betaAir: derived.betaAir, betaContact: derived.betaContact,
    sigma: derived.sigma, gamma: derived.gamma, mu: derived.mu,
    m, kDensity: kD, superspreading: ss, kSuperspread: kSS,
    dt, durationDays: dur, seed, seedRegion, startExposed: startExp,
    quarantined: quar, rhoMedian: pack?.rhoMedian ?? 100, ...over,
  });

  const runSingle = () => {
    if (!pack || busy) return;
    setBusy(true); setPlaying(false); framesRef.current = [];
    const id = idRef.current++;
    const params = buildParams();
    const w = workerRef.current!;
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress' && msg.day !== undefined) {
        setProg({ frac: msg.frac, label: msg.label });
        if (msg.full) {
          framesRef.current.push({ day: msg.day, global: msg.global, full: msg.full });
          setPlayIdx(framesRef.current.length - 1);
        }
      } else if (msg.type === 'done') {
        w.removeEventListener('message', onMsg);
        setBusy(false); setProg({ frac: 1, label: 'done' });
        if (msg.result?.error) { alert('Simulation error: ' + msg.result.error); return; }
        const r = msg.result as RunResult;
        setResult(r);
        setDayOverride(null);
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'run', id, base: baseUrl(), params, islandIdx, recordIdx: [selected] });
  };

  const runSweep = (kind: 'm' | 'L' | 'gamma' | 'mu') => {
    if (!pack || busy) return;
    setBusy(true);
    const id = idRef.current++;
    let values: number[] = M_SWEEP;
    if (kind === 'L') values = [0.75, 1.5, 3, 6, 12];
    if (kind === 'gamma') values = [0.03, 0.06, 0.12, 0.2, 0.3];
    if (kind === 'mu') values = [0.0005, 0.002, 0.006, 0.02, 0.06];
    if (kind === 'L') { const f = L; values = [f * 0.5, f * 0.75, f, f * 1.5, f * 2].map((v) => Math.max(0.25, v)); }
    const base = buildParams();
    const w = workerRef.current!;
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') setProg({ frac: msg.frac, label: msg.label });
      else if (msg.type === 'done') {
        w.removeEventListener('message', onMsg);
        setBusy(false);
        if (msg.result?.error) { alert('Sweep error: ' + msg.result.error); return; }
        const out = msg.result as { prob: number; ci: [number, number]; med: number; q1: number; q3: number }[][];
        if (kind === 'm') setMSweep(out);
        else {
          // sensitivity: aggregate peak/dead already in stats? worker returns island stats; compute global-ish mean peak/dead across islands? Use meanPeakI/meanDead
          const raw = msg.result as unknown as { meanPeakI: number; meanDead: number }[][];
          const peak = out.map((arr) => {
            const ms = (raw as unknown as { meanPeakI: number }[][]);
            void ms;
            const vals = arr.map(() => 0);
            void vals;
            return { mean: 0, lo: 0, hi: 0 };
          });
          void peak;
          // rebuild from out? worker sweep returns SweepIslandStat with meanPeakI/meanDead — extract:
          const full = msg.result as unknown as { meanPeakI: number; meanDead: number; arrivals: number[] }[][];
          const pk = full.map((arr) => {
            const ms = arr.map((s) => s.meanPeakI);
            return { mean: avg(ms), lo: Math.min(...ms), hi: Math.max(...ms) };
          });
          const dd = full.map((arr) => {
            const ms = arr.map((s) => s.meanDead);
            return { mean: avg(ms), lo: Math.min(...ms), hi: Math.max(...ms) };
          });
          setSensRes({ vals: values, peak: pk, dead: dd });
          setSensKind(kind as 'L' | 'gamma' | 'mu');
        }
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({
      type: 'sweep', id, base: baseUrl(),
      config: { kind, values, runsPer: kind === 'm' ? runsPer : Math.min(runsPer, 20), baseParams: base, islandIdx, baseSeed: seed },
    });
  };
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

  // playback timer
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPlayIdx((i) => {
        const n = framesRef.current.length;
        if (!n) return i;
        if (i + 1 >= n) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 1000 / Math.max(1, speed / 5));
    return () => clearInterval(t);
  }, [playing, speed]);

  const frames = framesRef.current;
  const curFrame: Frame | null = frames.length ? frames[Math.min(playIdx, frames.length - 1)] : null;
  const curDay = dayOverride ?? curFrame?.day ?? result?.days[result.days.length - 1] ?? 0;
  const mapVals: number[] | null = useMemo(() => {
    if (!curFrame || mode === 'density') return null;
    return curFrame.full[mode];
  }, [curFrame, mode]);
  const reachedArr: boolean[] | null = useMemo(() => {
    if (!result) return null;
    return result.summaries.map((s) => s.arrival >= 0 && s.arrival <= curDay);
  }, [result, curDay]);
  const arcs = useMemo(() => {
    if (!result) return [];
    return result.summaries
      .map((s, i) => ({ s: s.source, d: i, t0: s.arrival }))
      .filter((a) => a.s >= 0 && a.t0 >= 0);
  }, [result]);

  const edgesTop = useMemo(() => {
    if (!pack) return [];
    return [...pack.edges].sort((x, y) => y.w - x.w).slice(0, 400).map((e) => ({ s: e.s, d: e.d }));
  }, [pack]);

  const inLinks = useMemo(() => {
    if (!pack) return [];
    return pack.edges.filter((e) => e.d === selected).sort((x, y) => y.w - x.w).slice(0, 5);
  }, [pack, selected]);
  const outLinks = useMemo(() => {
    if (!pack) return [];
    return pack.edges.filter((e) => e.s === selected).sort((x, y) => y.w - x.w).slice(0, 5);
  }, [pack, selected]);

  const applyScenario = (kind: 'samoa-open' | 'samoa-quarantine') => {
    if (!pack) return;
    applyPreset('influenza_1918');
    const nzl = pack.regions.findIndex((r) => r.id === 'NZL');
    const asm = pack.regions.findIndex((r) => r.id === 'ASM');
    if (nzl >= 0) { setSeedRegion(nzl); setSelected(nzl); }
    setM(1);
    setQuar(kind === 'samoa-quarantine' && asm >= 0 ? [asm] : []);
    setTimeout(runSingle, 50);
  };

  if (!pack) return <div className="wrap"><p>{loadErr ? 'Failed to load data: ' + loadErr : 'Loading data pack…'}</p></div>;

  const preset: VirusPreset | undefined = pack.viruses.viruses.find((v) => v.id === presetId);
  const unverified = (preset?.sources ?? '').includes('[TEXTBOOK-UNVERIFIED]') || presetId === 'custom' ? false : (preset?.sources ?? '').includes('TEXTBOOK');
  const islands = pack.regions.map((r, i) => ({ r, i })).filter(({ i }) => islandIdx.includes(i));
  const seedOptions = pack.regions
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !seedSearch || r.name.toLowerCase().includes(seedSearch.toLowerCase()) || r.id.toLowerCase().includes(seedSearch.toLowerCase()))
    .slice(0, 80);
  const rInfo = pack.regions[selected];
  const rSum = result?.summaries[selected];
  const rRec = result?.recSeries?.[selected];

  return (
    <div className="wrap">
      <header>
        <h1>Outbreak</h1>
        <p className="muted">Regional (metapopulation) SEIRD simulator — population-weighted world map. Runs fully offline in your browser.</p>
        <label className="rq">Research question (editable)
          <textarea value={rq} onChange={(e) => setRq(e.target.value)} rows={2} />
        </label>
        <p className="warn">Remoteness lowers or delays the chance of an imported case, but <b>does not make any island immune</b>: with m&gt;0 every connected island is eventually reachable.</p>
      </header>

      <main className="grid">
        <section className="mapcol">
          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="Map layer">
              {(['density', 'S', 'E', 'I', 'R', 'D'] as MapMode[]).map((k) => (
                <button key={k} className={mode === k ? 'btn on' : 'btn'} onClick={() => setMode(k)}
                  title={k === 'density' ? 'Log population density (GHSL 2020) before a run' : `Infectious state ${k} proportion during run`}>{k === 'density' ? 'pop' : k}</button>
              ))}
            </div>
            <button className="btn" onClick={() => setFocusKey('pacific' + Date.now())} title="Zoom to Pacific islands">Pacific</button>
            <button className="btn" onClick={() => setFocusKey('atlantic' + Date.now())} title="Zoom to South Atlantic (Tristan/St Helena)">S. Atlantic</button>
            <button className="btn" onClick={() => setFocusKey('reset')} title="Reset zoom">Reset</button>
            <label className="chk" title="Faintly overlay the busiest air routes"><input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} /> routes</label>
          </div>
          <MapView regions={pack.regions} mode={mode} values={mapVals} reached={reachedArr}
            day={curDay} arcs={arcs} selected={selected} showRoutes={showRoutes} edgesTop={edgesTop}
            onSelect={setSelected} focusKey={focusKey} />
          <div className="legendrow muted small">
            {mode === 'density'
              ? 'Log population density (people/km²), GHSL GHS-POP R2023A epoch 2020. Darker = denser.'
              : `Colour: ${mode} proportion (colour-blind-safe scale) + white outline = reached. Day ${curDay.toFixed(0)}.`}
          </div>
          <div className="playrow">
            <button className="btn" onClick={runSingle} disabled={busy} title="Run one stochastic simulation in a Web Worker">▶ Run</button>
            <button className="btn" onClick={() => setPlaying(!playing)} disabled={!frames.length} title="Play/pause the computed run">{playing ? '⏸ Pause' : '⏵ Play'}</button>
            <button className="btn" onClick={() => setPlayIdx((i) => Math.min(frames.length - 1, i + 1))} disabled={!frames.length} title="Step one frame (≈5 days)">Step</button>
            <button className="btn" onClick={() => { setPlayIdx(0); setPlaying(false); }} title="Reset playback to day 0">Reset</button>
            <label title="Playback speed (simulated days per second)">Speed <input type="range" min={5} max={120} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /> {speed}/s</label>
            <span className="muted">Day {curDay.toFixed(0)} / {dur}</span>
          </div>
          {busy && <div className="prog"><div className="bar" style={{ width: `${(prog.frac * 100).toFixed(0)}%` }} /> <span className="small">{prog.label}</span></div>}
          {curFrame && (
            <div className="totals small">
              Global — S {fmt(curFrame.global[0])} · E {fmt(curFrame.global[1])} · I {fmt(curFrame.global[2])} · R {fmt(curFrame.global[3])} · D {fmt(curFrame.global[4])}
              {' '}· reached {result ? result.reached[Math.min(playIdx * 5, result.reached.length - 1)] ?? '—' : '—'}/{pack.regions.length}
              <span className="muted"> (single run)</span>
            </div>
          )}
          {selected !== undefined && rInfo && (
            <div className="card">
              <h4>{rInfo.name} <span className="muted">· {rInfo.id} · pop {fmt(rInfo.population)} · dens {rInfo.density.toFixed(1)}/km²</span></h4>
              <div className="cols">
                <div>
                  <div className="small"><b>Top inbound</b></div>
                  {inLinks.map((e) => <div key={e.s} className="small">{pack.regions[e.s].name} — {fmt(e.w)}/d <i>({EDGE_LABEL[e.t]})</i></div>)}
                  <div className="small"><b>Top outbound</b></div>
                  {outLinks.map((e) => <div key={e.d} className="small">{pack.regions[e.d].name} — {fmt(e.w)}/d <i>({EDGE_LABEL[e.t]})</i></div>)}
                </div>
                <div>
                  <div className="small">Arrival: <b>{rSum && rSum.arrival >= 0 ? `day ${rSum.arrival.toFixed(1)}` : 'unreached'}</b>
                    {rSum && rSum.source >= 0 ? ` from ${pack.regions[rSum.source].name}` : ''}</div>
                  <div className="small">Peak I: {rSum ? fmtP(rSum.peakI) + ' day ' + rSum.peakDay.toFixed(0) : '—'}</div>
                  <div className="small">Final attack {rSum ? fmtP(rSum.finalAttack) : '—'} · deaths {rSum ? fmtP(rSum.finalDead) : '—'}</div>
                  {rRec && (
                    <svg viewBox="0 0 200 60" className="spark">
                      {(['S', 'E', 'I', 'R', 'D'] as const).map((k, si) => {
                        const arr = rRec[k]; const mx = Math.max(1, ...arr);
                        const col = ['#999', '#f4a259', '#e63946', '#06d6a0', '#555'][si];
                        return <polyline key={k} fill="none" stroke={col} strokeWidth={1.2}
                          points={arr.map((v, i) => `${(i / Math.max(1, arr.length - 1) * 196 + 2).toFixed(1)},${(58 - (v / mx) * 54).toFixed(1)}`).join(' ')} />;
                      })}
                    </svg>
                  )}
                </div>
              </div>
              <div className="row">
                <button className="btn xs" onClick={() => setSeedRegion(selected)} title="Use this region as the outbreak seed">Set as seed</button>
                <button className="btn xs" onClick={() => setQuar((q) => q.includes(selected) ? q : [...q, selected])} title="Set this region's edges to 0 (quarantine)">Quarantine (edges=0)</button>
              </div>
            </div>
          )}
        </section>

        <aside className="ctrl">
          <h3>Controls</h3>
          <label title="Virus preset — fills all sliders; sliders stay editable afterwards">Preset
            <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              <option value="custom">Custom / hypothetical</option>
              {pack.viruses.viruses.map((v) => <option key={v.id} value={v.id}>inspired by {v.name}</option>)}
            </select>
          </label>
          {preset && presetId !== 'custom' && (
            <div className="small muted">Reported R0 {preset.R0_reported ?? preset.R0_preset} · L {preset.latent_L_days_preset}d · T {preset.infectious_T_days_preset}d · p {preset.death_share_p_preset} · a {preset.airborne_share_a}
              {' '}{unverified && <span className="badge">unverified</span>}
              <div>{(preset.sources ?? '').split(' ').filter((s) => s.startsWith('http')).map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">source </a>)}</div>
            </div>
          )}
          <Slider label="R0" title="Basic reproduction number (local, well-mixed)" v={R0} set={setR0} min={0} max={15} step={0.1} />
          <Slider label="Latent L (days)" title="Mean latent period; σ=1/L" v={L} set={setL} min={0.5} max={21} step={0.1} />
          <Slider label="Infectious T (days)" title="Mean infectious period; γ+μ=1/T" v={T} set={setT} min={1} max={14} step={0.1} />
          <Slider label="Death share p" title="Fraction of infections that die; μ=p/T" v={p} set={setP} min={0} max={0.7} step={0.001} />
          <Slider label="Airborne share a" title="Fraction of β that is airborne (density-scaled)" v={aShare} set={setAShare} min={0} max={1} step={0.05} />
          <div className="small muted">Derived live: σ={derived.sigma.toFixed(3)}/d · γ={derived.gamma.toFixed(4)}/d · μ={derived.mu.toFixed(5)}/d · β_air={derived.betaAir.toFixed(3)} · β_contact={derived.betaContact.toFixed(3)} · R0={ratesToDerived(derived.betaAir, derived.betaContact, derived.gamma, derived.mu, derived.sigma).R0.toFixed(2)}</div>
          <Slider label="Mobility m" title="Scales all inter-region flows" v={m} set={setM} min={0} max={1.5} step={0.05} />
          <div className="row">{[0, 0.4, 1, 1.5].map((v) => <button key={v} className="btn xs" onClick={() => setM(v)} title={v === 0 ? 'closed borders' : v === 0.4 ? '2020-like (1.78/4.54)' : v === 1 ? 'baseline' : 'increased'}>m={v}</button>)}</div>
          <Slider label="Density k" title="Applies only to airborne part; 0.1–0.3 airborne, ~0 contact" v={kD} set={setKD} min={0} max={1} step={0.05} />
          <label className="chk" title="Gamma-distributed per-step β multiplier (dispersion k)"><input type="checkbox" checked={ss} onChange={(e) => setSS(e.target.checked)} /> superspreading</label>
          {ss && <Slider label="dispersion k_ss" title="Lower = burstier" v={kSS} set={setKSS} min={0.05} max={1} step={0.05} />}
          <div className="row2">
            <label title="Simulated days">Days <input type="number" value={dur} onChange={(e) => setDur(Number(e.target.value))} min={30} max={730} /></label>
            <label title="Integration step; smaller = more accurate, slower">Δt <select value={dt} onChange={(e) => setDt(Number(e.target.value))}><option value={0.1}>0.1</option><option value={0.25}>0.25</option><option value={0.5}>0.5</option><option value={1}>1</option></select></label>
          </div>
          <div className="row2">
            <label title="Seed for reproducibility; runs use s, s+1, …">Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
            <button className="btn xs" onClick={() => setSeed(Math.floor(Math.random() * 1e9))} title="Draw a fresh random seed">new seed</button>
          </div>
          <label title="Region where the outbreak starts">Start region
            <input placeholder="search…" value={seedSearch} onChange={(e) => setSeedSearch(e.target.value)} />
            <select value={seedRegion} onChange={(e) => setSeedRegion(Number(e.target.value))}>
              {seedOptions.map(({ r, i }) => <option key={i} value={i}>{r.name} ({fmt(r.population)})</option>)}
            </select>
          </label>
          <Slider label="Initial exposed" title="Seed cases in start region" v={startExp} set={setStartExp} min={1} max={500} step={1} />
          <div className="small">Quarantined ({quar.length}): {quar.map((q) => pack.regions[q]?.id).join(', ') || 'none'}
            <button className="btn xs" onClick={() => setQuar([])}>clear</button></div>
          <div className="small">Islands tracked ({islandIdx.length}). Toggle in charts section.</div>
        </aside>
      </main>

      <section className="tabs">
        {(['charts', 'math', 'data', 'sources', 'history'] as const).map((t) => (
          <button key={t} className={tab === t ? 'btn on' : 'btn'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </section>

      {tab === 'charts' && (
        <section className="charts">
          {result && (
            <>
              <SeriesChart title="Global SEIRD over time (single run)" xs={result.days}
                series={[
                  { label: 'S', color: '#999', ys: result.S }, { label: 'E', color: '#f4a259', ys: result.E },
                  { label: 'I', color: '#e63946', ys: result.I }, { label: 'R', color: '#06d6a0', ys: result.R },
                  { label: 'D', color: '#666', ys: result.D },
                ]} csvName="global_seird.csv" note={`Single run, seed ${result.seed}.`} />
              <SeriesChart title="Regions reached over time (single run)" xs={result.days}
                series={[{ label: 'reached', color: '#ffd166', ys: result.reached }]} csvName="reached.csv" />
              <ArrivalTimeline title="Island arrival days (single run)" names={islandIdx.map((i) => pack.regions[i].name)}
                arrivals={islandIdx.map((i) => result.summaries[i].arrival)} csvName="arrivals.csv" />
            </>
          )}
          <div className="chart">
            <div className="chart-head"><h4>Main IA experiment: m-sweep (mean of N runs)</h4>
              <span><label className="small">runs <input type="number" value={runsPer} min={10} max={200} onChange={(e) => setRunsPer(Number(e.target.value))} style={{ width: 60 }} /></label>
                <button className="btn xs" disabled={busy} onClick={() => runSweep('m')} title="m in {0,0.1,…,1.5} × N runs">Run m-sweep</button>
                <button className="btn xs" onClick={() => mSweep && downloadCsv('msweep.csv', toCsv(['island', 'm', 'prob', 'lo', 'hi', 'med'], mSweep.flatMap((arr, mi) => arr.map((s, k) => [pack.regions[islandIdx[k]].name, M_SWEEP[mi], s.prob, s.ci[0], s.ci[1], s.med]))))}>CSV</button></span></div>
            {mSweep
              ? <SweepChart title="" mVals={M_SWEEP} perM={mSweep} islandNames={islandIdx.map((i) => pack.regions[i].name)} csvName="msweep.csv" />
              : <div className="muted small">Not run yet. Default 30 runs per m (10–200).</div>}
          </div>
          <div className="chart">
            <div className="chart-head"><h4>Sensitivity (mean ± range across runs)</h4>
              <span><button className="btn xs" disabled={busy} onClick={() => runSweep('L')} title="Vary latent period L">sweep L</button>
                <button className="btn xs" disabled={busy} onClick={() => runSweep('gamma')} title="Vary recovery hazard γ">sweep γ</button>
                <button className="btn xs" disabled={busy} onClick={() => runSweep('mu')} title="Vary death hazard μ">sweep μ</button></span></div>
            {sensRes
              ? <div className="small">Swept {sensKind}: {sensRes.vals.join(', ')} — peak I mean(range): {sensRes.peak.map((x) => `${fmtP(x.mean)}`).join(' · ')}; dead: {sensRes.dead.map((x) => fmtP(x.mean)).join(' · ')}
                <button className="btn xs" onClick={() => downloadCsv('sensitivity.csv', toCsv(['param', 'peak_mean', 'peak_lo', 'peak_hi', 'dead_mean'], sensRes.vals.map((v, i) => [v, sensRes.peak[i].mean, sensRes.peak[i].lo, sensRes.peak[i].hi, sensRes.dead[i].mean])))}>CSV</button></div>
              : <div className="muted small">Not run yet.</div>}
          </div>
          <div className="chart">
            <div className="chart-head"><h4>Baseline vs comparison</h4>
              <span><button className="btn xs" disabled={!result} onClick={() => result && setBaseline({ label: `R0=${R0} m=${m} L=${L}`, I: result.I, days: result.days })}>save baseline</button>
                <button className="btn xs" onClick={() => setBaseline(null)}>clear</button></span></div>
            {baseline && result
              ? <SeriesChart title="" xs={result.days} series={[
                { label: 'baseline I', color: '#888', ys: baseline.I.slice(0, result.days.length) },
                { label: 'current I (single run)', color: '#e63946', ys: result.I },
              ]} csvName="baseline_overlay.csv" note="Single run vs saved baseline." />
              : <div className="muted small">Save a baseline, change one parameter, re-run to overlay.</div>}
          </div>
          <ScatterR0 presets={pack.viruses.viruses.map((v) => ({ name: v.name, R0: v.R0_preset, p: v.death_share_p_preset, unverified: (v.sources ?? '').includes('TEXTBOOK') }))} />
          <div className="chart">
            <div className="chart-head"><h4>Island selection (by connectivity, never hard-coded safe)</h4></div>
            <div className="islands">
              {islandIdx.map((i) => (
                <label key={i} className="chk small" title={`inbound ${fmt(pack.regions[i].inW)}/day`}>
                  <input type="checkbox" checked readOnly onClick={() => setIslandIdx((s) => s.filter((x) => x !== i))} />{pack.regions[i].name} ✕</label>
              ))}
            </div>
            <button className="btn xs" onClick={() => {
              const remoteIds = new Set(pack.islands.remote.map((r) => String(r.map_unit_id)));
              setIslandIdx(defaultIslandSelection(pack.regions, remoteIds, 12));
            }}>reset default (12 least-connected + remote list)</button>
          </div>
        </section>
      )}
      {tab === 'math' && <MathPanel />}
      {tab === 'data' && <DataPanel meta={pack.meta as Record<string, unknown>} />}
      {tab === 'sources' && <SourcesPanel />}
      {tab === 'history' && <HistoryPanel onScenario={applyScenario} />}

      <footer className="muted small">
        Outbreak · {pack.regions.length} regions · {pack.edges.length} directed edges · base {(import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL} ·
        GHSL 2020 · Natural Earth (public domain) · OpenFlights (ODbL) · OurAirports (public domain) · World Bank (CC BY 4.0) · outputs are not forecasts.
      </footer>
    </div>
  );
}

function Slider({ label, title, v, set, min, max, step }: { label: string; title: string; v: number; set: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <label title={title}>{label}: {typeof v === 'number' ? (step < 0.01 ? v.toFixed(4) : step < 1 ? v.toFixed(2) : v.toFixed(0)) : v}
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
}
