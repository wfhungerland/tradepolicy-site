# Produktraum-Monitor

Wie komplex sind die Exporte eines Landes, und welche verwandten Produkte wären als Nächstes erreichbar? Economic Complexity für 130 Länder und 1.203 Warengruppen (HS4), 1995 bis 2024, dazu ein Test, ob Gravitationsmodelle Handel kurzfristig prognostizieren können.

Seite: https://wfhungerland.github.io/tradepolicy-site/

## Aufbau

- **Überblick:** Kennzahlen des gewählten Landes und die Befunde für Deutschland.
- **Länder:** ECI-Rang und Komplexität auf festem Maßstab über die Zeit, bis zu fünf Vergleichsländer, Ränge nach Fitness und GENEPY.
- **Produktraum:** Karte aller Warengruppen mit den Exportvorteilen des Landes (1995 und 2024 oder je Jahr), nächste Chancen nach Complexity Outlook Gain.
- **Branchen:** Anteil am Welthandel je Branche, 1995 und 2024.
- **Prognosetest:** Gravitation gegen naive Fortschreibung, AR-Modell und AR nach Zielländern, deutsche Ausfuhren und Welthandel.
- **Methodik:** Verfahren, Prüfungen, Quellen, Downloads.

## Daten

Dieses Repo enthält nur die Seite (`site/`) und abgeleitete Ergebnisse (`site/data/`, JSON, rund 1,4 MB). Berechnet werden sie im privaten Repo `tradepolicy` mit `20_export_site.py`; Rohdaten liegen nicht hier.

| Quelle | Verwendung | Lizenz |
|---|---|---|
| CEPII BACI HS92 V202601 | Exporte nach Land und Warengruppe | Etalab Open Licence 2.0 |
| Eurostat Comext | Prognosetest Deutschland | Weiterverwendung mit Quellenangabe |
| IMF IMTS | Prognosetest Welthandel | IMF-Nutzungsbedingungen, Quellenangabe |
| Harvard Growth Lab, Atlas of Economic Complexity | Namen der Warengruppen, Abgleich | CC BY 4.0 |

## Aktualisieren

1. Im Repo `tradepolicy` die Rechnungen laufen lassen und `python 20_export_site.py` ausführen.
2. Den Inhalt von `<output>/site_data` nach `site/data` in diesem Repo kopieren.
3. Committen und pushen. Der Workflow `pages.yml` veröffentlicht `site/` auf GitHub Pages (Settings, Pages, Source: GitHub Actions).

Die Seite braucht keinen Build-Schritt und keine Bibliotheken. Schriften liegen in `site/fonts` (SIL Open Font License), damit keine fremden Server eingebunden werden. Impressum und Datenschutzerklärung: `site/impressum.html`, `site/datenschutz.html`.

Lokal ansehen:

```bash
python -m http.server --directory site 8000
```
