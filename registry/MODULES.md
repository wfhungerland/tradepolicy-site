# Module des Produktraum-Monitors

Generated from registry/modules.json by registry/make_overview.py; edit the JSON, not this file.

KM criteria: official or established data source; automatic or at least yearly update, documented; descriptive, no model assumptions in the shown numbers; texts checked; figures follow the KM design rules.

## Handel und Spezialisierung

| Reiter | Leitfrage | Stufe | KM-Kandidat | Daten | Aktualisierung |
|---|---|---|---|---|---|
| Überblick | Wie komplex sind die Exporte eines Landes? | stabil | nein | CEPII BACI HS92 | by hand, yearly |
| Länder | Wie stehen die Länder im Komplexitätsvergleich? | stabil | nein | CEPII BACI HS92 | by hand, yearly |
| Länderprofil | Was exportiert ein Land, und was träfe es in den Szenarien? | stabil | nein | CEPII BACI, scenario results | by hand, yearly |
| Produktraum | Wo liegen die nächsten Exportchancen? | stabil | nein | CEPII BACI HS92 | by hand, yearly |
| Branchen | Welche Branchen tragen die Komplexität? | stabil | nein | CEPII BACI HS92 | by hand, yearly |
| Dienstleistungen | Womit handelt Deutschland bei Dienstleistungen? | stabil | ja | OECD TiS, IMF IMTS | by hand, yearly |
| Investitionen | Wo investiert die deutsche Wirtschaft? | stabil | ja | OECD FDI statistics (BMD4) | by hand, yearly |
| Mittelstand | Wie stark hängt der Mittelstand am Außenhandel? | stabil | ja | Eurostat TEC | by hand, yearly |

- Mittelstand: KM handover prompt exists (HANDOVER_KM_extensions.md, topic 1)

## Abhängigkeiten und Geopolitik

| Reiter | Leitfrage | Stufe | KM-Kandidat | Daten | Aktualisierung |
|---|---|---|---|---|---|
| Abhängigkeiten | Wo hängen EU und Deutschland an wenigen Lieferländern? | stabil | ja | CEPII BACI HS22, OECD ICIO | by hand, yearly |
| China-Wettbewerb | Wo konkurrieren deutsche und chinesische Exporte? | Sandkasten | nein | CEPII BACI, Global Trade Alert | by hand |
| Null-Handel | Wer handelt überhaupt mit wem? | Sandkasten | nein | CEPII BACI, CEPII Gravity | by hand |
| Regierungsform | Mit welchen Regierungen handeln Deutschland und die EU? | Sandkasten | nein | CEPII BACI, V-Dem | by hand |

## Regionen

| Reiter | Leitfrage | Stufe | KM-Kandidat | Daten | Aktualisierung |
|---|---|---|---|---|---|
| Bundesländer | Wie hängen die Bundesländer am Außenhandel? | stabil | ja | Destatis 51000-0032/0034, Eurostat nama_10r_2gdp | by hand, yearly (Destatis account) |
| Regionen | Welche Regionen Europas trifft was? | stabil | nein | Eurostat, ARDECO, OSM, BNetzA, Rosés-Wolf | quarterly (grid expansion, OSM) and by hand |
| Kreise | Was zeigen die Kreisdaten? | Sandkasten | nein | MaStR, Breitbandatlas, OSM, Regionaldatenbank, INKAR, BBSR | quarterly (MaStR, OSM) and by hand |
| Kreis-Steckbrief | Wie steht ein Kreis da? | stabil | nein | as Kreise | quarterly |

- Regionen: mixed: maps and descriptive parts stable, exposure model and cohesion RDD sandbox
- Kreise: maps stable, INKAR analyses and tariff exposure sandbox; deepened in a separate chat (HANDOVER_regional.md)

## Staat

| Reiter | Leitfrage | Stufe | KM-Kandidat | Daten | Aktualisierung |
|---|---|---|---|---|---|
| Staatsausgaben | Wofür gibt der Staat Geld aus? | im KM | ja | Eurostat COFOG, bundeshaushalt.de | quarterly (COFOG), by hand (federal budget) |
| Beschaffung | Wie kauft der Staat ein? | Sandkasten | nein | TED (EU), Destatis Vergabestatistik | by hand |

- Staatsausgaben: treemaps and COFOG charts in the KM since 2026-11-12; deepened in a separate chat (HANDOVER_haushalt.md)
- Beschaffung: Big G pilot; request to the procurement unit on hold

## Szenarien und Methodik

| Reiter | Leitfrage | Stufe | KM-Kandidat | Daten | Aktualisierung |
|---|---|---|---|---|---|
| Szenarien | Was kosten Zölle, was bringt der Binnenmarkt, was gesperrte Seewege? | stabil | nein | OECD ICIO, USITC ITPD-E, CEPII, US tariff schedules | monthly (US tariffs) |
| Prognosetest | Taugen Gravitationsmodelle für Kurzfristprognosen? | Sandkasten | nein | Eurostat Comext, IMF IMTS | none (archive) |
| Methodik | Methodik und Quellen | stabil | nein | - | with each change |

- Szenarien: model results; reproduction check 82 of 82

## Summe

Sandkasten: 6, stabil: 14, im KM: 1; KM-Kandidaten: 5
