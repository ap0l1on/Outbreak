# Build prompt — Outbreak

Build a complete, working educational web app called **Outbreak** in the current repository. The repository and project folder are named "Outbreak". It supports a Mathematics: Analysis and Approaches HL Internal Assessment about the geographical spread of a hypothetical outbreak across a population-weighted world map.

This is a **regional (metapopulation) simulation**. Do not render or simulate billions of individual people. Build the real application, not a mockup. Run the production build and fix all errors before finishing.

First inspect the repository and follow any instructions in it. The app goes in the repository root. Do not create a nested `Outbreak/Outbreak` folder. **A prepared data pack already exists in `data/`. Read `data/README.md` first.** Use these files as the data source. Do not re-download them, and do not invent replacement data.

---

## 1. Research question and outcomes

Show this research question in the app and the README, and make it editable:

> "How does interregional travel connectivity affect the probability and arrival time of a hypothetical outbreak in remote island regions in a population-weighted global SEIRD model?"

The main experiment varies one global travel-connectivity multiplier `m`, while disease parameters and population stay fixed. Sensitivity analyses then vary the latent period `L`, the recovery hazard `γ` and the death hazard `μ`.

Outcomes, defined precisely:
- **Island introduction probability.** For each selected island region, the fraction of repeated runs in which it gets at least one infection by day 365. Show a 95% confidence interval (Wilson interval).
- **Median arrival day.** The day of first infection, among the runs where that island is reached.
- **Island burden.** Final infected and dead proportions in the selected regions.
- **Global spread.** Global peak infectious proportion, its day, and the number of regions reached over time.

The app must explain that remoteness lowers or delays the chance of an imported case, but **does not make any island immune**.

---

## 2. Technology and deployment

- React, TypeScript and Vite. The app is static and client-side only: no backend, no API keys, no live map tiles. It must work offline after the build.
- Draw the map from local vector data with Canvas (for performance), plus `d3-geo` for the projection.
- Run the simulation in a **Web Worker** so the UI stays responsive during repeated runs.
- The layout must be responsive: a large map, a control panel, charts, and a Math/Data/Sources panel. It must be usable on a laptop and on a phone.
- Vite `base` is `/Outbreak/` for production and `/` for development. Use only relative asset paths and nothing linked from the domain root.
- Add a GitHub Actions workflow that builds and deploys `dist/` to GitHub Pages.
- Keep the model code (types, RNG, simulation step, travel matrix, presets) in `src/model/`, separate from the UI. Add unit tests (Vitest) for:
  - conservation: S+E+I+R+D = N in every region at every step;
  - no negative or oversized compartments;
  - a region with no links is never infected unless it is the seed;
  - the preset conversion formulas.

---

## 3. Data pack (already in `data/`)

The data was downloaded and processed on 2026-10-06. Write an **offline preprocessing script** (`scripts/build-data.ts` or Python in `scripts/`, run before the build) that reads these files and writes compact JSON to `public/data/`. The browser loads only that output. Commit the output so the deployed site needs no preprocessing step.

### 3.1 Population — `data/01_population/`
| File | Contents |
| --- | --- |
| `GHS_POP_2020_0p1deg.tif`, `_0p25deg.tif`, `_1deg.tif` | GHSL GHS-POP R2023A, epoch 2020. Each cell holds the number of people in it (summed from the 30″ grid), in EPSG:4326 with origin −180, 90. World total = **7,840,952,947**, exactly preserved. |
| `GHS_POP_2020_cells_0p25deg.csv` / `_1deg.csv` | `lat_center, lon_center, population` for populated cells (162,607 and 14,936 rows) |
| `population_by_map_unit_GHSL2020.csv` | For each Natural Earth map unit: `unit_id`, name, type, continent, subregion, `ghsl_pop_2020`, `area_km2`, `density_per_km2`, centroid. Covers 7,840,811,600 people; 141,347 coastal people more than 50 km from any polygon are unassigned. |
| `worldbank_population_2023.csv`, `worldbank_density_2022.csv` | Only for cross-checking. The World Bank 2023 world total is 8,062,923,417, a different source and year. Never mix it into the model. |

Citation: Schiavina M., Freire S., Carioli A., MacManus K. (2023). *GHS-POP R2023A — GHS population grid multitemporal (1975–2030)*. European Commission, JRC. doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE. Free reuse with attribution.

