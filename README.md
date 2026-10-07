# Outbreak

Educational, client-side-only metapopulation SEIRD simulator for a Mathematics: Analysis and Approaches HL Internal Assessment.

> Research question (editable in the app header):
> "How does interregional travel connectivity affect the probability and arrival time of a hypothetical outbreak in remote island regions in a population-weighted global SEIRD model?"

The main experiment varies one global travel-connectivity multiplier `m` while disease parameters and population stay fixed. Sensitivity analyses vary the latent period `L`, recovery hazard `γ` and death hazard `μ`.

Outcomes (as defined in-app):
- **Island introduction probability** — fraction of repeated runs reaching the island by day 365, with Wilson 95% CI.
- **Median arrival day** (among reached runs, with IQR).
- **Island burden** — final infected/dead proportions.
- **Global spread** — peak infectious proportion + day, regions reached over time.

Remoteness lowers/delays import probability but **does not make any island immune**.

## Setup

Requires Node 22+.

```bash
npm i
python3 scripts/build-data.py   # offline preprocessing: data/ -> public/data/
npm run dev                     # dev at /
npm run build                   # production build (base /Outbreak/)
npm run test                    # Vitest unit tests
npx vite preview --base /Outbreak/  # verify Pages path
```

Preprocessing output (`public/data/regions.json`, `edges.json`, `viruses.json`, `islands.json`, `meta.json`) is **committed**, so the deployed site needs no build-time preprocessing.

## Data sources, years, licences

| Dataset | Year/version | Licence |
|---|---|---|
| GHSL GHS-POP R2023A epoch 2020 (JRC) — Schiavina et al. 2023, doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE | 2020, 30″ → 0.1°/0.25°/1° | Free reuse with attribution |
| Natural Earth Admin-0 map units + Admin-1 + land/minor islands | 1:10m | Public domain |
| OpenFlights airports/routes (~2014 snapshot, `airlines` = carriers, **not** passengers) | ~2014 | ODbL — attribute + share-alike (credited in app + here) |
| OurAirports full list | — | Public domain |
| IATA passenger totals 2019 4.54bn / 2020 1.78bn / 2023 4.44bn / 2024 4.89bn | 2024 | Totals only |
| World Bank WDI (SP.POP.TOTL, EN.POP.DNST, IS.AIR.PSGR) | 2019–2023 | CC BY 4.0 — cross-check only, never in model |
| Virus presets (15) + island/history tables (URLs per row) | — | Rows tagged `[TEXTBOOK-UNVERIFIED]` show an "unverified" badge |

UN WPP 2024 context shown in app: ~8.2bn mid-2024, peak ~10.3bn mid-2080s.

Totals: GHSL source **7,840,952,947**; regions hold **7,840,811,597**; dropped **141,350** (529 coastal cells >50 km from any polygon, per `data/README.md`). `meta.json` records all of this. World Bank 2023 total (8,062,923,417) is a different source/year and is never mixed in.

## Regions & travel network

`scripts/build-data.py` (offline, stdlib-only):

- Starts from 298 map units. Splits every unit over 20M people or 1M km² (plus SHN special-case) into admin-1 → **2,375 regions**, 34,912 directed edges (20,770 air observed, 14,131 land synthetic, 11 estimated).
- Inhabited island units are never merged; SHN is split into Saint Helena / Ascension / Tristan da Cunha (pop override 4400/770/250 scaled to parent total).
- Population: map-unit GHSL totals preserved exactly; admin-1 splits weighted by 0.25° GHSL cells scaled to the parent 0.1°-based total (asserted).
- Area: parent area split by planar polygon share; density = pop/area; centroid from polygon bbox (CSV centroid for unsplit).
- Airports (3,251 mapped) assigned point-in-polygon to subregions, else nearest-centroid fallback.
- Air weights: `W = c·A·P_i^0.7·P_j^0.7/(d+100)^1.0`, `c` scaled so daily air at m=1 ≈ 13.4M (actual 13.86M incl. overlapping land on shared pairs, +3.4% — documented in meta). Rows are **not** normalised.
- Land (synthetic): border-detected via bbox overlap + vertex proximity (<~27 km), same gravity with A=1 and same `c`.
- Sea/manual (estimated, (trips/yr×pax)/365): Tokelau↔Samoa ferry ~7.1/d; Pitcairn↔FP/NZ ~0.55/d each; Tristan↔South Africa ~2.5/d; St Helena↔Johannesburg ~21/d; Niue↔Auckland ~32/d.
- Tiny regions (area <150 km²) stored as point markers; polygons quantized to 2 decimals.

