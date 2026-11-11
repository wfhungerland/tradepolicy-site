"""Quarterly update of the district data of the site (run by .github/workflows/update-kreise.yml).

Three parts, each can run on its own:
  mastr       Marktstammdatenregister (Bundesnetzagentur, Datenlizenz Deutschland 2.0): full export,
              electrical units aggregated to districts -> site/data/kreise_energy.json (values only;
              the map paths stay)
  osm         OpenStreetMap via Overpass (ODbL): power lines, substations, rail, motorways per Land ->
              district densities (site/data/kreise_infra.json) and map layers (site/data/netz_*.json)
  netzausbau  Bundesnetzagentur, Monitoring des Stromnetzausbaus: latest quarterly report (PDF) ->
              status and planned commissioning in site/data/energienetze.json ("nab")
  steckbrief  refresh the energy and network values, medians and ranks in kreise_steckbrief.json
Logic as in the analysis repository (scripts 66, 68, 70, 71, tools/pc_fetch_osm.py,
tools/server_fetch_kreise.py). District keys, NUTS 3 codes and population: update/assets/kreise.csv.
Usage: python update/update_kreise.py site/data mastr osm netzausbau steckbrief
"""
import gzip
import io
import json
import math
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ASSETS = Path(__file__).parent / "assets"
UA = {"User-Agent": "Mozilla/5.0 (Produktraum-Monitor update)"}
STAND = date.today().strftime("%m/%Y")


def get(url, timeout=600):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def kreise():
    return pd.read_csv(ASSETS / "kreise.csv", dtype={"ags": str})


# ------------------------------------------------------------------ MaStR
MASTR_PAGE = "https://www.marktstammdatenregister.de/MaStR/Datendownload"
UNIT_FILES = re.compile(r"^Einheiten(Solar|Wind|Biomasse|Wasser|Verbrennung|Kernkraft|GeoSolarthermieGrubenKlaerschlammDruckentspannung|Stromspeicher)(_\d+)?\.xml$", re.I)
FIELDS = {"Gemeindeschluessel", "EinheitBetriebsstatus", "Inbetriebnahmedatum", "DatumEndgueltigeStilllegung", "Bruttoleistung", "Energietraeger"}
GROUPS = {"Solare Strahlungsenergie": "solar", "Wind": "wind", "Biomasse": "bio", "Wasser": "hydro", "Braunkohle": "lignite", "Steinkohle": "coal",
          "Erdgas": "gas", "Mineralölprodukte": "fossil_other", "andere Gase": "fossil_other", "nicht biogener Abfall": "fossil_other",
          "Wärme": "other", "Wasserstoff": "other", "Kernenergie": "nuclear", "Speicher": "storage"}
RENEW, FOSSIL = ["solar", "wind", "bio", "hydro"], ["lignite", "coal", "gas", "fossil_other"]


