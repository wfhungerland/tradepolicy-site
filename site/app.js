"use strict";
(function () {
  const VIEWS = ["ueberblick", "laender", "produktraum", "branchen", "szenarien", "prognose", "methodik"];
  const DEFAULT_COMPARE = ["CHN", "USA", "JPN", "KOR"];
  const state = { scenario: "current_2026_08", iso: "DEU", compare: DEFAULT_COMPARE.slice(), colorMode: "status", snapYear: null, highlight: null };
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
    let h = location.hash.replace("#", "");
    let fig = null;
    if (h.startsWith("abb-")) { fig = document.getElementById(h); const sec = fig && fig.closest("section.view"); h = sec ? sec.id.replace("view-", "") : ""; }
    const view = VIEWS.includes(h) ? h : "ueberblick";
    VIEWS.forEach((v) => { $("view-" + v).hidden = v !== view; });
    document.querySelectorAll("nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("controls").hidden = view === "prognose" || view === "methodik";
    render(view).then(() => { if (fig) fig.scrollIntoView(); });
  }

  // figures: numbering, CSV, PNG and link (as under every chart of the Konjunkturmonitor)
  const FIGDATA = {};
  function setupFigures() {
    document.querySelectorAll(".fig").forEach((f, i) => {
      f.id = "abb-" + (i + 1);
      f.querySelector(".fignum").textContent = `Abb. ${i + 1}: `;
      f.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => figAction(f, b)));
    });
  }
  function figName(f) { return `Produktraum-Monitor (${D.meta.built}, ${f.id.replace("abb-", "Abb. ")}) ${f.dataset.fig}`; }
  function figAction(f, b) {
    const act = b.dataset.act;
    if (act === "link") {
      const url = location.href.split("#")[0] + "#" + f.id;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { b.textContent = "Link kopiert"; setTimeout(() => { b.textContent = "Link kopieren"; }, 1500); });
      return;
    }
    if (act === "csv") {
      const d = FIGDATA[f.dataset.fig]; if (!d) return;
      const q = (v) => (v === null || v === undefined) ? "" : /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v).replace(".", ",");
      const csv = "\ufeff" + [d.header, ...d.rows].map((r) => r.map(q).join(";")).join("\r\n");
      save(new Blob([csv], { type: "text/csv;charset=utf-8" }), figName(f) + ".csv");
      return;
    }
    if (act === "png") {
      const canvas = f.querySelector("canvas"), svg = f.querySelector("svg");
      if (canvas) { canvas.toBlob((bl) => save(bl, figName(f) + ".png")); return; }
      if (!svg) return;
      const vb = svg.viewBox.baseVal, s = 2, clone = svg.cloneNode(true);
      clone.setAttribute("width", vb.width); clone.setAttribute("height", vb.height);
      clone.querySelectorAll("text").forEach((tx) => { if (!tx.getAttribute("fill") && !tx.style.fill) tx.setAttribute("fill", "#000"); tx.setAttribute("font-family", "Source Sans 3, Arial, sans-serif"); });
      clone.querySelectorAll(".grid").forEach((g) => { g.setAttribute("stroke", "#D9D9D9"); g.setAttribute("stroke-width", "0.5"); });
      const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      const img = new Image();
      img.onload = () => { const c = document.createElement("canvas"); c.width = vb.width * s; c.height = vb.height * s; const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); c.toBlob((bl) => save(bl, figName(f) + ".png")); };
      img.src = src;
    }
  }
  function save(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  // ---------------------------------------------------------------- charts
  function lineChart(el, years, series, opt) {
    // as in the Konjunkturmonitor: value axis on the right, round steps, horizontal gridlines only,
    // unit above the top number, legend above the chart, first series dark blue
    const W = 860, legendRows = Math.ceil(series.length / 4), m = { l: 16, r: 54, t: 22 + legendRows * 20, b: 28 }, H = 300 + legendRows * 20;
    const vals = series.flatMap((s) => s.values.filter((v) => v !== null));
    let lo = opt.min !== undefined ? opt.min : Math.min(...vals);
    let hi = opt.max !== undefined ? opt.max : Math.max(...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.06; if (opt.min === undefined) lo -= pad; if (opt.max === undefined) hi += pad;
    const x = (i) => m.l + (i / (years.length - 1)) * (W - m.l - m.r);
    const y = (v) => opt.invert ? m.t + ((v - lo) / (hi - lo)) * (H - m.t - m.b) : H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
    const ticks = niceTicks(lo, hi, 5);
    if (opt.int && opt.min === 1 && !ticks.includes(1)) ticks.unshift(1);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "")}">`;
    series.forEach((ser, k) => { const lx = m.l + (k % 4) * 200, ly = 14 + Math.floor(k / 4) * 20; s += `<line x1="${lx}" x2="${lx + 18}" y1="${ly}" y2="${ly}" stroke="${ser.color}" stroke-width="${ser.bold ? 3 : 2}"/><text x="${lx + 24}" y="${ly + 4}" style="font-weight:${ser.bold ? 600 : 400}">${esc(ser.label)}</text>`; });
    ticks.forEach((t) => { s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${W - m.r + 8}" y="${y(t) + 4}">${opt.int ? t : fmt(t, 1)}</text>`; });
    if (opt.unit) { const tt = opt.invert ? ticks[0] : ticks[ticks.length - 1]; s += `<text x="${W}" y="${y(tt) - 10}" text-anchor="end">${esc(opt.unit)}</text>`; }
    years.forEach((yr, i) => { if (yr % 5 === 0 || i === years.length - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${yr}</text>`; });
    series.slice().reverse().forEach((ser) => {
      let d = ""; ser.values.forEach((v, i) => { if (v === null) return; d += (d ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); });
      s += `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.bold ? 2.6 : 1.6}" stroke-linejoin="round"><title>${esc(ser.label)}</title></path>`;
    });
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
    if (view === "szenarien") await renderScenarios();
    if (view === "prognose") renderForecast();
    if (view === "methodik") renderMethod();
  }

  function renderFacts() {
    const c = D.eci.countries[state.iso], n = c.rank.length - 1, ys = D.eci.years;
    $("facts").innerHTML = [
      [`${c.rank[0]} → ${c.rank[n]}`, `ECI-Rang ${ys[0]} und ${ys[n]}`, `von ${D.eci.n_countries} Ländern`],
      [`${fmt(c.fixed[0])} → ${fmt(c.fixed[n])}`, "Komplexität auf festem Maßstab", `${ys[0]} und ${ys[n]}`],
      [`${c.diversity[0]} → ${c.diversity[n]}`, "Warengruppen mit Exportvorteil", `${ys[0]} und ${ys[n]}`],
      [`${fmt(c.exports_bn_usd[n], 0)} Mrd. USD`, "Warenexporte", `${ys[n]}, Dreijahresmittel`],
    ].map(([b, l, s]) => `<div class="kpi"><span class="kn">${esc(l)}</span><span class="kv">${b}</span><span class="ks">${esc(s)}</span></div>`).join("");
    const move = c.rank[n] < c.rank[0] ? "verbessert sich" : c.rank[n] > c.rank[0] ? "fällt" : "bleibt";
    $("ovAnswer").textContent = `${cname(state.iso)} ${move} im Complexity-Rang von Platz ${c.rank[0]} (${ys[0]})${move === "bleibt" ? " " : " auf Platz " + c.rank[n] + " "}(${ys[n]}) und hat ${ys[n]} in ${c.diversity[n]} von ${D.meta.n_products.toLocaleString("de-DE")} Warengruppen einen Exportvorteil.`;
  }

  function renderCountries() {
    const ys = D.eci.years, list = [state.iso, ...state.compare.filter((i) => i !== state.iso)].slice(0, 6);
    const colors = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"].map(css);
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
    lineChart($("rankChart"), ys, series("rank"), { invert: true, min: 1, max: Math.max(10, maxRank + 2), int: true, label: "ECI-Rang", unit: "Rang" });
    lineChart($("fixedChart"), ys, series("fixed"), { label: "Komplexität auf festem Maßstab", unit: "PCI" });
    FIGDATA.rank = { header: ["Jahr", ...list.map(cname)], rows: ys.map((yr, i) => [yr, ...list.map((iso) => D.eci.countries[iso].rank[i])]) };
    FIGDATA.fixed = { header: ["Jahr", ...list.map(cname)], rows: ys.map((yr, i) => [yr, ...list.map((iso) => D.eci.countries[iso].fixed[i])]) };
    const c0 = D.eci.countries[state.iso], n0 = ys.length - 1;
    $("laAnswer").textContent = `${cname(state.iso)} liegt ${ys[n0]} auf Rang ${c0.rank[n0]} von ${D.eci.n_countries} Ländern, ${ys[0]} auf Rang ${c0.rank[0]}. Auf festem Maßstab ${c0.fixed[n0] > c0.fixed[0] + 0.02 ? "stieg" : c0.fixed[n0] < c0.fixed[0] - 0.02 ? "sank" : "blieb"} die Komplexität des Exportkorbs ${Math.abs(c0.fixed[n0] - c0.fixed[0]) <= 0.02 ? "etwa gleich" : "von " + fmt(c0.fixed[0]) + " auf " + fmt(c0.fixed[n0])}.`;
    const n = ys.length - 1;
    $("rankTable").innerHTML = `<thead><tr><th>Land</th><th class="num">ECI-Rang ${ys[0]}</th><th class="num">${ys[n]}</th><th class="num">Fitness-Rang ${ys[n]}</th><th class="num">GENEPY-Rang ${ys[n]}</th><th class="num">Fester Maßstab ${ys[0]}</th><th class="num">${ys[n]}</th></tr></thead><tbody>` +
      list.map((iso) => { const c = D.eci.countries[iso]; return `<tr><td>${esc(cname(iso))}</td><td class="num">${c.rank[0]}</td><td class="num">${c.rank[n]}</td><td class="num">${c.fitness_rank[n]}</td><td class="num">${c.genepy_rank[n]}</td><td class="num">${fmt(c.fixed[0])}</td><td class="num">${fmt(c.fixed[n])}</td></tr>`; }).join("") + "</tbody>";
  }

  // product space ------------------------------------------------------------
  let spaceGeom = null;
  async function renderSpace() {
    const cd = await getJSON(`data/countries/${state.iso}.json`);
    const P = D.products.rows, snaps = cd.snapshots;
    const y0 = snaps[0], y1 = snaps[snaps.length - 1], n0 = cd.rca[String(y0)].length, n1 = cd.rca[String(y1)].length;
    const firstOpps = cd.opportunities.slice(0, 3).map((o) => P[o[0]][9] ? P[o[0]][9].split(";")[0].trim() : P[o[0]][1]);
    $("prAnswer").textContent = `${cname(state.iso)} hat ${y1} in ${n1.toLocaleString("de-DE")} Warengruppen einen Exportvorteil (${y0}: ${n0.toLocaleString("de-DE")}); ${cd.gained.length} kamen hinzu, ${cd.lost.length} gingen verloren. Die nächsten Chancen liegen etwa bei ${firstOpps.join(", ")}.`;
    FIGDATA.space = { header: ["HS4", "Warengruppe", "x", "y", "Komplexität (PCI)", "Welthandel 2024 (Mrd. USD)", `Vorteil ${y0}`, `Vorteil ${y1}`],
      rows: P.map((r, i) => [r[0], r[1], r[5], r[6], r[7], r[8], cd.rca[String(y0)].includes(i) ? 1 : 0, cd.rca[String(y1)].includes(i) ? 1 : 0]) };
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
      cd.opportunities.slice(0, 25).map(([i, dens, cog, pci]) => `<tr class="clickable${state.highlight === i ? " sel" : ""}" data-i="${i}" tabindex="0"><td class="num">${P[i][0]}</td><td>${esc(P[i][1])}${P[i][9] ? `<span class="ex">z. B. ${esc(P[i][9])}</span>` : ""}</td><td class="num">${fmt(dens)}</td><td class="num">${fmt(pci)}</td><td class="num">${fmt(cog)}</td></tr>`).join("") + "</tbody>";
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
    tip.innerHTML = `<b>${p[0]}</b> ${esc(p[1])}${p[9] ? `<br><i>z. B. ${esc(p[9])}</i>` : ""}<br>${esc(sectorDe(D.products.sectors[p[3]]))}<br>Komplexität ${fmt(p[7])} · Welthandel ${fmt(p[8], 1)} Mrd. USD<br>${cname(state.iso)}: ${st}`;
    tip.hidden = false;
    const tx = Math.min(mx + 12, r.width - tip.offsetWidth - 4), ty = Math.min(my + 12, r.height - tip.offsetHeight - 4);
    tip.style.left = Math.max(4, tx) + "px"; tip.style.top = Math.max(4, ty) + "px";
  }

  async function renderSectors() {
    const cd = await getJSON(`data/countries/${state.iso}.json`), ys = D.meta.years;
    const rows = D.products.sectors.map((s, k) => ({ s, a: cd.sector_share[k][0], b: cd.sector_share[k][1] })).sort((p, q) => (q.b || 0) - (p.b || 0));
    const mx = Math.max(...rows.flatMap((r) => [r.a || 0, r.b || 0]));
    const ch = rows.filter((r) => r.a !== null && r.b !== null).map((r) => ({ ...r, d: (r.b - r.a) * 100 }));
    const up = ch.slice().sort((p, q) => q.d - p.d)[0], dn = ch.slice().sort((p, q) => p.d - q.d)[0];
    $("brAnswer").textContent = `Den größten Weltmarktanteil hat ${cname(state.iso)} ${ys[1]} in der Branche ${sectorDe(rows[0].s)} mit ${fmt(rows[0].b * 100, 1)}\u202f%. Am stärksten gestiegen ist der Anteil seit ${ys[0]} in der Branche ${sectorDe(up.s)} (${up.d > 0 ? "+" : ""}${fmt(up.d, 1)} Pp), am stärksten gesunken in der Branche ${sectorDe(dn.s)} (${fmt(dn.d, 1)} Pp).`;
    $("sectorTable").innerHTML = `<thead><tr><th>Branche</th><th class="num">${ys[0]}</th><th class="num">${ys[1]}</th><th class="num">Veränderung</th><th>Anteil ${ys[1]}</th></tr></thead><tbody>` +
      rows.map((r) => {
        const d = (r.b - r.a) * 100, cls = Math.abs(d) < 0.05 ? "even" : "down", sym = Math.abs(d) < 0.05 ? "■" : d > 0 ? "▲" : "▼";
        return `<tr><td>${esc(sectorDe(r.s))}</td><td class="num">${fmt(r.a * 100, 1)}\u202f%</td><td class="num">${fmt(r.b * 100, 1)}\u202f%</td><td class="num"><span class="chip ${cls}">${sym}</span> ${d > 0 ? "+" : ""}${fmt(d, 1)} Pp</td><td><span class="bar" style="width:${Math.max(1, 140 * (r.b || 0) / mx)}px;background:var(--c1)"></span></td></tr>`;
      }).join("") + "</tbody>";
  }


  // scenarios ----------------------------------------------------------------
  const pct = (v, d = 2) => (v === null || v === undefined) ? "–" : (v > 0 && Number(v.toFixed(d)) !== 0 ? "+" : "") + fmt(v, d) + "\u202f%";
  function scName(iso, S) {
    if (iso === "EU27") return "EU27";
    if (iso === "ROW") return "Rest der Welt";
    const i2 = S.iso2[iso];
    if (regionNames && i2) { try { const n = regionNames.of(i2); if (n && n !== i2) return n; } catch (e) { /* fall back */ } }
    return (D.eci.countries[iso] && D.eci.countries[iso].name) || iso;
  }
  function robust(v) {
    if (v[1] === null || v[2] === null) return ["even", "ohne Spanne"];
    if (Math.abs(v[0]) < 0.005 && Math.abs(v[1]) < 0.01 && Math.abs(v[2]) < 0.01) return ["even", "kaum Wirkung"];
    return (v[1] < 0) === (v[2] < 0) || v[1] === 0 || v[2] === 0 ? ["good", "robust"] : ["bad", "Vorzeichen unsicher"];
  }
  async function renderScenarios() {
    const S = await getJSON("data/scenarios.json");
    const sel = $("scenario");
    if (!sel.options.length) {
      const grp = { us: "US-Zölle und Gegenzölle", eu: "EU-Binnenmarkt", transport: "Transportkosten" };
      sel.innerHTML = Object.keys(grp).map((g) => `<optgroup label="${grp[g]}">` +
        S.scenarios.filter((s) => s.group === g).map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("") + "</optgroup>").join("");
      sel.addEventListener("change", () => { state.scenario = sel.value; renderScenarios(); });
    }
    sel.value = state.scenario;
    const sc = S.scenarios.find((s) => s.id === state.scenario), C = sc.countries;
    const iso = C[state.iso] ? state.iso : "DEU", name = scName(iso, S), v = C[iso];
    const partner = sc.partner === "USA" ? "in die USA" : sc.partner === "EU" ? "in die EU" : "auf längeren Seewegen";
    $("scenShock").textContent = sc.shock;
    const note = iso !== state.iso ? `${cname(state.iso)} ist im Modell Teil des „Rests der Welt“; gezeigt wird Deutschland. ` : "";
    const [rc, rl] = robust(v);
    const sent = `${sc.title}: Das Realeinkommen ${iso === "DEU" ? "in Deutschland" : "von " + name} ändert sich um ${pct(v[0])} (Spanne ${pct(v[1])} bis ${pct(v[2])}). ` +
      (v[4] !== null && !(sc.partner === "USA" && iso === "USA") ? `Die Exporte ${partner} ändern sich um ${pct(v[4], 1)}, die gesamten Exporte um ${pct(v[3], 1)}.` : "");
    $("scenAnswer").innerHTML = `${esc(note + sent)} <span class="chip ${rc}">${rl}</span> <button type="button" class="copy" id="copyScen">⧉ Textbaustein</button>`;
    $("copyScen").addEventListener("click", (e) => {
      const txt = sent + " Quelle: Produktraum-Monitor, Modell nach Caliendo und Parro (2015), OECD ICIO 2022; " + location.href.split("#")[0] + "#szenarien";
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => { e.target.textContent = "kopiert"; });
    });
    const tile = (big, label) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">langfristig, zentraler Fall</span></div>`;
    $("scenFacts").innerHTML = [
      tile(pct(v[0]), `Realeinkommen ${name}`),
      v[4] !== null ? tile(pct(v[4], 1), `Exporte ${partner}`) : tile(pct(v[3], 1), "Exporte insgesamt"),
      tile(pct(C.EU27[0]), "Realeinkommen EU27"),
      sc.partner === "USA" ? tile(pct(C.USA[0]), "Realeinkommen USA") : tile(pct(C.CHN[0]), "Realeinkommen China"),
    ].join("");
    // bar chart: 20 largest effects plus selection and EU27
    const all = Object.keys(C).filter((k) => k !== "ROW");
    let list = all.filter((k) => k !== "EU27").sort((a, b) => Math.abs(C[b][0]) - Math.abs(C[a][0])).slice(0, 18);
    ["EU27", iso].forEach((k) => { if (!list.includes(k)) list.push(k); });
    list.sort((a, b) => C[a][0] - C[b][0]);
    $("scenChartTitle").textContent = "Realeinkommen in %: die 18 am stärksten betroffenen Länder, " + (iso === "DEU" ? "Deutschland" : name) + " und EU27";
    const W = 860, row = 22, m = { l: 170, r: 70, t: 8, b: 26 }, H = m.t + m.b + row * list.length;
    const vals = list.flatMap((k) => [C[k][0], C[k][1], C[k][2]]).filter((x) => x !== null);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pd = (hi - lo) * 0.05 || 0.1; lo -= pd; hi += pd;
    const X = (x) => m.l + (x - lo) / (hi - lo) * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Realeinkommen nach Ländern">`;
    niceTicks(lo, hi, 6).forEach((tk) => { s += `<line class="grid" x1="${X(tk)}" x2="${X(tk)}" y1="${m.t}" y2="${H - m.b}"/><text x="${X(tk)}" y="${H - 8}" text-anchor="middle">${fmt(tk, 1)}</text>`; });
    s += `<line x1="${X(0)}" x2="${X(0)}" y1="${m.t}" y2="${H - m.b}" stroke="#595959"/>`;
    list.forEach((k, i) => {
      const y = m.t + i * row, c = C[k], sel = k === iso || k === "EU27";
      const col = c[0] < 0 ? (sel ? "#C00000" : "#e08a8a") : (sel ? "#0070C0" : "#8fbfe3");
      s += `<rect x="${Math.min(X(0), X(c[0]))}" y="${y + 4}" width="${Math.abs(X(c[0]) - X(0))}" height="${row - 8}" fill="${col}"/>`;
      if (c[1] !== null) s += `<line x1="${X(c[1])}" x2="${X(c[2])}" y1="${y + row / 2}" y2="${y + row / 2}" stroke="#000" stroke-width="1"/>`;
      s += `<text x="${m.l - 8}" y="${y + row / 2 + 4}" text-anchor="end" style="fill:var(--fg);font-weight:${sel ? 600 : 400}">${esc(scName(k, S))}</text>`;
      s += `<text x="${W - m.r + 6}" y="${y + row / 2 + 4}">${pct(c[0])}</text>`;
    });
    $("scenChart").innerHTML = s + "</svg>";
    FIGDATA.scen = { header: ["Land", "Realeinkommen in %", "Spanne von", "Spanne bis", "Exporte insgesamt in %", `Exporte ${partner} in %`],
      rows: Object.keys(C).map((k) => [scName(k, S), C[k][0], C[k][1], C[k][2], C[k][3], C[k][4]]) };
    // German sectors
    const usS = sc.partner === "USA";
    // the 15 sectors with the largest German exports to the partner in 2022 (small sectors give extreme percentages)
    const bySize = sc.sectors_deu.filter((r) => r[1] !== null && (r[5] || 0) >= 5).sort((a, b) => (b[4] || 0) - (a[4] || 0)).slice(0, 15);
    const chip = (x, d = 1) => `<span class="chip ${x === null || Math.abs(x) < 0.05 ? "even" : x > 0 ? "good" : "bad"}">${pct(x, d)}</span>`;
    $("scenSectors").innerHTML = `<thead><tr><th>Branche</th>${usS ? '<th class="num">US-Zoll</th>' : ""}<th class="num">Exporte ${partner} 2022</th><th class="num">Exporte ${partner}</th><th class="num">Produktion</th></tr></thead><tbody>` +
      bySize.map((r) => `<tr><td>${esc(S.sector_names[r[0]] || r[0])}</td>${usS ? `<td class="num">${fmt(r[3], 1)}\u202f%</td>` : ""}<td class="num">${fmt(r[4], 1)} Mrd. USD</td><td class="num">${chip(r[2])}</td><td class="num">${chip(r[1], 2)}</td></tr>`).join("") + "</tbody>";
    // all countries
    $("scenAll").innerHTML = `<thead><tr><th>Land</th><th class="num">Realeinkommen</th><th class="num">Spanne</th><th class="num">Exporte ${partner}</th><th class="num">Exporte insgesamt</th>${usS ? '<th class="num">US-Zoll im Mittel</th>' : ""}</tr></thead><tbody>` +
      all.sort((a, b) => scName(a, S).localeCompare(scName(b, S), "de")).map((k) => { const c = C[k]; return `<tr${k === iso ? ' class="sel"' : ""}><td>${esc(scName(k, S))}</td><td class="num">${pct(c[0])}</td><td class="num">${c[1] === null ? "–" : pct(c[1]) + " bis " + pct(c[2])}</td><td class="num">${pct(c[4], 1)}</td><td class="num">${pct(c[3], 1)}</td>${usS ? `<td class="num">${c[6] === null ? "–" : fmt(c[6], 1) + " %"}</td>` : ""}</tr>`; }).join("") + "</tbody>";
    const rcls = { "bestanden": "good", "plausibel": "good", "erklärt": "even", "Abweichung": "bad" };
    $("scenChecks").innerHTML = `<thead><tr><th>Prüfung</th><th>Ergebnis</th><th>Befund</th></tr></thead><tbody>` +
      S.checks.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="chip ${rcls[c.result] || "even"}">${esc(c.result)}</span></td><td>${esc(c.text)}</td></tr>`).join("") + "</tbody>";
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
    $("stand").textContent = `Stand ${new Date(meta.built).toLocaleDateString("de-DE")} · Handelsdaten bis ${meta.years[1]}`;
    setupFigures();
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
