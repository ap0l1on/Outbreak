import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function Tex({ src }: { src: string }) {
  const html = useMemo(() => katex.renderToString(src, { throwOnError: false }), [src]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathPanel() {
  return (
    <div className="panel">
      <h3>Math — the metapopulation SEIRD model</h3>
      <p><b>Why regions?</b> Simulating billions of individuals is infeasible and unnecessary for the IA question.
        The world is aggregated into ~2,375 regions (map units, split into admin-1 where populous/large).
        Each region is well mixed; mixing between regions happens only through explicit travel edges.</p>
      <p><b>Grid cells → regions.</b> Each 0.1° GHSL cell centre is assigned point-in-polygon to a region
        (0.25° cells used as weights for admin-1 splits, scaled to the parent 0.1°-based total so totals match exactly).
        Density <Tex src="\rho_i = N_i / A_i" /> with area in km².</p>
      <p><b>Travel matrix & calibration.</b> Air edges aggregate OpenFlights airport routes to region pairs.
        Gravity weight <Tex src="W_{ij} = c\, A_{ij}\, P_i^{\alpha} P_j^{\alpha}/(d_{ij}+d_0)^{\delta}" />
        with <Tex src="\alpha=0.7,\ \delta=1.0,\ d_0=100\,\mathrm{km}" />. <Tex src="A_{ij}" /> is airline-route pairs
        (capacity proxy, not passengers). <Tex src="c" /> is scaled so total daily air trips at m=1 ≈ 4.89×10⁹/365 ≈ 13.4M.
        Rows are <b>not</b> normalised: hubs keep larger absolute flows than remote islands — that difference is the experiment.
        Land edges join border-sharing regions (same gravity, A=1, <i>synthetic</i>); sea/manual links use
        (trips/year × passengers)/365 (<i>estimated</i>).</p>
      <p><b>Local SEIRD (per day).</b> Force of infection <Tex src="\lambda_i = \beta_i I_i/N_i" />,{' '}
        <Tex src="\beta_i = \beta_{\mathrm{air}}(\rho_i/\rho_{\mathrm{med}})^k + \beta_{\mathrm{contact}}" />.
        Density scaling applies only to the airborne part; k is an assumption (0.1–0.3 airborne, ~0 contact).</p>
      <div className="eq"><Tex src="\begin{aligned} \dot S &= -\lambda S \\ \dot E &= \lambda S - \sigma E \\ \dot I &= \sigma E - (\gamma+\mu) I \\ \dot R &= \gamma I \\ \dot D &= \mu I \end{aligned}" /></div>
      <p>Units: all rates per day. <Tex src="\sigma=1/L" /> (latent period L),{' '}
        <Tex src="\gamma+\mu=1/T" /> (infectious period T), death share{' '}
        <Tex src="p=\mu/(\gamma+\mu)" />. Local <Tex src="R_0=(\beta_{\mathrm{air}}+\beta_{\mathrm{contact}})/(\gamma+\mu)" /> is{' '}
        <b>local, well-mixed</b>: it does not predict global invasion.</p>
      <p><b>Preset conversion.</b> <Tex src="\sigma=1/L,\ \mu=p/T,\ \gamma=(1-p)/T,\ \beta=R_0/T,\ \beta_{\mathrm{air}}=a\beta,\ \beta_{\mathrm{contact}}=(1-a)\beta" />.</p>
      <p><b>Numerics.</b> Tau-leap binomial: each rate h becomes <Tex src="p=1-e^{-h\Delta t}" /> per step
        (Δt default 0.25 d); I-exits split recovery/death by γ:μ (competing risks). Compartments above ~10⁴ use
        deterministic expectation for speed; small ones stay stochastic. Imports per route:{' '}
        <Tex src="\mathrm{Poisson}(m W_{ij}\Delta t\,(E_j+I_j)/N_j)" />, moved E→E / I→I with a balanced S-swap so
        regional N stays constant. First-import day and source are recorded.</p>
      <p><b>Why m matters for islands.</b> Expected infected imports per day ≈{' '}
        <Tex src="m\sum_j W_{ij}(I_j/N_j)" />, so <Tex src="P(\mathrm{no\ import})\approx e^{-\mathrm{expected}}" />.
        Larger m raises import pressure roughly linearly; remoteness lowers/delays but <b>never grants immunity</b>:
        with m&gt;0 and any edge, cumulative import probability → 1 over long horizons.</p>
      <p><b>β is local; travel carries people.</b> Airborne transmission never crosses oceans directly —
        flights/ships move infected <i>people</i> who then seed local airborne/contact spread.</p>
    </div>
  );
}

export function DataPanel({ meta }: { meta: Record<string, unknown> }) {
  const m = meta as {
    num_regions: number; num_edges: number; num_air_edges: number; num_land_edges: number;
    num_estimated_edges: number; dropped: number; source_total: number; region_total: number;
    calibration: { c: number; target: number }; daily_air_trips_m1: number;
  };
  return (
    <div className="panel">
      <h3>Data</h3>
      <ul className="tight">
        <li>GHS-POP R2023A epoch 2020 (JRC): 30″ grid summed to 0.1°/0.25°/1°. Source total <b>7,840,952,947</b>; regions hold <b>{Number(m?.region_total).toLocaleString()}</b>; dropped <b>{Number(m?.dropped).toLocaleString()}</b> (coastal &gt;50 km, per data/README). Free reuse with attribution.</li>
        <li>Natural Earth 1:10m map units + admin-1 (public domain). Regions: <b>{m?.num_regions}</b>.</li>
        <li>OpenFlights routes/airports (~2014, no pax, ODbL): <b>observed</b> route structure → gravity weights; 3,257 airports, 37,042 routes, 4,862 map-unit pairs.</li>
        <li>OurAirports (public domain): gap-filling airport list.</li>
        <li>IATA totals 2019 4.54bn / 2020 1.78bn / 2023 4.44bn / 2024 4.89bn → calibration 13.4M/day.</li>
        <li>World Bank WDI (CC BY 4.0): cross-check only, never in model.</li>
        <li>Virus presets (15) + remote/historical islands: sources per row; <span className="badge">unverified</span> where tagged.</li>
      </ul>
      <p>Edges: <b>{m?.num_edges}</b> directed — air <b>observed</b> ({m?.num_air_edges}), land <b>synthetic</b> ({m?.num_land_edges}, border-detected), manual sea/air <b>estimated</b> ({m?.num_estimated_edges}). Daily air at m=1 ≈ {(Number(m?.daily_air_trips_m1) / 1e6).toFixed(1)}M.</p>
      <p className="muted">Years differ (pop 2020, routes ~2014, pax 2024, manuals estimates) — see Limitations.</p>
      <h4>Limitations (also README)</h4>
      <ul className="tight">
        <li>Data years differ; manuals are estimates.</li>
        <li>Routes carry no passenger counts — weights are modelled.</li>
        <li>E assumed non-infectious (false for COVID/Andes pre-symptomatic).</li>
        <li>CFR overstates IFR.</li>
        <li>Each region well mixed; constant μ; no age/household/hospital.</li>
        <li>No interventions except travel reduction m / quarantine.</li>
        <li>Published params vary widely (SARS R0 0.3–4.1; COVID CFR &lt;1–13.6%). Do sensitivity analysis.</li>
        <li><b>Outputs are not forecasts.</b></li>
      </ul>
      <h4>Explore this model (IA workflow — do not submit as essay)</h4>
      <ol className="tight">
        <li>Record datasets, years, network source.</li>
        <li>Choose a hub start + baseline preset (e.g. Influenza 1918).</li>
        <li>Run the m-sweep with ≥30 runs per m.</li>
        <li>Compare island probability + median arrival.</li>
        <li>Repeat at different L, γ, μ.</li>
        <li>Export CSVs, plot, discuss uncertainty + assumptions.</li>
      </ol>
    </div>
  );
}

const SOURCES: [string, string][] = [
  ['JAMA Netw Open — incubation by variant', 'https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2795489'],
  ['Serial intervals Delta/Omicron', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10291789'],
  ['IJMR comparison table', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8555610/table/T1'],
  ['Khan et al. 2022 CFR meta-analysis', 'https://doaj.org/article/9e91d897f41f4ba99f0e1449aa6d154f'],
  ['MERS R0/CFR Riyadh 2014', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4322060'],
  ['WHO WPRO avian influenza Aug 2026', 'https://cdn.who.int/media/docs/default-source/wpro---documents/emergency/surveillance/avian-influenza/ai_20260828.pdf'],
  ['Andes person-to-person (CDC EID 2014)', 'https://wwwnc.cdc.gov/eid/article/20/10/14-0353'],
  ['Andes respiratory (Frontiers 2019)', 'https://www.frontiersin.org/journals/microbiology/articles/10.3389/fmicb.2019.02992/full'],
  ['Hantavirus incubation (CDC)', 'https://stacks.cdc.gov/view/cdc/16079/cdc_16079_DS1.pdf'],
  ['Epuyén outbreak summary', 'https://www.2minutemedicine.com/increased-close-contact-leads-to-spread-of-andes-virus-in-argentina/'],
  ['UN WPP 2024', 'https://www.ungeneva.org/en/news-media/news/2024/07/95264/growing-or-shrinking-what-latest-trends-tell-us-about-worlds'],
  ['GHS-POP R2023A (JRC)', 'https://data.jrc.ec.europa.eu/dataset/2ff68a52-5b5b-4a22-8f40-c41da8332cfe'],
  ['Natural Earth', 'https://www.naturalearthdata.com'],
  ['OpenFlights', 'https://openflights.org/data'],
  ['OurAirports', 'https://ourairports.com/data/'],
  ['World Bank WDI', 'https://data.worldbank.org'],
  ['IATA 2024 totals', 'https://globalnation.inquirer.net/263118/global-air-travel-hits-record-in-2024-as-post-covid-recovery-continues/amp'],
  ['Maritime quarantine 1918–19 (CDC EID)', 'https://wwwnc-origin.cdc.gov/eid/article/14/3/pdfs/07-0927.pdf'],
  ['Pacific islands escaped 1918 (Cambridge)', 'https://www.cambridge.org/core/product/392A0BE5AD01AE942060570E8B88CB83/core-reader'],
  ['McLane 2013 Paradise Locked', 'https://sites.otago.ac.nz/Sites/article/view/215'],
  ['Last places w/o COVID (VOA)', 'https://learningenglish.voanews.com/a/the-last-places-on-earth-without-coronavirus/5399052.html'],
  ['Nauru/Tuvalu/Tonga COVID-free', 'https://www.pacificislandtimes.com/post/nauru-tuvalu-and-tonga-among-the-only-five-countries-untouched-by-covid'],
];

export function SourcesPanel() {
  return (
    <div className="panel">
      <h3>Sources</h3>
      <ul className="tight">{SOURCES.map(([t, u]) => (
        <li key={u}><a href={u} target="_blank" rel="noreferrer">{t}</a></li>
      ))}</ul>
      <p className="muted">UN WPP 2024 context: ~8.2bn mid-2024, peak ~10.3bn mid-2080s.</p>
    </div>
  );
}

export function HistoryPanel({ onScenario }: { onScenario: (kind: 'samoa-open' | 'samoa-quarantine') => void }) {
  return (
    <div className="panel">
      <h3>Island history (qualitative analogues — present-day pop/routes, not 1918 reconstructions)</h3>
      <ul className="tight">
        <li><b>Western Samoa 1918:</b> SS Talune from Auckland, Nov 1918, no quarantine; 19–22% died. <button className="btn xs" onClick={() => onScenario('samoa-open')}>Run: 1918 preset, Auckland seed, Samoa link on</button></li>
        <li><b>American Samoa 1918–21:</b> naval quarantine from 23 Nov 1918; no deaths (&lt;100 km away). <button className="btn xs" onClick={() => onScenario('samoa-quarantine')}>Run: same, American Samoa edges = 0</button></li>
        <li><b>American Samoa 1926:</b> influenza arrived; ~1/1000 mortality (~200× lower). Lesson: quarantine delays but does not prevent.</li>
        <li><b>Pacific COVID 2020–22:</b> Nauru/Tokelau/Tuvalu among 33 case-free Apr 2020; Nauru/Tuvalu/Tonga still free late 2021. Arrival order follows connectivity.</li>
      </ul>
      <p className="muted">Acceptance check: a region with edges set to 0 is never reached in any run.</p>
    </div>
  );
}
