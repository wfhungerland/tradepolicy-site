"""Monthly update of the US tariff scenarios on the site.

1. Looks up the newest CEPII file of US import tariffs (usa_tariffs_YYYYMMDD.zip) on
   the CEPII database page. Stops if it is the version recorded in scenarios.json.
2. Aggregates the tariffs to ICIO sectors with fixed 2024 US import weights.
3. Re-solves the five US scenarios (peak April 2025, deals September 2025, the latest
   date in the file, and the two retaliation cases) on the stored baseline
   (41_update_assets.py), for all four elasticity variants.
4. Replaces those five entries in scenarios.json and records the tariff version.
The EU and shipping scenarios do not depend on US tariffs and stay as they are.

Needs only numpy, pandas, pyarrow and gravity_ge.py.
Copied from the private analysis repo (42_update_us_scenarios.py); assets built there by 41_update_assets.py.
Usage: python update/update_us_scenarios.py update/assets site/data/scenarios.json [--force]
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

import gravity_ge as gg

PAGE = "https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=44"
FILE_URL = "https://www.cepii.fr/DATA_DOWNLOAD/usa_tariffs/{name}"
BASE_DATE = "20250101"
FIXED = {"peak_2025_04": "20250410", "deal_2025_09": "20250905"}
GOODS = ("A", "B", "C")
MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
          "November", "Dezember"]


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tradepolicy-update"}), timeout=300) as r:
        return r.read()


def latest_file():
    html = get(PAGE).decode("latin-1")
    names = sorted(set(re.findall(r"usa_tariffs_(\d{8})\.zip", html)))
    if not names:
        raise SystemExit("no tariff file found on the CEPII page")
    return f"usa_tariffs_{names[-1]}.zip"


def sector_tariffs(raw, weights, hs_map):
    t = raw.rename(columns={"exporter_iso": "exporter", "hs6_rev2022": "hs22"})
    t = t.merge(hs_map, on="hs22").merge(weights, on=["exporter", "hs22"])
    t = t[t.v > 0]
    t["tv"] = t.ave * t.v
    g = t.groupby(["date_inforce", "exporter", "sector"], as_index=False)[["tv", "v"]].sum()
    g["tariff"] = g.tv / g.v
    return g.rename(columns={"date_inforce": "date", "v": "us_imports_2024"})


def us_row(t, date_, countries, sectors):
    """US tariffs by origin and sector in force at date_ (latest entry on or before)."""
    pos = {c: k for k, c in enumerate(countries)}
    spos = {s: k for k, s in enumerate(sectors)}
    d = t[t.date <= date_].sort_values("date").groupby(["exporter", "sector"]).tail(1).copy()
    d["origin"] = d.exporter.where(d.exporter.isin(pos), "ROW")
    d = d[d.sector.isin(spos) & d.sector.str.startswith(GOODS) & (d.origin != "USA")]
    d["tv"] = d.tariff * d.us_imports_2024
    g = d.groupby(["origin", "sector"])[["tv", "us_imports_2024"]].sum()
    row = np.zeros((len(countries), len(sectors)))
    for (o, s), r in g.iterrows():
        row[pos[o], spos[s]] = r.tv / r.us_imports_2024
    return row


def german_date(d):
    x = datetime.strptime(d, "%Y%m%d")
    return f"{x.day}. {MONTHS[x.month - 1]} {x.year}"


def main(assets, scen_path, force=False):
    assets, scen_path = Path(assets), Path(scen_path)
    S = json.loads(scen_path.read_text(encoding="utf-8"))
    name = latest_file()
    if S.get("us_tariff_file") == name and not force:
        print(f"{name} already used, nothing to do")
        return False
    print(f"downloading {name}")
    with zipfile.ZipFile(io.BytesIO(get(FILE_URL.format(name=name)))) as z:
        pq = next(n for n in z.namelist() if n.endswith(".parquet"))
        raw = pd.read_parquet(io.BytesIO(z.read(pq)), columns=["exporter_iso", "date_inforce", "hs6_rev2022", "ave"])
    B = np.load(assets / "baseline.npz")
    countries, sectors = list(B["countries"]), list(B["sectors"])
    base = {k: B[k] for k in ("Y", "G", "b", "alpha", "pi", "E", "I", "VA", "R0", "D", "tau0")}
    t = sector_tariffs(raw, pd.read_parquet(assets / "us_weights.parquet"),
                       pd.read_csv(assets / "hs6_icio_map.csv", dtype=str))
    last = t.date.max()
    dates = {**FIXED, "current": last}
    us = countries.index("USA")
    eu = B["eu"]
    thetas = {v: B[f"theta_{v}"] for v in ("protee", "protee_uncapped", "uniform4", "uniform8")}
    tau0 = base["tau0"]

    def tau_at(d):
        tau = tau0.copy()
        tau[us] = us_row(t, d, countries, sectors)
        return tau

    def retaliate(tau1, who):
        out = tau1.copy()
        rise = np.maximum(tau1[us] - tau0[us], 0.0)
        for n, c in enumerate(countries):
            if c in ("USA", "ROW") or (who == "EU" and not eu[n]):
                continue
            out[n, us, :] = tau1[n, us, :] + rise[n]
        return out

    cases = {"peak_2025_04": tau_at(dates["peak_2025_04"]), "deal_2025_09": tau_at(dates["deal_2025_09"])}
    cur = tau_at(last)
    cases["current"] = cur
    cases["retaliation_eu"] = retaliate(cur, "EU")
    cases["retaliation_all"] = retaliate(cur, "ALL")

    deu = countries.index("DEU")
    new = {}
    for key, tau1 in cases.items():
        res = {v: gg.cp_solve(base, tau1, th) for v, th in thetas.items()}
        r = res["protee"]
        C = {}
        to_old, to_new = r["X_old"][us].sum(axis=1), r["X_new"][us].sum(axis=1)
        for k, c in enumerate(countries):
            w = [(res[v]["W_hat"][k] - 1) * 100 for v in thetas]
            C[c] = [round(w[0], 3), round(min(w), 3), round(max(w), 3), round((r["exports_hat"][k] - 1) * 100, 2),
                    None if k == us else round((to_new[k] / to_old[k] - 1) * 100, 2),
                    round((r["Y_new"][k].sum() / base["Y"][k].sum() - 1) * 100, 3),
                    round(float((tau1[us, k] * r["X_old"][us, k]).sum() / max(r["X_old"][us, k].sum(), 1e-9) * 100), 2)]
        we = [((res[v]["W_hat"][eu] * base["I"][eu]).sum() / base["I"][eu].sum() - 1) * 100 for v in thetas]
        C["EU27"] = [round(we[0], 3), round(min(we), 3), round(max(we), 3), None,
                     round((to_new[eu].sum() / to_old[eu].sum() - 1) * 100, 2), None, None]
        sec = [[s, round((r["Y_hat"][deu, j] - 1) * 100, 2),
                round((r["X_new"][us, deu, j] / max(r["X_old"][us, deu, j], 1e-9) - 1) * 100, 2),
                round(float(tau1[us, deu, j]) * 100, 2), round(float(r["X_old"][us, deu, j]) / 1e3, 2),
                round(float(base["Y"][deu, j]) / 1e3, 1)] for j, s in enumerate(sectors)]
        new[key] = (C, sec)
        print(f"{key:16s} DEU {C['DEU'][0]:+.3f}%  EU27 {C['EU27'][0]:+.3f}%  USA {C['USA'][0]:+.3f}%")

    when = german_date(last)
    for sc in S["scenarios"]:
        k = "current" if sc["id"] == "current_2026_08" else sc["id"]
        if k not in new:
            continue
        sc["countries"], sc["sectors_deu"] = new[k]
        if sc["id"] == "current_2026_08":
            sc["title"] = f"US-Zölle aktuell ({when})"
            sc["shock"] = re.sub(r"US-Zölle wie am [^:;]+", f"US-Zölle wie am {when}", sc["shock"], count=1)
        if sc["id"].startswith("retaliation"):
            sc["shock"] = re.sub(r"US-Zölle wie am [^;]+", f"US-Zölle wie am {when}", sc["shock"], count=1)
    S["us_tariff_file"] = name
    S["us_tariff_latest_date"] = last
    S["built"] = date.today().isoformat()
    scen_path.write_text(json.dumps(S, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"updated {scen_path} with {name} (latest measure {last})")
    return True


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    main(a[0], a[1], force="--force" in sys.argv)