Each region stores id, name, parentUnit, population, areaKm2, density, centroid, isIsland, isRemote, airports, in/out weights, polygon-or-point. `meta.json` holds versions, years, licences, totals, dropped, counts, calibration.

## Model

Per region S/E/I/R/D with `β_i = β_air·(ρ_i/ρ_med)^k + β_contact`, `λ_i = β_i·I_i/N_i`, σ=1/L, p=μ/(γ+μ), local R0=(β_air+β_contact)/(γ+μ) (labelled local well-mixed, not global invasion). Travel: Poisson(`m·W·Δt·(E_j+I_j)/N_j`) E→E/I→I with balanced S-swap (N constant), first-import day/source recorded. Tau-leap binomial `p=1−e^(−hΔt)`, I-exit split γ:μ; deterministic expectation above ~10⁴. Seeded mulberry32; runs s,s+1,… reproducible. Optional gamma per-step β multiplier (k_ss default 0.2). See Math panel (KaTeX) for derivations.

Presets loaded from `public/data/viruses.json` (from `data/04_viruses/virus_presets.json`); choosing fills sliders, sliders stay editable; labelled "inspired by X" with reported values, source links, unverified badges. Conversion σ=1/L, γ+μ=1/T, μ=p/T, γ=(1−p)/T, β=R0/T, β_air=aβ.

## App

- Equal Earth (centred ~160°E), Canvas + d3-geo, zoom/pan, Pacific/S. Atlantic jumps, log-density layer pre-run, S/E/I/R/D layer + reached outlines during run, island circle markers, fading import arcs, optional faint air routes.
- Play/pause/step/reset/speed (days/s), day + global S/E/I/R/D, clickable region card (links with observed/estimated/synthetic labels, arrival/source/peak/attack/deaths, sparkline).
- Island view defaults to 12 least-connected inhabited island regions by inbound weight + `remote_islands.csv` (by connectivity, never hard-coded safe).
- Charts (each with CSV export, labelled single-run vs mean-of-N): global SEIRD, reached, arrival timeline, **m-sweep** ({0,0.1,…,1.5}×N, Wilson CI + median/IQR), L/γ/μ sensitivity (mean±range), baseline overlay, R0-vs-fatality scatter (log x).
- One-click 1918 Samoa scenarios (open vs ASM quarantined); zero-edge regions never reached.
- Responsive laptop/phone layout; Web Worker keeps UI live; works offline after build (no tiles/keys).

## Limitations

Data years differ (pop 2020, routes ~2014, pax 2024, manuals estimates); routes lack pax so weights are modelled; E assumed non-infectious; CFR overstates IFR; well-mixed regions, constant μ; only travel interventions; params vary widely — do sensitivity analysis. **Outputs are not forecasts.** The IA workflow panel guides recording/plotting without writing the essay.

## Deployment

- `vite.config.ts`: `base` `/Outbreak/` in production, `/` in dev; no domain-root links (asset URLs via `BASE_URL` under the base).
- `.github/workflows/deploy.yml` builds `dist/` and deploys to GitHub Pages.

## Files created

- `scripts/build-data.py`, `public/data/{regions,edges,viruses,islands,meta}.json`
- `src/model/{types,rng,params,stats,simulation}.ts`, `src/model/model.test.ts`
- `src/worker/simWorker.ts`, `src/lib/data.ts`
- `src/components/{MapView,Charts,Panels}.tsx`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`
- `vite.config.ts`, `package.json`, `tsconfig.json`, `index.html`, `.github/workflows/deploy.yml`, `README.md`