Context to display in the app: the UN World Population Prospects 2024 puts the world population at about 8.2 billion in mid-2024, with a projected peak of about 10.3 billion in the mid-2080s.

### 3.2 Geography — `data/02_geography/` (Natural Earth, public domain)
- `map_units_detailed.geojson` and `map_units_simplified.geojson`: Admin-0 **map units**, which keep overseas territories separate (American Samoa, Pitcairn, Tokelau, Saint Helena and so on). Key: `unit_id` (= `gu_a3`).
- `admin1_simplified.geojson`: states and provinces (`adm1_code`, `gu_a3`).
- `minor_islands.geojson`, `land_simplified.geojson`, `populated_places.csv` (cities with `pop_max`).
- Original zips are in `data/00_raw_sources/`.

### 3.3 Travel — `data/03_travel/`
| File | Contents |
| --- | --- |
| `airports_with_scheduled_routes.csv` | 3,257 OpenFlights airports with routes: IATA code, lat/lon, `routes_in`, `routes_out`, `unit_id` |
| `airport_route_edges.csv` | 37,042 direct airport-to-airport routes: `airlines` (number of carriers, a capacity proxy and **not** a passenger count), `distance_km`, `src_unit`, `dst_unit` |
| `map_unit_route_matrix.csv` | 4,862 linked map-unit pairs: `routes`, `airline_route_pairs`, `min_distance_km` |
| `connectivity_by_map_unit.csv` | Map units sorted from least to most connected; 54 have no scheduled airport |
| `ourairports_all_airports.csv` | Full OurAirports list (public domain), for filling gaps |
| `global_air_passengers_IATA.csv` | 2019: 4.54 bn; 2020: 1.78 bn; 2023: 4.44 bn; 2024: 4.89 bn passengers |
| `worldbank_air_passengers_2019.csv` | Passengers carried by each country's airlines, 2019 (World Bank, CC BY 4.0) |

OpenFlights data is ODbL, so credit it in the app and README. It is a snapshot from about 2014 with no passenger volumes.

### 3.4 Viruses — `data/04_viruses/`
`virus_parameters.csv` and `virus_presets.json` hold 15 viruses: reported R0, incubation, fatality, routes, a source URL per row, and the converted rates `sigma, gamma, mu, beta_total, beta_air, beta_contact`. Rows tagged `[TEXTBOOK-UNVERIFIED]` must show an "unverified" badge in the app.

### 3.5 Islands and history — `data/05_islands/`
- `remote_islands.csv`: 20 remote islands with `map_unit_id`, approximate population, access description (air or sea) and notes.
- `historical_island_outbreaks.csv`: validation cases with sources (section 8 below).

---

## 4. Building regions (preprocessing)

Target **about 800–2,500 regions**:
1. Start from the map units. Split large or populous units into admin-1 regions: any unit over 20 million people or 1 million km², and at minimum China, India, the USA, Brazil, Russia, Indonesia, Nigeria, Pakistan, Canada and Australia.
2. Every inhabited island map unit stays its own region. Never merge an island into a mainland region.
3. Region population = the sum of the 0.1° GHSL cells whose centres fall in the polygon, with nearest-polygon fallback within 50 km. **Assert that the regions add up to the source total**, and print and store any population that was dropped.
4. Store for each region: `id`, `name`, `parentUnit`, `population`, `areaKm2`, `density`, `centroid`, `isIsland`, `isRemote`, `airports[]`, a simplified polygon (or a point marker if it is tiny), and its in- and out-weights.
5. Write `public/data/meta.json` with dataset names, versions, years, licences, totals and dropped population.

---

## 5. Travel network

Travel moves infected *people* between regions. Airborne transmission is only local and never crosses oceans.

Edge types, each labelled in the data as observed, estimated or synthetic:
1. **Air (observed route structure).** Aggregate `airport_route_edges.csv` to region pairs. Weight with a gravity model calibrated to route capacity:
   `W_ij = c · A_ij · P_i^α · P_j^α / (d_ij + d0)^δ`, where `A_ij` = number of airline-route pairs (0 when there is no route). Defaults: α = 0.7, δ = 1.0, d0 = 100 km.
