"""Government expenditure by function (COFOG) for Germany, all levels, for the site tab
"Staatsausgaben".

Source: Eurostat gov_10a_exp (total expenditure TE, million EUR), sectors S13 (general
government, consolidated), S1311 (federal), S1312 (Länder), S1313 (municipalities), S1314
(social security); divisions GF01-GF10 for all sectors 1995 onward, groups (second level)
for S13 from 2000. Population: demo_gind (AVG); prices: deflator of government final consumption
(nama_10_gdp P3_S13, PD15_EUR).

Subsector figures include transfers between levels; their sum exceeds the consolidated
general government total by 14-24 %. They are therefore shown side by side, never stacked.

Copy of tradepolicy/86_cofog.py for the quarterly site update.
Usage: python update/update_cofog.py site/data
"""
import json, sys, urllib.request
from pathlib import Path

API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
SECTORS = ["S13", "S1311", "S1312", "S1313", "S1314"]
DIV_SHORT = {
    "GF01": ("Verwaltung und Zinsen", "Administration and interest"),
    "GF02": ("Verteidigung", "Defence"),
    "GF03": ("Öffentliche Sicherheit", "Public order, safety"),
    "GF04": ("Wirtschaft und Verkehr", "Economy and transport"),
    "GF05": ("Umweltschutz", "Environmental protection"),
    "GF06": ("Wohnen, Kommunales", "Housing, community"),
    "GF07": ("Gesundheit", "Health"),
    "GF08": ("Kultur, Sport, Religion", "Culture, sport, religion"),
    "GF09": ("Bildung", "Education"),
    "GF10": ("Soziale Sicherung", "Social protection"),
}

def fetch(ds, q, lang="en"):
    url = f"{API}{ds}?{q}&lang={lang}"
    for a in range(4):
        try:
            return json.load(urllib.request.urlopen(url, timeout=300))
        except Exception as e:
            err = e
    raise err

def tidy(d):
    ids, size = d["id"], d["size"]
    inv = [{v: k for k, v in d["dimension"][i]["category"]["index"].items()} for i in ids]
    out = []
    for k, v in d["value"].items():
        k = int(k); idx = []
        for s in reversed(size): idx.append(k % s); k //= s
        idx = idx[::-1]
        out.append({**{ids[j]: inv[j][idx[j]] for j in range(len(ids))}, "value": v})
    return out

def series(ds, q):
    d = fetch(ds, q); t = {v: k for k, v in d["dimension"]["time"]["category"]["index"].items()}
    return {int(t[int(k)]): v for k, v in d["value"].items()}

def main(site=None):
    q = "geo=DE&unit=MIO_EUR&na_item=TE&" + "&".join(f"sector={s}" for s in SECTORS)
    d = fetch("gov_10a_exp", q)
    rows = tidy(d)
    lab_de = fetch("gov_10a_exp", "geo=DE&unit=MIO_EUR&na_item=TE&sector=S13&time=2024", "de")["dimension"]["cofog99"]["category"]["label"]
    lab_en = d["dimension"]["cofog99"]["category"]["label"]
    years = sorted({int(r["time"]) for r in rows})
    pop = series("demo_gind", "geo=DE&indic_de=AVG")
    defl = series("nama_10_gdp", "geo=DE&unit=PD15_EUR&na_item=P3_S13")  # government final consumption deflator
    gdp = series("nama_10_gdp", "geo=DE&unit=CP_MEUR&na_item=B1GQ")
    y1 = years[-1]
    val = {}
    for r in rows:
        val.setdefault(r["sector"], {}).setdefault(r["cofog99"], {})[int(r["time"])] = r["value"]
    divs = list(DIV_SHORT)
    def ser(sec, code): return [round(val[sec].get(code, {}).get(y, float("nan")), 1) if y in val[sec].get(code, {}) else None for y in years]
    out = {
        "_meta": {"source": "Eurostat gov_10a_exp, demo_gind, nama_10_gdp", "updated": d.get("updated"), "unit": "million EUR, current prices"},
        "years": years,
        "divisions": [{"code": c, "de": DIV_SHORT[c][0], "en": DIV_SHORT[c][1]} for c in divs],
        "sectors": {s: {c: ser(s, c) for c in divs + ["TOTAL"]} for s in SECTORS},
        "pop": [pop.get(y) for y in years],
        "price_index": [round(defl[y] / defl[y1], 5) if y in defl else None for y in years],
        "gdp": [gdp.get(y) for y in years],
        "price_base": y1,
        "deflator": "P3_S13",
    }
    # second level for general government (treemap), from 2000
    groups = {}
    for code, per in val["S13"].items():
        if len(code) == 6 and code.startswith("GF"):
            groups[code] = [per.get(y) for y in years]
    out["groups"] = {c: {"de": lab_de.get(c, c), "en": lab_en.get(c, c), "values": v} for c, v in sorted(groups.items())}
    # checks
    for y in years:
        s = sum(out["sectors"]["S13"][c][years.index(y)] or 0 for c in divs)
        t = out["sectors"]["S13"]["TOTAL"][years.index(y)]
        assert abs(s / t - 1) < 0.01, (y, s, t)
    txt = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    assert "NaN" not in txt
    if site: open(Path(site) / "cofog.json", "w").write(txt)
    else:
        Path("output").mkdir(exist_ok=True); open("output/cofog.json", "w").write(txt)
    # key facts
    i = years.index(y1); S = out["sectors"]["S13"]
    print("total", y1, round(S["TOTAL"][i] / 1e3), "bn;", "share of GDP", round(100 * S["TOTAL"][i] / gdp[y1], 1))
    for c in divs:
        sh = 100 * S[c][i] / S["TOTAL"][i]
        rpc = S[c][i] * 1e6 / pop[y1]
        i19 = years.index(2019); rpc19 = S[c][i19] * 1e6 / pop[2019] / out["price_index"][i19]
        print(c, DIV_SHORT[c][0], f"{sh:.1f} %", f"{rpc:.0f} EUR/head", f"vs 2019 real {rpc - rpc19:+.0f}")
    print("groups", len(groups), "first year with groups", min(y for y in years if any(v[years.index(y)] for v in groups.values())))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
