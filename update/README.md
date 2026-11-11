# Monthly update of the US tariff scenarios

`update_us_scenarios.py` looks for a new CEPII file of US import tariffs
(Guimbard 2026, CC BY-NC 4.0), aggregates it to the 50 ICIO sectors, re-solves the
five US tariff scenarios on the stored baseline and rewrites their entries in
`site/data/scenarios.json`. EU single market and shipping scenarios stay unchanged.

- `gravity_ge.py`: the model solver (Caliendo and Parro 2015, exact hat algebra).
- `assets/baseline.npz`: model baseline, OECD ICIO 2022 with MAcMap 2019 tariffs and the
  US schedule of 1 January 2025; `assets/us_weights.parquet`: US imports 2024 by exporter
  and HS6 (CEPII BACI); `assets/hs6_icio_map.csv`: HS 2022 to ICIO sectors.
- Run by `.github/workflows/update-tariffs.yml` on the 6th of each month and by hand
  (Actions tab, "Zollszenarien aktualisieren", "Run workflow").

Local run: `python update/update_us_scenarios.py update/assets site/data/scenarios.json`

# Quarterly update of the district data

`update_kreise.py` refreshes the district data of the site from three public sources:
Marktstammdatenregister (power generation, `kreise_energy.json`), OpenStreetMap via Overpass
(power lines, substations, rail, motorways: `kreise_infra.json`, `netz_*.json`) and the
Bundesnetzagentur grid expansion monitoring (`energienetze.json`, part "nab"); then the energy
and network values of the district profile (`kreise_steckbrief.json`). Run by
`.github/workflows/update-kreise.yml` on the 15th of January, April, July and October and by hand
(Actions tab, "Kreisdaten aktualisieren"). Each source runs on its own; a failing source leaves
its previous data in place. Not updated automatically (need credentials or appear yearly):
Regionaldatenbank export ratios, Global Trade Alert subsidies, INKAR, Breitbandatlas, hydrogen
core network. `assets/kreise.csv`: district key, NUTS 3 code, name, population, area.