2. **Land (synthetic).** Connect neighbouring regions that share a border with the same gravity form and a separate scale `c_land`.
3. **Sea and manual links (estimated).** Add these, flagged *estimated*:
   - Tokelau ↔ Samoa (ferry, about every 2 weeks);
   - Pitcairn ↔ French Polynesia / New Zealand (supply ship, about every 3 months);
   - Tristan da Cunha ↔ South Africa (about 8–10 sailings per year), as its own region carved out of the Saint Helena unit if possible;
   - Saint Helena ↔ Johannesburg (weekly flight since 2017, missing from OpenFlights);
   - Niue ↔ Auckland (1–2 flights per week, missing).

   Convert frequency to a daily travel weight: (trips per year × typical passengers) / 365.
4. Never connect every region to every other region. Cross-ocean movement exists only through explicit edges.

**Calibration:** scale `c` so that total daily air trips at m = 1 ≈ 4.89 × 10⁹ / 365 ≈ 13.4 million. Do **not** normalise rows to 1, because that would erase the difference between a hub and a remote island. Keep the absolute daily traveller numbers.

**Mobility multiplier `m`:** it scales all inter-region flows. Presets:
- 0 = closed borders;
- 0.4 = "2020-like" (1.78 / 4.54 ≈ 0.39);
- 1 = baseline;
- 1.5 = increased.

Also allow a per-region override (for example, quarantine one island by setting its edges to 0), to reproduce the American Samoa 1918 case.

---

## 6. Disease model

Each region `i` has the compartments S, E (latent, not infectious), I, R and D.

Local force of infection, with optional density scaling (default k = 0; explain it in the UI):

```
β_i = (β_air · (ρ_i / ρ_median)^k + β_contact)
λ_i = β_i · I_i / N_i
```

Explain that density scaling applies only to the airborne part, and that k is a modelling assumption (suggested 0.1–0.3 for airborne viruses, about 0 for contact viruses).

Within each region:
```
dS/dt = −λ_i S_i
dE/dt =  λ_i S_i − σ E_i
dI/dt =  σ E_i − (γ+μ) I_i
dR/dt =  γ I_i
dD/dt =  μ I_i
```
with σ = 1/L, death share p = μ/(γ+μ), and local R0 = (β_air + β_contact)/(γ+μ). Label this R0 as a **local, well-mixed** quantity that does not predict global invasion.

**Travel (stochastic, important for islands):** each step Δt (default 0.25 day), the number of travellers from j to i is `m·W_ij·Δt`. The number of *infected* travellers (E or I) on that route is drawn as **Poisson(m·W_ij·Δt·(E_j+I_j)/N_j)**. Move them into E_i (or I_i), keeping all compartments non-negative. Record the first import day for each region and the source region it came from.

**Within-region dynamics:** use the **tau-leap binomial** method. Transitions are drawn with p = 1 − e^(−rate·Δt), and the I-exit is split between recovery and death in proportion γ : μ (competing risks). Switch to a deterministic Euler/RK4 update for compartments above about 10⁴ people, so that big regions are fast and small ones are stochastic. Document this in the Math panel.

**RNG:** use a seeded PRNG (for example mulberry32). Show the seed, add a "new seed" button, and make sure repeated runs with seeds s, s+1, … are reproducible.

**Seeding:** the starting region is chosen by clicking the map. Default to a dense, well-connected hub (for example Guangdong or London), with the number of initial exposed people adjustable (default 10).

**Optional superspreading toggle:** replace the constant β with a gamma-distributed per-step multiplier (dispersion k_ss, default 0.2). This lets the Andes hantavirus preset produce occasional clusters even with R0 < 1. Explain it as an optional extension.

---

## 7. Virus presets

Load these from `public/data/viruses.json`, which is built from `data/04_viruses/virus_presets.json`. Choosing a preset fills all the sliders, and the sliders stay editable afterwards. In the UI, label each preset "inspired by X" rather than as the virus itself, and show its reported values and source links.

Conversion (show it in the Math panel):
- σ = 1/L
- γ + μ = 1/T
- μ = p/T, γ = (1−p)/T
- β = R0/T
- β_air = a·β, β_contact = (1−a)·β

Here L is the latent period, T the infectious period, p the death share (IFR where known, otherwise CFR) and a the airborne share.

