# Outbreak data pack

Downloaded and processed on 2026-10-06 for the Outbreak IA simulation. Each folder is one kind of data.

| Folder | Contents |
| --- | --- |
| `00_raw_sources/` | Original downloads: Natural Earth zips, OpenFlights `routes/airports/airlines.dat`, GHSL input metadata. The 482 MB GHSL raster itself is NOT included (too big); re-download link below. |
| `01_population/` | GHSL GHS-POP R2023A, epoch 2020, aggregated from 30 arc-second grid to 0.1°, 0.25°, 1° GeoTIFFs (sum of people per cell) + CSV point tables; population per map unit; World Bank population and density. |
| `02_geography/` | Natural Earth 1:10m map units (detailed + simplified GeoJSON), admin-1 provinces, minor islands, land, populated places. |
| `03_travel/` | OpenFlights airports and direct routes, assigned to map units; map-unit route matrix; connectivity per map unit; OurAirports full airport list; IATA and World Bank passenger totals. |
| `04_viruses/` | 15 virus parameter sets with sources, and SEIRD presets (σ, γ, μ, β_air, β_contact). |
| `05_islands/` | 20 remote islands with access notes, and historical island outbreaks for validation. |

## Key checks
- GHSL 2020 world total: **7,840,952,947** people. Aggregation preserves it exactly at every resolution.
- Map-unit assignment covers 7,840,811,600 people. 529 coastal cells (141,347 people) more than 50 km from any polygon are unassigned.
- World Bank 2023 world population: 8,062,923,417 (different year and source; use only as a check).
- Network: 3,257 airports with scheduled routes, 37,042 direct airport-to-airport routes, 4,862 linked map-unit pairs. 54 map units have no scheduled airport.

## File notes
- `population_by_map_unit_GHSL2020.csv`: `ghsl_pop_2020` is computed from the grid; `pop_est` is Natural Earth's own estimate.
- `airport_route_edges.csv`: `airlines` = number of airlines flying the direct route (a proxy for capacity, NOT passengers).
- `map_unit_route_matrix.csv`: `routes` = airport routes between two units. Use with the gravity model for weights.
- `connectivity_by_map_unit.csv`: sorted least-connected first. This is the objective way to choose "remote islands".
- `virus_presets.json`: values tagged `[TEXTBOOK-UNVERIFIED]` still need a primary citation before use in the IA.

## Known gaps (fix manually in the app, and label as estimated)
- OpenFlights routes are a ~2014 snapshot with no passenger volumes. Saint Helena's airport (opened 2017) and Niue's Auckland flights are missing.
- Ship-only places (Tokelau, Pitcairn, Tristan da Cunha) need hand-made sea links. Suggested frequencies are in `05_islands/remote_islands.csv`, all estimated.
- The modelled 2010 VBD-Air passenger matrix was not downloaded (requires manual download/terms check).

## Sources and licences
- GHS-POP R2023A — Schiavina M., Freire S., Carioli A., MacManus K. (2023), European Commission JRC, doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE. Free, attribution required. Raw: https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2020_GLOBE_R2023A_4326_30ss/V1-0/
- Natural Earth — public domain. https://www.naturalearthdata.com
- OpenFlights — Open Database License (ODbL); attribute and share-alike. https://openflights.org/data
- OurAirports — public domain. https://ourairports.com/data/
- World Bank WDI (SP.POP.TOTL, EN.POP.DNST, IS.AIR.PSGR) — CC BY 4.0.
- Virus and island sources: URLs inside each CSV row.

## Processing
GHSL raster → each 30″ cell summed into the coarser cell containing its centre. Map units → each 0.1° cell centre point-in-polygon, nearest polygon within 50 km as fallback. Airports → nearest map unit within 30 km.
