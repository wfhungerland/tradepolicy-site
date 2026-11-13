"""Write registry/MODULES.md, a readable overview of registry/modules.json."""
import json
from pathlib import Path

here = Path(__file__).parent
R = json.load(open(here / "modules.json", encoding="utf-8"))
ST = {"sandbox": "Sandkasten", "stable": "stabil", "km": "im KM"}
lines = ["# Module des Produktraum-Monitors", "", "Generated from registry/modules.json by registry/make_overview.py; edit the JSON, not this file.", "",
         "KM criteria: " + "; ".join(R["km_criteria"]) + ".", ""]
for a in R["areas"]:
    lines += [f"## {a['de']}", "", "| Reiter | Leitfrage | Stufe | KM-Kandidat | Daten | Aktualisierung |", "|---|---|---|---|---|---|"]
    for m in [m for m in R["modules"] if m["area"] == a["id"]]:
        lines.append(f"| {m['de']} | {m['question']} | {ST[m['status']]} | {'ja' if m['km_candidate'] else 'nein'} | {m['data']} | {m['update']} |")
    notes = [f"- {m['de']}: {m['note']}" for m in R["modules"] if m["area"] == a["id"] and m.get("note")]
    lines += [""] + (notes + [""] if notes else [])
cnt = {s: sum(m["status"] == s for m in R["modules"]) for s in ST}
lines += ["## Summe", "", ", ".join(f"{ST[s]}: {n}" for s, n in cnt.items()) + f"; KM-Kandidaten: {sum(m['km_candidate'] and m['status'] != 'km' for m in R['modules'])}", ""]
(here / "MODULES.md").write_text("\n".join(lines), encoding="utf-8")
# the site reads a compact copy for its navigation and the status line of each tab
site = {"areas": R["areas"], "modules": [{k: m[k] for k in ("id", "area", "status", "km_candidate", "data", "update_de", "update_en")} for m in R["modules"]]}
(here.parent / "site" / "data" / "modules.json").write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("\n".join(lines[-2:]))