| Preset | R0 | L | T | p | a | σ | γ | μ | β |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| COVID-19 ancestral | 2.5 | 4 | 7 | 0.007 | 0.6 | 0.250 | 0.142 | 0.0010 | 0.357 |
| COVID-19 Omicron | 8 | 2 | 5 | 0.001 | 0.85 | 0.500 | 0.1998 | 0.0002 | 1.600 |
| Influenza 1918 | 2.0 | 1.5 | 4 | 0.025 | 0.6 | 0.667 | 0.244 | 0.0063 | 0.500 |
| Influenza 2009 H1N1 | 1.5 | 1.5 | 4 | 0.0002 | 0.6 | 0.667 | 0.250 | 0.00005 | 0.375 |
| SARS 2003 | 2.5 | 4 | 10 | 0.11 | 0.3 | 0.250 | 0.089 | 0.011 | 0.250 |
| MERS | 0.8 | 5 | 10 | 0.35 | 0.3 | 0.200 | 0.065 | 0.035 | 0.080 |
| Ebola | 1.7 | 9 | 8 | 0.5 | 0.05 | 0.111 | 0.0625 | 0.0625 | 0.213 |
| Nipah | 0.48 | 9 | 7 | 0.55 | 0.1 | 0.111 | 0.064 | 0.079 | 0.069 |
| H5N1 (human) | 0.3 | 3 | 7 | 0.658 | 0.5 | 0.333 | 0.049 | 0.094 | 0.043 |
| Andes hantavirus | 0.8 | 18 | 7 | 0.35 | 0.3 | 0.056 | 0.093 | 0.050 | 0.114 |
| Measles | 15 | 10 | 8 | 0.002 | 0.9 | 0.100 | 0.125 | 0.0003 | 1.875 |
| Smallpox | 6 | 12 | 14 | 0.30 | 0.3 | 0.083 | 0.050 | 0.0214 | 0.429 |

Also include a "Custom / hypothetical" preset. The JSON file also contains COVID Alpha and Delta and Sin Nombre hantavirus.

Reported reference data to show in a "Real viruses" comparison table, with source links taken from the CSV:
- COVID-19 incubation by variant (JAMA Netw Open meta-analysis, 141 studies): pooled 6.57 days; Alpha 5.00; Beta 4.50; Delta 4.41; Omicron 3.42 (95% CI 2.88–3.96). Serial interval: Delta 2.3–5.8 days, Omicron 2.1–4.8 days.
- R0 and CFR comparison (IJMR table):
  - COVID-19: R0 2.28, CFR <1–13.56%;
  - MERS: R0 0.3–1.3, CFR >35%;
  - H1N1 2009: R0 1.4–1.6, CFR 0.4–6.7%;
  - SARS: R0 0.3–4.1;
  - Ebola: R0 1.5–1.9;
  - Nipah: R0 0.48.
- Pooled CFR (Khan et al. 2022 meta-analysis): Ebola 61.06%, Nipah 55.19%, MERS 18.49%, SARS 10.86%.
- H5N1 in humans (WHO WPRO, August 2026): 486 cases and 320 deaths from 2003 to Aug 2026, CFR 65.8%.
- Andes hantavirus:
  - the only hantavirus with proven person-to-person spread (CDC EID 2014);
  - Chile's yearly CFR was 32–35%;
  - incubation is 7–39 days, and contacts are monitored for 42 days;
  - in the Epuyén outbreak of 2018–19, 34 cases, 32% CFR and superspreading at one gathering.
- Include a scatter plot of **R0 against fatality** for all the presets (log x-axis). It shows the trade-off between transmissibility and lethality.

Expected qualitative behaviour (use these as acceptance checks):
- Measles and Omicron reach almost every connected region.
- Andes, Nipah, MERS and H5N1 usually fade out locally because R0 < 1.
- Ebola spreads slowly.
- Influenza 1918 is the reference preset for the island question.

---

## 8. Historical validation cases

Show these in an "Island history" panel, and build **one-click scenarios** for them:
- **Western Samoa, 1918.** Influenza arrived on the ship SS Talune from Auckland in November 1918, with no quarantine; 19–22% of the population died (CDC EID 2008, maritime quarantine study). *Scenario:* the 1918 preset, seeded in Auckland, with the Samoa–NZ link on.
- **American Samoa, 1918–1921.** A strict naval maritime quarantine from 23 November 1918 meant there were no influenza deaths, even though it lies under 100 km from Western Samoa (Cambridge, *Epidemiology & Infection*; McLane 2013). *Scenario:* the same, with American Samoa's edges set to 0.
- **American Samoa, 1926.** Influenza finally arrived. Mortality was about 1 in 1,000, roughly 200 times lower than in Western Samoa in 1918. Lesson: quarantine delays the epidemic but does not prevent it.
- **Pacific COVID-19, 2020–2022.** Nauru, Tokelau and Tuvalu were among 33 places with no reported cases in April 2020. Nauru, Tuvalu and Tonga were still case-free in late 2021. Lesson: arrival order follows connectivity.