def mastr(site):
    html = get(MASTR_PAGE, 120).read().decode("utf-8", "ignore")
    url = re.search(r'href="(https://download\.marktstammdatenregister\.de/Gesamtdatenexport_\d{8}_[\d.]+\.zip)"', html).group(1)
    print("MaStR export:", url, flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        zp = Path(tmp) / "mastr.zip"
        with get(url, 1800) as r, open(zp, "wb") as f:
            while True:
                b = r.read(1 << 22)
                if not b:
                    break
                f.write(b)
        agg = defaultdict(lambda: [0, 0.0])
        with zipfile.ZipFile(zp) as z:
            names = {}
            for _, el in ET.iterparse(z.open(next(n for n in z.namelist() if n.lower().startswith("katalogwerte")))):
                if el.tag == "Katalogwert" and el.findtext("Id"):
                    names[el.findtext("Id")] = el.findtext("Wert")
                el.clear()
            for fn in sorted(n for n in z.namelist() if UNIT_FILES.match(n)):
                storage = "stromspeicher" in fn.lower()
                for _, el in ET.iterparse(z.open(fn)):
                    if len(el) == 0 or not el.tag.startswith("Einheit") or el.tag.startswith("Einheiten"):
                        continue
                    rec = {c.tag: c.text for c in el if c.tag in FIELDS}
                    el.clear()
                    g = rec.get("Gemeindeschluessel")
                    if not g or not rec.get("Inbetriebnahmedatum") or rec.get("EinheitBetriebsstatus") == "31":
                        continue
                    et = "Speicher" if storage else names.get(rec.get("Energietraeger"), "unbekannt")
                    end = int(rec["DatumEndgueltigeStilllegung"][:4]) if rec.get("DatumEndgueltigeStilllegung") else 9999
                    key = (g[:5], GROUPS.get(et, "other"), int(rec["Inbetriebnahmedatum"][:4]), end)
                    agg[key][0] += 1
                    agg[key][1] += float(rec.get("Bruttoleistung") or 0) / 1000
                print(fn, "done", flush=True)
    this = date.today().year
    years = list(range(1990, this + 1))
    rows = defaultdict(float)
    for (k, gname, s, e), (_, mw) in agg.items():
        for y in years:
            if s <= y < e:
                rows[(k, y, gname)] += mw
    m = pd.Series(rows).rename_axis(["ags", "jahr", "g"]).unstack(fill_value=0.0)
    for c in RENEW + FOSSIL + ["nuclear", "other", "storage"]:
        if c not in m:
            m[c] = 0.0
    kr = kreise().set_index("ags")
    m = m[m.index.get_level_values("ags").isin(kr.index)]
    last = this - 1                                            # last complete year
    p = json.loads((Path(site) / "kreise_energy.json").read_text(encoding="utf-8"))
    cur, base = m.xs(last, level="jahr"), m.xs(last - 10, level="jahr")
    for ags, r in kr.iterrows():
        if r.nuts3 not in p["kreise"] or ags not in cur.index:
            continue
        c = cur.loc[ags]
        renew, fossil = c[RENEW].sum(), c[FOSSIL].sum()
        total = renew + fossil + c.nuclear + c.other
        sw0 = base.loc[ags, ["solar", "wind"]].sum() if ags in base.index else 0
        p["kreise"][r.nuts3].update({"sol": round(c.solar * 1000 / r["pop"], 2), "win": round(c.wind * 1000 / r["pop"], 2),
                                     "ren": round(renew / total, 3) if total else None, "lig": round(c.lignite), "coa": round(c.coal),
                                     "gas": round(c.gas), "gro": round((c.solar + c.wind) / sw0, 2) if sw0 else None})
    tot = m.groupby(level="jahr").sum()
    p["germany"] = {"years": years[:-1], **{c: [round(float(tot.loc[y, c]) / 1000, 2) if y in tot.index else 0 for y in years[:-1]]
                                            for c in ["solar", "wind", "bio", "hydro", "lignite", "coal", "gas", "fossil_other", "nuclear"]}}
    p["stand"] = f"Ende {last}"
    (Path(site) / "kreise_energy.json").write_text(json.dumps(p, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("energy updated for", last, "solar GW", p["germany"]["solar"][-1])


# ------------------------------------------------------------------ OSM
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
LAENDER = ["DE-BW", "DE-BY", "DE-BE", "DE-BB", "DE-HB", "DE-HH", "DE-HE", "DE-MV", "DE-NI", "DE-NW", "DE-RP", "DE-SL", "DE-SN", "DE-ST", "DE-SH", "DE-TH"]
BBOX = {"DE-BW": (47.5, 7.5, 49.8, 10.5), "DE-BY": (47.2, 8.9, 50.6, 13.9), "DE-BE": (52.3, 13.0, 52.7, 13.8), "DE-BB": (51.3, 11.2, 53.6, 14.8),
        "DE-HB": (53.0, 8.4, 53.6, 9.0), "DE-HH": (53.3, 9.7, 53.8, 10.4), "DE-HE": (49.3, 7.7, 51.7, 10.3), "DE-MV": (53.1, 10.5, 54.7, 14.5),
        "DE-NI": (51.2, 6.6, 54.0, 11.6), "DE-NW": (50.3, 5.8, 52.6, 9.5), "DE-RP": (48.9, 6.1, 50.95, 8.6), "DE-SL": (49.1, 6.3, 49.7, 7.5),
        "DE-SN": (50.1, 11.8, 51.7, 15.1), "DE-ST": (50.9, 10.5, 53.1, 13.2), "DE-SH": (53.3, 8.2, 55.1, 11.4), "DE-TH": (50.2, 9.8, 51.7, 12.7)}
QUERIES = {"power_line": ('way["power"="line"]["voltage"](area.a);', "geom"), "substation": ('nwr["power"="substation"]["voltage"](area.a);', "center"),
           "rail": ('way["railway"="rail"][!"service"](area.a);', "geom"), "motorway": ('way["highway"="motorway"](area.a);', "geom")}
R, LON0, UNIT = 6371.0088, 10.5, 0.1


def overpass(q_area, q_bbox):
    for attempt in range(30):
        url = SERVERS[attempt % len(SERVERS)]
        q = q_area if attempt < len(SERVERS) else q_bbox
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=1200) as r:
                res = json.load(r)
            if res.get("elements"):
                return res["elements"]
            raise RuntimeError("empty answer")
        except Exception as e:
            wait = min(300, 30 * (attempt // len(SERVERS) + 1))
            print(f"   {url.split('/')[2]}: {e}; retry in {wait} s", flush=True)
            time.sleep(wait)
    raise RuntimeError("Overpass did not answer")


def volt(t):
    v = [int(x) for x in str(t.get("voltage", "")).replace(",", ";").split(";") if x.strip().isdigit()]
    return max(v) if v else 0


def proj(lon, lat):
    la = np.radians(lat)
    return R * np.radians(np.asarray(lon) - LON0) * np.cos(la), R * la


def osm(site):
    from shapely import STRtree
    from shapely.geometry import LineString, MultiLineString, Point, shape
    from shapely.ops import linemerge, transform
    feats = {c: {} for c in QUERIES}
    for land in LAENDER:
        for cat, (body, mode) in QUERIES.items():
            s, w, n, e = BBOX[land]
            qa = f'[out:json][timeout:1100];area["ISO3166-2"="{land}"]->.a;({body});out {mode};'
            qb = f'[out:json][timeout:1100][bbox:{s},{w},{n},{e}];({body.replace("(area.a)", "")});out {mode};'
            els = overpass(qa, qb)
            for el in els:
                tags = el.get("tags") or {}
                if mode == "geom" and "geometry" in el:
                    g = tuple((round(p["lon"], 5), round(p["lat"], 5)) for p in el["geometry"])
                elif mode == "center":
                    c = el.get("center") or ({"lon": el["lon"], "lat": el["lat"]} if "lon" in el else None)
                    if not c:
                        continue
                    g = ((round(c["lon"], 5), round(c["lat"], 5)),)
                else:
                    continue
                feats[cat][(el["type"], el["id"])] = (tags, g)            # OSM id de-duplicates across Länder
            print(land, cat, len(els), flush=True)
            time.sleep(10)
    gj = json.load(get("https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2024_4326_LEVL_3.geojson"))
    polys = {f["properties"]["NUTS_ID"]: transform(proj, shape(f["geometry"])) for f in gj["features"] if f["properties"]["NUTS_ID"].startswith("DE")}
    ids = list(polys)
    tree = STRtree([polys[i] for i in ids])
    area = pd.Series({i: p.area for i, p in polys.items()})
    line = lambda g: LineString(np.c_[proj(*np.array(g).T)])

    def clip(items):
        acc = {}
        for ln, grp in items:
            for j in tree.query(ln):
                l = ln.intersection(polys[ids[j]]).length
                if l > 0:
                    acc[(ids[j], grp)] = acc.get((ids[j], grp), 0) + l
        return pd.Series(acc, dtype=float).unstack().reindex(ids).fillna(0)

    layers = defaultdict(list)
    pl = []
    for tags, g in feats["power_line"].values():
        v = volt(tags)
        if v >= 110000 and len(g) > 1:
            ln = line(g)
            pl.append((ln, "ehv" if v >= 220000 else "hv"))
            layers["ehv380" if v >= 380000 else "ehv220" if v >= 220000 else "hv110"].append(ln)
    rl = []
    for tags, g in feats["rail"].values():
        if len(g) > 1:
            ln, el = line(g), str(tags.get("electrified", "no")) not in ("no", "")
            rl.append((ln, "el" if el else "nel"))
            layers["rail_el" if el else "rail_nel"].append(ln)
    ml = [(line(g), "bab") for _, g in feats["motorway"].values() if len(g) > 1]
    layers["bab"] = [l for l, _ in ml]
    res = pd.DataFrame(index=ids)
    s = clip(pl)
    res["ehv_km"], res["hv_km"] = s.get("ehv", 0) / area * 100, s.get("hv", 0) / area * 100
    s = clip(rl)
    tot = s.sum(axis=1)
    res["rail_km"], res["rail_el"] = tot / area * 100, 100 * s.get("el", 0) / tot.replace(0, np.nan)
    res["bab_km"] = clip(ml)["bab"] / 2 / area * 100
    subs, cnt = [], {}
    minx = min(p.bounds[0] for p in polys.values()); maxy = max(p.bounds[3] for p in polys.values())
    for tags, g in feats["substation"].values():
        v = volt(tags)
        if v >= 110000 and tags.get("substation") != "minor_distribution":
            x, y = proj(*g[0])
            pt = Point(x, y)
            for j in tree.query(pt):
                if polys[ids[j]].contains(pt):
                    cnt[ids[j]] = cnt.get(ids[j], 0) + 1
                    break
            subs += [int(round((x - minx) / UNIT)), int(round((maxy - y) / UNIT)), 380 if v >= 380000 else 220 if v >= 220000 else 110]
    res["sub_n"] = pd.Series(cnt).reindex(ids).fillna(0).astype(int)
    km = lambda c, k=1: float((res[c] * area / 100).sum() / k)
    out = {g: {c: (None if pd.isna(v) else round(float(v), 2)) for c, v in r.items()} for g, r in res.iterrows()}
    out["_meta"] = {"stand": STAND, "ehv_km": round(km("ehv_km")), "hv_km": round(km("hv_km")), "rail_km": round(km("rail_km")), "bab_km": round(km("bab_km")), "sub_n": int(res.sub_n.sum())}
    (Path(site) / "kreise_infra.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print("infra:", out["_meta"])
    # map layers (same encoding as the analysis script 71)
    meta = {"w": round((max(p.bounds[2] for p in polys.values()) - minx) / UNIT), "h": round((maxy - min(p.bounds[1] for p in polys.values())) / UNIT), "unit_km": UNIT}
    sh = lambda geom: transform(lambda x, y: (np.asarray(x) - minx, y), geom)

    def enc(geom):
        c = np.asarray(geom.coords)
        return [int(v) for xy in zip(np.round(c[:, 0] / UNIT), np.round((maxy - c[:, 1]) / UNIT)) for v in xy]
    for k, ls in layers.items():
        full = [e for e in (enc(sh(l).simplify(0.06)) for l in ls) if len(e) >= 4]
        mg = linemerge(MultiLineString([sh(l) for l in ls]))
        lo = [e for e in (enc(gm.simplify(0.4)) for gm in getattr(mg, "geoms", [mg]) if gm.length > 0.3) if len(e) >= 4]
        for name, d in ((k, full), (k + "_lo", lo)):
            (Path(site) / f"netz_{name}.json").write_text(json.dumps({**meta, "d": d}, separators=(",", ":")), encoding="utf-8")
    (Path(site) / "netz_sub.json").write_text(json.dumps({**meta, "d": subs}, separators=(",", ":")), encoding="utf-8")
    print("map layers written")


# ------------------------------------------------------------------ Netzausbau
STATUS = [("vor dem Genehmigungsverfahren", "noch nicht im Verfahren"), ("im Bundesfachplanungs", "Bundesfachplanung/Raumordnung"),
          ("vor dem oder im Planfeststellungs", "vor/im Planfeststellungsverfahren"), ("genehmigt und vor dem oder im Bau", "genehmigt, vor/im Bau"),
          ("fertiggestellt aber noch nicht in Betrieb", "fertig, noch nicht in Betrieb"), ("vollständig in Betrieb", "in Betrieb")]


def pdftext(pdf, a=None, b=None):
    cmd = ["pdftotext", "-layout"] + (["-f", str(a), "-l", str(b)] if a else []) + [str(pdf), "-"]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def netzausbau(site):
    y = date.today().year
    with tempfile.TemporaryDirectory() as tmp:
        for yy in (y, y - 1):
            try:
                zp = Path(tmp) / "mon.zip"
                with get(f"https://data.netzausbau.de/Vorhaben/Monitoring/Monitoring-Archiv_{yy}.zip", 1800) as r, open(zp, "wb") as f:
                    f.write(r.read())
                break
            except Exception as e:
                print("archive", yy, e)
        with zipfile.ZipFile(zp) as z:
            reps = sorted((n for n in z.namelist() if re.search(r"Q(\d)-(\d\d)\.pdf$", n)), key=lambda n: re.search(r"Q(\d)-(\d\d)", n).group(2) + re.search(r"Q(\d)-(\d\d)", n).group(1))
            pdf = Path(tmp) / "rep.pdf"
            pdf.write_bytes(z.read(reps[-1]))
            q = re.search(r"Q(\d)-(\d\d)", reps[-1])
        toc = pdftext(pdf, 1, 4)
        # page numbers of the summary and the progress tables from the table of contents
        summ_page = int(re.search(r"Stand nach dem \w+ Quartal \d{4}\s+(\d+)", toc).group(1))
        fort = [int(x) for x in re.findall(r"Fortschrittstabelle\s+(\d+)", toc)]
        tech = [int(x) for x in re.findall(r"Technische Tabelle\s+(\d+)", toc)]
        t = re.sub(r"\s+", " ", pdftext(pdf, summ_page, summ_page))
        st = []
        for key, label in STATUS:
            mm = re.search(r"(\d[\d.]*) km [^•]*?" + re.escape(key.split()[0]) + r"[^•]*?" + re.escape(key.split()[-1]), t)
            st.append([label, int(mm.group(1).replace(".", ""))])
        rows = []
        for a, b in zip(fort, tech):
            for line in pdftext(pdf, a, b - 1).splitlines():
                mm = re.search(r"~?\s*([\d.]+) km\s+(\S.*?)\s*$", line)
                if mm and "Länge" not in line:
                    yr = re.fullmatch(r"(\d{4})", mm.group(2))
                    rows.append((float(mm.group(1).replace(".", "")), int(yr.group(1)) if yr else None))
    v = pd.DataFrame(rows, columns=["km", "jahr"])
    plan = v.dropna().groupby("jahr").km.sum().sort_index().cumsum()
    plan = plan.reindex(range(int(plan.index.min()), int(plan.index.max()) + 1)).ffill()
    p = json.loads((Path(site) / "energienetze.json").read_text(encoding="utf-8"))
    quarter_end = {1: "31.03.", 2: "30.06.", 3: "30.09.", 4: "31.12."}[int(q.group(1))] + "20" + q.group(2)
    p["nab"] = {"status": [s[0] for s in st], "km": [s[1] for s in st], "years": [int(x) for x in plan.index], "cum": [round(float(x)) for x in plan.values],
                "stand": quarter_end, "undated_km": round(float(v[v.jahr.isna()].km.sum())), "undated_n": int(v.jahr.isna().sum())}
    (Path(site) / "energienetze.json").write_text(json.dumps(p, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Netzausbau", quarter_end, "total km", sum(p["nab"]["km"]), "projects", len(v))


# ------------------------------------------------------------------ Steckbrief
def steckbrief(site):
    p = Path(site) / "kreise_steckbrief.json"
    sb = json.loads(p.read_text(encoding="utf-8"))
    en = json.loads((Path(site) / "kreise_energy.json").read_text(encoding="utf-8"))["kreise"]
    inf = json.loads((Path(site) / "kreise_infra.json").read_text(encoding="utf-8"))
    for g, k in sb["kreise"].items():
        e, i = en.get(g, {}), inf.get(g, {})
        k["v"].update({"solar_kw_pc": e.get("sol"), "wind_kw_pc": e.get("win"), "renew_share": None if e.get("ren") is None else round(100 * e["ren"], 3),
                       "lignite": e.get("lig"), "ehv_km": i.get("ehv_km"), "rail_el": i.get("rail_el"), "bab_km": i.get("bab_km")})
    for key in ("solar_kw_pc", "wind_kw_pc", "renew_share", "lignite", "ehv_km", "rail_el", "bab_km"):
        s = pd.Series({g: k["v"][key] for g, k in sb["kreise"].items()}, dtype=float)
        r = s.rank(ascending=False, method="min")
        if key == "lignite":
            r = r.where(s > 0)
        sb["indicators"][key]["med"] = float(s.median())
        sb["indicators"][key]["n"] = int(s.notna().sum())
        for g, k in sb["kreise"].items():
            k["r"][key] = None if pd.isna(r[g]) else int(r[g])
    stand = json.loads((Path(site) / "kreise_energy.json").read_text(encoding="utf-8")).get("stand")
    if stand:                                          # e.g. "Ende 2026": relabel the energy indicators
        for key in ("solar_kw_pc", "wind_kw_pc"):
            for lang, pre in (("de", "Ende "), ("en", "end-")):
                lab = sb["indicators"][key][lang]
                sb["indicators"][key][lang] = re.sub(r"(Ende |end-)\d{4}", pre + stand[-4:], lab)
    p.write_text(json.dumps(sb, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Steckbrief refreshed")


if __name__ == "__main__":
    site, parts = sys.argv[1], sys.argv[2:] or ["mastr", "osm", "netzausbau", "steckbrief"]
    for part in parts:
        {"mastr": mastr, "osm": osm, "netzausbau": netzausbau, "steckbrief": steckbrief}[part](site)
