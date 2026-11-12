"use strict";
(function () {
  const EN = document.documentElement.lang === "en";
  const L = (de, en) => EN ? en : de;
  const BASE = EN ? "../" : "";
  const LOC = L("de-DE", "en-GB");
  const fmtDate = (d) => EN ? new Date(d).toLocaleDateString(LOC, { day: "numeric", month: "long", year: "numeric" }) : new Date(d).toLocaleDateString(LOC);
  const PN = EN ? 10 : 1; // product name column
  const bn = (txt) => L(`${txt} Mrd. USD`, `USD ${txt} bn`);
  const PP = L("Pp", "pp");
  const VIEWS = ["ueberblick", "laender", "profil", "produktraum", "branchen", "abhaengigkeiten", "wettbewerb", "nullhandel", "regime", "mittelstand", "dienste", "fdi", "beschaffung", "staat", "regionen", "kreise", "steckbrief", "szenarien", "prognose", "methodik"];
  const DEFAULT_COMPARE = ["CHN", "USA", "JPN", "KOR"];
  const state = { scenario: "current_2026_08", iso: "DEU", compare: DEFAULT_COMPARE.slice(), colorMode: "status", snapYear: null, highlight: null };
  const cache = {};
  let D = {};
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames([L("de", "en")], { type: "region" }); } catch (e) { regionNames = null; }

  const $ = (id) => document.getElementById(id);
  // product group colours from the Konjunkturmonitor palette
  const GROUP_PAL = ["#0070C0", "#7030A0", "#47D359", "#B45309", "#D86DCD", "#51154A", "#00B0F0", "#002060"];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 2) => (v === null || v === undefined || !isFinite(v)) ? "–" : v.toLocaleString(LOC, { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function cname(iso) {
    const c = D.eci.countries[iso];
    if (!c) return iso;
    if (regionNames && c.iso2) { try { const n = regionNames.of(c.iso2); if (n && n !== c.iso2) return n; } catch (e) { /* fall back */ } }
    return c.name;
  }

  // English sentences: "the United States", "The Netherlands ..." at the start of a sentence
  const THE = ["USA", "GBR", "NLD", "PHL", "ARE", "DOM", "CAF", "COD", "COG", "BHS", "GMB", "SLV"];
  function sname(iso, start) { const n = cname(iso); return THE.includes(iso) ? (start ? "The " : "the ") + n : n; }

  async function getJSON(path) {
    if (!cache[path]) cache[path] = fetch(BASE + path).then((r) => { if (!r.ok) throw new Error(path); return r.json(); });
    return cache[path];
  }


  // ---------------------------------------------------------------- routing
  function route() {
    let h = location.hash.replace("#", "");
    let fig = null;
    const m = h.match(/^(profil|laender|produktraum|branchen)\/([A-Z]{3})$/);
    if (m && D.eci.countries[m[2]]) { state.iso = m[2]; $("country").value = m[2]; h = m[1]; }
    if (h.startsWith("steckbrief/")) { state.kreis = h.split("/")[1]; h = "steckbrief"; }
    if (h.startsWith("abb-")) { fig = document.getElementById(h); const sec = fig && fig.closest("section.view"); h = sec ? sec.id.replace("view-", "") : ""; }
    const view = VIEWS.includes(h) ? h : "ueberblick";
    VIEWS.forEach((v) => { $("view-" + v).hidden = v !== view; });
    document.querySelectorAll("nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("controls").hidden = ["prognose", "methodik", "kreise", "steckbrief", "dienste", "fdi", "beschaffung", "staat"].includes(view);
    render(view).then(() => { if (fig) fig.scrollIntoView(); });
  }

  // figures: numbering, CSV, PNG and link (as under every chart of the Konjunkturmonitor)
  const FIGDATA = {};
  function setupFigures() {
    document.querySelectorAll(".fig").forEach((f, i) => {
      f.id = "abb-" + (i + 1);
      f.querySelector(".fignum").textContent = L(`Abb. ${i + 1}: `, `Fig. ${i + 1}: `);
      f.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => figAction(f, b)));
    });
  }
  // file names as in the Konjunkturmonitor (docs/Regelwerk_Dateinamen.txt): "Product (date, Abb. NN) short title"
  const FIGSHORT = EN ? { rank: "ECI rank", fixed: "Fixed scale", profil: "Country profile scenarios", space: "Product space", scen: "Scenario real income" }
    : { rank: "ECI-Rang", fixed: "Fester Massstab", profil: "Laenderprofil Szenarien", space: "Produktraum", scen: "Szenario Realeinkommen" };
  function figName(f) { const n = f.id.replace("abb-", "").padStart(2, "0"); return `Produktraum-Monitor (${D.meta.built}, ${L("Abb.", "Fig.")} ${n}) ${FIGSHORT[f.dataset.fig] || f.dataset.fig}`; }
  function figAction(f, b) {
    const act = b.dataset.act;
    if (act === "link") {
      const url = location.href.split("#")[0] + "#" + (f.dataset.fig === "profil" ? "profil/" + state.iso : f.id);
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { b.textContent = L("Link kopiert", "Link copied"); setTimeout(() => { b.textContent = L("Link kopieren", "Copy link"); }, 1500); });
      return;
    }
    if (act === "csv") {
      const d = FIGDATA[f.dataset.fig]; if (!d) return;
      const q = EN ? (v) => (v === null || v === undefined) ? "" : /[,"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v)
        : (v) => (v === null || v === undefined) ? "" : /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v).replace(".", ",");
      const csv = "\ufeff" + [d.header, ...d.rows].map((r) => r.map(q).join(L(";", ","))).join("\r\n");
      save(new Blob([csv], { type: "text/csv;charset=utf-8" }), figName(f) + ".csv");
      return;
    }
    if (act === "png") { figPng(f).then((url) => fetch(url)).then((r) => r.blob()).then((bl) => save(bl, figName(f) + ".png")); return; }
    if (act === "xlsx") {
      const d = FIGDATA[f.dataset.fig]; if (!d) return;
      loadScript(BASE + "lib/xlsx.mini.min.js").then(() => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([d.header, ...d.rows]), L("Daten", "Data"));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
          [L("Abbildung", "Figure"), f.id.replace("abb-", L("Abb. ", "Fig. "))], [L("Frage", "Question"), f.querySelector(".cask").textContent], [L("Titel", "Title"), f.querySelector(".ftitle").textContent],
          [L("Erläuterung", "Note"), f.querySelector(".capnote").textContent], [L("Quelle", "Source"), f.querySelector(".src").textContent],
          [L("Stand", "As of"), D.meta.built], ["Link", location.href.split("#")[0] + "#" + f.id]]), "Info");
        XLSX.writeFile(wb, figName(f) + ".xlsx");
      });
      return;
    }
    if (act === "pptx") {
      Promise.all([loadScript(BASE + "lib/pptxgen.bundle.js"), figPng(f)]).then(([, url]) => {
        // slide master as in the Konjunkturmonitor: 16:9, grey frame, kicker, title, source line, no logo
        const pres = new PptxGenJS(); pres.layout = "LAYOUT_WIDE";
        const s = pres.addSlide(), font = "Arial";
        s.addShape(pres.ShapeType.rect, { x: 0.3, y: 0.3, w: 12.73, h: 6.9, line: { color: "8C8C8C", width: 0.75 }, fill: { color: "FFFFFF" } });
        s.addText(f.querySelector(".cask").textContent, { x: 0.6, y: 0.45, w: 12.1, h: 0.4, fontFace: font, fontSize: 14, color: "595959" });
        s.addText(f.querySelector(".ftitle").textContent, { x: 0.6, y: 0.85, w: 12.1, h: 0.8, fontFace: font, fontSize: 20, bold: true, color: "000000", valign: "top" });
        const img = new Image(); img.src = url;
        return new Promise((ok) => { img.onload = () => ok(img); }).then((im) => {
          const maxW = 12.1, maxH = 4.8, r = Math.min(maxW / im.width, maxH / im.height);
          s.addImage({ data: url, x: 0.6 + (maxW - im.width * r) / 2, y: 1.7, w: im.width * r, h: im.height * r });
          s.addText(f.querySelector(".src").textContent + " · " + D.meta.built, { x: 0.6, y: 6.6, w: 12.1, h: 0.4, fontFace: font, fontSize: 10, color: "000000" });
          return pres.writeFile({ fileName: figName(f) + ".pptx" });
        });
      });
    }
  }
  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) scripts[src] = new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
    return scripts[src];
  }
  // an svg drawn as an image cannot use the page's web fonts: embed Source Sans 3 as data URLs
  let fontCss = null;
  function embeddedFonts() {
    if (!fontCss) fontCss = Promise.all([400, 600, 700].map((w) => fetch(BASE + `fonts/SourceSans3-${w}-latin.woff2`).then((r) => r.blob())
      .then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(`@font-face{font-family:'Source Sans 3';font-weight:${w};src:url(${fr.result}) format('woff2');}`); fr.readAsDataURL(b); }))))
      .then((parts) => parts.join(""));
    return fontCss;
  }
  function figPng(f) {
    // PNG data URL of a figure: the canvas as is, an svg drawn on a white canvas at twice its size
    const canvas = f.querySelector("canvas"), svg = f.querySelector(".cmain svg");
    if (canvas) return Promise.resolve(canvas.toDataURL("image/png"));
    const vb = svg.viewBox.baseVal, k = 2, clone = svg.cloneNode(true);
    clone.setAttribute("width", vb.width); clone.setAttribute("height", vb.height);
    clone.querySelectorAll("text").forEach((tx) => { if (!tx.getAttribute("fill")) tx.setAttribute("fill", "#000"); tx.setAttribute("font-family", "'Source Sans 3', Arial, sans-serif"); tx.setAttribute("font-size", tx.getAttribute("font-size") || "13"); });
    clone.querySelectorAll(".grid").forEach((g) => { g.setAttribute("stroke", "#D9D9D9"); g.setAttribute("stroke-width", "0.5"); });
    return embeddedFonts().then((css) => {
    const st = document.createElementNS("http://www.w3.org/2000/svg", "style"); st.textContent = css; clone.insertBefore(st, clone.firstChild);
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement("canvas"); c.width = vb.width * k; c.height = vb.height * k; const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/png")); };
      img.src = src;
    });
    });
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
    ticks.forEach((t) => { s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${W - m.r + 8}" y="${y(t) + 4}">${opt.int ? t : fmt(t, tickDec(ticks))}</text>`; });
    if (opt.unit) { const tt = opt.invert ? ticks[0] : ticks[ticks.length - 1]; s += `<text x="${W}" y="${y(tt) - 10}" text-anchor="end">${esc(opt.unit)}</text>`; }
    years.forEach((yr, i) => { if (yr % 5 === 0 || i === years.length - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${yr}</text>`; });
    series.slice().reverse().forEach((ser) => {
      let d = ""; ser.values.forEach((v, i) => { if (v === null) return; d += (d ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); });
      s += `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.bold ? 2.6 : 1.6}" stroke-linejoin="round"><title>${esc(ser.label)}</title></path>`;
    });
    s += "</svg>";
    el.innerHTML = s;
  }

  // decimals that show every tick of a series exactly (0.25 steps need two)
  const tickDec = (ticks) => Math.max(0, ...ticks.map((v) => { const s = String(Math.abs(v)); return s.includes(".") ? s.split(".")[1].length : 0; }));
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
    if (view === "profil") await renderProfile();
    if (view === "produktraum") await renderSpace();
    if (view === "branchen") await renderSectors();
    if (view === "szenarien") await renderScenarios();
    if (view === "abhaengigkeiten") { await renderDependencies(); renderCritical(); }
    if (view === "wettbewerb") { await renderCompetition(); renderSubsidies(); }
    if (view === "nullhandel") await renderZeroTrade();
    if (view === "regime") await renderRegime();
    if (view === "mittelstand") await renderMittelstand();
    if (view === "dienste") await renderServices();
    if (view === "fdi") await renderFDI();
    if (view === "beschaffung") await renderProcurement();
    if (view === "staat") await renderState();
    if (view === "regionen") { await renderRegions(); renderNetMap(); renderEnergyNets(); }
    if (view === "kreise") { await renderKreiseMap(); await renderKreisProfile(); await renderKreise(); }
    if (view === "steckbrief") await renderSteckbrief();
    if (view === "prognose") renderForecast();
    if (view === "methodik") renderMethod();
  }

  function renderFacts() {
    const c = D.eci.countries[state.iso], n = c.rank.length - 1, ys = D.eci.years;
    $("facts").innerHTML = [
      [`${c.rank[0]} → ${c.rank[n]}`, L(`ECI-Rang ${ys[0]} und ${ys[n]}`, `ECI rank ${ys[0]} and ${ys[n]}`), L(`von ${D.eci.n_countries} Ländern`, `of ${D.eci.n_countries} countries`)],
      [`${fmt(c.fixed[0])} → ${fmt(c.fixed[n])}`, L("Komplexität auf festem Maßstab", "Complexity on a fixed scale"), L(`${ys[0]} und ${ys[n]}`, `${ys[0]} and ${ys[n]}`)],
      [`${c.diversity[0]} → ${c.diversity[n]}`, L("Warengruppen mit Exportvorteil", "Product groups with an export advantage"), L(`${ys[0]} und ${ys[n]}`, `${ys[0]} and ${ys[n]}`)],
      [bn(fmt(c.exports_bn_usd[n], 0)), L("Warenexporte", "Goods exports"), L(`${ys[n]}, Dreijahresmittel`, `${ys[n]}, three-year average`)],
    ].map(([b, l, s]) => `<div class="kpi"><span class="kn">${esc(l)}</span><span class="kv">${b}</span><span class="ks">${esc(s)}</span></div>`).join("");
    const move = c.rank[n] < c.rank[0] ? "verbessert sich" : c.rank[n] > c.rank[0] ? "fällt" : "bleibt";
    const moveEn = c.rank[n] < c.rank[0] ? `climbs in the complexity ranking from ${c.rank[0]} (${ys[0]}) to ${c.rank[n]} (${ys[n]})` : c.rank[n] > c.rank[0] ? `falls in the complexity ranking from ${c.rank[0]} (${ys[0]}) to ${c.rank[n]} (${ys[n]})` : `stays at ${c.rank[0]} in the complexity ranking (${ys[0]} and ${ys[n]})`;
    $("ovAnswer").textContent = EN ? `${sname(state.iso, true)} ${moveEn} and in ${ys[n]} has an export advantage in ${c.diversity[n]} of ${D.meta.n_products.toLocaleString(LOC)} product groups.`
      : `${cname(state.iso)} ${move} im Complexity-Rang von Platz ${c.rank[0]} (${ys[0]})${move === "bleibt" ? " " : " auf Platz " + c.rank[n] + " "}(${ys[n]}) und hat ${ys[n]} in ${c.diversity[n]} von ${D.meta.n_products.toLocaleString("de-DE")} Warengruppen einen Exportvorteil.`;
  }

  function renderCountries() {
    const ys = D.eci.years, list = [state.iso, ...state.compare.filter((i) => i !== state.iso)].slice(0, 6);
    const colors = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"].map(css);
    const opts = Object.keys(D.eci.countries).filter((i) => !list.includes(i)).sort((a, b) => cname(a).localeCompare(cname(b), L("de", "en")));
    $("compare").innerHTML = list.slice(1).map((iso, k) =>
      `<span class="pill"><i style="background:${colors[k + 1]}"></i>${esc(cname(iso))}<button type="button" data-rm="${iso}" aria-label="${esc(L(cname(iso) + " entfernen", "Remove " + cname(iso)))}">×</button></span>`).join("") +
      (list.length < 6 ? `<label for="addCmp" class="hint">${L("Vergleichsland", "Comparison country")}</label><select id="addCmp"><option value="">${L("hinzufügen …", "add …")}</option>${opts.map((i) => `<option value="${i}">${esc(cname(i))}</option>`).join("")}</select>` : "");
    $("compare").querySelectorAll("button[data-rm]").forEach((b) => b.addEventListener("click", () => {
      state.compare = state.compare.filter((i) => i !== b.dataset.rm); renderCountries();
    }));
    const add = $("addCmp"); if (add) add.addEventListener("change", () => { if (add.value) { state.compare.push(add.value); renderCountries(); } });
    const series = (key) => list.map((iso, k) => ({ label: cname(iso), color: colors[k], values: D.eci.countries[iso][key], bold: k === 0 }));
    const maxRank = Math.max(...list.flatMap((i) => D.eci.countries[i].rank));
    lineChart($("rankChart"), ys, series("rank"), { invert: true, min: 1, max: Math.max(10, maxRank + 2), int: true, label: L("ECI-Rang", "ECI rank"), unit: L("Rang", "Rank") });
    lineChart($("fixedChart"), ys, series("fixed"), { label: L("Komplexität auf festem Maßstab", "Complexity on a fixed scale"), unit: "PCI" });
    FIGDATA.rank = { header: [L("Jahr", "Year"), ...list.map(cname)], rows: ys.map((yr, i) => [yr, ...list.map((iso) => D.eci.countries[iso].rank[i])]) };
    FIGDATA.fixed = { header: [L("Jahr", "Year"), ...list.map(cname)], rows: ys.map((yr, i) => [yr, ...list.map((iso) => D.eci.countries[iso].fixed[i])]) };
    const c0 = D.eci.countries[state.iso], n0 = ys.length - 1;
    const dF = c0.fixed[n0] - c0.fixed[0];
    $("laAnswer").textContent = EN ? `${sname(state.iso, true)} ranks ${c0.rank[n0]} of ${D.eci.n_countries} countries in ${ys[n0]}, compared with ${c0.rank[0]} in ${ys[0]}. On a fixed scale, the complexity of its export basket ${Math.abs(dF) <= 0.02 ? "stayed about the same" : (dF > 0 ? "rose" : "fell") + " from " + fmt(c0.fixed[0]) + " to " + fmt(c0.fixed[n0])}.` : `${cname(state.iso)} liegt ${ys[n0]} auf Rang ${c0.rank[n0]} von ${D.eci.n_countries} Ländern, ${ys[0]} auf Rang ${c0.rank[0]}. Auf festem Maßstab ${c0.fixed[n0] > c0.fixed[0] + 0.02 ? "stieg" : c0.fixed[n0] < c0.fixed[0] - 0.02 ? "sank" : "blieb"} die Komplexität des Exportkorbs ${Math.abs(c0.fixed[n0] - c0.fixed[0]) <= 0.02 ? "etwa gleich" : "von " + fmt(c0.fixed[0]) + " auf " + fmt(c0.fixed[n0])}.`;
    const n = ys.length - 1;
    $("rankTable").innerHTML = `<thead><tr><th>${L("Land", "Country")}</th><th class="num">${L("ECI-Rang", "ECI rank")} ${ys[0]}</th><th class="num">${ys[n]}</th><th class="num">${L("Fitness-Rang", "Fitness rank")} ${ys[n]}</th><th class="num">${L("GENEPY-Rang", "GENEPY rank")} ${ys[n]}</th><th class="num">${L("Fester Maßstab", "Fixed scale")} ${ys[0]}</th><th class="num">${ys[n]}</th></tr></thead><tbody>` +
      list.map((iso) => { const c = D.eci.countries[iso]; return `<tr><td>${esc(cname(iso))}</td><td class="num">${c.rank[0]}</td><td class="num">${c.rank[n]}</td><td class="num">${c.fitness_rank[n]}</td><td class="num">${c.genepy_rank[n]}</td><td class="num">${fmt(c.fixed[0])}</td><td class="num">${fmt(c.fixed[n])}</td></tr>`; }).join("") + "</tbody>";
  }

  // product space ------------------------------------------------------------
  let spaceGeom = null;
  async function renderSpace() {
    const cd = await getJSON(`data/countries/${state.iso}.json`);
    const P = D.products.rows, snaps = cd.snapshots;
    const y0 = snaps[0], y1 = snaps[snaps.length - 1], n0 = cd.rca[String(y0)].length, n1 = cd.rca[String(y1)].length;
    const firstOpps = cd.opportunities.slice(0, 3).map((o) => EN ? (P[o[0]][2] || P[o[0]][10]).split(",")[0].trim().toLowerCase() : P[o[0]][9] ? P[o[0]][9].split(";")[0].trim() : P[o[0]][1]);
    $("prAnswer").textContent = EN ? `In ${y1}, ${sname(state.iso)} has an export advantage in ${n1.toLocaleString(LOC)} product groups (${y0}: ${n0.toLocaleString(LOC)}); it gained ${cd.gained.length} and lost ${cd.lost.length}. The nearest opportunities include ${firstOpps.slice(0, -1).join(", ")} and ${firstOpps[firstOpps.length - 1]}.` : `${cname(state.iso)} hat ${y1} in ${n1.toLocaleString("de-DE")} Warengruppen einen Exportvorteil (${y0}: ${n0.toLocaleString("de-DE")}); ${cd.gained.length} kamen hinzu, ${cd.lost.length} gingen verloren. Die nächsten Chancen liegen etwa bei ${firstOpps.join(", ")}.`;
    FIGDATA.space = { header: EN ? ["HS4", "Product group", "x", "y", "Complexity (PCI)", "World trade 2024 (USD bn)", `Advantage ${y0}`, `Advantage ${y1}`] : ["HS4", "Warengruppe", "x", "y", "Komplexität (PCI)", "Welthandel 2024 (Mrd. USD)", `Vorteil ${y0}`, `Vorteil ${y1}`],
      rows: P.map((r, i) => [r[0], r[PN], r[5], r[6], r[7], r[8], cd.rca[String(y0)].includes(i) ? 1 : 0, cd.rca[String(y1)].includes(i) ? 1 : 0]) };
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
        ? `<span><i style="background:${col.kept}"></i>${L("Exportvorteil", "Export advantage")} ${state.snapYear} (${yearSet.size})</span><span><i style="background:${col.none}"></i>${L("kein Exportvorteil", "no export advantage")}</span>`
        : `<span><i style="background:${col.kept}"></i>${L("Vorteil", "Advantage in")} ${snaps[0]} ${L("und", "and")} ${snaps[snaps.length - 1]} (${n("kept")})</span><span><i style="background:${col.gained}"></i>${L("hinzugewonnen", "gained")} (${n("gained")})</span><span><i style="background:${col.lost}"></i>${L("verloren", "lost")} (${n("lost")})</span><span><i style="background:${col.none}"></i>${L("kein Vorteil", "no advantage")}</span>`;

    $("oppTable").innerHTML = `<thead><tr><th>HS4</th><th>${L("Warengruppe", "Product group")}</th><th class="num">${L("Nähe", "Proximity")}</th><th class="num">${L("Komplexität", "Complexity")}</th><th class="num">Outlook Gain</th></tr></thead><tbody>` +
      cd.opportunities.slice(0, 25).map(([i, dens, cog, pci]) => `<tr class="clickable${state.highlight === i ? " sel" : ""}" data-i="${i}" tabindex="0"><td class="num">${P[i][0]}</td><td>${esc(P[i][PN])}${P[i][9] && !EN ? `<span class="ex">z. B. ${esc(P[i][9])}</span>` : ""}</td><td class="num">${fmt(dens)}</td><td class="num">${fmt(pci)}</td><td class="num">${fmt(cog)}</td></tr>`).join("") + "</tbody>";
    $("oppTable").querySelectorAll("tr[data-i]").forEach((tr) => {
      const pick = () => { const i = +tr.dataset.i; state.highlight = state.highlight === i ? null : i; renderSpace(); };
      tr.addEventListener("click", pick); tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }

  function groupDe(g) {
    if (EN) return g;
    return ({ "Machinery": "Maschinen", "Chemicals and pharma": "Chemie und Pharma", "Food and agriculture": "Nahrungsmittel und Agrar",
      "Minerals, metals, stone": "Rohstoffe, Metalle, Steine", "Textiles and apparel": "Textil und Bekleidung",
      "Plastics, wood, paper": "Kunststoff, Holz, Papier", "Electrical and electronics": "Elektrotechnik und Elektronik",
      "Vehicles, instruments, other": "Fahrzeuge, Instrumente, Sonstiges" })[g] || g;
  }
  function sectorDe(s) {
    if (EN) return s;
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
    const p = P[best], st = (EN ? { kept: "advantage in both years", gained: "gained", lost: "lost", none: "no advantage" } : { kept: "Vorteil in beiden Jahren", gained: "hinzugewonnen", lost: "verloren", none: "kein Vorteil" })[spaceGeom.status[best]];
    tip.innerHTML = `<b>${p[0]}</b> ${esc(p[PN])}${p[9] && !EN ? `<br><i>z. B. ${esc(p[9])}</i>` : ""}<br>${esc(sectorDe(D.products.sectors[p[3]]))}<br>${L("Komplexität", "Complexity")} ${fmt(p[7])} · ${L("Welthandel", "World trade")} ${bn(fmt(p[8], 1))}<br>${cname(state.iso)}: ${st}`;
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
    $("brAnswer").textContent = EN ? `${sname(state.iso, true)}'s largest world market share in ${ys[1]} is in ${sectorDe(rows[0].s).toLowerCase()}, at ${fmt(rows[0].b * 100, 1)}\u202f%. Since ${ys[0]} its share has risen most in ${sectorDe(up.s).toLowerCase()} (${up.d > 0 ? "+" : ""}${fmt(up.d, 1)} pp) and fallen most in ${sectorDe(dn.s).toLowerCase()} (${fmt(dn.d, 1)} pp).` : `Den größten Weltmarktanteil hat ${cname(state.iso)} ${ys[1]} in der Branche ${sectorDe(rows[0].s)} mit ${fmt(rows[0].b * 100, 1)}\u202f%. Am stärksten gestiegen ist der Anteil seit ${ys[0]} in der Branche ${sectorDe(up.s)} (${up.d > 0 ? "+" : ""}${fmt(up.d, 1)} Pp), am stärksten gesunken in der Branche ${sectorDe(dn.s)} (${fmt(dn.d, 1)} Pp).`;
    $("sectorTable").innerHTML = `<thead><tr><th>${L("Branche", "Sector")}</th><th class="num">${ys[0]}</th><th class="num">${ys[1]}</th><th class="num">${L("Veränderung", "Change")}</th><th>${L("Anteil", "Share")} ${ys[1]}</th></tr></thead><tbody>` +
      rows.map((r) => {
        const d = (r.b - r.a) * 100, cls = Math.abs(d) < 0.05 ? "even" : "down", sym = Math.abs(d) < 0.05 ? "■" : d > 0 ? "▲" : "▼";
        return `<tr><td>${esc(sectorDe(r.s))}</td><td class="num">${fmt(r.a * 100, 1)}\u202f%</td><td class="num">${fmt(r.b * 100, 1)}\u202f%</td><td class="num"><span class="chip ${cls}">${sym}</span> ${d > 0 ? "+" : ""}${fmt(d, 1)} ${PP}</td><td><span class="bar" style="width:${Math.max(1, 140 * (r.b || 0) / mx)}px;background:var(--c1)"></span></td></tr>`;
      }).join("") + "</tbody>";
  }


  // scenarios ----------------------------------------------------------------
  // a value that rounds to zero carries no sign (rule of the Konjunkturmonitor)
  const pct = (v, d = 2) => (v === null || v === undefined) ? "–" : Number(v.toFixed(d)) === 0 ? fmt(0, d) + "\u202f%" : (v > 0 ? "+" : "") + fmt(v, d) + "\u202f%";
  function scName(iso, S) {
    if (iso === "EU27") return "EU27";
    if (iso === "ROW") return L("Rest der Welt", "Rest of the world");
    const i2 = S.iso2[iso];
    if (regionNames && i2) { try { const n = regionNames.of(i2); if (n && n !== i2) return n; } catch (e) { /* fall back */ } }
    return (D.eci.countries[iso] && D.eci.countries[iso].name) || iso;
  }
  function robust(v) {
    if (v[1] === null || v[2] === null) return ["even", L("ohne Spanne", "no range")];
    if (Math.abs(v[0]) < 0.005 && Math.abs(v[1]) < 0.01 && Math.abs(v[2]) < 0.01) return ["even", L("kaum Wirkung", "little effect")];
    return (v[1] < 0) === (v[2] < 0) || v[1] === 0 || v[2] === 0 ? ["good", "robust"] : ["bad", L("Vorzeichen unsicher", "sign uncertain")];
  }
  async function renderScenarios() {
    const S = await getJSON("data/scenarios.json");
    const sel = $("scenario");
    if (!sel.options.length) {
      const grp = EN ? { us: "US tariffs and retaliation", eu: "EU single market", transport: "Transport costs", china: "Dependencies" } : { us: "US-Zölle und Gegenzölle", eu: "EU-Binnenmarkt", transport: "Transportkosten", china: "Abhängigkeiten" };
      sel.innerHTML = Object.keys(grp).map((g) => `<optgroup label="${grp[g]}">` +
        S.scenarios.filter((s) => s.group === g).map((s) => `<option value="${s.id}">${esc(EN ? s.title_en : s.title)}</option>`).join("") + "</optgroup>").join("");
      sel.addEventListener("change", () => { state.scenario = sel.value; renderScenarios(); });
    }
    sel.value = state.scenario;
    if (S.us_tariff_latest_date) { const d = S.us_tariff_latest_date; $("scenStand").textContent = EN ? `US tariffs: CEPII file ${S.us_tariff_file}, latest measure dated ${fmtDate(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`)}; checked monthly for new data.` : `US-Zölle: CEPII-Datei ${S.us_tariff_file}, jüngste Maßnahme vom ${d.slice(6)}.${d.slice(4, 6)}.${d.slice(0, 4)}; monatliche Prüfung auf neue Daten.`; }
    const sc = S.scenarios.find((s) => s.id === state.scenario), C = sc.countries;
    const iso = C[state.iso] ? state.iso : "DEU", name = scName(iso, S), v = C[iso];
    const partner = EN ? (sc.partner === "USA" ? "to the US" : sc.partner === "EU" ? "to the EU" : "on longer sea routes") : sc.partner === "USA" ? "in die USA" : sc.partner === "EU" ? "in die EU" : "auf längeren Seewegen";
    const CHN = sc.partner === "CHN";
    const flow = CHN ? L("Importe aus China", "Imports from China") : L(`Exporte ${partner}`, `Exports ${partner}`);
    const title = EN ? sc.title_en : sc.title;
    $("scenShock").textContent = EN ? sc.shock_en : sc.shock;
    const note = iso !== state.iso ? L(`${cname(state.iso)} ist im Modell Teil des „Rests der Welt“; gezeigt wird Deutschland. `, `In the model ${sname(state.iso)} is part of the rest of the world; Germany is shown instead. `) : "";
    const [rc, rl] = robust(v);
    const sent = EN ? `${title}: real income ${iso === "DEU" ? "in Germany" : "in " + sname(iso)} changes by ${pct(v[0])} (range ${pct(v[1])} to ${pct(v[2])}). ` +
      (v[4] !== null && !(sc.partner === "USA" && iso === "USA") ? `${flow} change by ${pct(v[4], 1)}, total exports by ${pct(v[3], 1)}.` : "")
      : `${sc.title}: Das Realeinkommen ${iso === "DEU" ? "in Deutschland" : "von " + name} ändert sich um ${pct(v[0])} (Spanne ${pct(v[1])} bis ${pct(v[2])}). ` +
      (v[4] !== null && !(sc.partner === "USA" && iso === "USA") ? `${CHN ? "Die Importe aus China" : "Die Exporte " + partner} ändern sich um ${pct(v[4], 1)}, die gesamten Exporte um ${pct(v[3], 1)}.` : "");
    const srTxt = sc.short_run && sc.short_run[iso] !== undefined ? L(` Mit kurzfristigen Elastizitäten aus eigener Schätzung: ${pct(sc.short_run[iso])}.`, ` With short-run elasticities from own estimates: ${pct(sc.short_run[iso])}.`) : "";
    $("scenAnswer").innerHTML = `${esc(note + sent + srTxt)} <span class="chip ${rc}">${rl}</span> <button type="button" class="copy" id="copyScen">⧉ ${L("Textbaustein", "Copy text")}</button>`;
    $("copyScen").addEventListener("click", (e) => {
      const txt = sent + L(" Quelle: Produktraum-Monitor, Modell nach Caliendo und Parro (2015), OECD ICIO 2022; ", " Source: Produktraum-Monitor, model after Caliendo and Parro (2015), OECD ICIO 2022; ") + location.href.split("#")[0] + "#szenarien";
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => { e.target.textContent = L("kopiert", "copied"); });
    });
    const tile = (big, label) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${L("langfristig, zentraler Fall", "long run, central case")}</span></div>`;
    $("scenFacts").innerHTML = [
      tile(pct(v[0]), L(`Realeinkommen ${name}`, `Real income, ${name}`)),
      v[4] !== null ? tile(pct(v[4], 1), flow) : tile(pct(v[3], 1), L("Exporte insgesamt", "Total exports")),
      tile(pct(C.EU27[0]), L("Realeinkommen EU27", "Real income, EU27")),
      sc.partner === "USA" ? tile(pct(C.USA[0]), L("Realeinkommen USA", "Real income, US")) : tile(pct(C.CHN[0]), L("Realeinkommen China", "Real income, China")),
    ].join("");
    // bar chart: 20 largest effects plus selection and EU27
    const all = Object.keys(C).filter((k) => k !== "ROW");
    let list = all.filter((k) => k !== "EU27").sort((a, b) => Math.abs(C[b][0]) - Math.abs(C[a][0])).slice(0, 18);
    ["EU27", iso].forEach((k) => { if (!list.includes(k)) list.push(k); });
    list.sort((a, b) => C[a][0] - C[b][0]);
    $("scenChartTitle").textContent = EN ? "Real income in %: the 18 hardest-hit countries, " + (iso === "DEU" ? "Germany" : name) + " and EU27" : "Realeinkommen in %: die 18 am stärksten betroffenen Länder, " + (iso === "DEU" ? "Deutschland" : name) + " und EU27";
    const W = 860, row = 22, m = { l: 170, r: 70, t: 8, b: 26 }, H = m.t + m.b + row * list.length;
    const vals = list.flatMap((k) => [C[k][0], C[k][1], C[k][2]]).filter((x) => x !== null);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pd = (hi - lo) * 0.05 || 0.1; lo -= pd; hi += pd;
    const X = (x) => m.l + (x - lo) / (hi - lo) * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L("Realeinkommen nach Ländern", "Real income by country")}">`;
    const tks = niceTicks(lo, hi, 6), td = tickDec(tks); tks.forEach((tk) => { s += `<line class="grid" x1="${X(tk)}" x2="${X(tk)}" y1="${m.t}" y2="${H - m.b}"/><text x="${X(tk)}" y="${H - 8}" text-anchor="middle">${fmt(tk, td)}</text>`; });
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
    FIGDATA.scen = { header: EN ? ["Country", "Real income in %", "Range from", "Range to", "Total exports in %", `${flow} in %`] : ["Land", "Realeinkommen in %", "Spanne von", "Spanne bis", "Exporte insgesamt in %", `${flow} in %`],
      rows: Object.keys(C).map((k) => [scName(k, S), C[k][0], C[k][1], C[k][2], C[k][3], C[k][4]]) };
    // German sectors
    const usS = sc.partner === "USA";
    // the 15 sectors with the largest German exports to the partner in 2022 (small sectors give extreme percentages)
    const bySize = CHN ? sc.sectors_deu.filter((r) => r[1] !== null && (r[5] || 0) >= 5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 15)
      : sc.sectors_deu.filter((r) => r[1] !== null && (r[5] || 0) >= 5).sort((a, b) => (b[4] || 0) - (a[4] || 0)).slice(0, 15);
    const chip = (x, d = 1) => `<span class="chip ${x === null || Math.abs(x) < 0.05 ? "even" : x > 0 ? "good" : "bad"}">${pct(x, d)}</span>`;
    const secNames = EN ? S.sector_names_en : S.sector_names;
    $("scenSectors").innerHTML = `<thead><tr><th>${L("Branche", "Sector")}</th>${usS ? `<th class="num">${L("US-Zoll", "US tariff")}</th>` : ""}${CHN ? `<th class="num">${L("Produktion 2022", "Output 2022")}</th>` : `<th class="num">${L("Exporte", "Exports")} ${partner} 2022</th><th class="num">${L("Exporte", "Exports")} ${partner}</th>`}<th class="num">${L("Produktion", "Output")}</th></tr></thead><tbody>` +
      bySize.map((r) => `<tr><td>${esc(secNames[r[0]] || r[0])}</td>${usS ? `<td class="num">${fmt(r[3], 1)}\u202f%</td>` : ""}${CHN ? `<td class="num">${bn(fmt(r[5], 0))}</td>` : `<td class="num">${bn(fmt(r[4], 1))}</td><td class="num">${chip(r[2])}</td>`}<td class="num">${chip(r[1], 2)}</td></tr>`).join("") + "</tbody>";
    // all countries
    $("scenAll").innerHTML = `<thead><tr><th>${L("Land", "Country")}</th><th class="num">${L("Realeinkommen", "Real income")}</th><th class="num">${L("Spanne", "Range")}</th><th class="num">${flow}</th><th class="num">${L("Exporte insgesamt", "Total exports")}</th>${usS ? `<th class="num">${L("US-Zoll im Mittel", "Average US tariff")}</th>` : ""}</tr></thead><tbody>` +
      all.sort((a, b) => scName(a, S).localeCompare(scName(b, S), L("de", "en"))).map((k) => { const c = C[k]; return `<tr${k === iso ? ' class="sel"' : ""}><td>${esc(scName(k, S))}</td><td class="num">${pct(c[0])}</td><td class="num">${c[1] === null ? "–" : pct(c[1]) + L(" bis ", " to ") + pct(c[2])}</td><td class="num">${pct(c[4], 1)}</td><td class="num">${pct(c[3], 1)}</td>${usS ? `<td class="num">${c[6] === null ? "–" : fmt(c[6], 1) + " %"}</td>` : ""}</tr>`; }).join("") + "</tbody>";
    const rcls = { "bestanden": "good", "plausibel": "good", "erklärt": "even", "Abweichung": "bad", "teilweise": "even", "partly": "even", "passed": "good", "plausible": "good", "explained": "even", "deviation": "bad" };
    $("scenChecks").innerHTML = `<thead><tr><th>${L("Prüfung", "Check")}</th><th>${L("Ergebnis", "Result")}</th><th>${L("Befund", "Finding")}</th></tr></thead><tbody>` +
      (EN ? S.checks_en : S.checks).map((c) => `<tr><td>${esc(c.name)}</td><td><span class="chip ${rcls[c.result] || "even"}">${esc(c.result)}</span></td><td>${esc(c.text)}</td></tr>`).join("") + "</tbody>";
  }


  // country profile ------------------------------------------------------------
  async function renderProfile() {
    const [cd, S] = await Promise.all([getJSON(`data/countries/${state.iso}.json`), getJSON("data/scenarios.json")]);
    const c = D.eci.countries[state.iso], ys = D.eci.years, n = ys.length - 1, name = cname(state.iso), P = D.products.rows;
    const iso = S.scenarios[0].countries[state.iso] ? state.iso : "ROW";
    $("profTitle").textContent = L("Länderprofil: ", "Country profile: ") + name;
    const val = (id) => { const sc = S.scenarios.find((s) => s.id === id); return sc ? sc.countries[iso] : null; };
    const cur = val("current_2026_08"), nsm = val("no_single_market"), red = val("red_sea_2024");
    const eu = ["AUT","BEL","BGR","HRV","CYP","CZE","DNK","EST","FIN","FRA","DEU","GRC","HUN","IRL","ITA","LVA","LTU","LUX","MLT","NLD","POL","PRT","ROU","SVK","SVN","ESP","SWE"].includes(state.iso);
    const sh = D.products.sectors.map((s, k) => ({ s, a: cd.sector_share[k][0], b: cd.sector_share[k][1] })).filter((r) => r.b !== null).sort((p, q) => q.b - p.b);
    $("profAnswer").textContent = EN ? `In ${ys[n]}, ${sname(state.iso)} ranks ${c.rank[n]} of ${D.eci.n_countries} in the complexity ranking (${ys[0]}: ${c.rank[0]}) and is strongest in ${sectorDe(sh[0].s).toLowerCase()}. ` +
      (iso === "ROW" ? `For the scenarios, the model counts ${sname(state.iso)} as part of the rest of the world.` :
        `The US tariffs of August 2026 change its real income in the long run by ${pct(cur[0])}` + (eu ? `; losing the single market would change it by ${pct(nsm[0])}.` : `; a diversion around Africa as in 2024 would change it by ${pct(red[0])}.`))
      : `${name} liegt ${ys[n]} im Complexity-Rang auf Platz ${c.rank[n]} von ${D.eci.n_countries} (${ys[0]}: ${c.rank[0]}) und ist am stärksten in der Branche ${sectorDe(sh[0].s)}. ` +
      (iso === "ROW" ? `Für Szenarien gehört ${name} im Modell zum „Rest der Welt“.` :
        `Die US-Zölle vom August 2026 ändern das Realeinkommen langfristig um ${pct(cur[0])}` + (eu ? `, ein Wegfall des Binnenmarkts um ${pct(nsm[0])}.` : `, eine Umleitung um Afrika wie 2024 um ${pct(red[0])}.`));
    const tile = (big, label, sub) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${esc(sub)}</span></div>`;
    $("profFacts").innerHTML = [
      tile(`${c.rank[0]} → ${c.rank[n]}`, L("ECI-Rang", "ECI rank"), L(`${ys[0]} und ${ys[n]}, von ${D.eci.n_countries}`, `${ys[0]} and ${ys[n]}, of ${D.eci.n_countries}`)),
      tile(`${c.diversity[n]}`, L("Warengruppen mit Exportvorteil", "Product groups with an export advantage"), `${ys[n]} (${ys[0]}: ${c.diversity[0]})`),
      tile(bn(fmt(c.exports_bn_usd[n], 0)), L("Warenexporte", "Goods exports"), L(`${ys[n]}, Dreijahresmittel`, `${ys[n]}, three-year average`)),
      tile(pct(cur[0]), L("Realeinkommen bei US-Zöllen", "Real income under US tariffs"), iso === "ROW" ? L("Rest der Welt, August 2026", "Rest of the world, August 2026") : L("August 2026, langfristig", "August 2026, long run")),
    ].join("");
    // dot and whisker chart over all scenarios
    const grpName = EN ? { us: "Tariffs", eu: "Single market", transport: "Sea routes", china: "Dependencies" } : { us: "Zölle", eu: "Binnenmarkt", transport: "Seewege", china: "Abhängigkeiten" };
    const SHORT = EN ? { peak_2025_04: "US tariffs April 2025", deal_2025_09: "US tariffs September 2025", current_2026_08: "US tariffs August 2026",
      retaliation_eu: "plus EU retaliation", retaliation_all: "plus retaliation by all", no_single_market: "No single market",
      trend_2030: "Integration to 2030", services_deeper: "Deeper services market", red_sea_2024: "Red Sea as in 2024",
      red_sea_closed: "Red Sea closed", panama_closed: "Panama Canal closed", china_dependencies: "China stops dependent goods" } : { peak_2025_04: "US-Zölle April 2025", deal_2025_09: "US-Zölle September 2025", current_2026_08: "US-Zölle August 2026",
      retaliation_eu: "dazu Gegenzölle der EU", retaliation_all: "dazu Gegenzölle aller Länder", no_single_market: "Ohne Binnenmarkt",
      trend_2030: "Integration bis 2030", services_deeper: "Tieferer Dienstleistungsmarkt", red_sea_2024: "Rotes Meer wie 2024",
      red_sea_closed: "Rotes Meer gesperrt", panama_closed: "Panamakanal gesperrt", china_dependencies: "Lieferstopp China, abhängige Waren" };
    const rows = S.scenarios.map((s) => ({ id: s.id, g: grpName[s.group], t: SHORT[s.id] || (EN ? s.title_en : s.title), v: s.countries[iso] })).filter((r) => r.v);
    $("profChartTitle").textContent = EN ? `Real income, ${iso === "ROW" ? "rest of the world" : name}, by scenario, change in %` : `Realeinkommen ${iso === "ROW" ? "Rest der Welt" : name} je Szenario, Änderung in %`;
    const W = 860, row = 28, m = { l: 300, r: 80, t: 10, b: 30 }, H = m.t + m.b + row * rows.length;
    const vals = rows.flatMap((r) => [r.v[0], r.v[1], r.v[2]]).filter((x) => x !== null);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pd = (hi - lo) * 0.06 || 0.1; lo -= pd; hi += pd;
    const X = (x) => m.l + (x - lo) / (hi - lo) * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L("Realeinkommen je Szenario", "Real income by scenario")}">`;
    const tks = niceTicks(lo, hi, 6), td = tickDec(tks); tks.forEach((tk) => { s += `<line class="grid" x1="${X(tk)}" x2="${X(tk)}" y1="${m.t}" y2="${H - m.b}"/><text x="${X(tk)}" y="${H - 8}" text-anchor="middle">${fmt(tk, td)}</text>`; });
    s += `<line x1="${X(0)}" x2="${X(0)}" y1="${m.t}" y2="${H - m.b}" stroke="#595959"/>`;
    rows.forEach((r, i) => {
      const y = m.t + i * row + row / 2, col = r.v[0] < 0 ? "#C00000" : "#002060";
      s += `<text x="8" y="${y + 4}" fill="#595959">${esc(r.g)}</text><text x="${m.l - 10}" y="${y + 4}" text-anchor="end">${esc(r.t)}</text>`;
      if (r.v[1] !== null) s += `<line x1="${X(r.v[1])}" x2="${X(r.v[2])}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="1.5" opacity="0.6"/>`;
      s += `<circle cx="${X(r.v[0])}" cy="${y}" r="5" fill="${col}"><title>${esc(r.t)}: ${pct(r.v[0])}</title></circle><text x="${W - m.r + 8}" y="${y + 4}">${pct(r.v[0])}</text>`;
    });
    $("profChart").innerHTML = s + "</svg>";
    FIGDATA.profil = { header: EN ? ["Scenario", "Real income in %", "Range from", "Range to"] : ["Szenario", "Realeinkommen in %", "Spanne von", "Spanne bis"], rows: rows.map((r) => [r.t, r.v[0], r.v[1], r.v[2]]) };
    $("profSectors").innerHTML = `<thead><tr><th>${L("Branche", "Sector")}</th><th class="num">${L("Weltmarktanteil", "World market share")} ${ys[0]}</th><th class="num">${ys[n]}</th><th class="num">${L("Veränderung", "Change")}</th></tr></thead><tbody>` +
      sh.slice(0, 6).map((r) => { const d = (r.b - r.a) * 100, sym = Math.abs(d) < 0.05 ? "■" : d > 0 ? "▲" : "▼"; return `<tr><td>${esc(sectorDe(r.s))}</td><td class="num">${fmt(r.a * 100, 1)} %</td><td class="num">${fmt(r.b * 100, 1)} %</td><td class="num"><span class="chip ${Math.abs(d) < 0.05 ? "even" : "down"}">${sym}</span> ${d > 0 ? "+" : ""}${fmt(d, 1)} ${PP}</td></tr>`; }).join("") + "</tbody>";
    $("profOpps").innerHTML = `<thead><tr><th>HS4</th><th>${L("Warengruppe", "Product group")}</th><th class="num">${L("Nähe", "Proximity")}</th><th class="num">${L("Komplexität", "Complexity")}</th></tr></thead><tbody>` +
      cd.opportunities.slice(0, 10).map(([i, dens, cog, pci]) => `<tr><td class="num">${P[i][0]}</td><td>${esc(P[i][PN])}${P[i][9] && !EN ? `<span class="ex">z. B. ${esc(P[i][9])}</span>` : ""}</td><td class="num">${fmt(dens)}</td><td class="num">${fmt(pci)}</td></tr>`).join("") + "</tbody>";
  }


  // strategic dependencies ------------------------------------------------------
  async function renderDependencies() {
    const [Dd, S] = await Promise.all([getJSON("data/dependencies.json"), getJSON("data/scenarios.json")]);
    const sel = $("depLevel");
    if (!sel.dataset.ready) { sel.dataset.ready = "1"; sel.addEventListener("change", () => renderDependencies()); }
    const lv = sel.value, X = Dd.levels[lv], who = lv === "EU27" ? L("Die EU", "The EU") : L("Deutschland", "Germany");
    const secEn = { "Tiere": "Animals", "Pflanzen": "Plants", "Fette": "Fats", "Nahrungsmittel": "Food", "Mineralien, Energie": "Minerals, energy", "Chemie, Pharma": "Chemicals, pharma",
      "Kunststoff, Kautschuk": "Plastics, rubber", "Leder": "Leather", "Holz, Papier": "Wood, paper", "Textilien": "Textiles", "Schuhe": "Footwear", "Steine, Glas, Edelmetalle": "Stone, glass, precious metals",
      "Metalle": "Metals", "Maschinen, Elektronik": "Machinery, electronics", "Fahrzeuge": "Vehicles", "Instrumente": "Instruments", "Sonstiges": "Other" };
    const secName = (s) => EN ? (secEn[s] || s) : s;
    const sc = S.scenarios.find((s) => s.id === "china_dependencies"), cv = sc && sc.countries[lv === "EU27" ? "EU27" : "DEU"];
    $("depAnswer").textContent = L(
      `${who} ist ${Dd.year} bei ${X.n_dependent} von ${X.n_products.toLocaleString(LOC)} Waren abhängig: wenige Lieferländer außerhalb der EU, kaum eigener Ersatz. Bei ${X.n_china_main} davon ist China Hauptlieferant. Rund ${fmt(X.red_sea_share * 100, 0)} % dieser Importe kommen über das Rote Meer. Ein Lieferstopp Chinas bei diesen Waren kostete langfristig ${pct(cv[0])} Realeinkommen${sc.short_run ? `, mit kurzfristigen Elastizitäten ${pct(sc.short_run[lv === "EU27" ? "EU27" : "DEU"])}` : ""}. Bei ${X.n_hard_to_replace} von ${X.n_with_sigma} Waren mit zwei Schätzungen lassen sich Lieferländer nach beiden kaum austauschen (σ unter 2).`,
      `In ${Dd.year} ${lv === "EU27" ? "the EU depends" : "Germany depends"} on ${X.n_dependent} of ${X.n_products.toLocaleString(LOC)} goods: few suppliers outside the EU and little own substitute. China is the main supplier for ${X.n_china_main} of them. About ${fmt(X.red_sea_share * 100, 0)} % of these imports come through the Red Sea. A Chinese supply stop for these goods would cost ${pct(cv[0])} of real income in the long run${sc.short_run ? `, ${pct(sc.short_run[lv === "EU27" ? "EU27" : "DEU"])} with short-run elasticities` : ""}. For ${X.n_hard_to_replace} of ${X.n_with_sigma} goods with two estimates, both say suppliers are hard to replace (σ below 2).`);
    const tile = (big, label, sub) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${esc(sub)}</span></div>`;
    $("depFacts").innerHTML = [
      tile(String(X.n_dependent), L("Abhängige Waren", "Dependent goods"), L(`HS6, von ${X.n_products.toLocaleString(LOC)}`, `HS6, of ${X.n_products.toLocaleString(LOC)}`)),
      tile(bn(fmt(X.extra_imports_bn, 0)), L("Importe außerhalb der EU", "Imports from outside the EU"), L(`${fmt(X.share_of_extra_imports * 100, 1)} % aller Importe von dort`, `${fmt(X.share_of_extra_imports * 100, 1)} % of all such imports`)),
      tile(String(X.n_china_main), L("davon China Hauptlieferant", "of which China main supplier"), bn(fmt(X.china_main_bn, 0))),
      tile(`${fmt(X.red_sea_share * 100, 0)} %`, L("über das Rote Meer", "via the Red Sea"), L(`Malakka: ${fmt(X.malacca_share * 100, 0)} %`, `Malacca: ${fmt(X.malacca_share * 100, 0)} %`)),
    ].join("");
    // bar chart: dependent goods by HS section, China as main supplier in dark blue
    const rows = X.sections, W = 860, row = 24, m = { l: 230, r: 60, t: 34, b: 10 }, H = m.t + m.b + row * rows.length;
    const mx = Math.max(...rows.map((r) => r[1])), Xs = (v) => m.l + v / mx * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L("Abhängige Waren nach Warengruppe", "Dependent goods by product group")}">`;
    s += `<rect x="${m.l}" y="6" width="12" height="12" fill="#002060"/><text x="${m.l + 18}" y="16">${L("China Hauptlieferant", "China main supplier")}</text><rect x="${m.l + 190}" y="6" width="12" height="12" fill="#a6a6a6"/><text x="${m.l + 208}" y="16">${L("andere Hauptlieferanten", "other main supplier")}</text>`;
    rows.forEach((r, i) => {
      const y = m.t + i * row;
      s += `<text x="${m.l - 8}" y="${y + row / 2 + 4}" text-anchor="end">${esc(secName(r[0]))}</text>`;
      s += `<rect x="${m.l}" y="${y + 4}" width="${Xs(r[2]) - m.l}" height="${row - 8}" fill="#002060"><title>${esc(secName(r[0]))}: ${r[2]} ${L("mit China", "with China")}</title></rect>`;
      s += `<rect x="${Xs(r[2])}" y="${y + 4}" width="${Xs(r[1]) - Xs(r[2])}" height="${row - 8}" fill="#a6a6a6"><title>${esc(secName(r[0]))}: ${r[1]}</title></rect>`;
      s += `<text x="${Xs(r[1]) + 6}" y="${y + row / 2 + 4}">${r[1]}</text>`;
    });
    $("depChart").innerHTML = s + "</svg>";
    FIGDATA.dep = { header: [L("Warengruppe", "Product group"), L("abhängige Waren", "dependent goods"), L("davon China Hauptlieferant", "China main supplier"), L("Importe in Mrd. USD", "Imports, USD bn")],
      rows: rows.map((r) => [secName(r[0]), r[1], r[2], r[3]]) };
    const P = X.products, pc = (x) => `${fmt(x * 100, 0)} %`;
    $("depTable").innerHTML = `<thead><tr><th>HS6</th><th>${L("Ware", "Product")}</th><th>${L("Hauptlieferant", "Main supplier")}</th><th class="num">${L("Anteil", "Share")}</th><th class="num">${L("China", "China")}</th><th class="num">${L("Importe", "Imports")}</th><th class="num">${L("Rotes Meer", "Red Sea")}</th><th class="num">σ</th><th class="num">σ ESCAP</th></tr></thead><tbody>` +
      P.slice(0, 30).map((r) => `<tr><td class="num">${r[0]}</td><td>${esc(EN ? r[2] : (r[1] || r[2]))}${EN ? "" : `<span class="ex">${esc(r[2])}</span>`}</td><td>${esc(cname(r[3]) || r[3])}</td><td class="num">${pc(r[4])}</td><td class="num">${pc(r[5])}</td><td class="num">${bn(fmt(r[6], 2))}</td><td class="num">${pc(r[9])}</td><td class="num">${r[11] === null || r[11] === undefined ? "–" : (r[11] <= 1.05 ? "≤\u202f1,05".replace(",", EN ? "." : ",") : fmt(r[11], 1))}</td><td class="num">${r[12] === null || r[12] === undefined ? "–" : fmt(r[12], 1)}${r[13] ? ' <span class="chip bad">▲</span>' : ""}</td></tr>`).join("") + "</tbody>";
    const secNames = EN ? S.sector_names_en : S.sector_names;
    $("depIndustries").innerHTML = `<thead><tr><th>${L("Branche in Deutschland", "Industry in Germany")}</th><th class="num">${L("Abhängige Vorleistungen aus China, direkt", "Dependent inputs from China, direct")}</th><th class="num">${L("mit indirekten Lieferketten", "incl. indirect supply chains")}</th><th class="num">${L("Chinesische Wertschöpfung insgesamt", "Chinese value added, all goods")}</th><th class="num">${L("Produktion bei Lieferstopp", "Output if China stops")}</th></tr></thead><tbody>` +
      Dd.germany_industries.map((r) => `<tr><td>${esc(secNames[r[0]] || r[0])}</td><td class="num">${fmt(r[1], 2)}\u202f%</td><td class="num">${fmt(r[4], 2)}\u202f%</td><td class="num">${fmt(r[5], 1)}\u202f%</td><td class="num">${pct(r[2], 1)}</td></tr>`).join("") + "</tbody>";
  }

  async function renderCompetition() {
    const C = await getJSON("data/competition.json");
    const secEn = { "Tiere": "Animals", "Pflanzen": "Plants", "Fette": "Fats", "Nahrungsmittel": "Food", "Mineralien, Energie": "Minerals, energy", "Chemie, Pharma": "Chemicals, pharma",
      "Kunststoff, Kautschuk": "Plastics, rubber", "Leder": "Leather", "Holz, Papier": "Wood, paper", "Textilien": "Textiles", "Schuhe": "Footwear", "Steine, Glas, Edelmetalle": "Stone, glass, precious metals",
      "Metalle": "Metals", "Maschinen, Elektronik": "Machinery, electronics", "Fahrzeuge": "Vehicles", "Instrumente": "Instruments", "Sonstiges": "Other" };
    const secName = (s) => EN ? (secEn[s] || s) : s;
    const S = C.similarity, e0 = S[0], e1 = S[S.length - 1], pr = C.price_ratio_weighted;
    const veh = C.sections.find((r) => r[0] === "Fahrzeuge");
    $("compAnswer").textContent = L(
      `Die Exporte Deutschlands und Chinas ähneln sich immer mehr: Die Exportähnlichkeit stieg von ${fmt(e0[1], 2)} (${e0[0]}) auf ${fmt(e1[1], 2)} (${e1[0]}). Bei derselben Ware im selben Zielland liegt der chinesische Stückwert im Median bei ${fmt(pr * 100, 0)} % des deutschen. Unter Preisdruck stehen ${C.n_exposed} deutsche Exportwaren mit ${bn(fmt(C.exposed_bn, 0))}, rund die Hälfte davon Fahrzeuge und Teile.${veh ? ` Dort stieg Chinas Weltmarktanteil von ${fmt(veh[4] * 100, 0)} % auf ${fmt(veh[3] * 100, 0)} %.` : ""}`,
      `German and Chinese exports are becoming more alike: export similarity rose from ${fmt(e0[1], 2)} (${e0[0]}) to ${fmt(e1[1], 2)} (${e1[0]}). For the same good in the same destination the Chinese unit value is at the median ${fmt(pr * 100, 0)} % of the German one. ${C.n_exposed} German export goods worth ${bn(fmt(C.exposed_bn, 0))} are under price pressure, about half of it vehicles and parts.${veh ? ` There China's world market share rose from ${fmt(veh[4] * 100, 0)} % to ${fmt(veh[3] * 100, 0)} %.` : ""}`);
    const tile = (big, label, sub) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${esc(sub)}</span></div>`;
    $("compFacts").innerHTML = [
      tile(fmt(e1[1], 2), L("Exportähnlichkeit", "Export similarity"), S.map((r) => `${r[0]}: ${fmt(r[1], 2)}`).join(" · ")),
      tile(`${fmt(pr * 100, 0)} %`, L("Preis China zu Deutschland", "Price China to Germany"), L("Median, gewichtet mit deutschen Exporten", "median, weighted by German exports")),
      tile(String(C.n_exposed), L("Waren unter Preisdruck", "Goods under price pressure"), L("HS6, Auswahl siehe Tabelle", "HS6, selection see table")),
      tile(bn(fmt(C.exposed_bn, 0)), L("deutsche Exporte darin", "German exports in them"), L(`${fmt(C.exposed_bn / C.deu_exports_bn * 100, 0)} % aller deutschen Exporte`, `${fmt(C.exposed_bn / C.deu_exports_bn * 100, 0)} % of all German exports`)),
    ].join("");
    // dumbbell chart: China and Germany shares 2012 -> 2024 by product group
    const rows = C.sections.filter((r) => r[1] >= 10), W = 860, row = 30, m = { l: 230, r: 30, t: 40, b: 30 }, H = m.t + m.b + row * rows.length;
    const mx = Math.ceil(Math.max(...rows.flatMap((r) => [r[3], r[4], r[5], r[6]])) * 20) / 20, ticks = niceTicks(0, mx * 100, 5);
    const Xs = (v) => m.l + v / mx * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L("Weltmarktanteile nach Warengruppe", "World market shares by product group")}">`;
    s += `<circle cx="${m.l + 6}" cy="12" r="5" fill="#002060"/><text x="${m.l + 16}" y="16">China</text><circle cx="${m.l + 96}" cy="12" r="5" fill="#a6a6a6"/><text x="${m.l + 106}" y="16">${L("Deutschland", "Germany")}</text>`;
    ticks.forEach((t) => { const x = Xs(t / 100); s += `<line x1="${x}" x2="${x}" y1="${m.t - 6}" y2="${H - m.b}" stroke="#e6e6e6"/><text x="${x}" y="${H - m.b + 18}" text-anchor="middle">${fmt(t, tickDec(ticks))} %</text>`; });
    rows.forEach((r, i) => {
      const y = m.t + i * row + row / 2;
      s += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${esc(secName(r[0]))}</text>`;
      [[r[4], r[3], "#002060", "China"], [r[6], r[5], "#a6a6a6", L("Deutschland", "Germany")]].forEach(([a, b, c, n], k) => {
        const yy = y + (k ? 5 : -5);
        s += `<line x1="${Xs(a)}" x2="${Xs(b)}" y1="${yy}" y2="${yy}" stroke="${c}" stroke-width="2"/><circle cx="${Xs(a)}" cy="${yy}" r="4" fill="#fff" stroke="${c}" stroke-width="1.5"/><circle cx="${Xs(b)}" cy="${yy}" r="4.5" fill="${c}"><title>${esc(secName(r[0]))}, ${n}: ${fmt(a * 100, 1)} % → ${fmt(b * 100, 1)} %</title></circle>`;
      });
    });
    $("compChart").innerHTML = s + "</svg>";
    FIGDATA.comp = { header: [L("Warengruppe", "Product group"), L("China 2012 (%)", "China 2012 (%)"), L("China 2024 (%)", "China 2024 (%)"), L("Deutschland 2012 (%)", "Germany 2012 (%)"), L("Deutschland 2024 (%)", "Germany 2024 (%)"), L("deutsche Exporte 2024, Mrd. USD", "German exports 2024, USD bn")],
      rows: rows.map((r) => [secName(r[0]), +(r[4] * 100).toFixed(1), +(r[3] * 100).toFixed(1), +(r[6] * 100).toFixed(1), +(r[5] * 100).toFixed(1), r[1]]) };
    const pc = (x) => `${fmt(x * 100, 0)} %`;
    $("compTable").innerHTML = `<thead><tr><th>HS6</th><th>${L("Ware", "Product")}</th><th class="num">${L("Deutsche Exporte", "German exports")}</th><th class="num">${L("China 2012", "China 2012")}</th><th class="num">${L("China 2024", "China 2024")}</th><th class="num">${L("Deutschland 2012", "Germany 2012")}</th><th class="num">${L("Deutschland 2024", "Germany 2024")}</th><th class="num">${L("Preisverhältnis", "Price ratio")}</th></tr></thead><tbody>` +
      C.products.slice(0, 30).map((r) => `<tr><td class="num">${r[0]}</td><td>${esc(EN ? r[2] : (r[1] || r[2]))}${EN ? "" : `<span class="ex">${esc(r[2])}</span>`}</td><td class="num">${bn(fmt(r[3], 2))}</td><td class="num">${pc(r[4])}</td><td class="num">${pc(r[5])}</td><td class="num">${pc(r[6])}</td><td class="num">${pc(r[7])}</td><td class="num">${fmt(r[8], 2)}</td></tr>`).join("") + "</tbody>";
  }

  async function renderZeroTrade() {
    const ids = ["ztLevel", "ztView", "ztStat", "ztPeriod"];
    if (!$("ztLevel").dataset.ready) { $("ztLevel").dataset.ready = "1"; ids.forEach((i) => $(i).addEventListener("change", () => renderZeroTrade())); }
    const lv = $("ztLevel").value, vw = $("ztView").value, stat = $("ztStat").value;
    const [Z, CMP] = await Promise.all([getJSON(`data/zerotrade_${lv}.json`), getJSON("data/zerotrade_compare.json")]);
    const plab = { 2001: L("China in der WTO", "China joins the WTO"), 2004: L("EU-Osterweiterung", "EU eastern enlargement"), 2008: L("Finanzkrise", "financial crisis"), 2020: L("Pandemie", "pandemic") };
    const ps = $("ztPeriod"), prev = ps.value;
    ps.innerHTML = Z.starts.map((s, k) => `<option value="${s}">${L("seit", "since")} ${s} (${k === 0 ? (s === 1990 ? L("Wiedervereinigung", "German reunification") : L("alle Jahre", "all years")) : plab[s]})</option>`).join("");
    if ([...ps.options].some((o) => o.value === prev)) ps.value = prev; else if (prev && +prev < Z.starts[1]) ps.value = Z.starts[0];
    const start = +ps.value, N = Z.countries.length;
    const raw = atob(Z.matrices[`${vw === "m" ? "x" : vw}_${stat}_${start}`]);
    const val = (i, j) => vw === "m" ? raw.charCodeAt(j * N + i) : raw.charCodeAt(i * N + j);
    const gamma = Z.binary ? 1 : 0.5, FLOOR = 0.12;
    const grey = (b) => b === 0 ? 255 : Math.round(255 * (1 - (FLOOR + (1 - FLOOR) * Math.pow(b / 255, gamma))));
    const k = 3, o = 10, cv = $("ztCanvas"), S = o + N * k;
    cv.width = S; cv.height = S;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(S, S);
    img.data.fill(255);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const g = grey(val(i, j));
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { const p = ((o + i * k + a) * S + o + j * k + b) * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = g; }
    }
    ctx.putImageData(img, 0, 0);
    const iso = Z.countries.includes(state.iso) ? state.iso : "DEU", ci = Z.countries.indexOf(iso);
    ctx.fillStyle = "#c00000"; ctx.fillRect(0, o + ci * k, o - 2, k); ctx.fillRect(o + ci * k, 0, k, o - 2);
    // facts
    let pos = 0, sum = 0, rowPos = 0, rowSum = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { if (i === j) continue; const b = val(i, j); if (b > 0) { pos++; sum += b / 255; } if (i === ci) { if (b > 0) rowPos++; rowSum += b / 255; } }
    const pairs = N * (N - 1), nm = cname(iso) || iso;
    const lvName = $("ztLevel").selectedOptions[0].text, vwName = $("ztView").selectedOptions[0].text;
    const unit = Z.binary ? (stat === "mean" ? L("Anteil der Jahre mit Handel", "share of years with trade") : L("Handel ja oder nein", "trade yes or no")) : L("Anteil der gehandelten Codes", "share of codes traded");
    const per = L(`Seit ${start}`, `Since ${start}`), how = stat === "median" ? L("in mindestens der Hälfte der Jahre", "in at least half of the years") : L("zumindest zeitweise", "at least at times");
    const dir = { x: L("Exporte", "exports"), m: L("Importe", "imports"), two: L("Handel in beide Richtungen", "two-way trade") }[vw];
    $("ztAnswer").textContent = Z.binary
      ? L(`${per} handeln ${fmt(pos / pairs * 100, 0)} % aller Länderpaare ${how} miteinander (${dir}). ${nm} hat mit ${rowPos} von ${N - 1} Ländern Handel.`,
          `${per}, ${fmt(pos / pairs * 100, 0)} % of all country pairs trade ${how} (${dir}). ${nm} trades with ${rowPos} of ${N - 1} countries.`)
      : L(`${per} handeln ${fmt(pos / pairs * 100, 0)} % aller Länderpaare überhaupt miteinander, im Mittel aber nur ${fmt(sum / pairs * 100, 1)} % der Codes auf Ebene ${lvName.split(" (")[0]} (${dir}). ${nm} handelt mit dem durchschnittlichen Partner ${fmt(rowSum / (N - 1) * 100, 0)} % der Codes.`,
          `${per}, ${fmt(pos / pairs * 100, 0)} % of all country pairs trade at all, but on average only ${fmt(sum / pairs * 100, 1)} % of codes at level ${lvName.split(" (")[0]} (${dir}). ${nm} trades ${fmt(rowSum / (N - 1) * 100, 0)} % of codes with the average partner.`);
    const tile = (big, label, sub) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${esc(sub)}</span></div>`;
    $("ztFacts").innerHTML = [
      tile(`${fmt(pos / pairs * 100, 0)} %`, L("Paare mit Handel", "Pairs with trade"), L(`${N} Länder, ${pairs.toLocaleString(LOC)} Paare`, `${N} countries, ${pairs.toLocaleString(LOC)} pairs`)),
      tile(`${fmt(100 - pos / pairs * 100, 0)} %`, L("Paare ohne Handel", "Pairs without trade"), L("weiße Zellen", "white cells")),
      tile(`${rowPos}`, L(`Partner von ${nm}`, `Partners of ${nm}`), L(`von ${N - 1}`, `of ${N - 1}`)),
      tile(Z.binary ? `${fmt(sum / pairs * 100, 0)} %` : `${fmt(sum / pairs * 100, 1)} %`, L("Mittlerer Wert je Paar", "Mean value per pair"), unit),
    ].join("");
    $("ztTitle").textContent = L(`Null-Handel-Matrix: ${lvName}, ${vwName}, ${stat === "median" ? "Median" : "Mittelwert"} seit ${start}`, `Zero-trade matrix: ${lvName}, ${vwName}, ${stat} since ${start}`);
    $("ztNote").textContent = L(`Zeile: ${vw === "m" ? "importierendes Land" : vw === "two" ? "Land" : "exportierendes Land"}, Spalte: Partner. Weiß: kein Handel. ${unit}${Z.binary ? "" : ", Wurzelskala"}. Rote Marke: ${nm} (oben im Länderfeld wählbar). Sortiert nach Breite des Handels, die am stärksten vernetzten Länder oben links.`,
      `Row: ${vw === "m" ? "importing country" : vw === "two" ? "country" : "exporting country"}, column: partner. White: no trade. ${unit}${Z.binary ? "" : ", square-root scale"}. Red mark: ${nm} (choose in the country field above). Sorted by breadth of trade, the most connected countries top left.`);
    const stops = [0, 0.1, 0.25, 0.5, 1];
    $("ztLegend").innerHTML = `<div class="hint">${stops.map((s) => { const g = grey(Math.round(s * 255)); return `<span style="display:inline-block;width:14px;height:14px;border:1px solid #d9d9d9;background:rgb(${g},${g},${g});vertical-align:middle"></span> ${s === 0 ? "0" : fmt(s * 100, 0) + " %"}`; }).join("&nbsp; ")}</div>`;
    const src = lv === "country" ? L("IMF IMTS, Spiegeldaten, 1990 bis 2024", "IMF IMTS, mirror data, 1990 to 2024") : L("CEPII BACI HS92 V202601 (Etalab-Lizenz 2.0), 1995 bis 2024", "CEPII BACI HS92 V202601 (Etalab licence 2.0), 1995 to 2024");
    $("ztSrc").textContent = L(`Quelle: eigene Berechnungen auf Basis von ${src}; Länder, die in allen Jahren vorkommen. Lizenz der Abbildung: CC BY 4.0.`, `Source: own calculations based on ${src}; countries present in all years. Licence of the figure: CC BY 4.0.`);
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) * S / r.width, sy = (e.clientY - r.top) * S / r.height;
      const j = Math.floor((sx - o) / k), i = Math.floor((sy - o) / k);
      if (i < 0 || j < 0 || i >= N || j >= N) return;
      const b = val(i, j), a = cname(Z.countries[i]) || Z.countries[i], c = cname(Z.countries[j]) || Z.countries[j];
      const v = b === 0 ? L("kein Handel", "no trade") : Z.binary && stat === "median" ? L("Handel", "trade") : `${fmt(b / 255 * 100, Z.binary ? 0 : 1)} %`;
      $("ztHover").textContent = `${a} ${vw === "m" ? "←" : vw === "two" ? "↔" : "→"} ${c}: ${v}`;
    };
    FIGDATA.zt = { header: [L("Land", "Country"), ...Z.countries], rows: Z.countries.map((c, i) => [c, ...Z.countries.map((_, j) => i === j ? "" : +(val(i, j) / 255).toFixed(3))]) };
    // Germany: stacked bars per year
    const CE = CMP[lv].entities, gi = CE[iso] ? iso : "DEU";
    const g = { years: CMP[lv].years }; ["two_way", "export_only", "import_only", "none"].forEach((c, q) => { g[c] = CE[gi][q].map((v) => v === null ? 0 : v / 1000); });
    const gname = cname(gi) || gi;
    const cats = [["two_way", L("beidseitig", "two-way"), "#002060"], ["export_only", L("nur Export", "export only"), "#5b9bd5"], ["import_only", L("nur Import", "import only"), "#a6a6a6"], ["none", L("kein Handel", "no trade"), "#f2f2f2"]];
    $("ztGerAsk").textContent = L(`Mit wie vielen Partnern und Waren handelt ${gname}?`, `With how many partners and goods does ${gname} trade?`);
    $("ztGerTitle").textContent = L(`${gname}: Handel nach Partnern${lv === "country" ? "" : " und Codes"}, ${lvName}, in %`, `${gname}: trade by partner${lv === "country" ? "" : " and code"}, ${lvName}, in %`);
    $("ztGerSrc").textContent = $("ztSrc").textContent;
    const W = 860, H = 300, m = { l: 16, r: 46, t: 34, b: 28 }, n = g.years.length, bw = (W - m.l - m.r) / n;
    const Y = (v) => H - m.b - v / 100 * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc($("ztGerTitle").textContent)}">`;
    cats.forEach((c, q) => { s += `<rect x="${m.l + q * 140}" y="6" width="12" height="12" fill="${c[2]}" stroke="#bfbfbf" stroke-width="0.5"/><text x="${m.l + q * 140 + 18}" y="16">${c[1]}</text>`; });
    [0, 25, 50, 75, 100].forEach((v) => { s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e6e6e6"/><text x="${W - m.r + 6}" y="${Y(v) + 4}">${v}</text>`; });
    g.years.forEach((y, i) => {
      let acc = 0; const x = m.l + i * bw + 1;
      cats.forEach((c) => { const v = g[c[0]][i] * 100; s += `<rect x="${x}" y="${Y(acc + v)}" width="${bw - 2}" height="${Y(acc) - Y(acc + v)}" fill="${c[2]}"><title>${y}, ${c[1]}: ${fmt(v, 1)} %</title></rect>`; acc += v; });
      if (y % 5 === 0) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${y}</text>`;
    });
    $("ztGerChart").innerHTML = s + "</svg>";
    FIGDATA.ztger = { header: [L("Jahr", "Year"), ...cats.map((c) => c[1] + " (%)")], rows: g.years.map((y, i) => [y, ...cats.map((c) => +(g[c[0]][i] * 100).toFixed(2))]) };
    // comparison: last year, horizontal stacked bars
    const agg = { EU27: L("EU27, Ø Mitglieder", "EU27, member mean"), EU27w: L("EU27, exportgewichtet", "EU27, export-weighted"), EA21: L("Euroraum, Ø Mitglieder", "Euro area, member mean"), EA21w: L("Euroraum, exportgewichtet", "Euro area, export-weighted") };
    let ents = ["DEU", "EU27", "EU27w", "EA21", "EA21w", "USA", "JPN", "FRA", "ITA", "GBR", "CAN", "CHN", "KOR", "ESP", "NLD", "POL", "AUT"];
    if (!ents.includes(gi)) ents = [gi, ...ents];
    ents = ents.filter((e) => CE[e]);
    const yi = CMP[lv].years.length - 1, yl = CMP[lv].years[yi];
    const rowH = 22, cm = { l: 200, r: 20, t: 34, b: 26 }, CW = 860, CH = cm.t + cm.b + rowH * ents.length;
    const XS = (v) => cm.l + v / 100 * (CW - cm.l - cm.r);
    let c2 = `<svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${L("Vergleich", "Comparison")}">`;
    cats.forEach((c, q) => { c2 += `<rect x="${cm.l + q * 140}" y="6" width="12" height="12" fill="${c[2]}" stroke="#bfbfbf" stroke-width="0.5"/><text x="${cm.l + q * 140 + 18}" y="16">${c[1]}</text>`; });
    [0, 25, 50, 75, 100].forEach((v) => { c2 += `<text x="${XS(v)}" y="${CH - 8}" text-anchor="middle">${v}</text>`; });
    ents.forEach((e, r) => {
      const y = cm.t + r * rowH, lab = agg[e] || cname(e) || e; let acc = 0;
      c2 += `<text x="${cm.l - 8}" y="${y + rowH / 2 + 4}" text-anchor="end"${e === gi ? ' font-weight="600"' : ""}>${esc(lab)}</text>`;
      cats.forEach((c, q) => { const v = (CE[e][q][yi] || 0) / 10; c2 += `<rect x="${XS(acc)}" y="${y + 3}" width="${XS(acc + v) - XS(acc)}" height="${rowH - 6}" fill="${c[2]}"><title>${esc(lab)}, ${c[1]}: ${fmt(v, 1)} %</title></rect>`; acc += v; });
    });
    $("ztCmpChart").innerHTML = c2 + "</svg>";
    $("ztCmpTitle").textContent = L(`Handel nach Partnern${lv === "country" ? "" : " und Codes"} im Vergleich, ${lvName}, ${yl}, in %`, `Trade by partner${lv === "country" ? "" : " and code"} compared, ${lvName}, ${yl}, in %`);
    $("ztCmpNote").textContent = L("EU27 und Euroraum (21 Mitglieder, Stand 2026): Mittel der Anteile der Mitgliedstaaten, ungewichtet oder nach Exporten 2024 gewichtet." + (lv === "country" ? " Auf Länderebene fehlen neun Mitglieder ohne IMF-Daten seit 1990." : " Luxemburg fehlt, weil BACI es erst ab 1999 getrennt ausweist."),
      "EU27 and euro area (21 members, as of 2026): mean of member states' shares, unweighted or weighted by 2024 exports." + (lv === "country" ? " At country level nine members without IMF data since 1990 are missing." : " Luxembourg is missing because BACI reports it separately only from 1999."));
    $("ztCmpSrc").textContent = $("ztSrc").textContent;
    FIGDATA.ztcmp = { header: [L("Land/Gruppe", "Country/group"), ...cats.map((c) => c[1] + " (%)")], rows: ents.map((e) => [agg[e] || cname(e) || e, ...cats.map((c, q) => +((CE[e][q][yi] || 0) / 10).toFixed(1))]) };
  }

  async function renderRegime() {
    const R = await getJSON("data/regime.json");
    if (!$("rgWho").dataset.ready) { $("rgWho").dataset.ready = "1"; ["rgWho", "rgFlow", "rgDim"].forEach((i) => $(i).addEventListener("change", () => renderRegime())); }
    const who = $("rgWho").value, flow = $("rgFlow").value, dim = $("rgDim").value;
    const catsDe = R.categories[dim];
    const en = { "liberale Demokratie": "liberal democracy", "Wahldemokratie": "electoral democracy", "Wahlautokratie": "electoral autocracy", "geschlossene Autokratie": "closed autocracy", "keine Einstufung": "not classified", "näher an den USA": "closer to the US", "näher an China": "closer to China" };
    const cn = (c) => EN ? en[c] || c : c;
    const col = { "liberale Demokratie": "#002060", "Wahldemokratie": "#5b9bd5", "Wahlautokratie": "#f4b183", "geschlossene Autokratie": "#c00000", "keine Einstufung": "#d9d9d9", "näher an den USA": "#002060", "näher an China": "#c00000" };
    const S = R.series[`${who}_${flow}_${dim}`], ys = S.years, n = ys.length, last = n - 1;
    const auto = (i) => dim === "regime" ? S.values[2][i] + S.values[3][i] : S.values[1][i];
    const fixed = R.series[`${who}_${flow}_fixed`], lib = R.series[`${who}_${flow}_libdem`];
    const whoN = who === "DEU" ? L("Deutschlands", "Germany's") : L("der EU im Handel mit Drittstaaten", "the EU's trade with non-members:");
    const flowN = flow === "X" ? L("Exporten", "exports") : L("Importen", "imports");
    const groupN = dim === "regime" ? L("Autokratien", "autocracies") : L("Ländern, die in der UN näher an China stehen,", "countries closer to China in UN votes");
    $("rgAnswer").textContent = L(`Der Anteil von ${groupN} an den ${flowN} ${whoN} stieg von ${fmt(auto(0) * 100, 0)} % (${ys[0]}) auf ${fmt(auto(last) * 100, 0)} % (${ys[last]}).` + (dim === "regime" ? ` Bei fester Einstufung von 2024 sind es ${fmt(fixed[0] * 100, 0)} % und ${fmt(fixed[last] * 100, 0)} %; die Verschiebung kommt also aus dem Handel, nicht aus neu eingestuften Ländern.` : ""),
      `The share of ${groupN} in ${whoN} ${flowN} rose from ${fmt(auto(0) * 100, 0)} % (${ys[0]}) to ${fmt(auto(last) * 100, 0)} % (${ys[last]}).` + (dim === "regime" ? ` With the 2024 classification held fixed it is ${fmt(fixed[0] * 100, 0)} % and ${fmt(fixed[last] * 100, 0)} %, so the shift comes from trade, not from reclassified countries.` : ""));
    const tile = (big, label, sub) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${esc(sub)}</span></div>`;
    $("rgFacts").innerHTML = [
      tile(`${fmt(auto(last) * 100, 0)} %`, dim === "regime" ? L("Autokratien", "Autocracies") : L("näher an China", "closer to China"), `${ys[last]}, ${L(`${ys[0]}: ${fmt(auto(0) * 100, 0)} %`, `${ys[0]}: ${fmt(auto(0) * 100, 0)} %`)}`),
      tile(`${fmt(S.values[0][last] * 100, 0)} %`, cn(catsDe[0]), String(ys[last])),
      tile(fmt(lib[last], 2), L("Demokratie-Index der Partner", "Partners' democracy index"), L(`handelsgewichtet, V-Dem LDI; ${ys[0]}: ${fmt(lib[0], 2)}`, `trade-weighted, V-Dem LDI; ${ys[0]}: ${fmt(lib[0], 2)}`)),
    ].join("");
    // stacked bars per year
    const W = 860, H = 320, m = { l: 16, r: 46, t: 40, b: 28 }, bw = (W - m.l - m.r) / n, Y = (v) => H - m.b - v / 100 * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L("Handel nach Regierungsform", "Trade by government type"))}">`;
    catsDe.forEach((c, q) => { s += `<rect x="${m.l + q * 165}" y="6" width="12" height="12" fill="${col[c]}"/><text x="${m.l + q * 165 + 18}" y="16">${esc(cn(c))}</text>`; });
    if (dim === "regime") s += `<line x1="${m.l}" x2="${m.l + 20}" y1="30" y2="30" stroke="#000" stroke-dasharray="4 3"/><text x="${m.l + 26}" y="34">${L("Grenze zu den Autokratien bei fester Einstufung 2024", "boundary to autocracies with 2024 classification fixed")}</text>`;
    [0, 25, 50, 75, 100].forEach((v) => { s += `<text x="${W - m.r + 6}" y="${Y(v) + 4}">${v}</text>`; });
    ys.forEach((y, i) => {
      let acc = 0; const x = m.l + i * bw + 1;
      catsDe.forEach((c, q) => { const v = S.values[q][i] * 100; s += `<rect x="${x}" y="${Y(acc + v)}" width="${bw - 2}" height="${Y(acc) - Y(acc + v)}" fill="${col[c]}"><title>${y}, ${esc(cn(c))}: ${fmt(v, 1)} %</title></rect>`; acc += v; });
      if (y % 5 === 0) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${y}</text>`;
    });
    if (dim === "regime") s += `<path d="${fixed.map((v, i) => `${i ? "L" : "M"}${m.l + i * bw + bw / 2},${Y(100 - v * 100)}`).join("")}" fill="none" stroke="#000" stroke-width="1.4" stroke-dasharray="4 3"/>`;
    $("rgChart").innerHTML = s + "</svg>";
    $("rgTitle").textContent = L(`${who === "DEU" ? "Deutschland" : "EU, Handel mit Drittstaaten"}: ${flow === "X" ? "Exporte" : "Importe"} nach ${dim === "regime" ? "Regimetyp" : "UN-Nähe"} der Partner, Anteile in %`, `${who === "DEU" ? "Germany" : "EU, trade with non-members"}: ${flow === "X" ? "exports" : "imports"} by partners' ${dim === "regime" ? "regime type" : "UN alignment"}, shares in %`);
    $("rgNote").textContent = who === "DEU" ? L("Deutschland: Handel mit allen Partnern, auch innerhalb der EU (Ungarn gilt seit 2018 als Wahlautokratie). Werte: IMF IMTS, Exporte fob, Importe cif.", "Germany: trade with all partners, including within the EU (Hungary counts as an electoral autocracy since 2018). Values: IMF IMTS, exports fob, imports cif.")
      : L("EU: Summe der Mitgliedstaaten im Handel mit Ländern außerhalb der EU (Zusammensetzung 2026). Werte: IMF IMTS.", "EU: sum of member states' trade with countries outside the EU (2026 composition). Values: IMF IMTS.");
    FIGDATA.rg = { header: [L("Jahr", "Year"), ...catsDe.map((c) => cn(c) + " (%)")], rows: ys.map((y, i) => [y, ...catsDe.map((c, q) => +(S.values[q][i] * 100).toFixed(2))]) };
    // dependencies
    const rows = ["EU27", "DEU"], rowH = 46, dm = { l: 130, r: 20, t: 34, b: 10 }, DH = dm.t + dm.b + rowH * rows.length, XS = (v) => dm.l + v / 100 * (W - dm.l - dm.r);
    let d = `<svg viewBox="0 0 ${W} ${DH}" role="img" aria-label="${esc(L("Abhängige Waren nach Hauptlieferant", "Dependent goods by main supplier"))}">`;
    catsDe.forEach((c, q) => { d += `<rect x="${16 + q * 165}" y="6" width="12" height="12" fill="${col[c]}"/><text x="${16 + q * 165 + 18}" y="16">${esc(cn(c))}</text>`; });
    rows.forEach((lv, r) => {
      const y = dm.t + r * rowH, D = R.dependencies[lv][dim]; let acc = 0;
      d += `<text x="${dm.l - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${lv === "DEU" ? L("Deutschland", "Germany") : "EU27"}</text>`;
      catsDe.forEach((c) => { const e = D[c]; if (!e) return; const v = e[2] * 100; d += `<rect x="${XS(acc)}" y="${y + 6}" width="${XS(acc + v) - XS(acc)}" height="${rowH - 12}" fill="${col[c]}"><title>${esc(cn(c))}: ${e[0]} ${L("Waren", "goods")}, ${fmt(e[1], 1)} ${L("Mrd. USD", "USD bn")}, ${fmt(v, 0)} %</title></rect>`;
        if (v > 6) d += `<text x="${XS(acc + v / 2)}" y="${y + rowH / 2 + 4}" text-anchor="middle" fill="${["#002060", "#c00000"].includes(col[c]) ? "#fff" : "#000"}" style="fill:${["#002060", "#c00000"].includes(col[c]) ? "#fff" : "#000"}">${fmt(v, 0)} %</text>`; acc += v; });
    });
    $("rgDepChart").innerHTML = d + "</svg>";
    FIGDATA.rgdep = { header: [L("Ebene", "Level"), L("Einstufung", "Class"), L("Waren", "Goods"), L("Importe, Mrd. USD", "Imports, USD bn"), L("Anteil am Wert (%)", "Share of value (%)")],
      rows: rows.flatMap((lv) => catsDe.filter((c) => R.dependencies[lv][dim][c]).map((c) => { const e = R.dependencies[lv][dim][c]; return [lv, cn(c), e[0], e[1], +(e[2] * 100).toFixed(1)]; })) };
    // breadth
    const B = R.breadth, rmap = { 3: "liberale Demokratie", 2: "Wahldemokratie", 1: "Wahlautokratie", 0: "geschlossene Autokratie" };
    const ser = [3, 2, 1, 0].map((r, k) => ({ label: cn(rmap[r]), color: col[rmap[r]], values: B.regimes[r].two_way.map((v) => +(v * 100).toFixed(2)), bold: k === 0 }));
    lineChart($("rgBrChart"), B.years, ser, { min: 0, label: L("Breite des Handels", "Breadth of trade"), unit: "%" });
    FIGDATA.rgbr = { header: [L("Jahr", "Year"), ...ser.map((x) => x.label + " (%)")], rows: B.years.map((y, i) => [y, ...ser.map((x) => x.values[i])]) };
  }

  async function renderMittelstand() {
    const M = await getJSON("data/mittelstand.json");
    const pn = (p) => ({ WORLD: L("Welt", "World"), INT_EU: L("EU-Binnenmarkt", "EU single market"), EXT_EU: L("außerhalb der EU", "outside the EU") })[p] || cname(M.iso[p]) || p;
    const ps = $("msPartner");
    if (!ps.dataset.ready) {
      ps.dataset.ready = "1"; ps.innerHTML = M.partners.map((p) => `<option value="${p}"${p === "US" ? " selected" : ""}>${esc(pn(p))}</option>`).join("");
      ["msFlow", "msPartner"].forEach((i) => $(i).addEventListener("change", () => renderMittelstand()));
    }
    const flow = $("msFlow").value, partner = ps.value, ys = M.years, li = ys.length - 1, yl = ys[li];
    const de = M.by_partner[`DE_${flow}_THS_EUR`], eu = M.by_partner[`EU_${flow}_THS_EUR`], nr = M.by_partner["DE_EXP_NR_ENT"];
    const sh = (o, p) => o[p] ? o[p].share[li] : null, S = M.summary, pc = (v, d = 0) => v === null ? "–" : `${fmt(v * 100, d)} %`;
    $("msAnswer").textContent = L(`Kleine und mittlere Unternehmen tragen ${pc(S[0])} der deutschen Exporte (EU: ${pc(sh(M.by_partner.EU_EXP_THS_EUR, "WORLD"))}), in die USA nur ${pc(S[1])} und nach China ${pc(S[2])}. Vom Exportrückgang in die USA durch die Zölle tragen sie rund ${pc(S[3])}, von den Exporten unter Preisdruck aus China ${pc(S[4])}. Stärker hängen sie bei den Importen an China: ${pc(S[5])} der Importe aus China gehen an KMU, gegenüber ${pc(S[6])} aller Importe.`,
      `Small and medium-sized enterprises account for ${pc(S[0])} of German exports (EU: ${pc(sh(M.by_partner.EU_EXP_THS_EUR, "WORLD"))}), only ${pc(S[1])} of exports to the US and ${pc(S[2])} of exports to China. They carry about ${pc(S[3])} of the tariff-driven fall in exports to the US and ${pc(S[4])} of exports under Chinese price pressure. They depend more on China for imports: ${pc(S[5])} of imports from China go to SMEs, against ${pc(S[6])} of all imports.`);
    const tile = (big, label, sub) => `<div class="kpi"><span class="kn">${esc(label)}</span><span class="kv">${big}</span><span class="ks">${esc(sub)}</span></div>`;
    $("msFacts").innerHTML = [
      tile(pc(S[0]), L("KMU-Anteil an den Exporten", "SME share of exports"), `${yl}, ${L("Welt", "world")}`),
      tile(nr.WORLD ? Math.round(nr.WORLD.total[li]).toLocaleString(LOC) : "–", L("exportierende Unternehmen", "exporting enterprises"), L(`davon ${pc(nr.WORLD.share[li])} KMU`, `of which ${pc(nr.WORLD.share[li])} SMEs`)),
      tile(pc(S[3]), L("KMU-Anteil am US-Zollverlust", "SME share of US tariff loss"), L(`von ${fmt(M.us_loss_bn, 0)} Mrd. USD (Industrie)`, `of USD ${fmt(M.us_loss_bn, 0)} bn (manufacturing)`)),
      tile(pc(S[5]), L("KMU-Anteil an Importen aus China", "SME share of imports from China"), L(`alle Importe: ${pc(S[6])}`, `all imports: ${pc(S[6])}`)),
    ].join("");
    // partner bars
    const P = M.partners.filter((p) => de[p] || eu[p]), W = 860, rowH = 24, m = { l: 200, r: 50, t: 34, b: 26 }, H = m.t + m.b + rowH * P.length;
    const mx = Math.ceil(Math.max(...P.flatMap((p) => [sh(de, p) || 0, sh(eu, p) || 0])) * 10) / 10, XS = (v) => m.l + v / mx * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L("KMU-Anteil nach Partner", "SME share by partner"))}">`;
    s += `<rect x="${m.l}" y="6" width="12" height="12" fill="#002060"/><text x="${m.l + 18}" y="16">${L("Deutschland", "Germany")}</text><rect x="${m.l + 140}" y="6" width="12" height="12" fill="#a6a6a6"/><text x="${m.l + 158}" y="16">EU27</text>`;
    niceTicks(0, mx * 100, 5).forEach((tk) => { s += `<line class="grid" x1="${XS(tk / 100)}" x2="${XS(tk / 100)}" y1="${m.t - 4}" y2="${H - m.b}"/><text x="${XS(tk / 100)}" y="${H - 8}" text-anchor="middle">${tk}</text>`; });
    P.forEach((p, r) => {
      const y = m.t + r * rowH, a = sh(de, p), b = sh(eu, p);
      s += `<text x="${m.l - 8}" y="${y + rowH / 2 + 4}" text-anchor="end"${p === partner ? ' font-weight="600"' : ""}>${esc(pn(p))}</text>`;
      if (a !== null) s += `<rect x="${m.l}" y="${y + 3}" width="${XS(a) - m.l}" height="${(rowH - 6) / 2}" fill="#002060"><title>${esc(pn(p))}, ${L("Deutschland", "Germany")}: ${pc(a, 1)}</title></rect>`;
      if (b !== null) s += `<rect x="${m.l}" y="${y + 3 + (rowH - 6) / 2}" width="${XS(b) - m.l}" height="${(rowH - 6) / 2}" fill="#a6a6a6"><title>${esc(pn(p))}, EU27: ${pc(b, 1)}</title></rect>`;
      if (a !== null) s += `<text x="${XS(Math.max(a, b || 0)) + 6}" y="${y + rowH / 2 + 4}">${fmt(a * 100, 0)}</text>`;
    });
    $("msChart").innerHTML = s + "</svg>";
    $("msTitle").textContent = L(`KMU-Anteil an den ${flow === "EXP" ? "Exporten" : "Importen"} nach Partner, ${yl}, in %`, `SME share of ${flow === "EXP" ? "exports" : "imports"} by partner, ${yl}, in %`);
    FIGDATA.ms = { header: [L("Partner", "Partner"), L("Deutschland (%)", "Germany (%)"), "EU27 (%)"], rows: P.map((p) => [pn(p), sh(de, p) === null ? "" : +(sh(de, p) * 100).toFixed(1), sh(eu, p) === null ? "" : +(sh(eu, p) * 100).toFixed(1)]) };
    // time series
    const ser = [{ label: L("Deutschland", "Germany"), color: "#002060", values: (de[partner] ? de[partner].share : ys.map(() => null)).map((v) => v === null ? null : +(v * 100).toFixed(2)), bold: true },
      { label: "EU27", color: "#a6a6a6", values: (eu[partner] ? eu[partner].share : ys.map(() => null)).map((v) => v === null ? null : +(v * 100).toFixed(2)) }];
    lineChart($("msTsChart"), ys, ser, { min: 0, label: L("KMU-Anteil", "SME share"), unit: "%" });
    $("msTsTitle").textContent = L(`KMU-Anteil an den ${flow === "EXP" ? "Exporten" : "Importen"}, Partner: ${pn(partner)}, in %`, `SME share of ${flow === "EXP" ? "exports" : "imports"}, partner: ${pn(partner)}, in %`);
    FIGDATA.msts = { header: [L("Jahr", "Year"), ...ser.map((x) => x.label + " (%)")], rows: ys.map((y, i) => [y, ...ser.map((x) => x.values[i] === null ? "" : x.values[i])]) };
    // activities
    const A = (M.by_activity.EXT_EU || []).filter((r) => r[0] !== "TOTAL"), AH = 34 + 26 + 22 * A.length, am = { l: 230, r: 120 };
    const AX = (v) => am.l + v * (W - am.l - am.r);
    let c = `<svg viewBox="0 0 ${W} ${AH}" role="img" aria-label="${esc(L("KMU-Anteil nach Branche", "SME share by industry"))}">`;
    [0, 0.25, 0.5, 0.75, 1].forEach((tk) => { c += `<line class="grid" x1="${AX(tk)}" x2="${AX(tk)}" y1="28" y2="${AH - 26}"/><text x="${AX(tk)}" y="${AH - 8}" text-anchor="middle">${tk * 100}</text>`; });
    A.forEach((r, k) => {
      const y = 30 + k * 22, nm = M.nace[r[0]] ? M.nace[r[0]][EN ? 1 : 0] : r[0];
      c += `<text x="${am.l - 8}" y="${y + 15}" text-anchor="end">${esc(nm)}</text><rect x="${am.l}" y="${y + 3}" width="${AX(r[1]) - am.l}" height="16" fill="${r[0].startsWith("G") ? "#5b9bd5" : "#002060"}"><title>${esc(nm)}: ${pc(r[1], 1)}</title></rect>`;
      c += `<text x="${AX(r[1]) + 6}" y="${y + 15}">${fmt(r[1] * 100, 0)} % · ${L(`${fmt(r[2], 1)} Mrd. EUR`, `EUR ${fmt(r[2], 1)} bn`)}</text>`;
    });
    $("msActChart").innerHTML = c + "</svg>";
    $("msActTitle").textContent = L(`KMU-Anteil an den Exporten außerhalb der EU nach Branche, ${M.activity_year}, in %`, `SME share of exports outside the EU by industry, ${M.activity_year}, in %`);
    FIGDATA.msact = { header: [L("Branche", "Industry"), L("KMU-Anteil (%)", "SME share (%)"), L("Exporte, Mrd. EUR", "Exports, EUR bn")], rows: A.map((r) => [M.nace[r[0]] ? M.nace[r[0]][EN ? 1 : 0] : r[0], +(r[1] * 100).toFixed(1), r[2]]) };
  }

  async function renderRegions() {
    const [E, H, K, N, I, X, U] = await Promise.all([getJSON("data/regional_exposure.json"), getJSON("data/regional_history.json"), getJSON("data/kreise_energy.json"), getJSON("data/kreise_netze.json"), getJSON("data/kreise_infra.json"), getJSON("data/kreise_export.json"), getJSON("data/kreise_us.json")]);
    const lay = $("regLayer"), ysel = $("regYear"), zsel = $("regZoom");
    if (!lay.dataset.ready) {
      lay.dataset.ready = "1"; ysel.innerHTML = H.years.filter((y) => y % 5 === 0 || y === H.years[H.years.length - 1]).map((y) => `<option${y === 2024 ? " selected" : ""}>${y}</option>`).join("");
      [lay, ysel, zsel].forEach((s) => s.addEventListener("change", () => renderRegions()));
    }
    const k = lay.value, RW = k === "rw" ? await getJSON("data/roses_wolf.json") : null, want = k === "rw" ? "rw" : "gdp";
    if (ysel.dataset.kind !== want) {
      ysel.dataset.kind = want;
      const ys = want === "rw" ? RW.years : H.years.filter((y) => y % 5 === 0 || y === H.years[H.years.length - 1]), def = want === "rw" ? 2021 : 2024;
      ysel.innerHTML = ys.map((y) => `<option${y === def ? " selected" : ""}>${y}</option>`).join("");
    }
    const yr = +ysel.value, yi = H.years.indexOf(yr), ri = RW ? RW.years.indexOf(yr) : -1;
    ysel.hidden = $("regYearLab").hidden = k !== "gdp" && k !== "rw";
    const kre = k.startsWith("k_");
    zsel.hidden = $("regZoom").previousElementSibling.hidden = kre || k === "rw";
    const red = ["#7f0000", "#c00000", "#e06666", "#f4b183", "#fce4d6", "#deebf7", "#5b9bd5"], blue = ["#fce4d6", "#f2f2f2", "#deebf7", "#9dc3e6", "#5b9bd5", "#2e75b6", "#002060"];
    const seq = ["#deebf7", "#9dc3e6", "#5b9bd5", "#2e75b6", "#1f4e79", "#002060"];
    const C = {
      us: { bins: [-9, -0.6, -0.45, -0.3, -0.15, 0, 0.15, 9], cols: red, unit: "%", dec: 2, get: (g) => E.regions[g] && E.regions[g].us,
        t: L("US-Zölle (Stand August 2026): Produktion nach regionaler Branchenstruktur, in %", "US tariffs (August 2026): output by regional industry mix, in %"),
        ask: L("Wo treffen die US-Zölle die Produktion am stärksten?", "Where do US tariffs hit output hardest?") },
      cn: { bins: [-9, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 9], cols: blue, unit: "%", dec: 2, get: (g) => E.regions[g] && E.regions[g].cn,
        t: L("Lieferstopp Chinas bei abhängigen Waren: Produktion, in %", "Chinese stop of dependent goods: output, in %"),
        ask: L("Wo ersetzt heimische Produktion fehlende Importe aus China?", "Where does domestic output replace missing imports from China?") },
      rs: { bins: [-9, 0, 0.02, 0.04, 0.06, 0.08, 0.1, 9], cols: blue, unit: "%", dec: 2, get: (g) => E.regions[g] && E.regions[g].rs,
        t: L("Umleitung um das Rote Meer wie 2024: Produktion, in %", "Red Sea rerouting as in 2024: output, in %"),
        ask: L("Welche Regionen gewinnen oder verlieren durch längere Seewege?", "Which regions gain or lose from longer sea routes?") },
      en: { bins: [0, 0.01, 0.02, 0.04, 0.06, 0.08, 1], cols: seq, unit: "%", dec: 1, scale: 100, get: (g) => E.regions[g] && E.regions[g].en,
        t: L("Anteil energieintensiver Industrien an der Beschäftigung, in %", "Share of energy-intensive industries in employment, in %"),
        ask: L("Wo hängen viele Arbeitsplätze an teurer Energie?", "Where do many jobs depend on costly energy?") },
      gdp: { bins: [0, 50, 75, 90, 110, 125, 150, 1e9], cols: ["#7f0000", "#e06666", "#fce4d6", "#f2f2f2", "#deebf7", "#5b9bd5", "#002060"], unit: "", dec: 0, get: (g) => H.gdp_index[g] && H.gdp_index[g][yi],
        t: L(`BIP je Einwohner ${yr}, Mittel aller Regionen = 100`, `GDP per head ${yr}, mean of all regions = 100`),
        ask: L("Wie haben sich Europas Regionen seit 1980 entwickelt?", "How have Europe's regions developed since 1980?") },
      rw: { bins: [0, 50, 75, 90, 110, 125, 150, 1e9], cols: ["#7f0000", "#e06666", "#fce4d6", "#f2f2f2", "#deebf7", "#5b9bd5", "#002060"], unit: "", dec: 0, get: (g) => RW && RW.idx[g] ? RW.idx[g][ri] : null,
        t: L(`BIP je Einwohner ${yr} nach Rosés und Wolf, Mittel der 173 Regionen = 100`, `GDP per head ${yr} after Rosés and Wolf, mean of the 173 regions = 100`),
        ask: L("Wie haben sich Europas Regionen seit 1900 entwickelt?", "How have Europe's regions developed since 1900?") },
      coh: { bins: [0, 1000, 2500, 5000, 10000, 15000, 1e9], cols: seq, unit: " EUR", dec: 0, get: (g) => H.cohesion_pc[g],
        t: L("EU-Kohäsionszahlungen 1989 bis 2023 je Einwohner, EUR", "EU cohesion payments 1989 to 2023 per head, EUR"),
        ask: L("Wohin flossen die EU-Fördermittel?", "Where did EU cohesion funds go?") },
      port: { bins: [0, 1, 5000, 20000, 50000, 100000, 1e12], cols: ["#f2f2f2", "#deebf7", "#9dc3e6", "#5b9bd5", "#1f4e79", "#002060"], unit: L(" Tsd. t", " kt"), dec: 0, get: (g) => H.ports_kt[g] === undefined ? 0 : H.ports_kt[g],
        t: L("Güterumschlag der Seehäfen nach Region, Tausend Tonnen", "Seaport cargo throughput by region, thousand tonnes"),
        ask: L("Über welche Regionen läuft der Seehandel?", "Through which regions does sea trade pass?") },
      k_sol: { bins: [0, 0.5, 1, 1.5, 2, 3, 99], cols: seq, unit: " kW", dec: 1, get: (g) => K.kreise[g] && K.kreise[g].sol,
        t: L(`Photovoltaik je Einwohner nach Kreisen, ${K.stand || "Ende 2025"}, kW`, `Solar PV per inhabitant by district, ${(K.stand || "Ende 2025").replace("Ende ", "end-")}, kW`),
        ask: L("Wo steht der Solarstrom?", "Where is solar power installed?") },
      k_win: { bins: [0, 0.1, 0.5, 1, 2, 4, 999], cols: seq, unit: " kW", dec: 1, get: (g) => K.kreise[g] && K.kreise[g].win,
        t: L(`Windkraft an Land je Einwohner nach Kreisen, ${K.stand || "Ende 2025"}, kW`, `Onshore wind per inhabitant by district, ${(K.stand || "Ende 2025").replace("Ende ", "end-")}, kW`),
        ask: L("Wo steht die Windkraft?", "Where is wind power installed?") },
      k_ren: { bins: [0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.01], cols: seq, unit: "%", dec: 0, scale: 100, get: (g) => K.kreise[g] && K.kreise[g].ren,
        t: L(`Anteil erneuerbarer Energien an der installierten Leistung nach Kreisen, ${K.stand || "Ende 2025"}, %`, `Renewable share of installed capacity by district, ${(K.stand || "Ende 2025").replace("Ende ", "end-")}, %`),
        ask: L("Wo dominiert noch fossile Erzeugung?", "Where does fossil generation still dominate?") },
      k_lig: { bins: [0, 1, 500, 1000, 2000, 3000, 1e9], cols: ["#f2f2f2", "#fce4d6", "#f4b183", "#e06666", "#c00000", "#7f0000"], unit: " MW", dec: 0, get: (g) => K.kreise[g] && K.kreise[g].lig,
        t: L(`Braunkohlekraftwerke nach Kreisen, Leistung ${K.stand || "Ende 2025"}, MW`, `Lignite power plants by district, capacity ${(K.stand || "Ende 2025").replace("Ende ", "end-")}, MW`),
        ask: L("Wo hängt die Region am Braunkohleausstieg?", "Which regions depend on the lignite phase-out?") },
      k_us: { bins: [-99, -3, -2.5, -2, -1.5, -1, 99], cols: ["#7f0000", "#c00000", "#e06666", "#f4b183", "#fce4d6", "#f2f2f2"], unit: "%", dec: 2, get: (g) => U.kreise[g] && U.kreise[g].dm,
        t: L("US-Zölle (Stand August 2026): Produktion der Industrie nach Kreisen, Veränderung in %", "US tariffs (August 2026): manufacturing output by district, change in %"),
        ask: L("Welche Kreise treffen die US-Zölle am stärksten?", "Which districts do US tariffs hit hardest?") },
      k_usl: { bins: [0, 100, 250, 500, 1000, 2000, 1e9], cols: ["#f2f2f2", "#fce4d6", "#f4b183", "#e06666", "#c00000", "#7f0000"], unit: " EUR", dec: 0, get: (g) => U.kreise[g] && U.kreise[g].lpc,
        t: L("US-Zölle (Stand August 2026): Produktionsverlust der Industrie je Einwohner nach Kreisen, EUR", "US tariffs (August 2026): manufacturing output loss per inhabitant by district, EUR"),
        ask: L("Wo kosten die US-Zölle je Einwohner am meisten?", "Where do US tariffs cost most per inhabitant?") },
      k_exq: { bins: [0, 0.2, 0.3, 0.4, 0.5, 0.6, 1.01], cols: seq, unit: "%", dec: 0, scale: 100, get: (g) => X.kreise[g] && X.kreise[g].quote_2024,
        t: L("Exportquote der Industrie nach Kreisen 2024, Auslandsumsatz in % des Umsatzes", "Manufacturing export ratio by district 2024, foreign sales in % of sales"),
        ask: L("Wo hängt die Industrie am stärksten am Ausland?", "Where does industry depend most on foreign markets?") },
      k_exd: { bins: [-99, -10, -3, 0, 3, 10, 99], cols: ["#c00000", "#f4b183", "#f2f2f2", "#deebf7", "#5b9bd5", "#002060"], unit: L(" Pp.", " pp"), dec: 1, get: (g) => X.kreise[g] && X.kreise[g].d_2012,
        t: L("Veränderung der Exportquote der Industrie 2012 bis 2024 nach Kreisen, Prozentpunkte", "Change in manufacturing export ratio 2012 to 2024 by district, percentage points"),
        ask: L("Wo ist die Industrie internationaler geworden?", "Where has industry become more international?") },
      k_exp: { bins: [0, 2000, 5000, 10000, 20000, 40000, 1e9], cols: seq, unit: " EUR", dec: 0, get: (g) => X.kreise[g] && X.kreise[g].ausl_pc,
        t: L("Auslandsumsatz der Industrie je Einwohner nach Kreisen 2024, EUR", "Manufacturing foreign sales per inhabitant by district 2024, EUR"),
        ask: L("Wo wird am meisten für das Ausland produziert?", "Where is most produced for foreign markets?") },
      ...Object.fromEntries([["k_ehv", "ehv_km", [0, 0.01, 2, 4, 6, 9, 999], " km/100 km²", 1, L("Höchstspannungsleitungen (220 und 380 kV) nach Kreisen, km je 100 km²", "Extra-high-voltage lines (220 and 380 kV) by district, km per 100 km²"), L("Wo verlaufen die großen Stromtrassen?", "Where do the main power corridors run?")],
        ["k_hvl", "hv_km", [0, 4, 8, 12, 16, 22, 999], " km/100 km²", 1, L("110-kV-Leitungen nach Kreisen, km je 100 km²", "110 kV lines by district, km per 100 km²"), L("Wie dicht ist das regionale Hochspannungsnetz?", "How dense is the regional high-voltage grid?")],
        ["k_rel", "rail_el", [0, 25, 50, 65, 80, 90, 101], "%", 0, L("Elektrifizierter Anteil der Bahnstrecken nach Kreisen, %", "Electrified share of railway lines by district, %"), L("Wo fahren noch Dieselzüge?", "Where do diesel trains still run?")],
        ["k_bab", "bab_km", [0, 0.01, 2, 4, 6, 9, 999], " km/100 km²", 1, L("Autobahnen nach Kreisen, km je 100 km²", "Motorways by district, km per 100 km²"), L("Welche Kreise liegen abseits der Autobahn?", "Which districts lie away from motorways?")]]
        .map(([id, f, b, u, d, tt, aa]) => [id, { bins: b, cols: seq, unit: u, dec: d, get: (g) => I[g] && I[g][f], t: tt, ask: aa }])),
      ...Object.fromEntries([["k_gig", "hh_gigabit", L("Haushalte mit mindestens 1 Gbit/s nach Kreisen, Juni 2026, %", "Households with at least 1 Gbit/s by district, June 2026, %"), L("Wo gibt es Gigabit-Internet zu Hause?", "Where is gigabit internet available at home?")],
        ["k_gwf", "gw_ftth", L("Gewerbegebiete mit Glasfaser bis ins Gebäude nach Kreisen, Juni 2026, %", "Industrial estates with fibre to the building by district, June 2026, %"), L("Haben die Gewerbegebiete Glasfaser?", "Do industrial estates have fibre?")],
        ["k_r4g", "rail_4g", L("4G-Versorgung entlang der Schienenwege nach Kreisen, bester Netzbetreiber, %", "4G coverage along railways by district, best operator, %"), L("Wo bricht im Zug das Netz ab?", "Where does the mobile signal drop on the train?")],
        ["k_b5g", "bab_5g", L("5G-Versorgung entlang der Autobahnen nach Kreisen, bester Netzbetreiber, %", "5G coverage along motorways by district, best operator, %"), L("Wie gut ist 5G an den Autobahnen?", "How good is 5G along motorways?")]]
        .map(([id, f, tt, aa]) => [id, { bins: [0, 25, 50, 75, 90, 95, 101], cols: ["#c00000", "#f4b183", "#deebf7", "#9dc3e6", "#2e75b6", "#002060"], unit: "%", dec: 0, get: (g) => N[g] && N[g][f], t: tt, ask: aa }])) }[k];
    const sc = C.scale || 1, colOf = (v) => { if (v === null || v === undefined || isNaN(v)) return "#bfbfbf"; for (let i = 0; i < C.cols.length; i++) if (v < C.bins[i + 1]) return C.cols[i]; return C.cols[C.cols.length - 1]; };
    const nm = (g) => (kre && K.kreise[g] && K.kreise[g].n) || (RW && RW.names[g]) || (E.regions[g] && E.regions[g].n) || H.names[g] || g;
    const fv = (v) => v === null || v === undefined || isNaN(v) ? "–" : `${fmt(v * sc, C.dec)}${C.unit === "%" ? " %" : C.unit}`;
    // viewbox: full EU or Germany window (EU map coordinates, 600 wide)
    const W = 600, Hh = E.height, vb = zsel.value === "de" ? [255 - 4, 120, 85, 115] : [0, 0, W, Hh];
    const deScale = [(4020000 - 2500000) / (7400000 - 2500000) * W, (5450000 - 3580000) / (7400000 - 2500000) * W, (4700000 - 4020000) / (7400000 - 2500000) * W, (3580000 - 2650000) / (7400000 - 2500000) * W];
    const box = kre ? [0, 0, K.width, K.height] : k === "rw" ? [0, 0, RW.width, RW.height] : zsel.value === "de" ? deScale : vb;
    let s = `<svg viewBox="${box.map((x) => x.toFixed(1)).join(" ")}" role="img" aria-label="${esc(C.t)}" style="background:#fff;max-height:760px">`;
    const paths = kre ? K.paths : k === "rw" ? RW.paths : E.paths;
    Object.keys(paths).forEach((g) => { const v = C.get(g); s += `<path d="${paths[g]}" fill="${colOf(v)}" stroke="#fff" stroke-width="${kre ? 0.4 : zsel.value === "de" ? 0.08 : 0.25}" data-g="${g}"><title>${esc(nm(g))}: ${fv(v)}</title></path>`; });
    $("regMap").innerHTML = s + "</svg>";
    $("regMap").querySelectorAll("path").forEach((p) => p.addEventListener("mousemove", () => { const g = p.dataset.g; $("regHover").textContent = `${nm(g)} (${g}): ${fv(C.get(g))}`; }));
    $("regLegend").innerHTML = `<div class="hint">${C.cols.map((c, i) => `<div><span style="display:inline-block;width:14px;height:12px;background:${c};border:1px solid #d9d9d9;vertical-align:middle"></span> ${i === 0 && C.bins[1] === 0.01 ? L("keine", "none") : i === 1 && C.bins[1] === 0.01 ? L("über 0 bis ", "above 0 to ") + fmt(C.bins[2] * sc, C.dec) : i === 0 ? L("unter ", "below ") + fmt(C.bins[1] * sc, C.dec) : i === C.cols.length - 1 ? fmt(C.bins[i] * sc, C.dec) + L(" und mehr", " and more") : fmt(C.bins[i] * sc, C.dec) + " – " + fmt(C.bins[i + 1] * sc, C.dec)}</div>`).join("")}<div><span style="display:inline-block;width:14px;height:12px;background:#bfbfbf;vertical-align:middle"></span> ${L("keine Daten", "no data")}</div></div>`;
    $("regTitle").textContent = C.t; $("regAsk").textContent = C.ask;
    const all = Object.keys(paths).map((g) => [g, C.get(g)]).filter((r) => r[1] !== null && r[1] !== undefined && !isNaN(r[1]));
    const de = all.filter((r) => r[0].startsWith("DE")).sort((a, b) => a[1] - b[1]);
    const INF = ["k_ehv", "k_hvl", "k_rel", "k_bab"], none = all.filter((r) => r[1] === 0).length, avg = all.reduce((t, r) => t + r[1], 0) / all.length;
    if (kre && ["k_gig", "k_gwf", "k_r4g", "k_b5g"].includes(k)) $("regSrc").textContent = L("Quelle: eigene Berechnungen auf Basis des Breitbandatlas (Gigabit-Grundbuch, Bundesnetzagentur) und Destatis; Kartengrundlage: © EuroGeographics (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on the broadband atlas (Gigabit-Grundbuch, Federal Network Agency) and Destatis; base map: © EuroGeographics (GISCO). Licence of the figure: CC BY 4.0.");
    else if (kre && ["k_us", "k_usl"].includes(k)) $("regSrc").textContent = L("Quelle: eigene Berechnungen mit dem Caliendo-Parro-Modell (OECD ICIO 2022), Eurostat (Branchenstruktur NUTS 2) und der Regionaldatenbank Deutschland (Exportquote je Kreis); Kartengrundlage: © EuroGeographics (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations with the Caliendo-Parro model (OECD ICIO 2022), Eurostat (industry mix NUTS 2) and the Regional Database Germany (export ratio by district); base map: © EuroGeographics (GISCO). Licence of the figure: CC BY 4.0.");
    else if (kre && ["k_exq", "k_exd", "k_exp"].includes(k)) $("regSrc").textContent = L("Quelle: eigene Berechnungen auf Basis der Regionaldatenbank Deutschland (Tabelle 42111-04-02-4) und Destatis; Kartengrundlage: © EuroGeographics (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on the Regional Database Germany (table 42111-04-02-4) and Destatis; base map: © EuroGeographics (GISCO). Licence of the figure: CC BY 4.0.");
    else if (kre && INF.includes(k)) $("regSrc").textContent = L("Quelle: eigene Berechnungen auf Basis von OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL 1.0); Kartengrundlage: © EuroGeographics (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0); base map: © EuroGeographics (GISCO). Licence of the figure: CC BY 4.0.");
    else if (kre) $("regSrc").textContent = L("Quelle: eigene Berechnungen auf Basis des Marktstammdatenregisters (Bundesnetzagentur, Datenlizenz Deutschland 2.0) und Destatis; Kartengrundlage: © EuroGeographics (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on the market master data register (Federal Network Agency, Data licence Germany 2.0) and Destatis; base map: © EuroGeographics (GISCO). Licence of the figure: CC BY 4.0.");
    const srt = [...all].sort((a, b) => a[1] - b[1]);
    const S = H.summary, yix = (y) => S.year.indexOf(y);
    const G = K.germany, gi = Math.max(0, G.years.indexOf(+(K.stand || "Ende 2025").slice(-4)));
    const ans = {
      rw: RW ? L(`Seit 1900 sind sich Europas Regionen nähergekommen: Die Streuung des logarithmierten BIP je Einwohner sank von ${fmt(RW.sigma[0], 2)} auf ${fmt(RW.sigma[RW.sigma.length - 1], 2)}, arme Regionen wuchsen schneller. Die Rangfolge hat sich dabei stark verschoben (Rangkorrelation 1900 zu 2021 nur ${fmt(RW.rho, 2)}). ${yr}: vorn ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}), hinten ${nm(srt[0][0])} (${fv(srt[0][1])}); deutsche Regionen im Mittel bei ${fmt(RW.de_idx[ri], 0)}.`,
        `Since 1900 Europe's regions have converged: the dispersion of log GDP per head fell from ${fmt(RW.sigma[0], 2)} to ${fmt(RW.sigma[RW.sigma.length - 1], 2)}, poor regions grew faster. Rankings have shifted a lot (rank correlation 1900 to 2021 only ${fmt(RW.rho, 2)}). ${yr}: top ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}), bottom ${nm(srt[0][0])} (${fv(srt[0][1])}); German regions at ${fmt(RW.de_idx[ri], 0)} on average.`) : "",
      k_us: L(`Im Modell verliert die Industrie in den Kreisen zwischen 0,3 und 3,5 % ihrer Produktion, im Mittel 1,5 %, zusammen rund ${fmt(U.total_mio / 1000, 0)} Mrd. EUR im Jahr. Am stärksten trifft es exportstarke Kreise wie ${nm(srt[0][0])} (${fv(srt[0][1])}), ${nm(srt[1][0])} und ${nm(srt[2][0])}.`, `In the model manufacturing loses between 0.3 and 3.5 % of output across districts, 1.5 % at the median, about EUR ${fmt(U.total_mio / 1000, 0)} bn a year in total. Export-heavy districts are hit hardest, such as ${nm(srt[0][0])} (${fv(srt[0][1])}), ${nm(srt[1][0])} and ${nm(srt[2][0])}.`),
      k_usl: L(`Je Einwohner ist der Verlust in Industriestandorten am größten: ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}), ${nm(srt[srt.length - 2][0])} und ${nm(srt[srt.length - 3][0])}. In Kreisen mit wenig Industrie liegt er meist bei rund 100 EUR.`, `Per inhabitant the loss is largest at industrial sites: ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}), ${nm(srt[srt.length - 2][0])} and ${nm(srt[srt.length - 3][0])}. In districts with little industry it is mostly around EUR 100.`),
      k_exq: L(`Die Industrie setzt ${fmt(100 * X.germany.quote[X.germany.quote.length - 1], 0)} % ihres Umsatzes im Ausland ab (1999: ${fmt(100 * X.germany.quote[0], 0)} %). Am höchsten ist die Exportquote in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}) und ${nm(srt[srt.length - 2][0])}, am niedrigsten in ${nm(srt[0][0])} (${fv(srt[0][1])}).`, `Manufacturing sells ${fmt(100 * X.germany.quote[X.germany.quote.length - 1], 0)} % of its output abroad (1999: ${fmt(100 * X.germany.quote[0], 0)} %). The export ratio is highest in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}) and ${nm(srt[srt.length - 2][0])}, lowest in ${nm(srt[0][0])} (${fv(srt[0][1])}).`),
      k_exd: L(`Seit 2012 ist die Exportquote in ${all.filter((r) => r[1] > 0).length} von ${all.length} Kreisen gestiegen. Den größten Sprung machte ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}); stark gesunken ist sie in ${nm(srt[0][0])} (${fv(srt[0][1])}). Hinter solchen Ausschlägen stehen vermutlich einzelne Großbetriebe.`, `Since 2012 the export ratio has risen in ${all.filter((r) => r[1] > 0).length} of ${all.length} districts. The biggest jump was in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}); it fell sharply in ${nm(srt[0][0])} (${fv(srt[0][1])}). Such swings probably reflect single large plants.`),
      k_exp: L(`Je Einwohner exportiert die Industrie am meisten in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}), ${nm(srt[srt.length - 2][0])} und ${nm(srt[srt.length - 3][0])}: Standorte einzelner Großunternehmen.`, `Per inhabitant, manufacturing exports most in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}), ${nm(srt[srt.length - 2][0])} and ${nm(srt[srt.length - 3][0])}: sites of single large companies.`),
      k_ehv: L(`Das Übertragungsnetz (220 und 380 kV) ist in OpenStreetMap rund ${fmt(Math.round(((I._meta || {}).ehv_km || 18300) / 100) * 100, 0)} Trassenkilometer lang; im Mittel der Kreise ${fv(avg)}. ${none} Kreise haben keine Höchstspannungsleitung; am dichtesten ist das Netz in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}).`, `The transmission grid (220 and 380 kV) is about ${fmt(Math.round(((I._meta || {}).ehv_km || 18300) / 100) * 100, 0)} route km long in OpenStreetMap; district average ${fv(avg)}. ${none} districts have no extra-high-voltage line; the grid is densest in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}).`),
      k_hvl: L(`Das 110-kV-Netz verteilt den Strom in die Regionen: rund ${fmt(Math.round(((I._meta || {}).hv_km || 43600) / 100) * 100, 0)} Trassenkilometer, im Mittel der Kreise ${fv(avg)}, am dichtesten in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}) und ${nm(srt[srt.length - 2][0])}.`, `The 110 kV grid distributes power into the regions: about ${fmt(Math.round(((I._meta || {}).hv_km || 43600) / 100) * 100, 0)} route km, district average ${fv(avg)}, densest in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}) and ${nm(srt[srt.length - 2][0])}.`),
      k_rel: L(`Rund zwei Drittel der Streckengleise sind elektrifiziert. ${none} Kreise haben gar keine elektrifizierte Strecke, darunter ${nm(srt[0][0])}, ${nm(srt[1][0])} und ${nm(srt[2][0])}.`, `About two thirds of running track is electrified. ${none} districts have no electrified line at all, among them ${nm(srt[0][0])}, ${nm(srt[1][0])} and ${nm(srt[2][0])}.`),
      k_bab: L(`Die Autobahnen sind in OpenStreetMap rund ${fmt(Math.round(((I._meta || {}).bab_km || 13300) / 100) * 100, 0)} km lang, nahe am amtlichen Wert. ${none} Kreise haben keinen eigenen Autobahnabschnitt; am dichtesten ist das Netz in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}).`, `Motorways are about ${fmt(Math.round(((I._meta || {}).bab_km || 13300) / 100) * 100, 0)} km long in OpenStreetMap, close to the official figure. ${none} districts have no motorway section of their own; the network is densest in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}).`),
      k_gig: L(`Im Mittel der Kreise können ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)} der Haushalte Gigabit-Anschlüsse buchen; Glasfaser bis ins Haus erreicht im Mittel nur ${fv(all.reduce((s, r) => s + ((N[r[0]] || {}).hh_ftth || 0), 0) / all.length)}. Am schlechtesten versorgt: ${nm(srt[0][0])} (${fv(srt[0][1])}).`, `On district average ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)} of households can book gigabit connections; fibre to the home reaches only ${fv(all.reduce((s, r) => s + ((N[r[0]] || {}).hh_ftth || 0), 0) / all.length)} on average. Worst served: ${nm(srt[0][0])} (${fv(srt[0][1])}).`),
      k_gwf: L(`Glasfaser bis ins Gebäude erreicht im Mittel der Kreise ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)} der Gewerbegebiete. Weit zurück liegen ${nm(srt[0][0])} (${fv(srt[0][1])}) und ${nm(srt[1][0])}.`, `Fibre to the building reaches ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)} of industrial estates on district average. Far behind are ${nm(srt[0][0])} (${fv(srt[0][1])}) and ${nm(srt[1][0])}.`),
      k_r4g: L(`Entlang der Schienen deckt der beste Netzbetreiber im Mittel der Kreise ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)} der Strecke mit 4G ab. Die größten Lücken: ${nm(srt[0][0])} (${fv(srt[0][1])}), ${nm(srt[1][0])} und ${nm(srt[2][0])}.`, `Along railways the best operator covers ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)} of the track with 4G on district average. Largest gaps: ${nm(srt[0][0])} (${fv(srt[0][1])}), ${nm(srt[1][0])} and ${nm(srt[2][0])}.`),
      k_b5g: L(`Die Autobahnen sind fast überall mit 5G versorgt (Mittel der Kreise ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)}). Lücken bleiben in ${nm(srt[0][0])} (${fv(srt[0][1])}) und ${nm(srt[1][0])}.`, `Motorways are almost fully covered by 5G (district average ${fv(all.reduce((s, r) => s + r[1], 0) / all.length)}). Gaps remain in ${nm(srt[0][0])} (${fv(srt[0][1])}) and ${nm(srt[1][0])}.`),
      k_sol: L(`Ende ${G.years[gi]} sind in Deutschland ${fmt(G.solar[gi], 0)} GW Photovoltaik installiert. Je Einwohner am meisten in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}) und ${nm(srt[srt.length - 2][0])}, am wenigsten in den Großstädten.`, `At end-${G.years[gi]} Germany has ${fmt(G.solar[gi], 0)} GW of solar PV installed. Per inhabitant most in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}) and ${nm(srt[srt.length - 2][0])}, least in the large cities.`),
      k_win: L(`Windkraft an Land (${fmt(G.wind[gi], 0)} GW) steht vor allem im Norden und Osten: an der Spitze ${nm(srt[srt.length - 1][0])} mit ${fv(srt[srt.length - 1][1])} je Einwohner. Im Süden bleibt sie gering.`, `Onshore wind (${fmt(G.wind[gi], 0)} GW) stands mainly in the north and east: top is ${nm(srt[srt.length - 1][0])} with ${fv(srt[srt.length - 1][1])} per inhabitant. In the south it remains small.`),
      k_ren: L(`In gut der Hälfte der Kreise stellen Erneuerbare über 90 % der installierten Leistung. Fossil geprägt bleiben Kraftwerksstandorte und Großstädte, etwa ${nm(srt[0][0])} (${fv(srt[0][1])}).`, `In just over half of all districts renewables provide over 90 % of installed capacity. Power-plant sites and large cities remain fossil-heavy, such as ${nm(srt[0][0])} (${fv(srt[0][1])}).`),
      k_lig: L(`Braunkohlekraftwerke (${fmt(G.lignite[gi], 1)} GW) konzentrieren sich auf wenige Kreise in der Lausitz, im Rheinischen und im Mitteldeutschen Revier; am meisten Leistung steht in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}).`, `Lignite plants (${fmt(G.lignite[gi], 1)} GW) concentrate in a few districts in Lusatia, the Rhineland and Central Germany; most capacity is in ${nm(srt[srt.length - 1][0])} (${fv(srt[srt.length - 1][1])}).`),
      us: L(`Am stärksten treffen die US-Zölle Regionen mit viel Industrie für den US-Markt: in Deutschland ${nm(de[0][0])} (${fv(de[0][1])}), ${nm(de[1][0])} und ${nm(de[2][0])}. Irische Regionen gewinnen im Modell, weil Produktion dorthin ausweicht.`, `US tariffs hit regions with much industry for the US market hardest: in Germany ${nm(de[0][0])} (${fv(de[0][1])}), ${nm(de[1][0])} and ${nm(de[2][0])}. Irish regions gain in the model as production shifts there.`),
      cn: L(`Fallen Chinas abhängige Waren weg, steigt die Produktion fast überall leicht, weil heimische Hersteller teurer einspringen; das Realeinkommen sinkt trotzdem. Am meisten produzieren ${nm(srt[srt.length - 1][0])} und ${nm(srt[srt.length - 2][0])} zusätzlich.`, `If China's dependent goods stop, output rises slightly almost everywhere because domestic producers step in at higher cost; real income still falls. ${nm(srt[srt.length - 1][0])} and ${nm(srt[srt.length - 2][0])} add most output.`),
      rs: L(`Längere Seewege verteuern Importe aus Asien; heimische Produktion ersetzt einen Teil davon. Die Effekte bleiben klein, am größten in ${nm(srt[srt.length - 1][0])}.`, `Longer sea routes make Asian imports dearer; domestic output replaces part of them. Effects stay small, largest in ${nm(srt[srt.length - 1][0])}.`),
      en: L(`In ${nm(srt[srt.length - 1][0])} arbeiten ${fv(srt[srt.length - 1][1])} der Beschäftigten in energieintensiven Industrien; in Deutschland ist der Anteil in ${nm(de[de.length - 1][0])} am höchsten (${fv(de[de.length - 1][1])}).`, `In ${nm(srt[srt.length - 1][0])} ${fv(srt[srt.length - 1][1])} of employees work in energy-intensive industries; in Germany the share is highest in ${nm(de[de.length - 1][0])} (${fv(de[de.length - 1][1])}).`),
      gdp: L(`Die Unterschiede zwischen Europas Kreisen und Regionen sind seit 2000 deutlich kleiner geworden: Die Streuung des logarithmierten BIP je Einwohner sank von ${fmt(S.sigma_nuts3[yix(2000)], 2)} auf ${fmt(S.sigma_nuts3[yix(2024)], 2)}. Ostdeutsche Kreise erreichten 1991 ${fmt(S.east_in_pct_of_west[yix(1991)], 0)} % des westdeutschen Niveaus, 2024 ${fmt(S.east_in_pct_of_west[yix(2024)], 0)} %.`, `Disparities between Europe's regions have narrowed markedly since 2000: the dispersion of log GDP per head fell from ${fmt(S.sigma_nuts3[yix(2000)], 2)} to ${fmt(S.sigma_nuts3[yix(2024)], 2)}. East German districts reached ${fmt(S.east_in_pct_of_west[yix(1991)], 0)} % of the West German level in 1991, ${fmt(S.east_in_pct_of_west[yix(2024)], 0)} % in 2024.`),
      coh: L(`Die meisten Mittel je Einwohner flossen nach Süd- und Osteuropa; in Deutschland nach ${nm(de[de.length - 1][0])} (${fv(de[de.length - 1][1])}) und in die übrigen ostdeutschen Länder. Ein Wachstumssprung an der 75-%-Schwelle ist mit diesen offenen Daten nicht sicher messbar.`, `Most funds per head went to Southern and Eastern Europe; in Germany to ${nm(de[de.length - 1][0])} (${fv(de[de.length - 1][1])}) and the other eastern Länder. A growth jump at the 75 % threshold cannot be measured reliably with these open data.`),
      port: L(`Der Seehandel konzentriert sich auf wenige Regionen: Rotterdam, Antwerpen, Algeciras und Hamburg. Deutschlands größter Hafen liegt in ${nm(de[de.length - 1][0])} (${fv(de[de.length - 1][1])}).`, `Sea trade concentrates in a few regions: Rotterdam, Antwerp, Algeciras and Hamburg. Germany's largest port is in ${nm(de[de.length - 1][0])} (${fv(de[de.length - 1][1])}).`) }[k];
    $("regAnswer").textContent = ans;
    const net = ["k_gig", "k_gwf", "k_r4g", "k_b5g"].includes(k);
    $("regExplain").textContent = ["k_us", "k_usl"].includes(k) ? L("Die Region (NUTS 2) liefert den Branchenmix der Industrie, das Modell die Produktionsänderung jeder Branche. Innerhalb der Region wird der Verlust mit der Exportquote des Kreises skaliert: Wer mehr ins Ausland verkauft, verliert mehr. Der Branchenmix einzelner Kreise ist geheim; der Auslandsumsatz umfasst alle Zielländer, nicht nur die USA. Betriebe mit 20 und mehr Beschäftigten.", "The region (NUTS 2) gives the manufacturing industry mix, the model the output change of each industry. Within the region the loss is scaled by the district's export ratio: districts selling more abroad lose more. The industry mix of single districts is confidential; foreign sales cover all destinations, not only the US. Establishments with 20 or more employees.") : ["k_exq", "k_exd", "k_exp"].includes(k) ? L("Regionaldatenbank: Betriebe des Verarbeitenden Gewerbes und Bergbaus mit 20 und mehr Beschäftigten, am Ort des Betriebs. Auslandsumsatz sind Lieferungen an Kunden im Ausland; Lieferungen an deutsche Exporteure zählen nicht dazu. Grau: Werte geheim gehalten, weil wenige Betriebe den Kreis prägen.", "Regional Database: manufacturing and mining establishments with 20 or more employees, at the establishment's location. Foreign sales are deliveries to customers abroad; deliveries to German exporters are not included. Grey: values suppressed because few establishments dominate the district.") : INF.includes(k) ? L(`OpenStreetMap, Stand ${(I._meta || {}).stand || "11/2026"}, je Bundesland abgefragt und auf die Kreise zugeschnitten. Leitungen: Trassenlänge, parallele Stromkreise auf einem Mast zählen einmal. Bahn: Streckengleise ohne Neben- und Abstellgleise, zweigleisige Strecken zählen doppelt. Autobahn: Fahrbahnlänge geteilt durch zwei. Gezeigt werden Dichten je Kreis; die Verläufe zeigt die Netzkarte unten.`, `OpenStreetMap, as of ${(I._meta || {}).stand || "11/2026"}, queried per Land and clipped to districts. Lines: route length, parallel circuits on one pylon count once. Rail: running track without sidings and yards, double-track lines count twice. Motorway: carriageway length divided by two. Densities per district are shown; the network map below shows the routes.`) : net ? L("Breitbandatlas der Bundesnetzagentur (Gigabit-Grundbuch), Stand Juni 2026. Mobilfunk entlang der Verkehrswege: Anteil der Strecke mit Versorgung im Fahrzeug beim besten der drei Netzbetreiber mit eigenem Netz (Telekom, Vodafone, Telefónica); die Versorgung durch irgendeinen Betreiber liegt mindestens so hoch.", "Federal Network Agency broadband atlas (Gigabit-Grundbuch), June 2026. Mobile coverage along transport routes: share of the route covered in the vehicle by the best of the three operators with own networks (Telekom, Vodafone, Telefónica); coverage by any operator is at least as high.") : kre ? L("Marktstammdatenregister der Bundesnetzagentur: alle Stromerzeugungsanlagen mit Gemeindeschlüssel, Bruttoleistung in Betrieb am Jahresende, nach Kreisen zusammengefasst. Windkraft auf See hat keinen Kreis und fehlt.", "Federal Network Agency market master data register: all generating units with municipality key, gross capacity in operation at year end, aggregated to districts. Offshore wind has no district and is missing.") : ["us", "cn", "rs"].includes(k)
      ? L("Verschiebe-Anteils-Ansatz nach Autor, Dorn und Hanson (2013) sowie Dauth, Findeisen und Südekum (2014): Die Modelländerung jeder Branche im jeweiligen Land wird mit ihrem Beschäftigungsanteil in der Region gewichtet (Eurostat, Strukturstatistik nach NUTS 2). Nur gewerbliche Wirtschaft; Landwirtschaft und öffentlicher Dienst fehlen. Annahme: Innerhalb eines Landes trifft ein Branchenschock alle Regionen gleich. Kreisdaten nach Branchen veröffentlichen weder Eurostat noch die Bundesagentur für Arbeit als Datei.", "Shift-share approach after Autor, Dorn and Hanson (2013) and Dauth, Findeisen and Suedekum (2014): each industry's model change in its country is weighted by its employment share in the region (Eurostat structural business statistics by NUTS 2). Business economy only; agriculture and the public sector are missing. Assumption: within a country an industry shock hits all regions alike. District data by industry are not published as files by Eurostat or the German employment agency.")
      : k === "rw" ? L("Rosés und Wolf schätzen das regionale BIP für Stichjahre aus Beschäftigung und Löhnen nach Sektoren (Geary-Methode) und gleichen es an die nationalen Werte an; in internationalen Dollar von 2011. Grenzen von heute, also auch für 1900 die heutigen Regionen. Norwegen 2021 ohne Bevölkerung für einige Regionen.", "Rosés and Wolf estimate regional GDP for benchmark years from sectoral employment and wages (Geary method), scaled to national totals; in 2011 international dollars. Today's boundaries, also for 1900. Norway 2021 lacks population for some regions.")
      : k === "gdp" ? L("ARDECO (JRC und EU-Kommission): BIP je Einwohner in Euro zu laufenden Preisen, relativ zum ungewichteten Mittel aller Regionen. Wechselkurse verzerren die Vergleiche über die Zeit, besonders um 1990 in Mittel- und Osteuropa. Ostdeutsche Regionen ab 1991.", "ARDECO (JRC and European Commission): GDP per head in euro at current prices, relative to the unweighted mean of all regions. Exchange rates distort comparisons over time, especially around 1990 in Central and Eastern Europe. East German regions from 1991.")
      : k === "coh" ? L("Historische EU-Zahlungen aus EFRE, ESF, Kohäsionsfonds und ELER, von der Kommission den Regionen zugeordnet, nominal, geteilt durch die letzte verfügbare Bevölkerung. Prüfung der 75-%-Schwelle als Regressionsdiskontinuität (wie Becker, Egger und von Ehrlich 2010) für 2007 bis 2013 und 2014 bis 2020: Weder bei den Zahlungen noch beim Wachstum ist der Sprung signifikant; Grenzänderungen der NUTS-Regionen und Übergangsregionen verwischen die Schwelle.", "Historic EU payments from ERDF, ESF, Cohesion Fund and EAFRD, allocated to regions by the Commission, nominal, divided by the latest available population. Test of the 75 % threshold as a regression discontinuity (as Becker, Egger and von Ehrlich 2010) for 2007 to 2013 and 2014 to 2020: neither payments nor growth jump significantly; NUTS boundary changes and transition regions blur the threshold.")
      : k === "en" ? L("Beschäftigte in Papier (C17), Mineralölverarbeitung (C19), Chemie (C20), Glas, Keramik und Steine (C23) sowie Metallerzeugung (C24) in % aller Beschäftigten der gewerblichen Wirtschaft. Ein grobes Maß für die Betroffenheit durch den Gaspreisschock 2022.", "Employment in paper (C17), refined petroleum (C19), chemicals (C20), glass, ceramics and stone (C23) and basic metals (C24) in % of business-economy employment. A rough measure of exposure to the 2022 gas price shock.")
      : L("Eurostat, Seeverkehr nach NUTS-2-Region: gelöschte und geladene Güter, Tausend Tonnen, letztes verfügbares Jahr.", "Eurostat, maritime transport by NUTS 2 region: goods loaded and unloaded, thousand tonnes, latest year.");
    $("regNote").textContent = k === "rw" ? L("173 Regionen in 16 Ländern Westeuropas (NUTS 2, teils NUTS 1); ohne Mittel- und Osteuropa.", "173 regions in 16 Western European countries (NUTS 2, partly NUTS 1); without Central and Eastern Europe.") : kre ? L("Kreise und kreisfreie Städte (NUTS 3, Stand 2024).", "Districts and district-free cities (NUTS 3, 2024).") : L("NUTS-2021-Regionen; EU-Ausschnitt ohne Gebiete in Übersee.", "NUTS 2021 regions; EU view without overseas territories.");
    if (k === "rw") $("regSrc").textContent = L("Quelle: eigene Berechnungen auf Basis der Rosés-Wolf-Datenbank zum regionalen BIP, Version 7 (Rosés und Wolf 2021); Grenzen der heutigen NUTS-Regionen. Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on the Rosés-Wolf database on regional GDP, version 7 (Rosés and Wolf 2021); boundaries of today's NUTS regions. Licence of the figure: CC BY 4.0.");
    else if (!kre) $("regSrc").textContent = L("Quelle: eigene Berechnungen auf Basis von Eurostat, ARDECO (JRC), Kohäsionsdaten der EU-Kommission und dem Caliendo-Parro-Modell; Kartengrundlage: © EuroGeographics für die Verwaltungsgrenzen (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on Eurostat, ARDECO (JRC), European Commission cohesion data and the Caliendo-Parro model; base map: © EuroGeographics for the administrative boundaries (GISCO). Licence of the figure: CC BY 4.0.");
    const low = ["us", "k_us", "k_ren", "k_gig", "k_gwf", "k_r4g", "k_b5g", "k_rel"].includes(k);
    const top = low ? srt.slice(0, 10) : [...srt].reverse().slice(0, 10);
    $("regTabTitle").textContent = low && k !== "us" ? L("Die zehn Kreise mit dem niedrigsten Anteil", "The ten districts with the lowest share") : k === "us" ? L("Die zehn am stärksten betroffenen Regionen", "The ten most affected regions") : L("Die zehn Regionen mit den höchsten Werten", "The ten regions with the highest values");
    $("regTable").innerHTML = `<thead><tr><th>NUTS</th><th>${L("Region", "Region")}</th><th class="num">${L("Wert", "Value")}</th></tr></thead><tbody>` + top.map((r) => `<tr><td>${r[0]}</td><td>${esc(nm(r[0]))}</td><td class="num">${fv(r[1])}</td></tr>`).join("") + "</tbody>";
    FIGDATA.reg = { header: ["NUTS", L("Region", "Region"), C.t], rows: all.map((r) => [r[0], nm(r[0]), +(r[1] * sc).toFixed(C.dec + 1)]) };
  }

  // network map: OSM lines drawn on a canvas, zoom with wheel or buttons, pan by dragging.
  // Speed: coarse merged lines (_lo) in the overview, detailed lines from zoom 3; during
  // interaction the last full drawing is moved as a bitmap and redrawn sharply when it stops.
  const NET = { data: {}, on: null, s: 1, ox: 0, oy: 0, ready: false, buf: null, timer: null };
  const NETL = () => [["ehv380", "#C00000", 1.6, L("380 kV", "380 kV"), true], ["ehv220", "#ED7D31", 1.3, L("220 kV", "220 kV"), true],
    ["hv110", "#7030A0", 0.6, L("110 kV", "110 kV"), false], ["sub", "#000000", 0, L("Umspannwerke ab 110 kV", "Substations from 110 kV"), false],
    ["rail_el", "#0070C0", 0.8, L("Bahn elektrifiziert", "Rail, electrified"), false], ["rail_nel", "#00B0F0", 0.8, L("Bahn ohne Oberleitung", "Rail, not electrified"), false],
    ["bab", "#595959", 1.1, L("Autobahnen", "Motorways"), false]];
  async function netLoad(k) {
    if (NET.data[k]) return NET.data[k];
    NET.data[k] = getJSON(`data/netz_${k}.json`).then((j) => {
      NET.meta = NET.meta || j;
      if (k === "sub") return j.d;
      const p = new Path2D(); j.d.forEach((a) => { p.moveTo(a[0], a[1]); for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]); if (k === "kreise") p.closePath(); }); return p;
    });
    return NET.data[k];
  }
  function netGeom() {
    const cv = $("netCanvas"), m = NET.meta, W = $("netWrap").clientWidth, H = Math.min(Math.round(W * m.h / m.w), 900), base = Math.min(W / m.w, H / m.h);
    return { cv, m, W, H, base, bx: (W - m.w * base) / 2, dpr: window.devicePixelRatio || 1 };
  }
  async function netDrawFull() {
    const NL = NETL(), fine = NET.s >= 3, ids = ["hv110", "rail_nel", "rail_el", "bab", "ehv220", "ehv380"].filter((id) => NET.on[id]);
    const want = { s: NET.s, ox: NET.ox, oy: NET.oy };
    const geo = await Promise.all([netLoad("kreise"), ...ids.map((id) => netLoad(fine ? id : id + "_lo")), NET.on.sub ? netLoad("sub") : null]);
    if (want.s !== NET.s || want.ox !== NET.ox || want.oy !== NET.oy) return;          // view changed while loading
    const g = netGeom(), k = g.base * NET.s, c = NET.buf || (NET.buf = document.createElement("canvas"));
    c.width = g.W * g.dpr; c.height = g.H * g.dpr;
    const ctx = c.getContext("2d");
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, g.W, g.H);
    ctx.setTransform(g.dpr * k, 0, 0, g.dpr * k, g.dpr * (NET.ox + g.bx * NET.s), g.dpr * NET.oy);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "#d9d9d9"; ctx.lineWidth = 0.6 / k; ctx.stroke(geo[0]);
    ids.forEach((id, i) => { const l = NL.find((x) => x[0] === id); ctx.strokeStyle = l[1]; ctx.lineWidth = l[2] * Math.min(2.5, Math.sqrt(NET.s)) / k; ctx.stroke(geo[i + 1]); });
    const d = geo[geo.length - 1];
    if (NET.on.sub && d) { ctx.fillStyle = "#000"; const f = Math.min(1.6, Math.sqrt(NET.s)) / k;
      for (let i = 0; i < d.length; i += 3) { const r = (d[i + 2] >= 380 ? 1.8 : d[i + 2] >= 220 ? 1.4 : 1) * f; ctx.fillRect(d[i] - r, d[i + 1] - r, 2 * r, 2 * r); } }
    NET.bs = NET.s; NET.box = NET.ox; NET.boy = NET.oy; NET.bW = g.W;
    netBlit();
  }
  function netBlit() {
    // show the buffer, moved and scaled from the view it was drawn for to the current view
    if (!NET.buf || !NET.meta) return;
    const g = netGeom(), f = NET.s / NET.bs, ax = NET.ox + g.bx * NET.s, abx = NET.box + g.bx * NET.bs;
    g.cv.width = g.W * g.dpr; g.cv.height = g.H * g.dpr; g.cv.style.height = g.H + "px";
    const ctx = g.cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, g.cv.width, g.cv.height);
    if (NET.bW !== g.W) return;
    ctx.setTransform(f, 0, 0, f, g.dpr * (ax - f * abx), g.dpr * (NET.oy - f * NET.boy));
    ctx.drawImage(NET.buf, 0, 0);
  }
  function netRedraw() { netBlit(); clearTimeout(NET.timer); NET.timer = setTimeout(netDrawFull, 160); }
  async function renderNetMap() {
    const NL = NETL(), cv = $("netCanvas");
    if (!NET.ready) {
      NET.ready = true; NET.on = Object.fromEntries(NL.map((l) => [l[0], l[4]]));
      $("netHead").textContent = L("Wo verlaufen die Netze?", "Where do the networks run?");
      $("netAsk").textContent = L("Wo verlaufen Stromleitungen, Bahnstrecken und Autobahnen?", "Where do power lines, railways and motorways run?");
      $("netTitle").textContent = L("Strom-, Bahn- und Autobahnnetz in Deutschland, OpenStreetMap", "Power, rail and motorway networks in Germany, OpenStreetMap");
      $("netHint").textContent = L("Ebenen an- und abwählen; Mausrad oder + und − zum Zoomen, ziehen zum Verschieben. In der Gesamtansicht vereinfachte Linien, ab dreifachem Zoom genaue Verläufe.", "Toggle layers; mouse wheel or + and − to zoom, drag to pan. Simplified lines in the overview, exact routes from threefold zoom.");
      $("netSrc").textContent = L("Quelle: OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL 1.0); Kreisgrenzen: © EuroGeographics (GISCO). Vollständigkeit wie in OpenStreetMap erfasst.", "Source: OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0); district boundaries: © EuroGeographics (GISCO). Completeness as mapped in OpenStreetMap.");
      $("netLayers").innerHTML = NL.map((l) => `<label style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:15px"><input type="checkbox" data-l="${l[0]}"${l[4] ? " checked" : ""}><span style="display:inline-block;width:18px;height:${l[0] === "sub" ? 8 : 4}px;background:${l[1]}"></span>${esc(l[3])}</label>`).join("");
      $("netLayers").querySelectorAll("input").forEach((c) => c.addEventListener("change", () => { NET.on[c.dataset.l] = c.checked; netDrawFull(); }));
      const zoom = (f, cx, cy) => { const r = cv.getBoundingClientRect(); cx = cx === undefined ? r.width / 2 : cx; cy = cy === undefined ? r.height / 2 : cy;
        const ns = Math.min(60, Math.max(1, NET.s * f)); NET.ox = cx - (cx - NET.ox) * ns / NET.s; NET.oy = cy - (cy - NET.oy) * ns / NET.s; NET.s = ns; netRedraw(); };
      cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.3 : 1 / 1.3, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      let drag = null;
      cv.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY, NET.ox, NET.oy]; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
      cv.addEventListener("pointermove", (e) => { if (!drag) return; NET.ox = drag[2] + e.clientX - drag[0]; NET.oy = drag[3] + e.clientY - drag[1]; netRedraw(); });
      cv.addEventListener("pointerup", () => { drag = null; cv.style.cursor = "grab"; });
      $("netIn").addEventListener("click", () => zoom(1.5)); $("netOut").addEventListener("click", () => zoom(1 / 1.5));
      $("netReset").addEventListener("click", () => { NET.s = 1; NET.ox = 0; NET.oy = 0; netDrawFull(); });
      window.addEventListener("resize", () => { if (!$("view-regionen").hidden) netDrawFull(); });
    }
    await netDrawFull();
  }

  // hydrogen core network and transmission grid expansion (Bundesnetzagentur)
  async function renderEnergyNets() {
    const G = await getJSON("data/energienetze.json"), H2 = G.h2, N = G.nab;
    const LN = { BW: "Baden-Württemberg", BY: L("Bayern", "Bavaria"), BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg", HE: L("Hessen", "Hesse"),
      MV: "Mecklenburg-Vorpommern", NI: L("Niedersachsen", "Lower Saxony"), NW: L("Nordrhein-Westfalen", "North Rhine-Westphalia"), RP: L("Rheinland-Pfalz", "Rhineland-Palatinate"),
      SL: "Saarland", SN: L("Sachsen", "Saxony"), ST: L("Sachsen-Anhalt", "Saxony-Anhalt"), SH: "Schleswig-Holstein", TH: L("Thüringen", "Thuringia"), AWZ: L("See (AWZ)", "Offshore (EEZ)") };
    const SN = { "noch nicht im Verfahren": L("noch nicht im Verfahren", "not yet in procedure"), "Bundesfachplanung/Raumordnung": L("Bundesfachplanung/Raumordnung", "federal sectoral or spatial planning"),
      "vor/im Planfeststellungsverfahren": L("vor/im Planfeststellungsverfahren", "before/in planning approval"), "genehmigt, vor/im Bau": L("genehmigt, vor/im Bau", "approved, before/under construction"),
      "fertig, noch nicht in Betrieb": L("fertig, noch nicht in Betrieb", "completed, not yet in operation"), "in Betrieb": L("in Betrieb", "in operation") };
    const km = (v) => `${fmt(v, 0)} km`, sum = (a) => a.reduce((t, v) => t + v, 0);
    const tot = H2.km_total, inv = H2.inv_total, ntot = sum(N.km), op = N.km[N.km.length - 1], fin = N.km[N.km.length - 2];
    $("enHead").textContent = L("Wasserstoff-Kernnetz und Ausbau des Stromnetzes", "Hydrogen core network and power grid expansion");
    $("enAnswer").textContent = L(`Das genehmigte Wasserstoff-Kernnetz umfasst ${km(tot)}, gut die Hälfte davon umgestellte Erdgasleitungen; bis 2032 soll alles in Betrieb sein, Kosten rund ${fmt(inv / 1000, 0)} Mrd. EUR. Beim Übertragungsnetz sind von ${km(ntot)} geplanter Leitungen ${km(op)} in Betrieb und weitere ${km(fin)} fertig; der größte Block steckt noch vor oder in der Planfeststellung.`,
      `The approved hydrogen core network spans ${km(tot)}, just over half of it converted gas pipelines; all of it is to be in operation by 2032, at a cost of about EUR ${fmt(inv / 1000, 0)} bn. Of ${km(ntot)} of planned transmission lines, ${km(op)} are in operation and another ${km(fin)} are completed; the largest block is still before or in planning approval.`);
    const bars = (el, rows, keys, cols, labels, unit) => {
      const W = 860, rowH = 26, m = { l: 250, r: 70, t: 34, b: 26 }, H = m.t + m.b + rowH * rows.length;
      const mx = Math.max(...rows.map((r) => sum(keys.map((k) => r[k])))), ticks = niceTicks(0, mx * 1.12, 5), top = Math.max(ticks[ticks.length - 1], mx * 1.1), XS = (v) => m.l + v / top * (W - m.l - m.r);
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
      if (keys.length > 1) keys.forEach((k, i) => { s += `<rect x="${m.l + i * 240}" y="6" width="12" height="12" fill="${cols[i]}"/><text x="${m.l + i * 240 + 18}" y="16">${esc(labels[i])}</text>`; });
      ticks.forEach((t) => { s += `<line class="grid" x1="${XS(t)}" x2="${XS(t)}" y1="${m.t - 4}" y2="${H - m.b}"/><text x="${XS(t)}" y="${H - 8}" text-anchor="middle">${fmt(t, 0)}</text>`; });
      s += `<text x="${W - m.r}" y="${m.t - 12}" text-anchor="end">${esc(unit)}</text>`;
      rows.forEach((r, i) => { const y = m.t + i * rowH; let x = m.l;
        s += `<text x="${m.l - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(r.name)}</text>`;
        keys.forEach((k, j) => { const w = XS(r[k]) - m.l; s += `<rect x="${x}" y="${y + 4}" width="${Math.max(0, w)}" height="${rowH - 8}" fill="${r.col || cols[j]}"><title>${esc(r.name)}${keys.length > 1 ? ", " + esc(labels[j]) : ""}: ${km(r[k])}</title></rect>`; x += w; });
        s += `<text x="${x + 6}" y="${y + rowH / 2 + 4}">${fmt(sum(keys.map((k) => r[k])), 0)}</text>`; });
      el.innerHTML = s + "</svg>";
    };
    const src = L("Quelle: eigene Berechnungen auf Basis der Bundesnetzagentur", "Source: own calculations based on the Federal Network Agency");
    // 1 hydrogen by Land
    const hr = H2.land.map((l, i) => ({ name: LN[l] || l, neu: H2.neu[i], um: H2.um[i], inv: H2.inv[i] }));
    bars($("h2LChart"), hr, ["um", "neu"], ["#9dc3e6", "#002060"], [L("Umstellung von Erdgasleitungen", "Conversion of gas pipelines"), L("Neubau", "New build")], "km");
    $("h2LAsk").textContent = L("Durch welche Länder läuft das Wasserstoff-Kernnetz?", "Which Länder does the hydrogen core network cross?");
    $("h2LTitle").textContent = L("Wasserstoff-Kernnetz nach Ländern, genehmigte Leitungen in km", "Hydrogen core network by Land, approved pipelines in km");
    $("h2LSrc").textContent = src + L(" (Genehmigung vom 22.10.2024, Anlagen 3 und 4). Länderübergreifende Abschnitte zu gleichen Teilen aufgeteilt. Lizenz der Abbildung: CC BY 4.0.", " (approval of 22.10.2024, annexes 3 and 4). Segments crossing Länder split equally. Licence of the figure: CC BY 4.0.");
    FIGDATA.h2land = { header: [L("Land", "Land"), L("Umstellung (km)", "Conversion (km)"), L("Neubau (km)", "New build (km)"), L("Investitionen (Mio. EUR)", "Investment (EUR m)")], rows: hr.map((r) => [r.name, r.um, r.neu, r.inv]) };
    // 2 hydrogen over time
    lineChart($("h2ZChart"), H2.years, [{ label: L("insgesamt", "total"), color: "#002060", bold: true, values: H2.years.map((_, i) => H2.cum_neu[i] + H2.cum_um[i]) },
      { label: L("Umstellung", "Conversion"), color: "#9dc3e6", values: H2.cum_um }, { label: L("Neubau", "New build"), color: "#0070C0", values: H2.cum_neu }], { min: 0, unit: "km", label: "H2" });
    $("h2ZAsk").textContent = L("Wann geht das Wasserstoff-Kernnetz in Betrieb?", "When does the hydrogen core network go into operation?");
    $("h2ZTitle").textContent = L("Wasserstoff-Kernnetz: geplante Inbetriebnahme, kumuliert in km", "Hydrogen core network: planned commissioning, cumulative km");
    $("h2ZSrc").textContent = src + L(" (Genehmigung vom 22.10.2024). Planerische Inbetriebnahme je Abschnitt. Lizenz der Abbildung: CC BY 4.0.", " (approval of 22.10.2024). Planned commissioning per segment. Licence of the figure: CC BY 4.0.");
    FIGDATA.h2zeit = { header: [L("Jahr", "Year"), L("Umstellung (km)", "Conversion (km)"), L("Neubau (km)", "New build (km)")], rows: H2.years.map((y, i) => [y, H2.cum_um[i], H2.cum_neu[i]]) };
    // 3 grid status
    const sc = ["#d9d9d9", "#bfbfbf", "#9dc3e6", "#5b9bd5", "#2e75b6", "#002060"];
    bars($("nabSChart"), N.status.map((st, i) => ({ name: SN[st] || st, km: N.km[i], col: sc[i] })), ["km"], ["#002060"], [""], "km");
    $("nabSAsk").textContent = L("Wie weit ist der Ausbau des Übertragungsnetzes?", "How far has transmission grid expansion progressed?");
    $("nabSTitle").textContent = L(`Ausbau des Übertragungsnetzes (EnLAG und BBPlG) nach Stand, ${N.stand}, km`, `Transmission grid expansion (EnLAG and BBPlG) by status, ${N.stand}, km`);
    $("nabSSrc").textContent = src + L(" (Monitoring des Stromnetzausbaus, zweites Quartal 2026). Lizenz der Abbildung: CC BY 4.0.", " (grid expansion monitoring, second quarter 2026). Licence of the figure: CC BY 4.0.");
    FIGDATA.nabstand = { header: [L("Stand", "Status"), "km"], rows: N.status.map((st, i) => [SN[st] || st, N.km[i]]) };
    // 4 grid plan over time
    lineChart($("nabZChart"), N.years, [{ label: L("geplante Inbetriebnahme, kumuliert", "planned commissioning, cumulative"), color: "#002060", bold: true, values: N.cum }], { min: 0, unit: "km", label: "grid" });
    $("nabZAsk").textContent = L("Bis wann sollen die neuen Stromleitungen laufen?", "By when are the new power lines to run?");
    $("nabZTitle").textContent = L("Übertragungsnetz: geplante Inbetriebnahme der Vorhaben, kumuliert in km", "Transmission grid: planned commissioning of projects, cumulative km");
    $("nabZSrc").textContent = src + L(` (Monitoring des Stromnetzausbaus, Q2/2026). Geplante Gesamtinbetriebnahme je Vorhaben; ohne ${N.undated_n} Vorhaben ohne Termin (${km(N.undated_km)}). Lizenz der Abbildung: CC BY 4.0.`, ` (grid expansion monitoring, Q2/2026). Planned completion per project; excluding ${N.undated_n} projects without date (${km(N.undated_km)}). Licence of the figure: CC BY 4.0.`);
    FIGDATA.nabzeit = { header: [L("Jahr", "Year"), "km"], rows: N.years.map((y, i) => [y, N.cum[i]]) };
  }

  // subsidies (Global Trade Alert): new harmful subsidies per year; Chinese targeted subsidies on goods under Chinese price pressure
  async function renderSubsidies() {
    const S = await getJSON("data/subsidies.json");
    const GN = { "China": L("China", "China"), "USA": L("USA", "USA"), "Deutschland": L("Deutschland", "Germany"), "übrige EU": L("übrige EU", "rest of EU"), "übrige Welt": L("übrige Welt", "rest of world") };
    const ex = S.china_exposed[0], ot = S.china_exposed[1], sm = S.china_exposed[2], pc = (v) => `${fmt(100 * v, 0)} %`;
    const rg = (S.regression || []).find((r) => r.stichprobe.startsWith("Waren mit") && r.fe === "HS-Kapitel" && r.kontrollen === "nein");
    $("subHead").textContent = L("Subventionen: Wo greift China gezielt ein?", "Subsidies: where does China intervene in a targeted way?");
    $("subAnswer").textContent = L(`Der Global Trade Alert zählt ${fmt(S.n_total, 0)} schädliche Subventionen seit 2009, ${fmt(S.n_force, 0)} davon sind in Kraft. Bei den ${ex.n} Waren, bei denen Deutschland unter chinesischem Preisdruck steht, wirken im Schnitt ${fmt(ex.mean_cn_subsidies, 0)} gezielte chinesische Subventionen, bei gleich großen anderen Waren ${fmt(ot.mean_cn_subsidies, 0)}, bei kleineren ${fmt(sm.mean_cn_subsidies, 0)}. China subventioniert also vor allem große Warenmärkte; gezielt auf die deutschen Druckwaren ausgerichtet ist es kaum${rg ? ` (innerhalb der HS-Kapitel +${fmt(rg.effekt_pct, 0)} %, nicht signifikant)` : ""}.`,
      `The Global Trade Alert counts ${fmt(S.n_total, 0)} harmful subsidies since 2009, ${fmt(S.n_force, 0)} of them in force. For the ${ex.n} goods where Germany faces Chinese price pressure, ${fmt(ex.mean_cn_subsidies, 0)} targeted Chinese subsidies apply on average, against ${fmt(ot.mean_cn_subsidies, 0)} for other goods of similar size and ${fmt(sm.mean_cn_subsidies, 0)} for smaller ones. China thus subsidises large product markets above all; it hardly targets the goods where Germany is under pressure${rg ? ` (within HS chapters +${fmt(rg.effekt_pct, 0)} %, not significant)` : ""}.`);
    const order = ["China", "USA", "Deutschland", "übrige EU", "übrige Welt"], col = { "China": "#C00000", "USA": "#002060", "Deutschland": "#000000", "übrige EU": "#0070C0", "übrige Welt": "#a6a6a6" };
    lineChart($("subZChart"), S.years, order.map((g) => ({ label: GN[g], color: col[g], bold: g === "China" || g === "USA", values: S.by_year[g] })), { min: 0, label: "subsidies" });
    $("subZAsk").textContent = L("Wer subventioniert am meisten?", "Who subsidises most?");
    $("subZTitle").textContent = L("Neu angekündigte schädliche Subventionen je Jahr, Anzahl der Maßnahmen", "Newly announced harmful subsidies per year, number of interventions");
    $("subZSrc").textContent = L("Quelle: eigene Berechnungen auf Basis von Global Trade Alert (Kapitel L und P der MAST-Klassifikation, rot oder gelb bewertet), Stand November 2026. Neuere Jahre werden mit Verzögerung nachgetragen. Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on Global Trade Alert (MAST chapters L and P, rated red or amber), November 2026. Recent years are filled in with a lag. Licence of the figure: CC BY 4.0.");
    FIGDATA.subzeit = { header: [L("Jahr", "Year"), ...order.map((g) => GN[g])], rows: S.years.map((y, i) => [y, ...order.map((g) => S.by_year[g][i])]) };
    const W = 860, H = 264, m = { l: 260, r: 160 }, rows = [[L("unter chinesischem Preisdruck", "under Chinese price pressure"), ex, "#C00000"], [L("übrige Waren gleicher Größe", "other goods of similar size"), ot, "#595959"], [L("kleinere Waren", "smaller goods"), sm, "#a6a6a6"]];
    const mx = Math.max(ex.mean_cn_subsidies, ot.mean_cn_subsidies) * 1.1, XS = (v) => m.l + v / mx * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    niceTicks(0, mx, 5).forEach((t) => { s += `<line class="grid" x1="${XS(t)}" x2="${XS(t)}" y1="20" y2="${H - 30}"/><text x="${XS(t)}" y="${H - 10}" text-anchor="middle">${fmt(t, 0)}</text>`; });
    rows.forEach(([lab, r, c], i) => { const y = 36 + i * 64;
      s += `<text x="${m.l - 10}" y="${y + 22}" text-anchor="end">${esc(lab)}</text><rect x="${m.l}" y="${y}" width="${XS(r.mean_cn_subsidies) - m.l}" height="36" fill="${c}"><title>${esc(lab)}: ${fmt(r.mean_cn_subsidies, 1)}</title></rect>`;
      s += `<text x="${XS(r.mean_cn_subsidies) + 8}" y="${y + 15}">${fmt(r.mean_cn_subsidies, 1)}</text><text x="${XS(r.mean_cn_subsidies) + 8}" y="${y + 32}" fill="#595959">${L(`${pc(r.share_with_cn_subsidy)} der Waren betroffen`, `${pc(r.share_with_cn_subsidy)} of goods affected`)}</text>`; });
    $("subCChart").innerHTML = s + "</svg>";
    $("subCAsk").textContent = L("Subventioniert China gerade dort, wo es Deutschland unter Druck setzt?", "Does China subsidise exactly where it puts Germany under pressure?");
    $("subCTitle").textContent = L("Gezielte chinesische Subventionen in Kraft je Ware (HS 6), Durchschnitt", "Targeted Chinese subsidies in force per good (HS 6), average");
    $("subCSrc").textContent = L("Quelle: eigene Berechnungen auf Basis von Global Trade Alert und CEPII BACI. Gezielt: nicht horizontal, höchstens 50 Warencodes; auch Maßnahmen von Provinzen und Kommunen. Preisdruck: Waren der Abbildung oben (Chinas Weltmarktanteil +5 Punkte seit 2012, Stückwert mindestens halb so hoch wie der deutsche, kurze Qualitätsleiter). Gleiche Größe: deutsche Exporte ab 100 Mio. USD wie bei den Druckwaren. Poisson-Regression mit HS-Kapitel-Effekten: kein signifikanter Unterschied. Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on Global Trade Alert and CEPII BACI. Targeted: not horizontal, at most 50 product codes; including provincial and local measures. Price pressure: goods of the figure above (China's world market share +5 points since 2012, unit value at least half the German one, short quality ladder). Similar size: German exports of USD 100 million or more, as for the pressure goods. Poisson regression with HS chapter effects: no significant difference. Licence of the figure: CC BY 4.0.");
    FIGDATA.subcn = { header: [L("Waren", "Goods"), L("Subventionen je Ware", "Subsidies per good"), L("Anteil betroffen (%)", "Share affected (%)"), L("Zahl der Waren", "Number of goods")], rows: rows.map(([lab, r]) => [lab, +r.mean_cn_subsidies.toFixed(1), +(100 * r.share_with_cn_subsidy).toFixed(1), r.n]) };
  }

  // profile of districts by US tariff exposure (INKAR)
  async function renderKreisProfile() {
    const P = await getJSON("data/kreise_profile.json"), Q = P.quintiles, q1 = Q[0], q5 = Q[Q.length - 1];
    $("kpHead").textContent = L("Wer lebt in den Kreisen, die die US-Zölle am stärksten treffen?", "Who lives in the districts hit hardest by US tariffs?");
    $("kpAnswer").textContent = L(`Die am stärksten betroffenen Kreise (Verlust ${fmt(q5.loss_pc_min, 0)} EUR je Einwohner und mehr) sind wohlhabende Industriestandorte: BIP je Einwohner ${fmt(q5["Bruttoinlandsprodukt je Einwohner"], 0)} Tsd. EUR gegenüber ${fmt(q1["Bruttoinlandsprodukt je Einwohner"], 0)} im am wenigsten betroffenen Fünftel, Medianeinkommen ${fmt(q5.Medianeinkommen, 0)} gegenüber ${fmt(q1.Medianeinkommen, 0)} EUR, Industriebeschäftigte je 100 Einwohner im erwerbsfähigen Alter ${fmt(q5.Industriequote, 0)} gegenüber ${fmt(q1.Industriequote, 0)}. Arbeitslosigkeit und Alter unterscheiden sich kaum; der AfD-Anteil liegt im am stärksten betroffenen Fünftel sogar niedriger, ohne klaren Zusammenhang über alle Kreise. Der Zollschock trifft also eher wirtschaftlich starke Regionen.`,
      `The districts hit hardest (loss of EUR ${fmt(q5.loss_pc_min, 0)} per inhabitant and more) are prosperous industrial sites: GDP per head EUR ${fmt(q5["Bruttoinlandsprodukt je Einwohner"], 0)} thousand against ${fmt(q1["Bruttoinlandsprodukt je Einwohner"], 0)} in the least affected fifth, median earnings EUR ${fmt(q5.Medianeinkommen, 0)} against ${fmt(q1.Medianeinkommen, 0)}, industry employees per 100 working-age inhabitants ${fmt(q5.Industriequote, 0)} against ${fmt(q1.Industriequote, 0)}. Unemployment and age barely differ; the AfD vote is even lower in the most affected fifth, with no clear pattern across all districts. The tariff shock thus hits economically strong regions above all.`);
    const keys = Object.keys(P.labels), dec = (k) => k === "Medianeinkommen" ? 0 : 1;
    let t = `<thead><tr><th></th>${Q.map((r) => `<th class="num">${L(`${r.quintile}. Fünftel`, `${r.quintile}th fifth`).replace("1th", "1st").replace("2th", "2nd").replace("3th", "3rd")}</th>`).join("")}<th class="num">${L("Rangkorrelation", "Rank correlation")}</th></tr></thead><tbody>`;
    t += `<tr><td>${L("Verlust je Einwohner, EUR (Spanne)", "Loss per inhabitant, EUR (range)")}</td>${Q.map((r) => `<td class="num">${fmt(r.loss_pc_min, 0)}–${fmt(r.loss_pc_max, 0)}</td>`).join("")}<td></td></tr>`;
    keys.forEach((k) => { t += `<tr><td>${esc(EN ? P.labels[k][1] : P.labels[k][0])}</td>${Q.map((r) => `<td class="num">${r[k] === null ? "–" : fmt(r[k], dec(k))}</td>`).join("")}<td class="num">${fmt(P.spearman[k], 2)}</td></tr>`; });
    $("kpTable").innerHTML = t + "</tbody>";
    $("kpSrc").textContent = L(`Quelle: eigene Berechnungen auf Basis von INKAR 2025 (BBSR) und der Kreiswerte zu den US-Zöllen (Seite Regionen). ${P.n} Kreise in fünf gleich große Gruppen nach dem Produktionsverlust je Einwohner; Mittelwerte mit der Bevölkerung gewichtet. Rangkorrelation (Spearman) des Merkmals mit dem Verlust je Einwohner über alle Kreise.`,
      `Source: own calculations based on INKAR 2025 (BBSR) and the district US tariff values (Regions page). ${P.n} districts in five equal groups by output loss per inhabitant; means weighted by population. Rank correlation (Spearman) of each indicator with the loss per inhabitant across districts.`);
  }

  // tab "Kreise": eight INKAR analyses (79_inkar_analyses.py)
  async function renderKreise() {
    const [R, GR] = await Promise.all([getJSON("data/kreise_inkar.json"), getJSON("data/kreise_grw.json")]), it = Object.fromEntries(R.items.map((x) => [x.id, x]));
    const f1 = (v) => v === null || v === undefined ? "–" : fmt(v, 1), pp = (b) => `${b > 0 ? "+" : ""}${fmt(b, 2)}`;
    const star = (p) => p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.1 ? "*" : "";
    const qh = L("Fünftel nach US-Zoll-Verlust je Einwohner (1 = gering, 5 = hoch)", "Fifth by US tariff loss per inhabitant (1 = low, 5 = high)");
    const qtable = (x, labels, byLab) => `<thead><tr><th>${esc(byLab)}</th>${labels.map((l) => `<th class="num">${esc(l)}</th>`).join("")}</tr></thead><tbody>` +
      x.table.map((r) => `<tr><td>${r.q || r.fq || r.gq}</td>${x.cols.map((c) => `<td class="num">${c === "flaeche" ? fmt(r[c], 2) : ["gwst", "stk", "schulden", "bauland"].includes(c) ? fmt(r[c], 0) : f1(r[c])}</td>`).join("")}</tr>`).join("") + "</tbody>";
    const ctable = (rows) => `<thead><tr><th>${L("Merkmal (je Standardabweichung)", "Variable (per standard deviation)")}</th><th class="num">${L("Effekt", "Effect")}</th><th class="num">${L("Std.-Fehler", "Std. error")}</th><th class="num">p</th></tr></thead><tbody>` +
      rows.map(([lab, c]) => `<tr><td>${esc(lab)}</td><td class="num">${pp(c.b)}${star(c.p)}</td><td class="num">${fmt(c.se, 2)}</td><td class="num">${fmt(c.p, 3)}</td></tr>`).join("") + "</tbody>";
    const list = (b, unit) => b.slice(0, 8).map((r) => `${r[0]} (${fmt(r[1], 0)} EUR, ${fmt(r[2], 1)}${unit})`).join("; ");
    const F = it.fachkraefte, D = it.demografie, G = it.finanzen, Z = it.flaeche, W = it.wahlen, B = it.breitband, I = it.industrie, E = it.erreichbarkeit, M = it.migration, A = it.armut;
    const q = (x, k, i) => x.table[i][k];
    const blocks = [
      [L("1. Finden entlassene Fachkräfte neue Stellen?", "1. Would laid-off skilled workers find new jobs?"),
       L(`Der Arbeitsmarkt der stark betroffenen Kreise ist eher fester: Arbeitslosenquote ${f1(q(F, "alq", 4))} % gegenüber ${f1(q(F, "alq", 0))} % im am wenigsten betroffenen Fünftel, Beschäftigtenquote ${f1(q(F, "bq", 4))} gegenüber ${f1(q(F, "bq", 0))} %. Der Anteil der Fachkräfte unter den Arbeitslosen und unter den offenen Stellen ist überall ähnlich (rund 28 und 57 %). INKAR enthält keine Gesamtzahl offener Stellen; eine echte Quote Stellen je Arbeitslosem fehlt daher.`,
         `The labour market of strongly affected districts is rather tighter: unemployment ${f1(q(F, "alq", 4))} % against ${f1(q(F, "alq", 0))} % in the least affected fifth, employment rate ${f1(q(F, "bq", 4))} against ${f1(q(F, "bq", 0))} %. The share of skilled workers among the unemployed and among vacancies is similar everywhere (about 28 and 57 %). INKAR has no total of vacancies, so a true ratio of vacancies per unemployed is missing.`),
       qtable(F, [L("Arbeitslosenquote, %", "Unemployment rate, %"), L("Fachkräfte unter Arbeitslosen, %", "Skilled among unemployed, %"), L("Fachkraft-Stellen unter offenen Stellen, %", "Skilled-level vacancies, %"), L("Beschäftigtenquote, %", "Employment rate, %")], qh)],
      [L("2. Treffen Zölle und Schrumpfung zusammen?", "2. Do tariffs and shrinking coincide?"),
       L(`Im Mittel nicht: Das am stärksten betroffene Fünftel wächst laut BBSR-Prognose bis 2045 um ${f1(q(D, "prog", 4))} %. ${D.both.length} Kreise tragen aber beide Risiken (hoher Verlust und Bevölkerung bis 2045 um mehr als 5 % kleiner), oft alte Industriestandorte: ${list(D.both, " %")}.`,
         `Not on average: the most affected fifth grows by ${f1(q(D, "prog", 4))} % to 2045 in the BBSR projection. But ${D.both.length} districts carry both risks (high loss and population more than 5 % smaller by 2045), often old industrial sites: ${list(D.both, " %")}.`),
       qtable(D, [L("Bevölkerung 2022 bis 2045, %", "Population 2022 to 2045, %")], qh)],
      [L("3. Wie stark hängen die Gemeindekassen an der Industrie?", "3. How much do municipal budgets depend on industry?"),
       L(`Stark: Im am stärksten betroffenen Fünftel bringt die Gewerbesteuer ${fmt(q(G, "gwst", 4), 0)} EUR je Einwohner, im am wenigsten betroffenen ${fmt(q(G, "gwst", 0), 0)} EUR. Sie entspricht dort ${f1(q(G, "gwst_share", 4))} % der gemeindlichen Steuerkraft (gegenüber ${f1(q(G, "gwst_share", 0))} %); je Standardabweichung der Zollbetroffenheit ${pp(G.coef[0].b)} Punkte bei gleichem Einkommen und gleicher Dichte. Die Schulden der Gemeinden sind dort eher niedriger (${fmt(q(G, "schulden", 4), 0)} gegenüber ${fmt(q(G, "schulden", 0), 0)} EUR je Einwohner). Ein Gewinneinbruch der Industrie schlägt also direkt auf die Haushalte reicher Industriegemeinden durch.`,
         `Strongly: in the most affected fifth local business tax yields EUR ${fmt(q(G, "gwst", 4), 0)} per inhabitant, in the least affected EUR ${fmt(q(G, "gwst", 0), 0)}. It equals ${f1(q(G, "gwst_share", 4))} % of municipal tax capacity there (against ${f1(q(G, "gwst_share", 0))} %); ${pp(G.coef[0].b)} points per standard deviation of tariff exposure at equal income and density. Municipal debt is rather lower there (EUR ${fmt(q(G, "schulden", 4), 0)} against ${fmt(q(G, "schulden", 0), 0)} per inhabitant). A slump in industrial profits thus hits the budgets of rich industrial municipalities directly.`),
       qtable(G, [L("Gewerbesteuer, EUR je Einwohner", "Local business tax, EUR per inhabitant"), L("Steuerkraft, EUR je Einwohner", "Tax capacity, EUR per inhabitant"), L("Gewerbesteuer im Verhältnis zur Steuerkraft, %", "Business tax relative to tax capacity, %"), L("Kommunale Schulden, EUR je Einwohner", "Municipal debt, EUR per inhabitant")], qh)],
      [L("4. Wählen exportstarke Industriekreise anders?", "4. Do export-heavy industrial districts vote differently?"),
       L(`Die AfD hat von 2017 bis 2025 im Mittel ${f1(W.mean_d)} Punkte gewonnen, in Kreisen mit hoher Zollbetroffenheit mehr: je Standardabweichung des Verlusts ${pp(W.coef[0].b)} Punkte (innerhalb der Länder, bei gleicher Arbeitslosigkeit, Einkommen, Alter und Dichte; ${W.n} Kreise). Die Veränderung der Industriebeschäftigung je Einwohner im erwerbsfähigen Alter 2013 bis 2023 hängt nicht damit zusammen. Die Zölle von 2026 können die Wahlen davor nicht verursacht haben; das Maß steht hier für exportabhängige Industriestandorte, etwa der Autoindustrie.`,
         `The AfD gained ${f1(W.mean_d)} points on average from 2017 to 2025, more in districts with high tariff exposure: ${pp(W.coef[0].b)} points per standard deviation of the loss (within Länder, at equal unemployment, income, age and density; ${W.n} districts). The change in industry employment per working-age inhabitant 2013 to 2023 is unrelated. The 2026 tariffs cannot have caused earlier elections; the measure stands for export-dependent industrial sites, such as the car industry.`),
       ctable([[L("US-Zoll-Verlust je Einwohner", "US tariff loss per inhabitant"), W.coef[0]], [L("Veränderung Industriebeschäftigte je 100 Einwohner 15-64, 2013 bis 2023", "Change in industry employees per 100 inhabitants 15-64, 2013 to 2023"), W.coef[1]]])],
      [L("5. Holt gutes Breitband IT-Jobs in den Kreis?", "5. Does good broadband attract IT jobs?"),
       L(`Nein, nicht messbar: Kreise mit hoher Gigabit-Versorgung 2020 haben ihren Anteil an IT- und Kreativbeschäftigten bis 2023 nicht stärker gesteigert als andere (bei gleichem Ausgangsniveau und gleicher Dichte, innerhalb der Länder). Der IT-Anteil stieg im Mittel um ${fmt(B.mean_it, 2)} Punkte.`,
         `No, not measurably: districts with high gigabit coverage in 2020 did not raise their share of IT and creative employment by 2023 more than others (at equal starting level and density, within Länder). The IT share rose by ${fmt(B.mean_it, 2)} points on average.`),
       ctable([[L("Gigabit 2020 → IT-Beschäftigte, Punkte", "Gigabit 2020 → IT employment, points"), B.coef[0]], [L("Gigabit 2020 → Kreativbranchen, Punkte", "Gigabit 2020 → creative industries, points"), B.coef[1]]])],
      [L("6. Hängt der Industrieabbau seit 2019 an Exporten oder Energie?", "6. Is industrial decline since 2019 linked to exports or energy?"),
       L(`Kaum: Die Industriebeschäftigung je 100 Einwohner im erwerbsfähigen Alter sank 2019 bis 2023 in ${fmt(100 * I.share_down, 0)} % der Kreise, im Mittel blieb sie fast gleich (${pp(I.mean_d)} Punkte). Weder die Veränderung der Exportquote noch der Anteil energieintensiver Industrie der Region erklären die Unterschiede signifikant. Für den Energiepreisschock ist der Zeitraum bis 2023 vermutlich zu kurz, und die Branchenstruktur der Kreise ist nur auf Regionsebene bekannt.`,
         `Hardly: industry employment per 100 working-age inhabitants fell from 2019 to 2023 in ${fmt(100 * I.share_down, 0)} % of districts, on average it stayed almost flat (${pp(I.mean_d)} points). Neither the change in the export ratio nor the region's share of energy-intensive industry explains the differences significantly. The period to 2023 is probably too short for the energy price shock, and the industry mix is known only at regional level.`),
       ctable([[L("Veränderung Exportquote 2019 bis 2024", "Change in export ratio 2019 to 2024"), I.coef[0]], [L("Energieintensive Beschäftigung der Region", "Energy-intensive employment of the region"), I.coef[1]]])],
      [L("7. Exportieren gut angebundene Kreise mehr?", "7. Do well-connected districts export more?"),
       L(`Vor allem die Nähe zum Flughafen zählt: Je Standardabweichung längerer Fahrzeit zum nächsten Flughafen (im Mittel ${fmt(E.means.t_air, 0)} Minuten) ist der Auslandsumsatz je Einwohner um rund ${fmt(100 * (1 - Math.exp(E.coef_ln[1].b)), 0)} % niedriger, bei gleicher Industriebeschäftigung und gleicher Dichte. Autobahn und Fernbahnhof machen keinen messbaren Unterschied; vier von fünf Kreisen erreichen die nächste Autobahn im Mittel in höchstens 15 Minuten.`,
         `Above all, proximity to an airport matters: per standard deviation of longer travel time to the nearest airport (${fmt(E.means.t_air, 0)} minutes on average), foreign sales per inhabitant are about ${fmt(100 * (1 - Math.exp(E.coef_ln[1].b)), 0)} % lower, at equal industry employment and density. Motorway and intercity station make no measurable difference; four in five districts reach the nearest motorway in 15 minutes or less on average.`),
       ctable([[L("Fahrzeit Autobahn → log Auslandsumsatz je Einwohner", "Time to motorway → log foreign sales per head"), E.coef_ln[0]], [L("Fahrzeit Flughafen → log Auslandsumsatz je Einwohner", "Time to airport → log foreign sales per head"), E.coef_ln[1]], [L("Fahrzeit Fernbahnhof → log Auslandsumsatz je Einwohner", "Time to intercity station → log foreign sales per head"), E.coef_ln[2]], [L("Fahrzeit Flughafen → Exportquote, Punkte", "Time to airport → export ratio, points"), E.coef[1]]])],
      [L("8. Wie arbeiten Zugewanderte in Industriekreisen?", "8. How do immigrants work in industrial districts?"),
       L(`Je industrieller der Kreis, desto kleiner der Ausländeranteil (${f1(q(M, "ausl", 4))} gegenüber ${f1(q(M, "ausl", 0))} %), aber desto höher ihre Beschäftigungsquote (${f1(q(M, "bq_ausl", 4))} gegenüber ${f1(q(M, "bq_ausl", 0))} %). Mit der Exportquote steigt der Ausländeranteil dagegen (Rangkorrelation ${fmt(M.rho_exq, 2)}): exportstarke Standorte liegen oft in Ballungsräumen.`,
         `The more industrial the district, the smaller the foreigners' share (${f1(q(M, "ausl", 4))} against ${f1(q(M, "ausl", 0))} %), but the higher their employment rate (${f1(q(M, "bq_ausl", 4))} against ${f1(q(M, "bq_ausl", 0))} %). With the export ratio, in contrast, the foreigners' share rises (rank correlation ${fmt(M.rho_exq, 2)}): export-heavy sites are often in metropolitan areas.`),
       qtable(M, [L("Industriebeschäftigte je 100 Einwohner 15-64", "Industry employees per 100 inhabitants 15-64"), L("Ausländeranteil, %", "Foreigners' share, %"), L("Beschäftigungsquote der Ausländer, %", "Employment rate of foreigners, %")], L("Fünftel nach Industriebeschäftigung je Einwohner (1 = gering, 5 = hoch)", "Fifth by industry employment per inhabitant (1 = low, 5 = high)"))],
      [L("9. Wächst die Industrie dort, wo Fläche da ist?", "9. Does industry grow where land is available?"),
       L(`Kaum messbar: Kreise, in denen die Industriebeschäftigung je Einwohner 2013 bis 2023 am stärksten wuchs (+${f1(q(Z, "d_iq", 4))} Punkte), haben weniger bebaute Fläche (${f1(q(Z, "svf", 4))} gegenüber ${f1(q(Z, "svf", 0))} % Siedlungs- und Verkehrsfläche) und weisen jährlich etwa gleich viel neue Fläche aus (${fmt(q(Z, "flaeche", 4), 2)} % der Fläche je Jahr). Innerhalb der Länder und bei gleicher Dichte hängt das Industriewachstum weder mit dem Flächenzuwachs noch mit der bebauten Fläche zusammen; höhere Baulandpreise gehen eher mit mehr Wachstum einher (schwach signifikant). Industrie wächst in ländlichen Kreisen mit Platz, aber nicht wegen neu ausgewiesener Fläche.`,
         `Hardly measurable: districts where industry employment per inhabitant grew most from 2013 to 2023 (+${f1(q(Z, "d_iq", 4))} points) have less built-up land (${f1(q(Z, "svf", 4))} against ${f1(q(Z, "svf", 0))} % settlement and transport area) and designate about as much new land per year (${fmt(q(Z, "flaeche", 4), 2)} % of the area). Within Länder and at equal density, industrial growth is unrelated to new land and to built-up area; higher building land prices rather go with more growth (weakly significant). Industry grows in rural districts with space, but not because of newly designated land.`),
       qtable(Z, [L("Industriebeschäftigte je 100 Einwohner 15-64, Veränderung 2013 bis 2023", "Industry employees per 100 inhabitants 15-64, change 2013 to 2023"), L("Neue Siedlungs- und Verkehrsfläche, % der Fläche je Jahr (2018 bis 2023)", "New settlement and transport area, % of area per year (2018 to 2023)"), L("Baulandpreis, EUR je m²", "Building land price, EUR per m²"), L("Siedlungs- und Verkehrsfläche, % der Fläche", "Settlement and transport area, % of area")], L("Fünftel nach Industriewachstum (1 = gering, 5 = hoch)", "Fifth by industrial growth (1 = low, 5 = high)"))],
      [L("10. Wo trifft ein Industrieschock auf Armut?", "10. Where does an industrial shock meet poverty?"),
       L(`Im Mittel unterscheiden sich SGB-II-Quote und Kinderarmut kaum zwischen den Fünfteln. ${A.both.length} Kreise verbinden aber hohen Zollverlust mit hoher SGB-II-Quote (oberstes Fünftel, ab ${f1(A.thr)} %): ${list(A.both, " %")}. Das sind vor allem Industriestädte wie Ludwigshafen, Schweinfurt und Salzgitter.`,
         `On average SGB II rate and child poverty barely differ between the fifths. But ${A.both.length} districts combine a high tariff loss with a high SGB II rate (top fifth, from ${f1(A.thr)} %): ${list(A.both, " %")}. These are mainly industrial cities such as Ludwigshafen, Schweinfurt and Salzgitter.`),
       qtable(A, [L("SGB-II-Quote, %", "SGB II rate, %"), L("Kinderarmut, %", "Child poverty, %")], qh)],
      [L("11. Liegen die betroffenen Kreise in GRW-Fördergebieten?", "11. Are the affected districts GRW aid areas?"),
       L(`Selten: Im am stärksten betroffenen Fünftel leben ${fmt(100 * GR.summary.by_quintile[4].share_c, 0)} % der Menschen in C-Fördergebieten, im am wenigsten betroffenen ${fmt(100 * GR.summary.by_quintile[0].share_c, 0)} %. Nur ${fmt(100 * GR.summary.loss_share_in_c, 0)} % des Produktionsverlusts fallen in C-Gebiete, ${fmt(100 * GR.summary.loss_share_in_cd, 0)} % in C- oder D-Gebiete (Bevölkerung: ${fmt(100 * GR.summary.germany.share_c, 0)} und ${fmt(100 * GR.summary.germany.share_cd, 0)} %). Die Regionalförderung der GRW reicht damit an den Kern des Zollschocks kaum heran.`,
         `Rarely: in the most affected fifth ${fmt(100 * GR.summary.by_quintile[4].share_c, 0)} % of people live in C aid areas, in the least affected ${fmt(100 * GR.summary.by_quintile[0].share_c, 0)} %. Only ${fmt(100 * GR.summary.loss_share_in_c, 0)} % of the output loss falls in C areas, ${fmt(100 * GR.summary.loss_share_in_cd, 0)} % in C or D areas (population: ${fmt(100 * GR.summary.germany.share_c, 0)} and ${fmt(100 * GR.summary.germany.share_cd, 0)} %). GRW regional aid thus barely reaches the core of the tariff shock.`),
       `<thead><tr><th>${esc(qh)}</th><th class="num">${L("Bevölkerung in C-Fördergebieten, %", "Population in C aid areas, %")}</th><th class="num">${L("in C- oder D-Fördergebieten, %", "in C or D aid areas, %")}</th></tr></thead><tbody>` + GR.summary.by_quintile.map((r) => `<tr><td>${r.q}</td><td class="num">${fmt(100 * r.share_c, 0)}</td><td class="num">${fmt(100 * r.share_cd, 0)}</td></tr>`).join("") + "</tbody>"],
    ];
    $("krIntro").textContent = L(`Elf Auswertungen mit den Kreisdaten des BBSR (INKAR 2025) und der US-Zoll-Betroffenheit je Kreis. Alles sind Zusammenhänge zwischen Kreisen, keine Ursachen. Regressionen mit Länder-Effekten und robusten Standardfehlern; Sterne: *** p < 0,01, ** p < 0,05, * p < 0,1.`,
      `Eleven analyses with BBSR district data (INKAR 2025) and the US tariff exposure by district. All are associations across districts, not causes. Regressions with Land effects and robust standard errors; stars: *** p < 0.01, ** p < 0.05, * p < 0.1.`);
    $("krItems").innerHTML = blocks.map(([h, t, tab]) => `<h3 style="margin-top:32px">${esc(h)}</h3><p class="answer">${esc(t)}</p><div class="tablewrap"><table>${tab}</table></div>`).join("") +
      `<p class="src">${L("Quelle: eigene Berechnungen auf Basis von INKAR 2025 (BBSR, Gebietsstand 31.12.2023, darin der GRW-Status jeder Gemeinde laut BBSR-Referenz 2023), der Regionaldatenbank Deutschland und dem Caliendo-Parro-Modell. Bundestagswahl: Zweitstimmen.", "Source: own calculations based on INKAR 2025 (BBSR, boundaries of 31.12.2023, including the GRW status of every municipality from the BBSR reference 2023), the Regional Database Germany and the Caliendo-Parro model. Federal elections: party-list votes.")}</p>`;
  }

  // tab "Kreise": district maps of the INKAR analyses, one card per indicator
  async function renderKreiseMap() {
    const [K, V0, GR] = await Promise.all([getJSON("data/kreise_energy.json"), getJSON("data/kreise_inkar_map.json"), getJSON("data/kreise_grw.json")]);
    const V = Object.fromEntries(Object.keys(V0).map((g) => [g, { ...V0[g], grw: GR.kreise[g] ? GR.kreise[g].grw : null }]));
    const seq = ["#deebf7", "#9dc3e6", "#5b9bd5", "#2e75b6", "#1f4e79", "#002060"], div = ["#c00000", "#f4b183", "#f2f2f2", "#deebf7", "#5b9bd5", "#002060"];
    const red = ["#f2f2f2", "#fce4d6", "#f4b183", "#e06666", "#c00000", "#7f0000"];
    const risk = (a) => ({ cat: true, cols: ["#e7e6e6", "#9dc3e6", "#f4b183", "#c00000"], labels: [L("weder noch", "neither"), a, L("hoher Zollverlust", "high tariff loss"), L("beides", "both")] });
    const ALL = {
      risk_demo: { ...risk(L("starke Schrumpfung (unter −5 %)", "strong shrinking (below −5 %)")), t: L("Doppelrisiko: hoher US-Zoll-Verlust (oberstes Fünftel) und Bevölkerung bis 2045 um mehr als 5 % kleiner", "Double risk: high US tariff loss (top fifth) and population more than 5 % smaller by 2045"), ask: L("Wo treffen Zölle und Schrumpfung zusammen?", "Where do tariffs and shrinking coincide?") },
      risk_pov: { ...risk(L("hohe SGB-II-Quote (oberstes Fünftel)", "high SGB II rate (top fifth)")), t: L("Doppelrisiko: hoher US-Zoll-Verlust und hohe SGB-II-Quote (jeweils oberstes Fünftel)", "Double risk: high US tariff loss and high SGB II rate (top fifth each)"), ask: L("Wo trifft ein Industrieschock auf Armut?", "Where does an industrial shock meet poverty?") },
      gwst: { bins: [0, 400, 600, 800, 1000, 1500, 1e9], cols: seq, unit: " EUR", t: L("Gewerbesteuer 2023, EUR je Einwohner", "Local business tax 2023, EUR per inhabitant"), ask: L("Wo bringt die Gewerbesteuer viel?", "Where does local business tax yield a lot?") },
      gwst_share: { bins: [0, 50, 60, 70, 80, 90, 101], cols: seq, unit: " %", t: L("Gewerbesteuer (Ist-Aufkommen) im Verhältnis zur gemeindlichen Steuerkraft 2023, %", "Local business tax (actual revenue) relative to municipal tax capacity 2023, %"), ask: L("Wo hängen die Gemeindekassen an der Gewerbesteuer?", "Where do municipal budgets depend on business tax?") },
      schulden: { bins: [0, 500, 1000, 1500, 2500, 4000, 1e9], cols: red, unit: " EUR", t: L("Schulden der Gemeinden und Gemeindeverbände 2023, EUR je Einwohner", "Debt of municipalities and associations 2023, EUR per inhabitant"), ask: L("Wo sind die Gemeinden verschuldet?", "Where are municipalities indebted?") },
      d_iq: { bins: [-99, -1, 0, 1, 2, 4, 99], cols: div, unit: L(" Pkt.", " pts"), t: L("Veränderung der Industriebeschäftigten je 100 Einwohner von 15 bis 64, 2013 bis 2023, Punkte", "Change in industry employees per 100 inhabitants aged 15-64, 2013 to 2023, points"), ask: L("Wo ist die Industrie gewachsen?", "Where has industry grown?") },
      flaeche: { bins: [0, 0.02, 0.04, 0.06, 0.08, 0.12, 99], cols: red, unit: " %", t: L("Neue Siedlungs- und Verkehrsfläche je Jahr 2018 bis 2023, % der Gesamtfläche", "New settlement and transport area per year 2018 to 2023, % of total area"), ask: L("Wo wird viel Fläche neu bebaut?", "Where is much new land built on?") },
      grw: { cat: true, cols: ["#e7e6e6", "#f4b183", "#9dc3e6", "#2e75b6"], labels: [L("kein Fördergebiet", "no aid area"), L("teilweise (unter der Hälfte der Bevölkerung)", "partly (under half of the population)"), L("überwiegend D-Fördergebiet", "mainly D aid area"), L("überwiegend C-Fördergebiet", "mainly C aid area")], t: L("GRW-Fördergebiete 2022 bis 2027 nach Kreisen (Mehrheit der Bevölkerung)", "GRW regional aid areas 2022 to 2027 by district (majority of population)"), ask: L("Wo darf regional gefördert werden?", "Where is regional aid allowed?") },
      prog: { bins: [-99, -10, -5, 0, 5, 10, 99], cols: div, unit: " %", t: L("Prognostizierte Bevölkerungsentwicklung 2022 bis 2045 (BBSR), %", "Projected population change 2022 to 2045 (BBSR), %"), ask: L("Wo schrumpft die Bevölkerung?", "Where does the population shrink?") },
      d_afd: { bins: [0, 4, 6, 8, 10, 12, 99], cols: red, unit: L(" Pp.", " pp"), t: L("Zuwachs der AfD-Zweitstimmen 2017 bis 2025, Prozentpunkte", "Gain in AfD party-list vote 2017 to 2025, percentage points"), ask: L("Wo hat die AfD am stärksten zugelegt?", "Where did the AfD gain most?") },
      alq: { bins: [0, 3, 4, 5, 6, 8, 99], cols: red, unit: " %", t: L("Arbeitslosenquote 2023, %", "Unemployment rate 2023, %"), ask: L("Wo ist die Arbeitslosigkeit hoch?", "Where is unemployment high?") },
      fk_os: { bins: [0, 50, 55, 60, 65, 70, 101], cols: seq, unit: " %", t: L("Anteil der Stellen für Fachkräfte an allen offenen Stellen 2023, %", "Share of skilled-level vacancies in all vacancies 2023, %"), ask: L("Wo werden vor allem Fachkräfte gesucht?", "Where are skilled workers in demand?") },
      giga20: { bins: [0, 25, 50, 75, 90, 95, 101], cols: seq, unit: " %", t: L("Haushalte mit mindestens 1.000 Mbit/s 2020, %", "Households with at least 1,000 Mbit/s 2020, %"), ask: L("Wo gab es 2020 schon Gigabit?", "Where was gigabit available in 2020?") },
      d_it: { bins: [-99, 0, 0.25, 0.5, 0.75, 1, 99], cols: div, unit: L(" Pp.", " pp"), t: L("Veränderung des Anteils der IT- und naturwissenschaftlichen Dienstleistungsberufe 2017 bis 2023, Prozentpunkte", "Change in share of IT and science service occupations 2017 to 2023, percentage points"), ask: L("Wo sind IT-Jobs entstanden?", "Where were IT jobs created?") },
      d_iq19: { bins: [-99, -2, -1, 0, 1, 2, 99], cols: div, unit: L(" Pp.", " pp"), t: L("Veränderung der Industriebeschäftigten je 100 Einwohner von 15 bis 64, 2019 bis 2023, Punkte", "Change in industry employees per 100 inhabitants aged 15-64, 2019 to 2023, points"), ask: L("Wo hat die Industrie Beschäftigung verloren?", "Where has industry lost employment?") },
      t_air: { bins: [0, 30, 45, 60, 75, 90, 999], cols: red, unit: " min", t: L("Pkw-Fahrzeit zum nächsten internationalen Flughafen 2024, Minuten", "Car travel time to the nearest international airport 2024, minutes"), ask: L("Wie weit ist der nächste Flughafen?", "How far is the nearest airport?") },
      ausl: { bins: [0, 5, 10, 15, 20, 25, 99], cols: seq, unit: " %", t: L("Ausländeranteil 2023, %", "Foreigners' share 2023, %"), ask: L("Wo leben viele Ausländer?", "Where do many foreigners live?") },
      bq_ausl: { bins: [0, 45, 50, 55, 60, 65, 101], cols: seq, unit: " %", t: L("Beschäftigungsquote der Ausländer 2023, %", "Employment rate of foreigners 2023, %"), ask: L("Wo arbeiten Zugewanderte häufig?", "Where do immigrants often work?") },
      sgb2: { bins: [0, 4, 6, 8, 10, 14, 99], cols: red, unit: " %", t: L("SGB-II-Quote 2023, %", "SGB II rate 2023, %"), ask: L("Wo leben viele Menschen von Grundsicherung?", "Where do many people live on basic income support?") },
      kinder: { bins: [0, 6, 9, 12, 15, 20, 99], cols: red, unit: " %", t: L("Kinderarmut 2023 (Kinder unter 15 in Bedarfsgemeinschaften), %", "Child poverty 2023 (children under 15 in benefit households), %"), ask: L("Wo ist Kinderarmut verbreitet?", "Where is child poverty widespread?") } };
    const nm = (g) => (K.kreise[g] && K.kreise[g].n) || g;
    const sw = (c) => `<span style="display:inline-block;width:14px;height:12px;background:${c};border:1px solid #d9d9d9;vertical-align:middle"></span>`;
    Object.keys(ALL).forEach((k) => {
      const C = ALL[k], el = $(`km_${k}_map`);
      if (!el) return;
      const get = (g) => V[g] ? V[g][k] : null;
      const colOf = (v) => { if (v === null || v === undefined || isNaN(v)) return "#bfbfbf"; if (C.cat) return C.cols[v]; for (let i = 0; i < C.cols.length; i++) if (v < C.bins[i + 1]) return C.cols[i]; return C.cols[C.cols.length - 1]; };
      const fv = (v) => v === null || v === undefined ? "–" : C.cat ? C.labels[v] : `${fmt(v, k === "flaeche" ? 3 : 1)}${C.unit}`;
      let s = `<svg viewBox="0 0 ${K.width} ${K.height.toFixed(1)}" role="img" aria-label="${esc(C.t)}" style="background:#fff;max-height:620px">`;
      Object.keys(K.paths).forEach((g) => { s += `<path d="${K.paths[g]}" fill="${colOf(get(g))}" stroke="#fff" stroke-width="0.4" data-g="${g}"><title>${esc(nm(g))}: ${esc(fv(get(g)))}</title></path>`; });
      el.innerHTML = s + "</svg>";
      el.querySelectorAll("path").forEach((p) => { p.style.cursor = "pointer"; p.addEventListener("mousemove", () => { $("krHover").textContent = `${nm(p.dataset.g)}: ${fv(get(p.dataset.g))}`; }); p.addEventListener("click", () => { location.hash = "steckbrief/" + p.dataset.g; }); });
      $(`km_${k}_leg`).innerHTML = (C.cat ? C.labels.map((l, i) => `<span>${sw(C.cols[i])} ${esc(l)}</span>`) :
        C.cols.map((c, i) => `<span>${sw(c)} ${i === 0 ? L("unter ", "below ") + fmt(C.bins[1], k === "flaeche" ? 2 : 1) : i === C.cols.length - 1 ? fmt(C.bins[i], k === "flaeche" ? 2 : 1) + L(" und mehr", " and more") : fmt(C.bins[i], k === "flaeche" ? 2 : 1) + " – " + fmt(C.bins[i + 1], k === "flaeche" ? 2 : 1)}</span>`)).join("") + `<span>${sw("#bfbfbf")} ${L("keine Daten", "no data")}</span>`;
      $(`km_${k}_title`).textContent = C.t; $(`km_${k}_ask`).textContent = C.ask;
      $(`km_${k}_src`).textContent = L("Quelle: eigene Berechnungen auf Basis von INKAR 2025 (BBSR), der Regionaldatenbank Deutschland und dem Caliendo-Parro-Modell; Kartengrundlage: © EuroGeographics (GISCO). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on INKAR 2025 (BBSR), the Regional Database Germany and the Caliendo-Parro model; base map: © EuroGeographics (GISCO). Licence of the figure: CC BY 4.0.");
      FIGDATA[`km_${k}`] = { header: ["NUTS", L("Kreis", "District"), C.t], rows: Object.keys(K.paths).map((g) => [g, nm(g), C.cat ? fv(get(g)) : get(g)]) };
    });
    $("krHover").textContent = L("Zeiger auf einen Kreis: Name und Wert; Klick öffnet den Kreis-Steckbrief.", "Point at a district: name and value; click opens the district profile.");
  }

  // district profile: every district indicator with German median and rank
  async function renderSteckbrief() {
    const [S, K] = await Promise.all([getJSON("data/kreise_steckbrief.json"), getJSON("data/kreise_energy.json")]);
    const inp = $("sbInput"), keys = Object.keys(S.kreise).sort((a, b) => S.kreise[a].n.localeCompare(S.kreise[b].n, "de"));
    const label = (g) => `${S.kreise[g].n} (${S.kreise[g].land})`;
    if (!inp.dataset.ready) {
      inp.dataset.ready = "1";
      $("sbList").innerHTML = keys.map((g) => `<option value="${esc(label(g))}"></option>`).join("");
      inp.addEventListener("change", () => { const g = keys.find((x) => label(x) === inp.value || S.kreise[x].n === inp.value); if (g) { location.hash = "steckbrief/" + g; } });
      $("sbPrint").addEventListener("click", () => window.print());
    }
    const g = S.kreise[state.kreis] ? state.kreis : (keys.find((x) => S.kreise[x].n.startsWith("Regensburg, Stadt")) || keys[0]);
    const k = S.kreise[g], I = S.indicators;
    inp.value = label(g);
    const fv = (key, v) => v === null || v === undefined ? "–" : `${fmt(v, I[key].d)}${I[key].u}`;
    $("sbName").textContent = `${k.n}, ${k.land}`;
    // notable: top or bottom 10 % among districts with data
    const notable = Object.keys(I).filter((key) => !["pop", "loss_mio", "lignite", "grw_c"].includes(key) && k.r[key] !== null).map((key) => ({ key, p: k.r[key] / I[key].n }))
      .filter((x) => x.p <= 0.1 || x.p > 0.9).sort((a, b) => Math.min(a.p, 1 - a.p) - Math.min(b.p, 1 - b.p)).slice(0, 4);
    const nt = notable.map((x) => `${(EN ? I[x.key].en : I[x.key].de)} ${fv(x.key, k.v[x.key])} (${L("Rang", "rank")} ${k.r[x.key]} ${L("von", "of")} ${I[x.key].n})`);
    $("sbAnswer").textContent = L(`${fmt(k.v.pop, 0)} Einwohner. ${k.v.loss_pc !== null ? `Die US-Zölle kosten die Industrie hier im Modell ${fv("dm", k.v.dm)} Produktion, ${fv("loss_pc", k.v.loss_pc)} je Einwohner (Median ${fv("loss_pc", I.loss_pc.med)}). ` : "Für die US-Zölle liegen keine Kreiswerte vor (Geheimhaltung). "}${nt.length ? "Auffällig im Vergleich der Kreise: " + nt.join("; ") + "." : ""}`,
      `${fmt(k.v.pop, 0)} inhabitants. ${k.v.loss_pc !== null ? `In the model US tariffs cost manufacturing here ${fv("dm", k.v.dm)} of output, ${fv("loss_pc", k.v.loss_pc)} per head (median ${fv("loss_pc", I.loss_pc.med)}). ` : "No district values for US tariffs (confidentiality). "}${nt.length ? "Notable among districts: " + nt.join("; ") + "." : ""}`);
    // locator map
    let m = `<svg viewBox="0 0 ${K.width} ${K.height.toFixed(1)}" role="img" aria-label="${esc(k.n)}" style="background:#fff;max-height:340px">`;
    Object.keys(K.paths).forEach((x) => { m += `<path d="${K.paths[x]}" fill="${x === g ? "#002060" : "#e7e6e6"}" stroke="#fff" stroke-width="0.4" data-g="${x}" style="cursor:pointer"><title>${esc(S.kreise[x] ? S.kreise[x].n : x)}</title></path>`; });
    $("sbMap").innerHTML = m + "</svg>";
    $("sbMap").querySelectorAll("path").forEach((p) => p.addEventListener("click", () => { if (S.kreise[p.dataset.g]) location.hash = "steckbrief/" + p.dataset.g; }));
    const groups = [["struktur", L("Wirtschaft und Bevölkerung", "Economy and population")], ["industrie", L("Industrie und Export", "Industry and exports")], ["zoelle", L("US-Zölle (Stand August 2026)", "US tariffs (August 2026)")],
      ["finanzen", L("Gemeindefinanzen, Soziales und Förderung", "Municipal finances, welfare and aid")], ["energie", L("Stromerzeugung", "Power generation")], ["netze", L("Netze und Erreichbarkeit", "Networks and access")], ["gesellschaft", L("Gesellschaft", "Society")]];
    $("sbTables").innerHTML = groups.map(([gid, gl]) => `<h3 style="margin-top:28px">${esc(gl)}</h3><div class="tablewrap"><table><thead><tr><th>${L("Merkmal", "Indicator")}</th><th class="num">${esc(k.n)}</th><th class="num">${L("Median der Kreise", "Median of districts")}</th><th class="num">${L("Rang (1 = höchster Wert)", "Rank (1 = highest)")}</th></tr></thead><tbody>` +
      Object.keys(I).filter((key) => I[key].g === gid).map((key) => `<tr><td>${esc(EN ? I[key].en : I[key].de)}</td><td class="num">${fv(key, k.v[key])}</td><td class="num">${fv(key, I[key].med)}</td><td class="num">${k.r[key] === null ? "–" : `${k.r[key]} / ${I[key].n}`}</td></tr>`).join("") + "</tbody></table></div>").join("");
    $("sbSrc").textContent = L("Quellen: INKAR 2025 (BBSR), Regionaldatenbank Deutschland, Marktstammdatenregister und Breitbandatlas (Bundesnetzagentur), OpenStreetMap (ODbL), BBSR-Referenz der GRW-Fördergebiete, Caliendo-Parro-Modell; eigene Berechnungen. Kreisgrenzen: © EuroGeographics (GISCO). Lizenz: CC BY 4.0.",
      "Sources: INKAR 2025 (BBSR), Regional Database Germany, market master data register and broadband atlas (Federal Network Agency), OpenStreetMap (ODbL), BBSR reference of GRW aid areas, Caliendo-Parro model; own calculations. District boundaries: © EuroGeographics (GISCO). Licence: CC BY 4.0.");
  }

  // trade in services (OECD TiS, IMF IMTS)
  async function renderServices() {
    const S = await getJSON("data/services.json"), y = S.year, li = S.years.length - 1, bn = (v) => L(`${fmt(v, 0)} Mrd. EUR`, `EUR ${fmt(v, 0)} bn`);
    const ui = S.us.years.length - 1, di = S.digital.years.length - 1, X3 = { LUX: L("Luxemburg", "Luxembourg"), MLT: "Malta", CYP: L("Zypern", "Cyprus") }, CN = (p) => X3[p] || cname(p) || p;
    const top = S.types.slice().sort((a, b) => b.x - a.x);
    $("svAnswer").textContent = L(`Deutschland exportierte ${y} Dienstleistungen für ${bn(S.exp[li])} und importierte für ${bn(S.imp[li])}; das Defizit entsteht fast ganz im Reiseverkehr. Größter Abnehmer sind die USA (${bn(S.partners[0].x)}). Mit den USA ist der Dienstleistungshandel nach deutscher Statistik fast ausgeglichen (${fmt(S.us.services[ui], 0)} Mrd. USD), der Warenhandel weist einen Überschuss von ${fmt(S.us.goods[ui], 0)} Mrd. USD aus. Digitale Dienste und Lizenzen kommen zu ${fmt(S.digital.us[di], 0)} % direkt aus den USA, mit Irland zu ${fmt((S.digital.us_ie[di] ?? S.digital.us_ie.filter((v) => v !== null).at(-1)), 0)} %.`,
      `In ${y} Germany exported services worth ${bn(S.exp[li])} and imported ${bn(S.imp[li])}; the deficit arises almost entirely in travel. The largest buyer is the US (${bn(S.partners[0].x)}). According to German statistics, services trade with the US is nearly balanced (USD ${fmt(S.us.services[ui], 0)} bn), while goods trade shows a surplus of USD ${fmt(S.us.goods[ui], 0)} bn. Digital services and licences come ${fmt(S.digital.us[di], 0)} % directly from the US, ${fmt((S.digital.us_ie[di] ?? S.digital.us_ie.filter((v) => v !== null).at(-1)), 0)} % including Ireland.`);
    $("svExplain").textContent = L("OECD, Dienstleistungshandel nach Partnerländern (Zahlungsbilanz, BPM6), Meldeland Deutschland. Bilaterale Werte weichen zwischen den Meldeländern stark ab: Die US-Statistik weist einen deutlich höheren Überschuss der USA im Dienstleistungshandel mit Deutschland aus, weil US-Konzerne digitale Dienste und Lizenzen oft über Töchter in Irland, den Niederlanden oder Luxemburg verbuchen. Warenhandel: IMF IMTS, Zollstatistik (Exporte fob, Importe cif).",
      "OECD, trade in services by partner (balance of payments, BPM6), reporter Germany. Bilateral figures differ widely between reporters: US statistics show a much larger US surplus in services with Germany, because US groups often book digital services and licences through subsidiaries in Ireland, the Netherlands or Luxembourg. Goods: IMF IMTS, customs basis (exports fob, imports cif).");
    // 1 types: paired bars
    const W = 860, rowH = 30, m = { l: 250, r: 70, t: 34, b: 26 }, H = m.t + m.b + rowH * top.length, mx = Math.max(...top.flatMap((r) => [r.x, r.m])) * 1.1, XS = (v) => m.l + v / mx * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img"><rect x="${m.l}" y="6" width="12" height="12" fill="#002060"/><text x="${m.l + 18}" y="16">${L("Exporte", "Exports")}</text><rect x="${m.l + 120}" y="6" width="12" height="12" fill="#a6a6a6"/><text x="${m.l + 138}" y="16">${L("Importe", "Imports")}</text>`;
    niceTicks(0, mx, 5).forEach((t) => { s += `<line class="grid" x1="${XS(t)}" x2="${XS(t)}" y1="${m.t - 4}" y2="${H - m.b}"/><text x="${XS(t)}" y="${H - 8}" text-anchor="middle">${fmt(t, 0)}</text>`; });
    top.forEach((r, i) => { const yy = m.t + i * rowH, nm = EN ? r.en : r.de;
      s += `<text x="${m.l - 8}" y="${yy + rowH / 2 + 4}" text-anchor="end">${esc(nm)}</text><rect x="${m.l}" y="${yy + 3}" width="${XS(r.x) - m.l}" height="${(rowH - 8) / 2}" fill="#002060"><title>${esc(nm)}, ${L("Exporte", "exports")}: ${bn(r.x)}</title></rect><rect x="${m.l}" y="${yy + 3 + (rowH - 8) / 2}" width="${XS(r.m) - m.l}" height="${(rowH - 8) / 2}" fill="#a6a6a6"><title>${esc(nm)}, ${L("Importe", "imports")}: ${bn(r.m)}</title></rect><text x="${XS(Math.max(r.x, r.m)) + 6}" y="${yy + rowH / 2 + 4}">${fmt(r.x - r.m, 0)}</text>`; });
    $("svTChart").innerHTML = s + "</svg>";
    $("svTAsk").textContent = L("Womit verdient Deutschland, wofür zahlt es?", "What does Germany earn on, what does it pay for?");
    $("svTTitle").textContent = L(`Dienstleistungshandel nach Art, ${y}, Mrd. EUR (Zahl rechts: Saldo)`, `Trade in services by type, ${y}, EUR bn (number on the right: balance)`);
    $("svTSrc").textContent = L("Quelle: eigene Berechnungen auf Basis von OECD, Trade in services by partner economy (BPM6). Lizenz der Abbildung: CC BY 4.0.", "Source: own calculations based on OECD, Trade in services by partner economy (BPM6). Licence of the figure: CC BY 4.0.");
    FIGDATA.svtypes = { header: [L("Art", "Type"), L("Exporte, Mrd. EUR", "Exports, EUR bn"), L("Importe, Mrd. EUR", "Imports, EUR bn")], rows: top.map((r) => [EN ? r.en : r.de, r.x, r.m]) };
    // 2 US balance
    lineChart($("svUChart"), S.us.years, [{ label: L("Warenhandel", "Goods"), color: "#002060", bold: true, values: S.us.goods }, { label: L("Dienstleistungen", "Services"), color: "#00B0F0", bold: true, values: S.us.services }], { unit: L("Mrd. USD", "USD bn"), label: "US" });
    $("svUAsk").textContent = L("Wie groß ist der Überschuss mit den USA wirklich?", "How large is the surplus with the US really?");
    $("svUTitle").textContent = L("Saldo Deutschlands mit den USA, Waren und Dienstleistungen, Mrd. USD", "Germany's balance with the US, goods and services, USD bn");
    $("svUSrc").textContent = L("Quelle: IMF IMTS (Waren, Zollstatistik), OECD (Dienstleistungen, Meldeland Deutschland); eigene Berechnungen. Lizenz der Abbildung: CC BY 4.0.", "Source: IMF IMTS (goods, customs basis), OECD (services, reporter Germany); own calculations. Licence of the figure: CC BY 4.0.");
    FIGDATA.svus = { header: [L("Jahr", "Year"), L("Waren, Mrd. USD", "Goods, USD bn"), L("Dienstleistungen, Mrd. USD", "Services, USD bn")], rows: S.us.years.map((yy, i) => [yy, S.us.goods[i], S.us.services[i]]) };
    // 3 digital dependence
    lineChart($("svDChart"), S.digital.years, [{ label: L("USA und Irland", "US and Ireland"), color: "#002060", bold: true, values: S.digital.us_ie }, { label: L("USA", "US"), color: "#00B0F0", values: S.digital.us }], { min: 0, unit: "%", label: "digital" });
    $("svDAsk").textContent = L("Wie abhängig ist Deutschland von digitalen Diensten aus den USA?", "How dependent is Germany on US digital services?");
    $("svDTitle").textContent = L(`Importe von IT-, Telekommunikations- und Informationsdiensten sowie Lizenzgebühren: Anteil aus den USA, % (${y} insgesamt ${bn(S.digital.total[di])})`, `Imports of ICT services and licence fees: share from the US, % (${y} total ${bn(S.digital.total[di])})`);
    $("svDSrc").textContent = L("Quelle: OECD, Trade in services by partner economy; EBOPS SI und SH; eigene Berechnungen. Die direkte US-Quote unterschätzt die Abhängigkeit, weil US-Konzerne viel über Irland abrechnen; Sprünge zwischen einzelnen Jahren spiegeln Meldelücken, für 2014 und 2023 fehlt der Wert für Irland. Lizenz der Abbildung: CC BY 4.0.", "Source: OECD, Trade in services by partner economy; EBOPS SI and SH; own calculations. The direct US share understates dependence, as US groups bill much through Ireland; jumps between single years reflect reporting gaps, and the value for Ireland is missing for 2014 and 2023. Licence of the figure: CC BY 4.0.");
    FIGDATA.svdig = { header: [L("Jahr", "Year"), L("USA, %", "US, %"), L("USA und Irland, %", "US and Ireland, %"), L("Insgesamt, Mrd. EUR", "Total, EUR bn")], rows: S.digital.years.map((yy, i) => [yy, S.digital.us[i], S.digital.us_ie[i], S.digital.total[i]]) };
    $("svTabTitle").textContent = L(`Die wichtigsten Partner im Dienstleistungshandel, ${y}`, `Main partners in services trade, ${y}`);
    $("svTable").innerHTML = `<thead><tr><th>${L("Partner", "Partner")}</th><th class="num">${L("Exporte, Mrd. EUR", "Exports, EUR bn")}</th><th class="num">${L("Importe, Mrd. EUR", "Imports, EUR bn")}</th><th class="num">${L("Saldo", "Balance")}</th></tr></thead><tbody>` +
      S.partners.map((r) => `<tr><td>${esc(CN(r.p))}</td><td class="num">${fmt(r.x, 1)}</td><td class="num">${fmt(r.m, 1)}</td><td class="num">${fmt(r.x - r.m, 1)}</td></tr>`).join("") + "</tbody>";
  }

  // critical raw materials under Chinese export controls (BACI HS22)
  async function renderCritical() {
    const C = await getJSON("data/critical_materials.json"), G = C.groups.slice().sort((a, b) => b.cn_2024 - a.cn_2024), nm = (g) => EN ? g.en : g.de;
    const mg = C.groups.find((g) => g.g === "magnets"), bi = C.groups.find((g) => g.g === "bismuth");
    $("crHead").textContent = L("Kritische Rohstoffe unter chinesischer Exportkontrolle", "Critical raw materials under Chinese export controls");
    $("crAnswer").textContent = L(`Seit 2023 hat China den Export von neun Rohstoffgruppen genehmigungspflichtig gemacht. Direkt aus China kommen bei Permanentmagneten ${fmt(mg.cn_2024, 0)} % und bei Bismut ${fmt(bi.cn_2024, 0)} % der deutschen Importe; bei den meisten anderen liegt der Anteil zwischen 7 und 33 %, weil vieles über Verarbeiter in Frankreich, Belgien oder Österreich kommt. Diese verarbeiten teils chinesisches Vormaterial; die direkte Quote dürfte die Abhängigkeit daher unterschätzen.`,
      `Since 2023 China has placed exports of nine raw-material groups under licensing. Directly from China come ${fmt(mg.cn_2024, 0)} % of German imports of permanent magnets and ${fmt(bi.cn_2024, 0)} % of bismuth; for most others the share lies between 7 and 33 %, as much arrives via processors in France, Belgium or Austria. These partly process Chinese input, so the direct share probably understates dependence.`);
    const W = 860, rowH = 30, m = { l: 300, r: 80, t: 34, b: 26 }, H = m.t + m.b + rowH * G.length, XS = (v) => m.l + v / 100 * (W - m.l - m.r);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img"><rect x="${m.l}" y="6" width="12" height="12" fill="#C00000"/><text x="${m.l + 18}" y="16">${L("Anteil Chinas an den deutschen Importen 2024", "China's share of German imports 2024")}</text><circle cx="${m.l + 356}" cy="12" r="5" fill="none" stroke="#000" stroke-width="1.5"/><text x="${m.l + 366}" y="16">${L("Anteil Chinas an den Weltexporten", "China's share of world exports")}</text>`;
    [0, 25, 50, 75, 100].forEach((t) => { s += `<line class="grid" x1="${XS(t)}" x2="${XS(t)}" y1="${m.t - 4}" y2="${H - m.b}"/><text x="${XS(t)}" y="${H - 8}" text-anchor="middle">${t}</text>`; });
    G.forEach((g, i) => { const y = m.t + i * rowH;
      s += `<text x="${m.l - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(nm(g))}</text><rect x="${m.l}" y="${y + 6}" width="${XS(g.cn_2024) - m.l}" height="${rowH - 12}" fill="#C00000"><title>${esc(nm(g))}: ${fmt(g.cn_2024, 1)} % ${L("aus China", "from China")}</title></rect>`;
      s += `<circle cx="${XS(g.cn_world)}" cy="${y + rowH / 2}" r="5" fill="none" stroke="#000" stroke-width="1.5"><title>${L("Weltexporte", "World exports")}: ${fmt(g.cn_world, 1)} %</title></circle><text x="${XS(g.cn_2024) + 6}" y="${y + rowH / 2 + 4}" fill="#fff" style="paint-order:stroke" stroke="#C00000" stroke-width="0">${""}</text><text x="${XS(g.cn_2024) - 6}" y="${y + rowH / 2 + 4}" text-anchor="end" fill="#fff">${g.cn_2024 >= 10 ? fmt(g.cn_2024, 0) : ""}</text>`; });
    $("crChart").innerHTML = s + "</svg>";
    $("crAsk").textContent = L("Wie stark hängt Deutschland direkt an China?", "How directly does Germany depend on China?");
    $("crTitle").textContent = L("Rohstoffe unter chinesischer Exportkontrolle: Anteil Chinas an den deutschen Importen 2024, %", "Raw materials under Chinese export controls: China's share of German imports 2024, %");
    $("crSrc").textContent = L("Quelle: eigene Berechnungen auf Basis von CEPII BACI HS22; Warengruppen nach den Ankündigungen des chinesischen Handelsministeriums, Zuordnung zu HS-Sechsstellern genähert (Gallium, Germanium und Indium teilen sich Codes mit Niob und Vanadium). Weltexporte: ohne die Verarbeitung im Inland Chinas, die bei Seltenen Erden weit höher liegt. Lizenz der Abbildung: CC BY 4.0.",
      "Source: own calculations based on CEPII BACI HS22; product groups following the announcements of China's Ministry of Commerce, mapping to HS six-digit codes approximate (gallium, germanium and indium share codes with niobium and vanadium). World exports: excluding processing inside China, which for rare earths is far higher. Licence of the figure: CC BY 4.0.");
    FIGDATA.crit = { header: [L("Rohstoff", "Material"), L("China-Anteil Importe 2024, %", "China share imports 2024, %"), L("China-Anteil Weltexporte, %", "China share world exports, %")], rows: G.map((g) => [nm(g), g.cn_2024, g.cn_world]) };
    $("crTable").innerHTML = `<thead><tr><th>${L("Rohstoff", "Material")}</th><th>${L("Kontrolle seit", "Controlled since")}</th><th class="num">${L("Importe 2024, Mio. USD", "Imports 2024, USD m")}</th><th class="num">${L("China 2022, %", "China 2022, %")}</th><th class="num">${L("China 2024, %", "China 2024, %")}</th><th>${L("Größte Lieferländer 2024", "Largest suppliers 2024")}</th></tr></thead><tbody>` +
      G.map((g) => `<tr><td>${esc(nm(g))}</td><td>${g.control}</td><td class="num">${fmt(g.imp_mio_usd, 0)}</td><td class="num">${fmt(g.cn_2022, 0)}</td><td class="num">${fmt(g.cn_2024, 0)}</td><td>${g.top.map((t) => `${esc(t[0])} ${fmt(t[1], 0)} %`).join(", ")}</td></tr>`).join("") + "</tbody>";
  }

  // foreign direct investment (OECD FDI statistics, BMD4)
  async function renderFDI() {
    const F = await getJSON("data/fdi.json"), li = F.years.length - 1, bn = (v) => L(`${fmt(v, 0)} Mrd. EUR`, `EUR ${fmt(v, 0)} bn`), O = F.out;
    const i13 = 0, us = O.usa[li], cn = O.chn[li], w = O.world[li], fsum = (a) => a.reduce((t, v) => t + (v || 0), 0);
    const I = F.inward, X3 = { LUX: L("Luxemburg", "Luxembourg") }, CN = (c) => X3[c] || cname(c) || c;
    $("fdAnswer").textContent = L(`Deutsche Unternehmen hielten ${F.year} Direktinvestitionen von ${bn(w)} im Ausland, ${bn(us)} davon in den USA (${fmt(100 * us / w, 0)} %) und ${bn(cn)} in China (${fmt(100 * cn / w, 0)} %). Seit ${F.years[i13]} ist der Bestand in den USA um ${fmt(100 * (us / O.usa[i13] - 1), 0)} % gewachsen, in China um ${fmt(100 * (cn / O.chn[i13] - 1), 0)} %. Umgekehrt investieren chinesische Unternehmen wenig in Deutschland: ${bn(I.CHN.ult)} nach dem letzten Investor (${F.inward_year}), US-Unternehmen ${bn(I.USA.ult)}.`,
      `In ${F.year} German companies held direct investment of ${bn(w)} abroad, ${bn(us)} of it in the US (${fmt(100 * us / w, 0)} %) and ${bn(cn)} in China (${fmt(100 * cn / w, 0)} %). Since ${F.years[i13]} the stock in the US has grown by ${fmt(100 * (us / O.usa[i13] - 1), 0)} %, in China by ${fmt(100 * (cn / O.chn[i13] - 1), 0)} %. Conversely, Chinese companies invest little in Germany: ${bn(I.CHN.ult)} by ultimate investor (${F.inward_year}), US companies ${bn(I.USA.ult)}.`);
    $("fdExplain").textContent = L("OECD, Direktinvestitionsstatistik nach Partnerländern (BMD4, Richtungsprinzip), Meldeland Deutschland, alle Einheiten, Euro. Ausländische Bestände nach dem unmittelbaren Partnerland; Investitionen in Deutschland zusätzlich nach dem letzten Investor, der über Holdings in den Niederlanden oder Luxemburg geleitete Mittel dem Herkunftsland zuordnet. Die Ströme schwanken stark, weil sie reinvestierte Gewinne und konzerninterne Kredite enthalten.",
      "OECD, FDI statistics by partner country (BMD4, directional principle), reporter Germany, all units, euro. Outward positions by immediate partner; inward also by ultimate investor, which assigns funds routed via holdings in the Netherlands or Luxembourg to the country of origin. Flows are volatile as they include reinvested earnings and intra-group loans.");
    lineChart($("fdSChart"), F.years, [{ label: L("USA", "US"), color: "#002060", bold: true, values: O.usa }, { label: "China", color: "#C00000", bold: true, values: O.chn }], { min: 0, unit: L("Mrd. EUR", "EUR bn"), label: "FDI" });
    $("fdSAsk").textContent = L("Wie groß ist das deutsche Engagement in den USA und in China?", "How large is German investment in the US and China?");
    $("fdSTitle").textContent = L("Bestand deutscher Direktinvestitionen, Mrd. EUR", "Stock of German direct investment, EUR bn");
    $("fdSSrc").textContent = L("Quelle: OECD, FDI statistics by partner country; eigene Darstellung. Lizenz der Abbildung: CC BY 4.0.", "Source: OECD, FDI statistics by partner country; own presentation. Licence of the figure: CC BY 4.0.");
    FIGDATA.fdstock = { header: [L("Jahr", "Year"), L("USA, Mrd. EUR", "US, EUR bn"), L("China, Mrd. EUR", "China, EUR bn"), L("Welt, Mrd. EUR", "World, EUR bn")], rows: F.years.map((y, i) => [y, O.usa[i], O.chn[i], O.world[i]]) };
    lineChart($("fdFChart"), F.flows.years, [{ label: L("USA", "US"), color: "#002060", bold: true, values: F.flows.usa }, { label: "China", color: "#C00000", bold: true, values: F.flows.chn }], { unit: L("Mrd. EUR", "EUR bn"), label: "FDI flows" });
    $("fdFAsk").textContent = L("Fließt neues Kapital eher in die USA oder nach China?", "Does new capital flow rather to the US or to China?");
    $("fdFTitle").textContent = L(`Neue deutsche Direktinvestitionen (netto), Mrd. EUR; Summe ${F.flows.years[0]} bis ${F.flows.years.at(-1)}: USA ${fmt(fsum(F.flows.usa), 0)}, China ${fmt(fsum(F.flows.chn), 0)}`, `New German direct investment (net), EUR bn; sum ${F.flows.years[0]} to ${F.flows.years.at(-1)}: US ${fmt(fsum(F.flows.usa), 0)}, China ${fmt(fsum(F.flows.chn), 0)}`);
    $("fdFSrc").textContent = L("Quelle: OECD, FDI statistics by partner country (Finanzströme); eigene Darstellung. Lizenz der Abbildung: CC BY 4.0.", "Source: OECD, FDI statistics by partner country (financial flows); own presentation. Licence of the figure: CC BY 4.0.");
    FIGDATA.fdflow = { header: [L("Jahr", "Year"), L("USA, Mrd. EUR", "US, EUR bn"), L("China, Mrd. EUR", "China, EUR bn")], rows: F.flows.years.map((y, i) => [y, F.flows.usa[i], F.flows.chn[i]]) };
    $("fdTabTitle").textContent = L(`Direktinvestitionen in Deutschland ${F.inward_year}: unmittelbares Partnerland und letzter Investor, Mrd. EUR`, `Direct investment in Germany ${F.inward_year}: immediate partner and ultimate investor, EUR bn`);
    $("fdTable").innerHTML = `<thead><tr><th>${L("Land", "Country")}</th><th class="num">${L("Unmittelbarer Partner", "Immediate partner")}</th><th class="num">${L("Letzter Investor", "Ultimate investor")}</th></tr></thead><tbody>` +
      Object.keys(I).sort((a, b) => (I[b].ult || 0) - (I[a].ult || 0)).map((c) => `<tr><td>${esc(CN(c))}</td><td class="num">${I[c].imc === null ? "–" : fmt(I[c].imc, 1)}</td><td class="num">${I[c].ult === null ? "–" : fmt(I[c].ult, 1)}</td></tr>`).join("") + "</tbody>";
  }

  async function renderProcurement() {
    const B = await getJSON("data/bigg_ted.json"), pc = (v, d = 0) => `${fmt(100 * v, d)} %`;
    const LV = { central: L("Bund", "Federal"), regional_local: L("Länder und Kommunen", "Länder and municipalities"), public_body: L("Öffentliche Einrichtungen", "Public bodies"), utilities_other: L("Sektorenauftraggeber, sonstige", "Utilities, other") };
    const lv = B.f1_levels, c2 = B.f2_concentration, c3 = B.f3_competition, c4 = B.f4_persistence, cov = B.coverage;
    const last = (a) => a[a.length - 1], avg = (a, k) => a.reduce((t, r) => t + r[k], 0) / a.length, f3l = last(c3), f4l = last(c4), f2l = { y0: c2[0].year, y1: last(c2).year, top100: avg(c2, "top100"), top1pct_awards: avg(c2, "top1pct_awards") };
    const yrs = (a) => a.map((r) => r.year);
    $("pcAnswer").textContent = L(
      `Der Bund vergibt ${pc(lv.central.share)} des in TED veröffentlichten Auftragsvolumens, trägt aber ${pc(lv.central.var_share)} zu dessen Schwankung bei. Die Nachfrage ist granular: Im Mittel der Jahre ${f2l.y0} bis ${f2l.y1} gingen ${pc(f2l.top100)} des Volumens an die 100 größten Auftragnehmer, und das größte 1 % der Aufträge machte ${pc(f2l.top1pct_awards)} aus. ${f3l.year} erhielten ${pc(f3l.single_bid)} der Vergaben nur ein Angebot. ${pc(f4l.value_incumbent_firm)} des Volumens ${f4l.year} gingen an Firmen, die schon in den drei Vorjahren einen Auftrag erhielten.`,
      `The federal government awards ${pc(lv.central.share)} of the contract volume published in TED but accounts for ${pc(lv.central.var_share)} of its fluctuation. Demand is granular: on average over ${f2l.y0} to ${f2l.y1} the 100 largest contractors received ${pc(f2l.top100)} of the volume, and the largest 1 % of contracts accounted for ${pc(f2l.top1pct_awards)}. In ${f3l.year} ${pc(f3l.single_bid)} of awards received a single bid. ${pc(f4l.value_incumbent_firm)} of the ${f4l.year} volume went to firms that already won a contract in the three preceding years.`);
    $("pcExplain").textContent = L(
      "Nachbau der Fakten aus Cox, Müller, Pasten, Schoenle und Weber (2024, „Big G“) für Deutschland. Daten: Zuschlagsbekanntmachungen in TED (Amtsblatt der EU) mit Auftraggeber in Deutschland, 2016 bis 2025, also nur Aufträge über den EU-Schwellenwerten. Werte wie veröffentlicht, meist ohne Umsatzsteuer; Aufträge über 5 Mrd. EUR gelten als Eingabefehler. Bei mehreren Auftragnehmern wird der Wert gleich verteilt. Tragen mindestens drei Zuschläge einer Meldung exakt denselben Wert, gilt er als Gesamtwert der Meldung und wird aufgeteilt (etwa bei der Maskenbeschaffung des Bundes 2020). Firmennamen sind nur grob vereinheitlicht (ohne Rechtsform). Viele Bekanntmachungen nennen keinen Wert. Viele Rüstungsaufträge fehlen, weil sie nicht EU-weit ausgeschrieben werden müssen. Zuschlagswerte sind keine Ausgaben: Rahmenverträge werden oft nicht voll abgerufen.",
      "Replication of the facts in Cox, Müller, Pasten, Schoenle and Weber (2024, “Big G”) for Germany. Data: contract award notices in TED (Official Journal of the EU) with a buyer in Germany, 2016 to 2025, hence only contracts above the EU thresholds. Values as published, mostly net of VAT; awards above EUR 5 bn are treated as input errors. With several contractors the value is split equally. If at least three awards of one notice carry exactly the same value, it is read as the notice total and split (e.g. the federal mask procurement in 2020). Firm names are harmonised only roughly (legal form removed). Many notices give no value. Many defence contracts are missing because they need not be tendered EU-wide. Award values are not spending: framework agreements are often not fully used.");
    const Q = B.f1_quarterly, ks = Object.keys(LV).filter((k) => Q[k]), cols = ["#002060", "#C00000", "#7F7F7F", "#B4C7E7"];
    lineChart($("pcQChart"), Q.q, ks.map((k, i) => ({ label: LV[k], color: cols[i], bold: i < 2, values: Q[k] })), { min: 0, unit: L("Mrd. EUR", "EUR bn"), label: "TED" });
    $("pcQAsk").textContent = L("Wie stark schwankt die öffentliche Nachfrage, und wer treibt die Schwankung?", "How much does public demand fluctuate, and who drives it?");
    $("pcQTitle").textContent = L("Vergebenes Auftragsvolumen je Quartal nach Auftraggeber, Mrd. EUR", "Contract volume awarded per quarter by buyer, EUR bn");
    $("pcQSrc").textContent = L("Quelle: TED (Amt für Veröffentlichungen der EU), eigene Berechnung. Lizenz der Abbildung: CC BY 4.0.", "Source: TED (Publications Office of the EU), own calculation. Licence of the figure: CC BY 4.0.");
    FIGDATA.pcq = { header: [L("Quartal", "Quarter"), ...ks.map((k) => `${LV[k]}, ${L("Mrd. EUR", "EUR bn")}`)], rows: Q.q.map((q, i) => [q, ...ks.map((k) => Q[k][i])]) };
    lineChart($("pcCChart"), yrs(c2), [{ label: L("100 größte Auftragnehmer", "100 largest contractors"), color: "#002060", bold: true, values: c2.map((r) => 100 * r.top100) }, { label: L("10 größte Auftragnehmer", "10 largest contractors"), color: "#C00000", bold: true, values: c2.map((r) => 100 * r.top10) }, { label: L("Größtes 1 % der Aufträge", "Largest 1 % of contracts"), color: "#7F7F7F", values: c2.map((r) => 100 * r.top1pct_awards) }], { min: 0, unit: "%", label: "share" });
    $("pcCAsk").textContent = L("Verteilt sich die Nachfrage breit oder auf wenige Firmen?", "Is demand spread widely or concentrated on few firms?");
    $("pcCTitle").textContent = L("Anteil am Auftragsvolumen, %", "Share of contract volume, %");
    $("pcCSrc").textContent = $("pcQSrc").textContent;
    FIGDATA.pcc = { header: [L("Jahr", "Year"), L("Firmen", "Firms"), L("10 größte, %", "Top 10, %"), L("100 größte, %", "Top 100, %"), L("Größtes 1 % der Aufträge, %", "Largest 1 % of contracts, %"), "HHI"], rows: c2.map((r) => [r.year, r.firms, 100 * r.top10, 100 * r.top100, 100 * r.top1pct_awards, r.hhi]) };
    lineChart($("pcBChart"), yrs(c3), [{ label: L("Vergaben mit nur einem Angebot", "Awards with a single bid"), color: "#002060", bold: true, values: c3.map((r) => 100 * r.single_bid) }, { label: L("Anteil am Volumen", "Share of volume"), color: "#C00000", bold: true, values: c3.map((r) => 100 * r.single_bid_value) }], { min: 0, unit: "%", label: "single bid" });
    $("pcBAsk").textContent = L("Wie viel Wettbewerb gibt es um öffentliche Aufträge?", "How much competition is there for public contracts?");
    $("pcBTitle").textContent = L("Vergaben mit nur einem Angebot, %", "Awards with a single bid, %");
    $("pcBSrc").textContent = $("pcQSrc").textContent;
    FIGDATA.pcb = { header: [L("Jahr", "Year"), L("Vergaben mit Angabe", "Awards reporting bids"), L("Median Angebote", "Median bids"), L("Nur ein Angebot, %", "Single bid, %"), L("Volumen mit einem Angebot, %", "Volume with a single bid, %")], rows: c3.map((r) => [r.year, r.n, r.median_bids, 100 * r.single_bid, 100 * r.single_bid_value]) };
    lineChart($("pcPChart"), yrs(c4), [{ label: L("bekannte Firma", "known firm"), color: "#002060", bold: true, values: c4.map((r) => 100 * r.value_incumbent_firm) }, { label: L("bekanntes Paar Auftraggeber–Firma", "known buyer–firm pair"), color: "#C00000", bold: true, values: c4.map((r) => 100 * r.value_repeat_pair) }], { min: 0, max: 100, unit: "%", label: "incumbents" });
    $("pcPAsk").textContent = L("Bleiben die Lieferfirmen des Staates dieselben?", "Does the state keep the same suppliers?");
    $("pcPTitle").textContent = L("Anteil am Auftragsvolumen, %, Rückblick bis drei Jahre", "Share of contract volume, %, looking back up to three years");
    $("pcPSrc").textContent = $("pcQSrc").textContent;
    FIGDATA.pcp = { header: [L("Jahr", "Year"), L("Rückblick, Jahre", "Look-back, years"), L("an bekannte Firmen, %", "to known firms, %"), L("gleiches Paar, %", "same pair, %")], rows: c4.map((r) => [r.year, r.lookback, 100 * r.value_incumbent_firm, 100 * r.value_repeat_pair]) };
    const T = B.f5_type;
    $("pcSTitle").textContent = L(`Was kauft der Staat? Anteil am Volumen 2016 bis 2025: Bauleistungen ${pc(T.works || 0)}, Dienstleistungen ${pc(T.services || 0)}, Lieferungen ${pc(T.supplies || 0)}`, `What does the state buy? Share of volume 2016 to 2025: works ${pc(T.works || 0)}, services ${pc(T.services || 0)}, supplies ${pc(T.supplies || 0)}`);
    $("pcSTable").innerHTML = `<thead><tr><th>CPV</th><th>${L("Bereich", "Division")}</th><th class="num">${L("Anteil am Volumen", "Share of volume")}</th></tr></thead><tbody>` + B.f5_cpv2.map((r) => `<tr><td>${esc(r.cpv2)}</td><td>${esc(L(r.de, r.en))}</td><td class="num">${pc(r.share, 1)}</td></tr>`).join("") + "</tbody>";
    $("pcCovTitle").textContent = L("Abdeckung der Daten je Jahr", "Data coverage by year");
    $("pcCovTable").innerHTML = `<thead><tr><th>${L("Jahr", "Year")}</th><th class="num">${L("Bekanntmachungen", "Notices")}</th><th class="num">${L("Vergaben", "Awards")}</th><th class="num">${L("Volumen, Mrd. EUR", "Volume, EUR bn")}</th><th class="num">${L("mit Wert", "with value")}</th><th class="num">${L("mit Auftragnehmer", "with contractor")}</th><th class="num">${L("mit Angebotszahl", "with bid count")}</th></tr></thead><tbody>` +
      cov.map((r) => `<tr><td>${r.year}</td><td class="num">${fmt(r.notices, 0)}</td><td class="num">${fmt(r.awards, 0)}</td><td class="num">${fmt(r.value_bn, 1)}</td><td class="num">${pc(r.share_with_value)}</td><td class="num">${pc(r.share_with_winner)}</td><td class="num">${pc(r.share_with_bids)}</td></tr>`).join("") + "</tbody>";
  }

  // ---------------------------------------------------------------- government expenditure by function
  // Tufte rules: direct labels instead of legends, one accent (social protection, dark blue), greys otherwise
  const ACC = "#002060", G1 = "#595959", G2 = "#8c8c8c", G3 = "#bfbfbf", G4 = "#e6e6e6";
  const LEVELS = () => ({ S1311: [L("Bund", "Federal"), "B"], S1312: [L("Länder", "Länder"), "L"], S1313: [L("Gemeinden", "Municipalities"), "G"], S1314: [L("Sozialversicherung", "Social security"), "S"] });
  const spread = (labs, gap) => { labs.sort((a, b) => a.y - b.y); for (let k = 1; k < labs.length; k++) if (labs[k].y - labs[k - 1].y < gap) labs[k].y = labs[k - 1].y + gap; return labs; };

  function slopegraph(el, cols, rows, opt) {
    // cols: year labels; rows: {label, values:[..], accent}; values above opt.brk drawn in a top band (axis break)
    const W = 860, m = { l: 300, r: 300, t: 34, b: 16 }, H = opt.h || 520, brk = opt.brk;
    const vals = rows.flatMap((r) => r.values), lowVals = vals.filter((v) => !brk || v <= brk), hiVals = vals.filter((v) => brk && v > brk);
    const topBand = brk ? 70 : 0, gap = brk ? 26 : 0, lowTop = m.t + topBand + gap, lowHi = Math.max(...lowVals) * 1.04;
    const hMin = hiVals.length ? Math.min(...hiVals) - 1 : 0, hMax = hiVals.length ? Math.max(...hiVals) + 1 : 1;
    const y = (v) => brk && v > brk ? m.t + topBand - 10 - ((v - hMin) / (hMax - hMin)) * (topBand - 20) : H - m.b - (v / lowHi) * (H - m.b - lowTop);
    const x = (k) => m.l + ((cols[k] - cols[0]) / (cols.at(-1) - cols[0])) * (W - m.l - m.r);  // columns placed on a time scale
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label)}">`;
    cols.forEach((c, k) => { s += `<text x="${x(k)}" y="16" text-anchor="middle" style="font-weight:600">${c}</text>`; });
    // vertical axis: a thin line per column, ticks with light gridlines between the outer columns
    const lowTicks = niceTicks(0, lowHi, 4).filter((t) => t <= lowHi), hiTicks = hiVals.length ? niceTicks(hMin, hMax, 2) : [];
    cols.forEach((_, k) => { s += `<line x1="${x(k)}" x2="${x(k)}" y1="${m.t - 4}" y2="${H - m.b}" stroke="${G3}" stroke-width="0.8"/>`; });
    [...lowTicks, ...hiTicks].forEach((t) => { const yy = y(t); s += `<line x1="${x(0)}" x2="${x(cols.length - 1)}" y1="${yy}" y2="${yy}" stroke="${G4}" stroke-width="0.8"/><text x="${x(0) + 4}" y="${yy - 3}" style="font-size:11px;fill:${G2}">${fmt(t, 0)}</text>`; });
    s += `<text x="${x(0) + 4}" y="${m.t - 8}" style="font-size:11px;fill:${G2}">%</text>`;
    if (brk) cols.forEach((_, k) => { const yy = m.t + topBand + gap / 2; s += `<path d="M${x(k) - 7},${yy + 3}L${x(k) + 7},${yy - 3}M${x(k) - 7},${yy + 8}L${x(k) + 7},${yy + 2}" stroke="${G2}" stroke-width="1"/>`; });
    rows.forEach((r) => {
      const col = r.accent ? ACC : G2, w = r.accent ? 2.6 : 1.4;
      s += `<path d="${r.values.map((v, k) => (k ? "L" : "M") + x(k) + "," + y(v).toFixed(1)).join("")}" fill="none" stroke="${col}" stroke-width="${w}"><title>${esc(r.label)}</title></path>`;
      r.values.forEach((v, k) => { s += `<circle cx="${x(k)}" cy="${y(v)}" r="${r.accent ? 3.5 : 2.5}" fill="${col}"><title>${esc(`${r.label}, ${cols[k]}: ${fmt(v, 1)} %`)}</title></circle>`; });
    });
    const side = (k, anchor, dx, txt) => spread(rows.map((r) => ({ r, y: y(r.values[k]) + 4 })), 15).forEach((l) => { s += `<text x="${x(k) + dx}" y="${l.y}" text-anchor="${anchor}" style="font-weight:${l.r.accent ? 600 : 400};fill:${l.r.accent ? ACC : "#000"}">${esc(txt(l.r))}</text>`; });
    side(0, "end", -10, (r) => `${r.label}  ${fmt(r.values[0], 1)}`);
    side(cols.length - 1, "start", 10, (r) => `${fmt(r.values.at(-1), 1)}  ${r.label}`);
    for (let k = 1; k < cols.length - 1; k++) rows.forEach((r) => { if (r.accent) s += `<text x="${x(k)}" y="${y(r.values[k]) - 9}" text-anchor="middle" style="fill:${ACC}">${fmt(r.values[k], 1)}</text>`; });
    el.innerHTML = s + "</svg>";
  }

  function sparkTable(el, years, rows, head) {
    // rows: {label, accent, level, spark:[..], change, share}
    const W = 860, rh = 30, top = 30, H = top + rows.length * rh + 6, cx = [0, 330, 360, 560, 700, 860];
    const allIdx = rows.flatMap((r) => r.spark.map((v) => 100 * v / r.spark[0])), SPK = { lo: Math.min(...allIdx), hi: Math.max(...allIdx) };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="table">`;
    head.forEach((h, k) => { s += `<text x="${k === 0 ? 0 : k === 2 ? cx[2] : cx[k + 1] - 10}" y="18" text-anchor="${k === 0 || k === 2 ? "start" : "end"}" style="font-size:12px;fill:${G1}">${esc(h)}</text>`; });
    s += `<line x1="0" x2="${W}" y1="${top - 6}" y2="${top - 6}" stroke="${G3}"/>`;
    rows.forEach((r, i) => {
      const yy = top + i * rh, mid = yy + rh / 2, col = r.accent ? ACC : G1;
      s += `<text x="0" y="${mid + 4}" style="font-weight:${r.accent ? 600 : 400};fill:${r.accent ? ACC : "#000"}">${esc(r.label)}</text>`;
      s += `<text x="${cx[2] - 10}" y="${mid + 4}" text-anchor="end">${fmt(r.level, 0)}</text>`;
      const sv = r.spark.map((v) => 100 * v / r.spark[0]), mx = SPK.hi, mn = SPK.lo, sx = (k) => cx[2] + 10 + (k / (sv.length - 1)) * 170, sy = (v) => yy + rh - 4 - ((v - mn) / (mx - mn || 1)) * (rh - 8);
      s += `<line x1="${sx(0)}" x2="${sx(sv.length - 1)}" y1="${sy(100)}" y2="${sy(100)}" stroke="${G4}"/>`;
      s += `<path d="${sv.map((v, k) => (k ? "L" : "M") + sx(k).toFixed(1) + "," + sy(v).toFixed(1)).join("")}" fill="none" stroke="${col}" stroke-width="1.3"><title>${esc(`${r.label}: ${years.at(-1)} ${fmt(sv.at(-1), 0)} (${years[0]} = 100)`)}</title></path>`;
      s += `<circle cx="${sx(sv.length - 1)}" cy="${sy(sv.at(-1))}" r="2.2" fill="${col}"/><text x="${sx(sv.length - 1) + 6}" y="${sy(sv.at(-1)) + 4}" style="font-size:11px;fill:${G1}">${fmt(sv.at(-1), 0)}</text>`;
      s += `<text x="${cx[4] - 10}" y="${mid + 4}" text-anchor="end">${(r.change > 0 ? "+" : "") + fmt(r.change, 0)}</text>`;
      s += `<text x="${cx[5] - 10}" y="${mid + 4}" text-anchor="end">${fmt(r.share, 1)}</text>`;
    });
    el.innerHTML = s + "</svg>";
  }

  function squarify(items, rect, keepOrder) {
    // keepOrder: lay out in the given order (stable positions over time, pinned tiles first = top left)
    const total = items.reduce((t, d) => t + d.v, 0), out = [];
    let r = { ...rect }, rest = (keepOrder ? items.slice() : items.slice().sort((a, b) => b.v - a.v)).map((d) => ({ ...d, a: (d.v / total) * rect.w * rect.h }));
    const worst = (row, side) => { const s = row.reduce((t, d) => t + d.a, 0), mx = Math.max(...row.map((d) => d.a)), mn = Math.min(...row.map((d) => d.a)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
    while (rest.length) {
      const side = Math.min(r.w, r.h); let row = [rest[0]], i = 1;
      while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
      const s = row.reduce((t, d) => t + d.a, 0);
      if (r.w >= r.h) { const w = s / r.h; let yy = r.y; row.forEach((d) => { const h = d.a / w; out.push({ ...d, x: r.x, y: yy, w, h }); yy += h; }); r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h }; }
      else { const h = s / r.w; let xx = r.x; row.forEach((d) => { const w = d.a / h; out.push({ ...d, x: xx, y: r.y, w, h }); xx += w; }); r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h }; }
      rest = rest.slice(i);
    }
    return out;
  }

  const chgText = (p) => (p === null || !isFinite(p)) ? "" : `${p > 0 ? "+" : ""}${fmt(p, 0)} %`;
  const isDark = (hex) => { const v = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16)); return 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2] < 140; };

  // every function its own hue (Konjunkturmonitor palette); each group a fixed tint of that hue by its COFOG code,
  // so a tile keeps its colour across years and in the zoomed view
  const DIV_HUE = { GF10: "#002060", GF07: "#0070C0", GF01: "#00B0F0", GF04: "#51154A", GF09: "#7030A0", GF03: "#D86DCD", GF02: "#C00000", GF08: "#47D359", GF05: "#2E7D32", GF06: "#595959" };
  const tint = (hex, t) => "#" + [1, 3, 5].map((o) => Math.round(parseInt(hex.slice(o, o + 2), 16) + t * (255 - parseInt(hex.slice(o, o + 2), 16))).toString(16).padStart(2, "0")).join("");
  const groupFill = (code, allCodes) => { const sib = allCodes.filter((c) => c.slice(0, 4) === code.slice(0, 4)).sort(), j = sib.indexOf(code); return tint(DIV_HUE[code.slice(0, 4)] || "#595959", sib.length > 1 ? 0.6 * j / (sib.length - 1) : 0); };
  function cellLabel(c, total, big) {
    const fs = big ? 13 : 11.5, lh = fs + 3, mc = Math.floor(c.w / (fs * 0.56)), lab = c.label.length > mc ? c.label.slice(0, Math.max(1, mc - 1)) + "…" : c.label, col = isDark(c.fill) ? "#fff" : "#000";
    if (c.w < 60 || c.h < (big ? 40 : 32)) return "";
    const pcT = `${fmt(100 * c.v / total, 1)}\u202f%`, amT = `${fmt(c.v, c.v < 10 ? 1 : 0)} ${L("Mrd.", "bn")}`, one = (pcT + " · " + amT).length * fs * 0.56 < c.w - 8;
    const l2 = one ? pcT + " · " + amT : pcT, l3 = !one && c.h > 3 * lh + 4 ? amT : "";
    return `<text x="${c.x + 5}" y="${c.y + lh}" style="font-size:${fs}px;fill:${col}">${esc(lab)}</text><text x="${c.x + 5}" y="${c.y + 2 * lh}" style="font-size:${fs}px;fill:${col}">${l2}</text>` + (l3 ? `<text x="${c.x + 5}" y="${c.y + 3 * lh}" style="font-size:${fs}px;fill:${col}">${l3}</text>` : "");
  }

  function nestedTreemap(el, divs, W, H, zoom, onZoom, opt) {
    const pins = (opt && opt.pins) || new Set(), rank = (opt && opt.rank) || {}, ord = (arr) => arr.slice().sort((a, b) => (pins.has(b.code) - pins.has(a.code)) || ((rank[a.code] ?? 999) - (rank[b.code] ?? 999)));
    const pinMark = (c) => pins.has(c.code) ? `<rect x="${c.x + 1.5}" y="${c.y + 1.5}" width="${Math.max(0, c.w - 3)}" height="${Math.max(0, c.h - 3)}" fill="none" stroke="#000" stroke-width="2.5"/>` : "";
    // divs: {code, label, groups:[{label, v, p}], p}; area = spending, colour = 5-year real change per head
    const total = divs.reduce((t, d) => t + d.groups.reduce((u, g) => u + g.v, 0), 0);
    // area grows with real spending: the box covers scale x full area, the dotted frame marks the peak
    const sc = Math.max(0.05, Math.min(1, (opt && opt.scale) || 1)), BW = W * Math.sqrt(sc), BH = H * Math.sqrt(sc);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="treemap">`;
    if (sc < 0.999) s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#8c8c8c" stroke-dasharray="3,3"/><text x="${W - 6}" y="${H - 8}" text-anchor="end" style="font-size:12px;fill:#595959">${esc((opt && opt.frameLabel) || "")}</text>`;
    if (zoom) {
      const d = divs.find((x) => x.code === zoom), dt = d.groups.reduce((u, g) => u + g.v, 0);
      const allc = d.groups.map((g) => g.code);
      squarify(ord(d.groups.filter((g) => g.v > 0)), { x: 0, y: 0, w: BW, h: BH }, true).forEach((c) => {
        c.fill = groupFill(c.code, allc);
        s += `<g class="tmgrp" data-code="${c.code}" style="cursor:pointer"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${c.fill}" stroke="#fff" stroke-width="2"><title>${esc(`${c.label}: ${fmt(c.v, 1)} ${L("Mrd. EUR", "EUR bn")}, ${fmt(100 * c.v / dt, 1)} % ${L("der Aufgabe", "of the function")}; ${L("real je Einwohner gegenüber fünf Jahren zuvor", "real per head vs five years earlier")} ${chgText(c.p)}`)}</title></rect>`;
        s += cellLabel({ ...c }, dt, true) + pinMark(c) + "</g>";
      });
      el.innerHTML = s + "</svg>";
      el.querySelectorAll(".tmgrp").forEach((g) => g.addEventListener("click", () => opt && opt.onPin && opt.onPin(g.dataset.code)));
      return;
    }
    const blocks = squarify(ord(divs.map((d) => ({ ...d, v: d.groups.reduce((u, g) => u + g.v, 0) }))), { x: 0, y: 0, w: BW, h: BH }, true);
    blocks.forEach((b) => {
      const head = b.h > 40 && b.w > 60 ? 20 : 0;
      s += `<g class="tmdiv" data-code="${b.code}" style="cursor:zoom-in">`;
      s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff"/>`;
      if (head) { const pc = ` ${fmt(100 * b.v / total, 0)}\u202f%`, amt = ` · ${fmt(b.v, 0)} ${L("Mrd.", "bn")}`, mc = Math.floor(b.w / 7.2);
        let lab = b.label, extra = "";
        if (lab.length + pc.length + amt.length <= mc) extra = pc + amt; else if (lab.length + pc.length <= mc) extra = pc; else if (lab.length <= mc) extra = ""; else lab = lab.slice(0, Math.max(1, mc - 1)) + "…";
        s += `<text x="${b.x + 4}" y="${b.y + 14}" style="font-weight:600;font-size:12.5px">${esc(lab)}${extra}</text>`; }
      const allc = b.groups.map((g) => g.code);
      squarify(ord(b.groups.filter((g) => g.v > 0)), { x: b.x + 1, y: b.y + head + 1, w: Math.max(1, b.w - 2), h: Math.max(1, b.h - head - 2) }, true).forEach((c) => {
        c.fill = groupFill(c.code, allc);
        s += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${c.fill}" stroke="#fff" stroke-width="1"><title>${esc(`${b.label}: ${c.label}, ${fmt(c.v, 1)} ${L("Mrd. EUR", "EUR bn")} (${fmt(100 * c.v / total, 1)} %); ${L("real je Einwohner gegenüber fünf Jahren zuvor", "real per head vs five years earlier")} ${chgText(c.p)}`)}</title></rect>`;
        s += cellLabel(c, total, false) + pinMark(c);
      });
      s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#fff" stroke-width="3"/></g>`;
    });
    el.innerHTML = s + "</svg>";
    el.querySelectorAll(".tmdiv").forEach((g) => g.addEventListener("click", () => onZoom(g.dataset.code)));
  }

  function barMatrix(el, rows, levels, opt) {
    // rows = functions, columns = levels; each cell a bar on one common scale, value printed
    const keys = Object.keys(levels), W = 860, lw = 210, cw = (W - lw) / keys.length, rh = 28, top = 30, H = top + rows.length * rh + 4;
    const hi = Math.max(...rows.flatMap((r) => keys.map((k) => r.vals[k]))), bw = (v) => (v / hi) * (cw - 52);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label)}">`;
    keys.forEach((k, j) => { s += `<text x="${lw + j * cw}" y="18" style="font-weight:600">${esc(levels[k][0])}</text>`; });
    s += `<line x1="0" x2="${W}" y1="${top - 6}" y2="${top - 6}" stroke="${G3}"/>`;
    rows.forEach((r, i) => {
      const yy = top + i * rh;
      s += `<text x="0" y="${yy + rh / 2 + 4}" style="font-weight:${r.accent ? 600 : 400};fill:${r.accent ? ACC : "#000"}">${esc(r.label)}</text>`;
      keys.forEach((k, j) => {
        const v = r.vals[k], x0 = lw + j * cw, col = k === "S1311" ? "#000" : G2;
        if (v >= 0.5) s += `<rect x="${x0}" y="${yy + 7}" width="${Math.max(1, bw(v))}" height="${rh - 14}" fill="${col}"><title>${esc(`${r.label}, ${levels[k][0]}: ${fmt(v, 0)} ${opt.unit}`)}</title></rect><text x="${x0 + Math.max(1, bw(v)) + 4}" y="${yy + rh / 2 + 4}" style="font-size:12px">${fmt(v, 0)}</text>`;
        else s += `<text x="${x0}" y="${yy + rh / 2 + 4}" style="font-size:12px;fill:${G2}">–</text>`;
      });
    });
    el.innerHTML = s + "</svg>";
  }

  function lineDirect(el, years, series, opt) {
    const W = 860, H = 330, m = { l: 16, r: 230, t: 24, b: 28 };
    const vals = series.flatMap((s) => s.values), hi = Math.max(...vals) * 1.05, x = (i) => m.l + (i / (years.length - 1)) * (W - m.l - m.r), y = (v) => H - m.b - (v / hi) * (H - m.t - m.b);
    const ticks = niceTicks(0, hi, 4);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label)}">`;
    ticks.forEach((t) => { s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l}" y="${y(t) - 4}" style="font-size:12px;fill:${G1}">${fmt(t, 0)}</text>`; });
    s += `<text x="${m.l}" y="${m.t - 10}" style="font-size:12px;fill:${G1}">${esc(opt.unit)}</text>`;
    years.forEach((yr, i) => { if (yr % 5 === 0 || i === years.length - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" style="font-size:12px;fill:${G1}">${yr}</text>`; });
    series.forEach((se) => { s += `<path d="${se.values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join("")}" fill="none" stroke="${se.color}" stroke-width="${se.bold ? 2.4 : 1.4}"><title>${esc(se.label)}</title></path>`; });
    spread(series.map((se) => ({ se, y: y(se.values.at(-1)) + 4 })), 15).forEach((l) => { s += `<text x="${W - m.r + 8}" y="${l.y}" style="font-weight:${l.se.bold ? 600 : 400};fill:${l.se.color === G3 ? G1 : l.se.color}">${esc(l.se.label)} ${fmt(l.se.values.at(-1), 0)}</text>`; });
    el.innerHTML = s + "</svg>";
  }

  // federal budget by function plan: three levels (main, upper, function), click to descend
  const HF_HUE = { "0": "#00B0F0", "1": "#7030A0", "2": "#002060", "3": "#0070C0", "4": "#595959", "5": "#47D359", "6": "#D86DCD", "7": "#51154A", "8": "#C00000" };
  // federal budget treemap; views: fn (function plan), grp (economic type), epl (ministry); parent maps from bund.json
  // withFunds: core budget plus special funds, minus payments into and between funds; hatched = part from special funds
  const GRP_HUE = { "4": "#00B0F0", "5": "#C00000", "6": "#002060", "7": "#51154A", "8": "#47D359", "9": "#595959" };
  const EPL_HUE = { "11": "#002060", "14": "#C00000", "60": "#595959", "32": "#7F7F7F", "12": "#51154A", "30": "#7030A0", "15": "#0070C0", "17": "#D86DCD", "09": "#47D359", "23": "#2E7D32", "16": "#00B0F0" };
  function bundTree(el, B, yi, path, onNav, withFunds, view) {
    const Y = B.years[yi], VW = B.views[view], P = VW.parent, haveAlt = withFunds && Y.alt;
    const V = haveAlt ? Y.alt[view] : Y.v[view], fp = haveAlt ? Y.part[view] : {};
    const lab = (c) => (view === "fn" && c.length === 1 && EN ? B.haupt_en[c] : VW.labels[c]) || c;
    const chain = (k) => { const a = [k]; while (P[a[0]]) a.unshift(P[a[0]]); return a; };
    const leaves = Object.entries(V).filter(([, v]) => v > 0);
    const under = (k, p) => !p || chain(k).includes(p);
    const sumOf = (p) => leaves.filter(([k]) => under(k, p)).reduce((t, [, v]) => t + v, 0);
    const fundOf = (p) => leaves.filter(([k]) => under(k, p)).reduce((t, [k, v]) => t + Math.min(fp[k] || 0, v), 0);
    const childAt = (k, p) => { const ch = chain(k), i = p ? ch.indexOf(p) : -1; return ch[i + 1]; };
    const kids = (p) => [...new Set(leaves.filter(([k]) => under(k, p)).map(([k]) => childAt(k, p)).filter(Boolean))].sort().map((c) => ({ code: c, label: lab(c), v: sumOf(c) })).filter((d) => d.v > 0);
    const kidsAll = (p) => Object.keys(P).filter((k) => P[k] === p).sort();
    const hue = (c) => view === "fn" ? HF_HUE[c[0]] : view === "grp" ? GRP_HUE[c[0]] : EPL_HUE[chain(c)[0]];
    const fill = (c) => { const ch = chain(c), h = hue(c) || "#595959"; let t = 0;
      for (let d = 1; d < ch.length; d++) { const sib = kidsAll(ch[d - 1]); t += (d === 1 ? 0.5 : 0.3) * (sib.length > 1 ? sib.indexOf(ch[d]) / (sib.length - 1) : 0); }
      if (view === "epl" && !EPL_HUE[ch[0]]) t = Math.max(t, 0.35);  // small ministries: light grey-blue
      return tint(h, Math.min(0.85, t)); };
    const pre = path.at(-1) || "", W = 860, H = 520, total = sumOf(pre);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="treemap federal budget"><defs><pattern id="sfhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" stroke-width="2.2" opacity=".75"/></pattern></defs>`;
    squarify(kids(pre), { x: 0, y: 0, w: W, h: H }).forEach((b) => {
      const sub = kids(b.code), head = sub.length && b.h > 40 && b.w > 60 ? 20 : 0;
      s += `<g class="btblk" data-code="${b.code}" style="cursor:${sub.length ? "zoom-in" : "default"}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff"/>`;
      if (head) { const pc = ` ${fmt(100 * b.v / total, 0)} %`, amt = ` · ${fmt(b.v, b.v < 10 ? 1 : 0)} ${L("Mrd.", "bn")}`, mc = Math.floor(b.w / 7.2); let lb = b.label, ex = "";
        if (lb.length + pc.length + amt.length <= mc) ex = pc + amt; else if (lb.length + pc.length <= mc) ex = pc; else if (lb.length > mc) lb = lb.slice(0, Math.max(1, mc - 1)) + "…";
        s += `<text x="${b.x + 4}" y="${b.y + 14}" style="font-weight:600;font-size:12.5px">${esc(lb)}${ex}</text>`; }
      const cells = sub.length ? squarify(sub, { x: b.x + 1, y: b.y + head + 1, w: Math.max(1, b.w - 2), h: Math.max(1, b.h - head - 2) }) : [{ ...b, x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 }];
      cells.forEach((c) => { c.fill = fill(c.code); const f = haveAlt ? fundOf(c.code) : 0, fh = f > 0 ? Math.min(c.h, c.h * f / c.v) : 0;
        const fx = f > 0 ? `; ${L("davon Sondervermögen", "of which special funds")} ${fmt(f, 2)}` : "";
        s += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${c.fill}" stroke="#fff" stroke-width="1"><title>${esc(`${c.code} ${c.label}: ${fmt(c.v, 2)} ${L("Mrd. EUR", "EUR bn")} (${fmt(100 * c.v / total, 1)} %)${fx}`)}</title></rect>`;
        if (fh > 0.5) s += `<rect x="${c.x}" y="${c.y + c.h - fh}" width="${c.w}" height="${fh}" fill="url(#sfhatch)" pointer-events="none"/>`;
        s += cellLabel(c, total, !sub.length); });
      s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#fff" stroke-width="3"/></g>`;
    });
    el.innerHTML = s + "</svg>";
    el.querySelectorAll(".btblk").forEach((g) => { const c = g.dataset.code; if (kids(c).length) g.addEventListener("click", () => onNav([...path, c])); });
    return { total, lab };
  }

  async function renderState() {
    const C = await getJSON("data/cofog.json"), Y = C.years, li = Y.length - 1, i19 = Y.indexOf(2019), i00 = Y.indexOf(2000);
    const S = C.sectors.S13, dn = (c) => { const d = C.divisions.find((x) => x.code === c); return L(d.de, d.en); };
    const share = (c, i) => 100 * S[c][i] / S.TOTAL[i];
    const real = (sec, c, i) => C.sectors[sec][c][i] * 1e6 / C.pop[i] / C.price_index[i];
    const codes = C.divisions.map((d) => d.code), order = codes.slice().sort((a, b) => S[b][li] - S[a][li]);
    const gdpShare = 100 * S.TOTAL[li] / C.gdp[li];
    const ch = codes.map((c) => ({ c, v: real("S13", c, li) - real("S13", c, i19) })).sort((a, b) => b.v - a.v);
    const extra = 100 * (["S1311", "S1312", "S1313", "S1314"].reduce((t, s) => t + C.sectors[s].TOTAL[li], 0) / S.TOTAL[li] - 1);
    $("stAnswer").textContent = L(
      `Der Staat gab ${Y[li]} ${fmt(S.TOTAL[li] / 1000, 0)} Mrd. EUR aus, ${fmt(gdpShare, 1)} % des BIP. ${fmt(share("GF10", li), 0)} Cent von jedem Euro flossen in die Soziale Sicherung, ${fmt(share("GF07", li), 0)} in die Gesundheit. Am stärksten gestiegen sind seit 2019 die preisbereinigten Ausgaben je Einwohner für ${dn(ch[0].c)} (+${fmt(ch[0].v, 0)} EUR) und ${dn(ch[1].c)} (+${fmt(ch[1].v, 0)} EUR).`,
      `In ${Y[li]} general government spent EUR ${fmt(S.TOTAL[li] / 1000, 0)} bn, ${fmt(gdpShare, 1)} % of GDP. ${fmt(share("GF10", li), 0)} cents of every euro went to social protection, ${fmt(share("GF07", li), 0)} to health. Since 2019, real spending per head rose most for ${dn(ch[0].c).toLowerCase()} (+EUR ${fmt(ch[0].v, 0)}) and ${dn(ch[1].c).toLowerCase()} (+EUR ${fmt(ch[1].v, 0)}).`);
    $("stExplain").textContent = L(
      `Eurostat, Staatsausgaben nach Aufgaben (COFOG), Stand ${String(C._meta.updated || "").slice(0, 10)}. Der Staat umfasst Bund, Länder, Gemeinden und Sozialversicherung; seine Summe ist konsolidiert, Zahlungen zwischen den Ebenen sind herausgerechnet. Die Werte je Ebene enthalten diese Zahlungen und lassen sich nicht addieren (zusammen ${fmt(extra, 0)} % mehr als der Staat insgesamt). Preisbereinigt mit dem Deflator der Konsumausgaben des Staates, in Preisen von ${C.price_base}. Zinsen zählen zu Verwaltung. Die Reihen beginnen 2000; 1995 enthält die Übernahme der Treuhand-Schulden durch den Bund (rund 130 Mrd. EUR).`,
      `Eurostat, government expenditure by function (COFOG), as of ${String(C._meta.updated || "").slice(0, 10)}. General government covers federal, Länder, municipal and social security funds; its total is consolidated, so payments between levels are netted out. Values by level include those payments and cannot be added up (together ${fmt(extra, 0)} % more than the general government total). Deflated with the deflator of government final consumption, ${C.price_base} prices. Interest belongs to administration. Series start in 2000; 1995 includes the federal takeover of the Treuhand debt (about EUR 130 bn).`);
    const src = L("Quelle: Eurostat (gov_10a_exp, demo_gind, nama_10_gdp); eigene Berechnung. Lizenz der Abbildung: CC BY 4.0.", "Source: Eurostat (gov_10a_exp, demo_gind, nama_10_gdp); own calculation. Licence of the figure: CC BY 4.0.");
    // 1 slopegraph of shares
    const cols = [2000, 2019, Y[li]], ci = cols.map((y) => Y.indexOf(y));
    slopegraph($("stSChart"), cols, order.map((c) => ({ label: dn(c), accent: c === "GF10", values: ci.map((i) => share(c, i)) })), { label: "shares", h: 560, brk: 20 });
    $("stSAsk").textContent = L("Wofür gibt der Staat sein Geld aus?", "What does the state spend its money on?");
    $("stSTitle").textContent = L(`Anteil an den Staatsausgaben, %: Soziale Sicherung stabil bei ${fmt(share("GF10", li), 0)} %, Gesundheit steigt von ${fmt(share("GF07", i00), 0)} auf ${fmt(share("GF07", li), 0)} % und ist zweitgrößter Posten`, `Share of government expenditure, %: social protection stable at ${fmt(share("GF10", li), 0)} %, health up from ${fmt(share("GF07", i00), 0)} to ${fmt(share("GF07", li), 0)} %, now the second largest item`);
    $("stSSrc").textContent = src;
    FIGDATA.stshare = { header: [L("Jahr", "Year"), ...order.map((c) => `${dn(c)}, %`)], rows: Y.slice(i00).map((y, k) => [y, ...order.map((c) => +share(c, i00 + k).toFixed(2))]) };
    // 2 sparkline table
    const ys = Y.slice(i00);
    sparkTable($("stMChart"), ys, order.map((c) => ({ label: dn(c), accent: c === "GF10", level: real("S13", c, li), spark: ys.map((_, k) => real("S13", c, i00 + k)), change: real("S13", c, li) - real("S13", c, i19), share: share(c, li) })),
      [L("Aufgabe", "Function"), L(`EUR je Einw. ${Y[li]}`, `EUR per head ${Y[li]}`), L(`Index 2000 = 100, bis ${Y[li]}`, `index 2000 = 100, to ${Y[li]}`), L("seit 2019, EUR", "since 2019, EUR"), L("Anteil, %", "share, %")]);
    $("stMAsk").textContent = L("Wo ist das Niveau gestiegen?", "Where has the level risen?");
    $("stMTitle").textContent = L(`Ausgaben je Einwohner in Preisen von ${C.price_base}: seit 2019 real +${fmt(real("S13", "TOTAL", li) - real("S13", "TOTAL", i19), 0)} EUR, davon ${fmt(100 * (real("S13", "GF10", li) - real("S13", "GF10", i19)) / (real("S13", "TOTAL", li) - real("S13", "TOTAL", i19)), 0)} % für Soziale Sicherung; Verlaufslinien als Index 2000 = 100 auf gemeinsamer Skala`, `Expenditure per head at ${C.price_base} prices: real +EUR ${fmt(real("S13", "TOTAL", li) - real("S13", "TOTAL", i19), 0)} since 2019, ${fmt(100 * (real("S13", "GF10", li) - real("S13", "GF10", i19)) / (real("S13", "TOTAL", li) - real("S13", "TOTAL", i19)), 0)} % of it for social protection; trend lines as index 2000 = 100 on one scale`);
    $("stMSrc").textContent = src;
    FIGDATA.stmult = { header: [L("Jahr", "Year"), ...order.map((c) => `${dn(c)}, EUR`)], rows: ys.map((y, k) => [y, ...order.map((c) => Math.round(real("S13", c, i00 + k)))]) };
    // 3 zoomable treemap: stable layout (order of the latest year), pinned tiles top left, optional film
    const yr = $("stYear"); yr.min = 2000; yr.max = Y[li];
    const TM = renderState.tm || (renderState.tm = { zoom: null, pins: new Set(), anim: null });
    const rank = {}; codes.slice().sort((a, b) => S[b][li] - S[a][li]).forEach((c, k) => { rank[c] = k; });
    Object.keys(C.groups).sort((a, b) => (C.groups[b].values[li] || 0) - (C.groups[a].values[li] || 0)).forEach((g, k) => { rank[g] = k; });
    const realG = (o, i) => i >= 5 && o.values[i] && o.values[i - 5] ? 100 * ((o.values[i] / C.pop[i] / C.price_index[i]) / (o.values[i - 5] / C.pop[i - 5] / C.price_index[i - 5]) - 1) : null;
    const valAt = (arr, yf) => { const i0 = Math.floor(yf) - Y[0], f = yf - Math.floor(yf), a0 = arr[i0] || 0, a1 = arr[Math.min(i0 + 1, Y.length - 1)] || 0; return a0 + f * (a1 - a0); };
    const drawTree = (yf) => {
      yf = yf === undefined ? +yr.value : yf; const yi = Math.floor(yf), i = Y.indexOf(yi);
      $("stYearLab").textContent = yi;
      const divs = codes.map((c) => ({ code: c, label: dn(c), groups: Object.entries(C.groups).filter(([g]) => g.startsWith(c)).map(([g, o]) => ({ code: g, label: L(o.de, o.en), v: valAt(o.values, yf) / 1000, p: realG(o, i) })) }));
      // real totals (prices of the latest year) for the area scale: whole state, or the zoomed function
      const realSeries = TM.zoom ? Y.map((_, k) => (Object.entries(C.groups).filter(([g]) => g.startsWith(TM.zoom)).reduce((t, [, o]) => t + (o.values[k] || 0), 0)) / C.price_index[k]) : Y.map((_, k) => S.TOTAL[k] / C.price_index[k]);
      const from = Y.indexOf(2000), peakK = realSeries.reduce((b, v, k) => (k >= from && v > realSeries[b] ? k : b), from), now = valAt(realSeries, yf);
      const scale = now / realSeries[peakK], frameLabel = L(`Rahmen: Höchststand ${Y[peakK]}, real`, `frame: peak ${Y[peakK]}, real`);
      nestedTreemap($("stTChart"), divs, 860, 520, TM.zoom, (code) => { TM.zoom = code; drawTree(); }, { scale, frameLabel, pins: TM.pins, rank, onPin: (code) => { TM.pins.has(code) ? TM.pins.delete(code) : TM.pins.add(code); drawTree(); } });
      const tot = divs.reduce((t, d) => t + d.groups.reduce((u, g) => u + g.v, 0), 0), zd = TM.zoom && divs.find((d) => d.code === TM.zoom);
      $("stCrumb").innerHTML = zd ? `<a href="javascript:void 0" data-top="1">${L("Alle Aufgaben", "All functions")}</a> › ${esc(zd.label)} <span style="color:#595959">· ${L("Klick auf eine Gruppe heftet sie oben links an (schwarzer Rahmen)", "click a group to pin it top left (black frame)")}</span>` : L("Klick auf eine Aufgabe vergrößert sie.", "Click a function to zoom in.") + (TM.pins.size ? ` <span style="color:#595959">· ${TM.pins.size} ${L("angeheftet", "pinned")}</span>` : "");
      $("stTTitle").textContent = zd
        ? L(`Grundriss der Staatsausgaben ${yi}, ${zd.label}: ${fmt(zd.groups.reduce((u, g) => u + g.v, 0), 0)} Mrd. EUR nach Gruppen; Fläche = Ausgaben`, `Floor plan of government spending ${yi}, ${zd.label}: EUR ${fmt(zd.groups.reduce((u, g) => u + g.v, 0), 0)} bn by group; area = spending`)
        : L(`Grundriss der Staatsausgaben ${yi}: zehn Aufgaben und ihre Gruppen, ${fmt(tot, 0)} Mrd. EUR; Fläche = Ausgaben`, `Floor plan of government spending ${yi}: ten functions and their groups, EUR ${fmt(tot, 0)} bn; area = spending`);
      FIGDATA.sttree = { header: ["COFOG", L("Aufgabe", "Function"), L("Gruppe", "Group"), L("Mrd. EUR", "EUR bn")], rows: divs.flatMap((d) => d.groups.map((g) => [g.code, d.label, g.label, +g.v.toFixed(2)])) };
    };
    const stop = () => { if (TM.anim) cancelAnimationFrame(TM.anim); TM.anim = null; $("stPlay").textContent = L("Abspielen", "Play"); };
    const play = () => {
      if (TM.anim) return stop();
      let yf = +yr.value >= Y[li] ? Y[0] : +yr.value, last = null; $("stPlay").textContent = L("Pause", "Pause");
      const step = (t) => { if (last !== null) yf += (t - last) / 700; last = t; if (yf >= Y[li]) { yf = Y[li]; yr.value = yf; drawTree(yf); return stop(); } yr.value = Math.floor(yf); drawTree(yf); TM.anim = requestAnimationFrame(step); };
      TM.anim = requestAnimationFrame(step);
    };
    if (!yr.dataset.init) {
      yr.value = Y[li]; yr.dataset.init = 1;
      yr.addEventListener("input", () => { stop(); drawTree(); });
      $("stCrumb").addEventListener("click", (e) => { if (e.target.dataset.top) { TM.zoom = null; drawTree(); } });
      $("stPlay").addEventListener("click", play);
    }
    drawTree();
    $("stTAsk").textContent = L("Was steckt im Einzelnen dahinter?", "What lies behind it in detail?");
    $("stTSrc").textContent = L("Jede Aufgabe ein Block in eigener Farbe, ihre Gruppen in festen Abstufungen dieser Farbe. Die Anordnung folgt den Ausgaben des letzten Jahres und bleibt über die Zeit gleich. Die Gesamtfläche wächst mit den realen Ausgaben (Preise des letzten Jahres); der gestrichelte Rahmen zeigt den Höchststand. Der Hinweistext jeder Fläche nennt zusätzlich die reale Veränderung je Einwohner gegenüber fünf Jahren zuvor. ", "Each function one block in its own colour, its groups in fixed tints of that colour. The layout follows spending in the latest year and stays fixed over time. The total area grows with real spending (latest-year prices); the dashed frame marks the peak. The tooltip of each cell also gives the real change per head over five years. ") + src;
    // 4 dot plot by level
    const LV = LEVELS();
    barMatrix($("stLChart"), order.map((c) => ({ label: dn(c), accent: c === "GF10", vals: Object.fromEntries(Object.keys(LV).map((sec) => [sec, C.sectors[sec][c][li] / 1000])) })), LV, { label: "levels", unit: L("Mrd. EUR", "EUR bn") });
    $("stLAsk").textContent = L("Welche Ebene gibt wofür aus?", "Which level spends on what?");
    $("stLTitle").textContent = L(`Ausgaben ${Y[li]} je Ebene, Mrd. EUR; alle Balken auf einer Skala`, `Expenditure ${Y[li]} by level, EUR bn; all bars on one scale`);
    $("stLSrc").textContent = L("Bund schwarz hervorgehoben. Werte je Ebene einschließlich Zahlungen an andere Ebenen, etwa des Bundeszuschusses an die Rentenversicherung; nicht addierbar. Strich: unter 0,5 Mrd. EUR. ", "Federal level highlighted in black. Values by level include payments to other levels, such as the federal grant to pension insurance; not additive. Dash: below EUR 0.5 bn. ") + src;
    FIGDATA.stlev = { header: [L("Aufgabe", "Function"), ...Object.values(LV).map((l) => `${l[0]}, ${L("Mrd. EUR", "EUR bn")}`)], rows: order.map((c) => [dn(c), ...Object.keys(LV).map((s) => +(C.sectors[s][c][li] / 1000).toFixed(1))]) };
    // 5 federal government, direct labels, from 2000
    const fed = ["GF10", "GF01", "GF04", "GF02", "GF09"];
    lineDirect($("stBChart"), ys, fed.map((c) => ({ label: dn(c), color: c === "GF10" ? ACC : c === "GF02" ? "#C00000" : G3, bold: c === "GF10" || c === "GF02", values: ys.map((_, k) => real("S1311", c, i00 + k)) })), { unit: L(`EUR je Einwohner, Preise ${C.price_base}`, `EUR per head, ${C.price_base} prices`), label: "federal" });
    $("stBAsk").textContent = L("Wofür gibt der Bund sein Geld aus?", "What does the federal government spend on?");
    $("stBTitle").textContent = L(`Ausgaben des Bundes je Einwohner; Verteidigung ${fmt(real("S1311", "GF02", i19), 0)} EUR (2019) und ${fmt(real("S1311", "GF02", li), 0)} EUR (${Y[li]})`, `Federal expenditure per head; defence EUR ${fmt(real("S1311", "GF02", i19), 0)} (2019) and EUR ${fmt(real("S1311", "GF02", li), 0)} (${Y[li]})`);
    $("stBSrc").textContent = L("Soziale Sicherung des Bundes enthält vor allem die Zuschüsse an die Rentenversicherung und das Bürgergeld. ", "Federal social protection mainly contains grants to pension insurance and basic income support. ") + src;
    FIGDATA.stfed = { header: [L("Jahr", "Year"), ...fed.map((c) => `${dn(c)}, EUR`)], rows: ys.map((y, k) => [y, ...fed.map((c) => Math.round(real("S1311", c, i00 + k)))]) };

    // 6 federal budget treemap (bundeshaushalt.de): function plan, economic type or ministry
    const B = await getJSON("data/bund.json"), BT = renderState.bt || (renderState.bt = { yi: B.years.length - 1, path: [], sf: false, view: "fn" });
    B.haupt_en = { "0": "General services", "1": "Education, research, culture", "2": "Social security, family, labour market", "3": "Health, environment, sport", "4": "Housing, urban development", "5": "Food, agriculture", "6": "Energy, water, trade and industry", "7": "Transport, communications", "8": "Public finance", "9": "Not assigned" };
    const VWL = { fn: L("Funktion", "Function"), grp: L("Ausgabenart", "Economic type"), epl: L("Ressort", "Ministry") };
    const drawBund = () => {
      const Yb = B.years[BT.yi], hasF = !!Yb.alt, sf = BT.sf && hasF;
      const r = bundTree($("stHChart"), B, BT.yi, BT.path, (p) => { BT.path = p; drawBund(); }, sf, BT.view);
      // controls as one text line: breakdown, years (outturn, plan), with or without special funds
      const opt = (attr, v, on, t) => `<button type="button" ${attr}="${v}" aria-pressed="${on}">${esc(t)}</button>`, dot = '<span class="dot">·</span>', gap = '<span class="gap"></span>';
      const grp = (lbl, f) => { const g = B.years.map((y, k) => [y, k]).filter(([y]) => f(y.kind)); return g.length ? `<span>${g.map(([y, k]) => opt("data-k", k, k === BT.yi, `${y.year}${y.kind === "Entwurf" ? L(" Entwurf", " draft") : ""}`)).join('<span style="margin:0 4px"></span>')}<span class="tl">${lbl}</span></span>` : ""; };
      $("stHYears").className = "tline";
      $("stHYears").innerHTML = `<span>${Object.keys(VWL).map((v) => opt("data-v", v, v === BT.view, VWL[v])).join(dot)}</span>` + gap
        + [grp(L("Ist", "outturn"), (k) => k === "Ist"), grp(L("Plan", "plan"), (k) => k !== "Ist")].filter(Boolean).join(gap)
        + gap + `<span${hasF ? "" : ' style="opacity:.45"'}>${opt("data-sf", 0, !sf, L("ohne", "without"))}${dot}${opt("data-sf", 1, sf, L("mit Sondervermögen", "with special funds"))}</span>`;
      $("stHYears").querySelectorAll("button[data-k]").forEach((b) => b.addEventListener("click", () => { BT.yi = +b.dataset.k; drawBund(); }));
      $("stHYears").querySelectorAll("button[data-v]").forEach((b) => b.addEventListener("click", () => { BT.view = b.dataset.v; BT.path = []; drawBund(); }));
      $("stHYears").querySelectorAll("button[data-sf]").forEach((b) => b.addEventListener("click", () => { if (hasF) { BT.sf = b.dataset.sf === "1"; drawBund(); } }));
      const crumbs = [`<a href="javascript:void 0" data-p="">${L("Alle", "All")}</a>`, ...BT.path.map((c, k) => k === BT.path.length - 1 ? esc(r.lab(c)) : `<a href="javascript:void 0" data-p="${BT.path.slice(0, k + 1).join(",")}">${esc(r.lab(c))}</a>`)];
      $("stHCrumb").innerHTML = BT.path.length ? crumbs.join(" › ") : "";
      $("stHCrumb").parentElement.style.display = BT.path.length ? "" : "none";  // path only when zoomed
      $("stHCrumb").querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { BT.path = a.dataset.p ? a.dataset.p.split(",") : []; drawBund(); }));
      const where = BT.path.length ? `, ${r.lab(BT.path.at(-1))}` : "";
      const byDe = { fn: "nach Funktionen", grp: "nach Ausgabenarten", epl: "nach Ressorts" }[BT.view], byEn = { fn: "by function", grp: "by economic type", epl: "by ministry" }[BT.view];
      $("stHTitle").textContent = L(`Grundriss des Bundeshaushalts ${Yb.year} (${Yb.kind})${sf ? " mit Sondervermögen" : ""}${where}: ${fmt(r.total, 1)} Mrd. EUR ${byDe}; Fläche = Ausgaben${sf ? ", schraffiert = Sondervermögen" : ""}`, `Floor plan of the federal budget ${Yb.year} (${Yb.kind === "Ist" ? "outturn" : Yb.kind === "Entwurf" ? "draft" : "plan"})${sf ? " with special funds" : ""}${where}: EUR ${fmt(r.total, 1)} bn ${byEn}; area = spending${sf ? ", hatched = special funds" : ""}`);
      const fnames = Object.keys(Yb.funds || {}), neg = Yb.kind !== "Ist" && Yb.negative < 0;
      const viewDe = { fn: "nach dem Funktionenplan (Aufgaben)", grp: "nach dem Gruppierungsplan (ökonomische Arten: Personal, Sachausgaben, Zuweisungen, Investitionen); Gruppen ohne eigenen Namen tragen den Namen der Obergruppe und ihre Nummer", epl: "nach Einzelplänen (Ressorts) und Kapiteln; Einzelplan 60 (Allgemeine Finanzverwaltung) und 32 (Bundesschuld) gehören keinem Ministerium" }[BT.view];
      const viewEn = { fn: "by the function plan", grp: "by the group plan (economic types: personnel, material spending, grants, investment); groups without own name carry the upper group's name and their number", epl: "by budget section (ministry) and chapter; sections 60 (general financial administration) and 32 (federal debt) belong to no ministry" }[BT.view];
      $("stHSrc").textContent = L(`Kernhaushalt des Bundes ${viewDe}; Ist aus der Haushaltsrechnung, Soll aus dem Haushaltsplan, Entwurf aus dem Regierungsentwurf. Ist und Soll sind nur begrenzt vergleichbar: Das Soll ist eine Obergrenze und enthält globale Ansätze, die sich erst im Ist verteilen. Die Summe kann je Gliederung leicht abweichen, weil negative Ansätze innerhalb eines Blocks verrechnet werden. ${BT.view === "fn" ? "Einige Bezeichnungen sind gekürzt oder aktualisiert (Bürgergeld statt Arbeitslosengeld II). " : ""}${sf ? `Mit den Ausgaben der Sondervermögen (${fnames.join(", ")}; zusammen ${fmt(Yb.funds_total, 1)} Mrd. EUR); Zahlungen des Kernhaushalts an Sondervermögen und zwischen ihnen (${fmt(Yb.netted, 1)} Mrd. EUR, darunter 10 Mrd. EUR vom Infrastruktur-Sondervermögen an den Klima- und Transformationsfonds) sind herausgerechnet. Ohne EU-Eigenmittel, durchlaufende EU-Mittel und Rücklagen für Versorgung. ` : ""}${!hasF ? "Für 2024 enthält die Haushaltsrechnung als Datei keine Sondervermögen. " : ""}${!sf && Yb.special_total ? `Ohne Sondervermögen und EU-Eigenmittel (${fmt(Yb.special_total, 1)} Mrd. EUR). ` : ""}${neg ? `Negative Ansätze (globale Minderausgaben, ${fmt(Yb.negative, 1)} Mrd. EUR) nicht gezeigt. ` : ""}Klick auf einen Block vergrößert ihn. Quelle: bundeshaushalt.de; eigene Berechnung. Lizenz der Abbildung: CC BY 4.0.`,
        `Federal core budget ${viewEn}; outturn from the budget accounts, plan from the budget, draft from the government draft. Outturn and plan are only partly comparable: the plan is a ceiling and contains global items that are spread only in the outturn. The sum can differ slightly between breakdowns because negative items are netted within a block. Names in German. ${sf ? `Including spending of the special funds (${fnames.join(", ")}; together EUR ${fmt(Yb.funds_total, 1)} bn); payments from the core budget to special funds and between them (EUR ${fmt(Yb.netted, 1)} bn) are netted out. Excluding EU own resources, EU pass-through funds and pension reserves. ` : ""}${!hasF ? "For 2024 the budget accounts file contains no special funds. " : ""}${!sf && Yb.special_total ? `Excluding special funds and EU own resources (EUR ${fmt(Yb.special_total, 1)} bn). ` : ""}${neg ? `Negative items (global spending cuts, EUR ${fmt(Yb.negative, 1)} bn) not shown. ` : ""}Click a block to zoom in. Source: bundeshaushalt.de; own calculation. Licence of the figure: CC BY 4.0.`);
      const VWc = B.views[BT.view], codes = [...new Set(B.years.flatMap((y) => [...Object.keys(y.v[BT.view]), ...Object.keys((y.alt || {})[BT.view] || {})]))].sort();
      FIGDATA.stbund = { header: [VWL[BT.view], L("Bezeichnung", "Name"), L("Obergruppe", "Upper level"), ...B.years.map((y) => `${y.year} ${y.kind}, ${L("Mrd. EUR", "EUR bn")}`), ...B.years.filter((y) => y.alt).map((y) => `${y.year} ${y.kind} ${L("mit Sondervermögen", "with special funds")}, ${L("Mrd. EUR", "EUR bn")}`)],
        rows: codes.map((c) => [c, VWc.labels[c] || c, VWc.labels[VWc.parent[c]] || "", ...B.years.map((y) => y.v[BT.view][c] === undefined ? "" : +y.v[BT.view][c].toFixed(3)), ...B.years.filter((y) => y.alt).map((y) => y.alt[BT.view][c] === undefined ? "" : +y.alt[BT.view][c].toFixed(3))]) };
    };
    drawBund();
    $("stHAsk").textContent = L("Wofür gibt der Bund im Einzelnen aus?", "What does the federal government spend on in detail?");
  }

  function renderForecast() {
    const names = EN ? { naive: "Naive", ar: "AR (benchmark)", bottom_up: "AR by destination", gravity: "Gravity" } : { naive: "Naiv", ar: "AR (Referenz)", bottom_up: "AR nach Zielländern", gravity: "Gravitation" };
    const block = (title, rows, hkey, hlabel) => {
      if (!rows) return "";
      const hs = [...new Set(rows.map((r) => r[hkey]))];
      const models = ["naive", "ar", "bottom_up", "gravity"];
      let t = `<div class="tablewrap"><table><caption>${esc(title)}</caption><thead><tr><th>${L("Modell", "Model")}</th>${hs.map((h) => `<th class="num">${esc(hlabel(h))}</th>`).join("")}</tr></thead><tbody>`;
      models.forEach((m) => {
        t += `<tr><td>${names[m]}</td>` + hs.map((h) => {
          const r = rows.find((x) => x[hkey] === h && x.model === m); if (!r) return "<td></td>";
          if (m === "ar") return `<td class="num">RMSE ${fmt(r.rmse, 1)}\u202f%</td>`;
          const cls = r.dm_pvalue < 0.1 ? (r.rel_rmse < 1 ? "good" : "bad") : "even";
          return `<td class="num"><span class="chip ${cls}">${fmt(r.rel_rmse)}</span> <span class="hint">p ${fmt(r.dm_pvalue)}</span></td>`;
        }).join("") + "</tr>";
      });
      return t + "</tbody></table></div>";
    };
    const F = D.forecast;
    const mh = EN ? (h) => h === 1 ? "1 month" : `${h} months` : (h) => h === 1 ? "1 Monat" : `${h} Monate`;
    const qh = EN ? (k) => k === 0 ? "quarter ahead" : `${k} month${k > 1 ? "s" : ""} known` : (k) => k === 0 ? "Quartal voraus" : `${k} Monat${k > 1 ? "e" : ""} bekannt`;
    $("forecastTables").innerHTML =
      block(L("Deutsche Ausfuhren, monatlich (Comext, EU27 als Exporteure)", "German exports, monthly (Comext, EU27 as exporters)"), F.forecast_germany.summary_monthly, "h", mh) +
      block(L("Deutsche Ausfuhren, monatlich, ohne März 2020 bis Juni 2021", "German exports, monthly, excluding March 2020 to June 2021"), F.forecast_germany.summary_monthly_excl_covid, "h", mh) +
      block(L("Deutsche Ausfuhren, Quartal", "German exports, quarterly"), F.forecast_germany.summary_quarterly, "known_months", qh) +
      block(L("Welthandel, monatlich (IMF IMTS, 210 Länder)", "World trade, monthly (IMF IMTS, 210 countries)"), F.forecast_world.summary_monthly, "h", mh) +
      block(L("Welthandel, Quartal", "World trade, quarterly"), F.forecast_world.summary_quarterly, "known_months", qh);
  }

  function renderMethod() {
    $("sources").innerHTML = D.meta.sources.map((s) => `<li>${esc(EN ? s.replace("(Szenarien)", "(scenarios)") : s)}</li>`).join("");
    $("built").textContent = EN ? `Calculated on ${fmtDate(D.meta.built)}. ${D.meta.n_countries} countries, ${D.meta.n_products.toLocaleString(LOC)} product groups (${D.meta.level}).` : `Stand der Berechnung: ${new Date(D.meta.built).toLocaleDateString("de-DE")}. ${D.meta.n_countries} Länder, ${D.meta.n_products} Warengruppen (${D.meta.level}).`;
  }

  // ---------------------------------------------------------------- start
  async function start() {
    const [meta, eci, products, edges, forecast] = await Promise.all(["meta", "eci", "products", "edges", "forecast"].map((f) => getJSON(`data/${f}.json`)));
    D = { meta, eci, products, edges, forecast };
    const sel = $("country");
    sel.innerHTML = Object.keys(eci.countries).sort((a, b) => cname(a).localeCompare(cname(b), L("de", "en"))).map((i) => `<option value="${i}"${i === state.iso ? " selected" : ""}>${esc(cname(i))}</option>`).join("");
    sel.addEventListener("change", () => { state.iso = sel.value; state.highlight = null; state.snapYear = null; route(); });
    $("countryHint").textContent = L(`${eci.n_countries} Länder, ${meta.years[0]} bis ${meta.years[1]}`, `${eci.n_countries} countries, ${meta.years[0]} to ${meta.years[1]}`);
    $("stand").textContent = L(`Stand ${new Date(meta.built).toLocaleDateString("de-DE")} · Handelsdaten bis ${meta.years[1]}`, `As of ${fmtDate(meta.built)} · trade data to ${meta.years[1]}`);
    setupFigures();
    $("profPrint").addEventListener("click", () => window.print());
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
  // language switch: keep the current view when changing language
  document.querySelectorAll(".lang a").forEach((a) => a.addEventListener("click", () => { if (location.hash) a.href = a.getAttribute("href").split("#")[0] + location.hash; }));
  start().catch((e) => { document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="note">${L("Die Daten konnten nicht geladen werden", "The data could not be loaded")} (${esc(e.message)}).</p>`); });
})();