Note: the model uses present-day population and routes, so these scenarios are *qualitative* analogues and not reconstructions of 1918.

Acceptance check: when a region's edges are set to zero, it is never reached in any run.

---

## 9. Map and animation (the main feature)

- Use the Equal Earth projection, centred at about 160°E so the Pacific is not cut at the edge. Include zoom and pan, and "jump to Pacific / South Atlantic" buttons.
- Before a run, show a log-scale **population-density** layer with a legend that names the dataset and year.
- During a run, colour regions by the selected compartment proportion: S, E, I, R or D, with I the default. Use a colour-blind-safe sequential scale. Add hatching or an outline for regions that have been "reached", so the state is not shown by colour alone.
- Draw tiny islands as circle markers so they are always visible and clickable.
- Animate import events as arcs from the source to the destination, fading out. Optionally show the main air routes faintly.
- Provide play, pause, step, reset and speed controls (simulated days per second). Show the current day and the global S/E/I/R/D totals.
- Clicking a region opens a card showing:
  - name, population and density;
  - its top inbound and outbound links, with their type (observed, estimated or synthetic);
  - arrival day, source of first import, peak infectious and day, and final attack rate and deaths;
  - a small SEIRD sparkline.
- **Island comparison view:** the default selection is the 10–15 least-connected inhabited island regions by inbound weight, plus the islands named in `remote_islands.csv`. Selection is by connectivity, never hard-coded as "safe".

---

## 10. Controls, experiments and charts

Controls:
- preset;
- β_air and β_contact (or R0 with the airborne share a);
- L, γ and μ (or T and p), each showing the derived R0, p and σ live;
- m, with its presets;
- per-region quarantine;
- density exponent k;
- superspreading toggle;
- duration (default 365 days), Δt and seed;
- start region and initial number exposed.

Every control must affect the simulation, with no placeholders. Each control gets a short tooltip.

Charts:
1. Global SEIRD over time.
2. Regions reached over time.
3. Island arrival days (one run), drawn as a timeline.
4. **The main IA experiment: an m-sweep.** For m in {0, 0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.5} × N runs (default 30, adjustable 10–200), plot each island's introduction probability against m with Wilson 95% CIs, and its median arrival day with an interquartile range.
5. Sensitivity sweeps over L, γ and μ: peak infectious proportion and final death proportion against the parameter (mean ± range across runs).
6. Baseline against comparison: save a baseline, change one parameter, and overlay the two.

Label every value as either "single run" or "mean of N runs". Add **CSV export** for every chart's data and for the m-sweep table, so the student can analyse results in their IA.

---

## 11. Math, Data and Sources panels

The Math panel explains:
- why the world is modelled as regions;
- how grid cells become regions and how density is computed;
- how the travel matrix is built and calibrated, and why it is not row-normalised;
- the SEIRD equations, with units for every parameter;
- the R0 derivation, and the competing-risk death share μ/(γ+μ);
- how tau-leaping and Poisson imports approximate the continuous rates (p = 1 − e^(−hΔt));
- how m changes the import pressure on islands. For example, the expected number of infected imports ≈ m·Σ_j W_ij·(I_j/N_j) per day, so P(no import) ≈ e^(−expected imports);
- why β_air and β_contact are local, while flights and ships carry the infection between regions.

Render all equations with KaTeX.

The Data panel lists, for each dataset: name, version, year, resolution, licence, total population, dropped population, and number of regions and edges. Mark each edge class as observed, estimated or synthetic.

The Limitations section (also in the README) covers:
- **Data years differ:** population is from 2020, the route structure from about 2014, passenger totals from 2024, and manual links are estimates.
- Routes carry no passenger counts, so their weights are modelled.
- The model assumes E is not infectious, but COVID-19 and Andes hantavirus can spread before symptoms.
- CFR overstates IFR.
- Each region is well mixed: no households, ages or hospitals; μ is constant.
- There are no interventions other than travel reduction.
- Published parameters vary widely (SARS R0 0.3–4.1; COVID CFR from under 1% to 13.6%). Encourage sensitivity analysis.
- The outputs are **not forecasts**.

