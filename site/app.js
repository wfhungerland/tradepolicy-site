"use strict";
(function () {
  const VIEWS = ["ueberblick", "laender", "produktraum", "branchen", "prognose", "methodik"];
  const DEFAULT_COMPARE = ["CHN", "USA", "JPN", "KOR"];
  const state = { iso: "DEU", compare: DEFAULT_COMPARE.slice(), colorMode: "status", snapYear: null, highlight: null };
  const cache = {};
  let D = {};
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["de"], { type: "region" }); } catch (e) { regionNames = null; }

  const $ = (id) => document.getElementById(id);
  // product group colours from the Konjunkturmonitor palette
  const GROUP_PAL = ["#0070C0", "#7030A0", "#47D359", "#B45309", "#D86DCD", "#51154A", "#00B0F0", "#002060"];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 2) => (v === null || v === undefined || !isFinite(v)) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function cname(iso) {
    const c = D.eci.countries[iso];
    if (!c) return iso;
    if (regionNames && c.iso2) { try { const n = regionNames.of(c.iso2); if (n && n !== c.iso2) return n; } catch (e) { /* fall back */ } }
    return c.name;
  }

  async function getJSON(path) {
    if (!cache[path]) cache[path] = fetch(path).then((r) => { if (!r.ok) throw new Error(path); return r.json(); });
    return cache[path];
  }


  // ---------------------------------------------------------------- routing
  function route() {
    const h = location.hash.replace("#", "");
    const view = VIEWS.includes(h) ? h : "ueberblick";
    VIEWS.forEach((v) => { $("view-" + v).hidden = v !== view; });
    document.querySelectorAll("nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("controls").hidden = view === "prognose" || view === "methodik";
    render(view);
  }

  // ---------------------------------------------------------------- charts
  function lineChart(el, years, series, opt) {
    const W = 860, H = 300, m = { l: 44, r: 140, t: 12, b: 28 };
    const vals = series.flatMap((s) => s.values.filter((v) => v !== null));
    let lo = opt.min !== undefined ? opt.min : Math.min(...vals);
    let hi = opt.max !== undefined ? opt.max : Math.max(...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.06; if (opt.min === undefined) lo -= pad; if (opt.max === undefined) hi += pad;
    const x = (i) => m.l + (i / (years.length - 1)) * (W - m.l - m.r);
    const y = (v) => opt.invert ? m.t + ((v - lo) / (hi - lo)) * (H - m.t - m.b) : H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
    const ticks = niceTicks(lo, hi, 5);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "")}">`;
    ticks.forEach((t) => { s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${opt.int ? t : fmt(t, 1)}</text>`; });
    years.forEach((yr, i) => { if (yr % 5 === 0 || i === years.length - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${yr}</text>`; });
    const ends = [];
    series.slice().reverse().forEach((ser) => {
      let d = ""; ser.values.forEach((v, i) => { if (v === null) return; d += (d ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); });
      s += `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.bold ? 2.6 : 1.6}" stroke-linejoin="round"/>`;
      const last = ser.values[ser.values.length - 1];
      if (last !== null) ends.push({ y: y(last), label: ser.label + (opt.int ? " " + last : ""), color: ser.color, bold: ser.bold });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach((e) => { s += `<circle cx="${x(years.length - 1)}" cy="${e.y}" r="0"/><text x="${W - m.r + 8}" y="${e.y + 4}" style="fill:var(--fg);font-weight:${e.bold ? 600 : 400}">${esc(e.label)}</text>`; });
    s += "</svg>";
    el.innerHTML = s;
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => span / k <= n) || mag * 10;
    const out = []; for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
    return out;
  }

  // ---------------------------------------------------------------- views
  async function render(view) {
    if (view === "ueberblick") renderFacts();
    if (view === "laender") renderCountries();
    if (view === "produktraum") await renderSpace();
    if (view === "branchen") await renderSectors();
    if (view === "prognose") renderForecast();
    if (view === "methodik") renderMethod();
  }

  function renderFacts() {
    const c = D.eci.countries[state.iso], n = c.rank.length - 1, ys = D.eci.years;
    $("facts").innerHTML = [
      [`${c.rank[0]} → ${c.rank[n]}`, `ECI-Rang ${cname(state.iso)} ${ys[0]} und ${ys[n]}, von ${D.eci.n_countries}`],
      [`${fmt(c.fixed[0])} → ${fmt(c.fixed[n])}`, "Komplexität des Exportkorbs auf festem Maßstab"],
      [`${c.diversity[0]} → ${c.diversity[n]}`, "Warengruppen mit Exportvorteil"],
      [`${fmt(c.exports_bn_usd[n], 0)} Mrd.`, `Warenexporte ${ys[n]} in USD (Dreijahresmittel)`],
    ].map(([b, l]) => `<div class="fact"><span class="big">${b}</span><span class="label">${esc(l)}</span></div>`).join("");
  }

  function renderCountries() {
    const ys = D.eci.years, list = [state.iso, ...state.compare.filter((i) => i !== state.iso)].slice(0, 6);
    const colors = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"].map(css);
    $("laenderTitle").textContent = cname(state.iso) + " im Vergleich";
    const opts = Object.keys(D.eci.countries).filter((i) => !list.includes(i)).sort((a, b) => cname(a).localeCompare(cname(b), "de"));
    $("compare").innerHTML = list.slice(1).map((iso, k) =>
      `<span class="pill"><i style="background:${colors[k + 1]}"></i>${esc(cname(iso))}<button type="button" data-rm="${iso}" aria-label="${esc(cname(iso))} entfernen">×</button></span>`).join("") +
      (list.length < 6 ? `<label for="addCmp" class="hint">Vergleichsland</label><select id="addCmp"><option value="">hinzufügen …</option>${opts.map((i) => `<option value="${i}">${esc(cname(i))}</option>`).join("")}</select>` : "");
    $("compare").querySelectorAll("button[data-rm]").forEach((b) => b.addEventListener("click", () => {
      state.compare = state.compare.filter((i) => i !== b.dataset.rm); renderCountries();
    }));
    const add = $("addCmp"); if (add) add.addEventListener("change", () => { if (add.value) { state.compare.push(add.value); renderCountries(); } });
    const series = (key) => list.map((iso, k) => ({ label: cname(iso), color: colors[k], values: D.eci.countries[iso][key], bold: k === 0 }));
    const maxRank = Math.max(...list.flatMap((i) => D.eci.countries[i].rank));
    lineChart($("rankChart"), ys, series("rank"), { invert: true, min: 1, max: Math.max(10, maxRank + 2), int: true, label: "ECI-Rang" });
    lineChart($("fixedChart"), ys, series("fixed"), { label: "Komplexität auf festem Maßstab" });
    const n = ys.length - 1;
    $("rankTable").innerHTML = `<thead><tr><th>Land</th><th class="num">ECI-Rang ${ys[0]}</th><th class="num">${ys[n]}</th><th class="num">Fitness-Rang ${ys[n]}</th><th class="num">GENEPY-Rang ${ys[n]}</th><th class="num">Fester Maßstab ${ys[0]}</th><th class="num">${ys[n]}</th></tr></thead><tbody>` +
      list.map((iso) => { const c = D.eci.countries[iso]; return `<tr><td>${esc(cname(iso))}</td><td class="num">${c.rank[0]}</td><td class="num">${c.rank[n]}</td><td class="num">${c.fitness_rank[n]}</td><td class="num">${c.genepy_rank[n]}</td><td class="num">${fmt(c.fixed[0])}</td><td class="num">${fmt(c.fixed[n])}</td></tr>`; }).join("") + "</tbody>";
  }

  // product space ------------------------------------------------------------
  let spaceGeom = null;
  async function renderSpace() {
    const cd = await getJSON(`data/countries/${state.iso}.json`);
    const P = D.products.rows, snaps = cd.snapshots;
    if (state.snapYear === null) state.snapYear = snaps[snaps.length - 1];
    const sy = $("snapYear");
    sy.innerHTML = snaps.map((y) => `<option value="${y}"${y === state.snapYear ? " selected" : ""}>${y}</option>`).join("");
    sy.hidden = $("snapYearLabel").hidden = state.colorMode !== "year";
    $("colorMode").value = state.colorMode;

    const first = new Set(cd.rca[String(snaps[0])]), last = new Set(cd.rca[String(snaps[snaps.length - 1])]);
    const yearSet = new Set(cd.rca[String(state.snapYear)] || []);
    const col = { kept: css("--kept"), gained: css("--gained"), lost: css("--lost"), none: css("--none") };
    const gcol = GROUP_PAL;
    const status = P.map((_, i) => first.has(i) && last.has(i) ? "kept" : last.has(i) ? "gained" : first.has(i) ? "lost" : "none");
    const color = P.map((p, i) => state.colorMode === "group" ? gcol[p[4]] : state.colorMode === "year" ? (yearSet.has(i) ? col.kept : col.none) : col[status[i]]);
    const order = P.map((_, i) => i).sort((a, b) => (color[a] === col.none) - (color[b] === col.none)).reverse();

    const cv = $("space"), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const padd = 14, X = (v) => padd + v * (w - 2 * padd), Y = (v) => padd + (1 - v) * (h - 2 * padd);
    const maxW = Math.max(...P.map((p) => p[8] || 0));
    const rad = P.map((p) => 1.5 + 6 * Math.sqrt((p[8] || 0) / maxW) * Math.min(1, w / 700));
    ctx.lineWidth = 0.5; ctx.strokeStyle = css("--edge-faint"); ctx.beginPath();
    D.edges.extra.forEach(([a, b]) => { ctx.moveTo(X(P[a][5]), Y(P[a][6])); ctx.lineTo(X(P[b][5]), Y(P[b][6])); }); ctx.stroke();
    ctx.lineWidth = 0.8; ctx.strokeStyle = css("--edge"); ctx.beginPath();
    D.edges.tree.forEach(([a, b]) => { ctx.moveTo(X(P[a][5]), Y(P[a][6])); ctx.lineTo(X(P[b][5]), Y(P[b][6])); }); ctx.stroke();
    order.forEach((i) => { ctx.beginPath(); ctx.arc(X(P[i][5]), Y(P[i][6]), rad[i], 0, 2 * Math.PI); ctx.fillStyle = color[i]; ctx.fill(); });
    if (state.highlight !== null) {
      const i = state.highlight; ctx.beginPath(); ctx.arc(X(P[i][5]), Y(P[i][6]), rad[i] + 6, 0, 2 * Math.PI);
      ctx.lineWidth = 2.5; ctx.strokeStyle = css("--fg"); ctx.stroke();
    }
    spaceGeom = { X, Y, rad, status };

    const n = (s) => status.filter((x) => x === s).length;
    $("spaceLegend").innerHTML = state.colorMode === "group"
      ? D.products.groups.map((g, k) => `<span><i style="background:${gcol[k]}"></i>${esc(groupDe(g))}</span>`).join("")
      : state.colorMode === "year"
        ? `<span><i style="background:${col.kept}"></i>Exportvorteil ${state.snapYear} (${yearSet.size})</span><span><i style="background:${col.none}"></i>kein Exportvorteil</span>`
        : `<span><i style="background:${col.kept}"></i>Vorteil ${snaps[0]} und ${snaps[snaps.length - 1]} (${n("kept")})</span><span><i style="background:${col.gained}"></i>hinzugewonnen (${n("gained")})</span><span><i style="background:${col.lost}"></i>verloren (${n("lost")})</span><span><i style="background:${col.none}"></i>kein Vorteil</span>`;

    $("oppTable").innerHTML = `<thead><tr><th>HS4</th><th>Warengruppe</th><th class="num">Nähe</th><th class="num">Komplexität</th><th class="num">Outlook Gain</th></tr></thead><tbody>` +
      cd.opportunities.slice(0, 25).map(([i, dens, cog, pci]) => `<tr class="clickable${state.highlight === i ? " sel" : ""}" data-i="${i}" tabindex="0"><td class="num">${P[i][0]}</td><td>${esc(P[i][1])}</td><td class="num">${fmt(dens)}</td><td class="num">${fmt(pci)}</td><td class="num">${fmt(cog)}</td></tr>`).join("") + "</tbody>";
    $("oppTable").querySelectorAll("tr[data-i]").forEach((tr) => {
      const pick = () => { const i = +tr.dataset.i; state.highlight = state.highlight === i ? null : i; renderSpace(); };
      tr.addEventListener("click", pick); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }

  function groupDe(g) {
    return ({ "Machinery": "Maschinen", "Chemicals and pharma": "Chemie und Pharma", "Food and agriculture": "Nahrungsmittel und Agrar",
      "Minerals, metals, stone": "Rohstoffe, Metalle, Steine", "Textiles and apparel": "Textil und Bekleidung",
      "Plastics, wood, paper": "Kunststoff, Holz, Papier", "Electrical and electronics": "Elektrotechnik und Elektronik",
      "Vehicles, instruments, other": "Fahrzeuge, Instrumente, Sonstiges" })[g] || g;
  }
  function sectorDe(s) {
    return ({ "Food and agriculture": "Nahrungsmittel und Agrar", "Minerals and fuels": "Mineralien und Brennstoffe", "Basic chemicals": "Grundstoffchemie",
      "Pharmaceuticals": "Pharma", "Other chemicals": "Übrige Chemie", "Plastics and rubber": "Kunststoffe und Kautschuk",
      "Leather, wood, paper": "Leder, Holz, Papier", "Textiles, apparel, footwear": "Textil, Bekleidung, Schuhe",
      "Stone, glass, precious metals": "Steine, Glas, Edelmetalle", "Metals": "Metalle", "Machinery": "Maschinenbau",
      "Electrical and electronics": "Elektrotechnik und Elektronik", "Motor vehicles": "Kraftfahrzeuge", "Other transport": "Übriger Fahrzeugbau",
      "Instruments and medical": "Instrumente und Medizintechnik", "Other manufactures": "Übrige Waren" })[s] || s;
  }

  function onSpaceMove(e) {
    if (!spaceGeom) return;
    const cv = $("space"), r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, P = D.products.rows;
    let best = -1, bd = 1e9;
    P.forEach((p, i) => { const dx = spaceGeom.X(p[5]) - mx, dy = spaceGeom.Y(p[6]) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    const tip = $("tip");
    if (best < 0 || bd > 144) { tip.hidden = true; return; }
    const p = P[best], st = { kept: "Vorteil in beiden Jahren", gained: "hinzugewonnen", lost: "verloren", none: "kein Vorteil" }[spaceGeom.status[best]];
    tip.innerHTML = `<b>${p[0]}</b> ${esc(p[1])}<br>${esc(sectorDe(D.products.sectors[p[3]]))}<br>Komplexität ${fmt(p[7])} · Welthandel ${fmt(p[8], 1)} Mrd. USD<br>${cname(state.iso)}: ${st}`;
    tip.hidden = false;
    const tx = Math.min(mx + 12, r.width - tip.offsetWidth - 4), ty = Math.min(my + 12, r.height - tip.offsetHeight - 4);
    tip.style.left = Math.max(4, tx) + "px"; tip.style.top = Math.max(4, ty) + "px";
  }

  async function renderSectors() {
    const cd = await getJSON(`data/countries/${state.iso}.json`), ys = D.meta.years;
    $("branchenTitle").textContent = "Branchen: " + cname(state.iso);
    const rows = D.products.sectors.map((s, k) => ({ s, a: cd.sector_share[k][0], b: cd.sector_share[k][1] })).sort((p, q) => (q.b || 0) - (p.b || 0));
    const mx = Math.max(...rows.flatMap((r) => [r.a || 0, r.b || 0]));
    $("sectorTable").innerHTML = `<thead><tr><th>Branche</th><th class="num">${ys[0]}</th><th class="num">${ys[1]}</th><th class="num">Veränderung</th><th>Anteil ${ys[1]}</th></tr></thead><tbody>` +
      rows.map((r) => {
        const d = (r.b - r.a) * 100, cls = Math.abs(d) < 0.3 ? "even" : d > 0 ? "good" : "bad";
        return `<tr><td>${esc(sectorDe(r.s))}</td><td class="num">${fmt(r.a * 100, 1)} %</td><td class="num">${fmt(r.b * 100, 1)} %</td><td class="num"><span class="chip ${cls}">${d > 0 ? "+" : ""}${fmt(d, 1)}</span></td><td><span class="bar" style="width:${Math.max(1, 140 * (r.b || 0) / mx)}px;background:var(--accent)"></span></td></tr>`;
      }).join("") + "</tbody>";
  }

  function renderForecast() {
    const names = { naive: "Naiv", ar: "AR (Referenz)", bottom_up: "AR nach Zielländern", gravity: "Gravitation" };
    const block = (title, rows, hkey, hlabel) => {
      if (!rows) return "";
      const hs = [...new Set(rows.map((r) => r[hkey]))];
      const models = ["naive", "ar", "bottom_up", "gravity"];
      let t = `<div class="tablewrap"><table><caption>${esc(title)}</caption><thead><tr><th>Modell</th>${hs.map((h) => `<th class="num">${esc(hlabel(h))}</th>`).join("")}</tr></thead><tbody>`;
      models.forEach((m) => {
        t += `<tr><td>${names[m]}</td>` + hs.map((h) => {
          const r = rows.find((x) => x[hkey] === h && x.model === m); if (!r) return "<td></td>";
          if (m === "ar") return `<td class="num">RMSE ${fmt(r.rmse, 1)} %</td>`;
          const cls = r.dm_pvalue < 0.1 ? (r.rel_rmse < 1 ? "good" : "bad") : "even";
          return `<td class="num"><span class="chip ${cls}">${fmt(r.rel_rmse)}</span> <span class="hint">p ${fmt(r.dm_pvalue)}</span></td>`;
        }).join("") + "</tr>";
      });
      return t + "</tbody></table></div>";
    };
    const F = D.forecast, mh = (h) => h === 1 ? "1 Monat" : `${h} Monate`, qh = (k) => k === 0 ? "Quartal voraus" : `${k} Monat${k > 1 ? "e" : ""} bekannt`;
    $("forecastTables").innerHTML =
      block("Deutsche Ausfuhren, monatlich (Comext, EU27 als Exporteure)", F.forecast_germany.summary_monthly, "h", mh) +
      block("Deutsche Ausfuhren, monatlich, ohne März 2020 bis Juni 2021", F.forecast_germany.summary_monthly_excl_covid, "h", mh) +
      block("Deutsche Ausfuhren, Quartal", F.forecast_germany.summary_quarterly, "known_months", qh) +
      block("Welthandel, monatlich (IMF IMTS, 210 Länder)", F.forecast_world.summary_monthly, "h", mh) +
      block("Welthandel, Quartal", F.forecast_world.summary_quarterly, "known_months", qh);
  }

  function renderMethod() {
    $("sources").innerHTML = D.meta.sources.map((s) => `<li>${esc(s)}</li>`).join("");
    $("built").textContent = `Stand der Berechnung: ${new Date(D.meta.built).toLocaleDateString("de-DE")}. ${D.meta.n_countries} Länder, ${D.meta.n_products} Warengruppen (${D.meta.level}).`;
  }

  // ---------------------------------------------------------------- start
  async function start() {
    const [meta, eci, products, edges, forecast] = await Promise.all(["meta", "eci", "products", "edges", "forecast"].map((f) => getJSON(`data/${f}.json`)));
    D = { meta, eci, products, edges, forecast };
    const sel = $("country");
    sel.innerHTML = Object.keys(eci.countries).sort((a, b) => cname(a).localeCompare(cname(b), "de")).map((i) => `<option value="${i}"${i === state.iso ? " selected" : ""}>${esc(cname(i))}</option>`).join("");
    sel.addEventListener("change", () => { state.iso = sel.value; state.highlight = null; state.snapYear = null; route(); });
    $("countryHint").textContent = `${eci.n_countries} Länder, ${meta.years[0]} bis ${meta.years[1]}`;
    $("colorMode").addEventListener("change", (e) => { state.colorMode = e.target.value; renderSpace(); });
    $("snapYear").addEventListener("change", (e) => { state.snapYear = +e.target.value; renderSpace(); });
    $("space").addEventListener("mousemove", onSpaceMove);
    $("space").addEventListener("mouseleave", () => { $("tip").hidden = true; });
    $("space").addEventListener("click", onSpaceMove);
    window.addEventListener("hashchange", route);
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!$("view-produktraum").hidden) renderSpace(); }, 150); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route);
    route();
  }
  start().catch((e) => { document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="note">Die Daten konnten nicht geladen werden (${esc(e.message)}).</p>`); });
})();