The Sources panel lists every source with its link, as in Section 13.

Add an "Explore this model" IA workflow:
1. Record the datasets, their years and the network source.
2. Choose a hub start and a baseline preset.
3. Run the m-sweep with at least 30 runs per m.
4. Compare island probability and median arrival.
5. Repeat at different L, γ and μ.
6. Export CSVs, plot, and discuss uncertainty and assumptions.

**Do not write the IA essay for the student.**

---

## 12. Finish checklist

- Preprocessing asserts that the population totals match, and `meta.json` records any people dropped.
- The tests pass, and `npm run build` succeeds.
- The site works under `/Outbreak/` (check with `vite preview --base /Outbreak/`).
- There is no fake data presented as real, and every estimated link is labelled.
- The README covers: setup (`npm i`, preprocessing, `npm run dev`), data sources and licences (GHSL attribution, Natural Earth public domain, OpenFlights ODbL with credit, OurAirports public domain, World Bank CC BY 4.0), model assumptions, limitations, and deployment.
- At the end, summarise the files created, how to run the app, the datasets and years used, the number of regions and edges, and how the base path is configured.

---

## 13. Sources (show in the app and the README)

- JAMA Netw Open — incubation period by SARS-CoV-2 variant: https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2795489
- Serial intervals for Delta and Omicron: https://pmc.ncbi.nlm.nih.gov/articles/PMC10291789
- IJMR comparison table (COVID-19, MERS, H1N1, SARS, Ebola, Nipah): https://pmc.ncbi.nlm.nih.gov/articles/PMC8555610/table/T1
- Khan et al. 2022, bat-borne virus CFR meta-analysis: https://doaj.org/article/9e91d897f41f4ba99f0e1449aa6d154f
- MERS R0/CFR, Riyadh 2014: https://pmc.ncbi.nlm.nih.gov/articles/PMC4322060
- WHO WPRO avian influenza update, Aug 2026: https://cdn.who.int/media/docs/default-source/wpro---documents/emergency/surveillance/avian-influenza/ai_20260828.pdf
- Andes hantavirus, person-to-person, Chile (CDC EID 2014): https://wwwnc.cdc.gov/eid/article/20/10/14-0353
- Andes hantavirus respiratory transmission (Frontiers 2019): https://www.frontiersin.org/journals/microbiology/articles/10.3389/fmicb.2019.02992/full
- Hantavirus incubation (CDC): https://stacks.cdc.gov/view/cdc/16079/cdc_16079_DS1.pdf
- Epuyén outbreak summary: https://www.2minutemedicine.com/increased-close-contact-leads-to-spread-of-andes-virus-in-argentina/
- UN World Population Prospects 2024 (UN Geneva): https://www.ungeneva.org/en/news-media/news/2024/07/95264/growing-or-shrinking-what-latest-trends-tell-us-about-worlds
- GHS-POP R2023A (JRC): https://data.jrc.ec.europa.eu/dataset/2ff68a52-5b5b-4a22-8f40-c41da8332cfe
- Natural Earth: https://www.naturalearthdata.com · OpenFlights: https://openflights.org/data · OurAirports: https://ourairports.com/data/ · World Bank WDI: https://data.worldbank.org
- IATA 2024 passenger totals: https://globalnation.inquirer.net/263118/global-air-travel-hits-record-in-2024-as-post-covid-recovery-continues/amp
- Maritime quarantine, 1918–19 influenza (CDC EID): https://wwwnc-origin.cdc.gov/eid/article/14/3/pdfs/07-0927.pdf
- Pacific islands that escaped 1918 influenza (Cambridge): https://www.cambridge.org/core/product/392A0BE5AD01AE942060570E8B88CB83/core-reader
- McLane 2013, "Paradise Locked": https://sites.otago.ac.nz/Sites/article/view/215
- Last places without COVID-19 (VOA): https://learningenglish.voanews.com/a/the-last-places-on-earth-without-coronavirus/5399052.html
- Nauru, Tuvalu and Tonga COVID-free (Pacific Island Times): https://www.pacificislandtimes.com/post/nauru-tuvalu-and-tonga-among-the-only-five-countries-untouched-by-covid
