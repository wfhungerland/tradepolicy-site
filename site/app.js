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
  const VIEWS = ["ueberblick", "laender", "profil", "produktraum", "branchen", "abhaengigkeiten", "szenarien", "prognose", "methodik"];
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
    if (view === "abhaengigkeiten") await renderDependencies();
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
      `${who} ist ${Dd.year} bei ${X.n_dependent} von ${X.n_products.toLocaleString(LOC)} Waren abhängig: wenige Lieferländer außerhalb der EU, kaum eigener Ersatz. Bei ${X.n_china_main} davon ist China Hauptlieferant. Rund ${fmt(X.red_sea_share * 100, 0)} % dieser Importe kommen über das Rote Meer. Ein Lieferstopp Chinas bei diesen Waren kostete langfristig ${pct(cv[0])} Realeinkommen${sc.short_run ? `, mit kurzfristigen Elastizitäten ${pct(sc.short_run[lv === "EU27" ? "EU27" : "DEU"])}` : ""}. Bei ${X.n_hard_to_replace} von ${X.n_with_sigma} geschätzten Waren lassen sich Lieferländer kaum austauschen (σ unter 2).`,
      `In ${Dd.year} ${lv === "EU27" ? "the EU depends" : "Germany depends"} on ${X.n_dependent} of ${X.n_products.toLocaleString(LOC)} goods: few suppliers outside the EU and little own substitute. China is the main supplier for ${X.n_china_main} of them. About ${fmt(X.red_sea_share * 100, 0)} % of these imports come through the Red Sea. A Chinese supply stop for these goods would cost ${pct(cv[0])} of real income in the long run${sc.short_run ? `, ${pct(sc.short_run[lv === "EU27" ? "EU27" : "DEU"])} with short-run elasticities` : ""}. For ${X.n_hard_to_replace} of ${X.n_with_sigma} estimated goods suppliers are hard to replace (σ below 2).`);
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
    $("depTable").innerHTML = `<thead><tr><th>HS6</th><th>${L("Ware", "Product")}</th><th>${L("Hauptlieferant", "Main supplier")}</th><th class="num">${L("Anteil", "Share")}</th><th class="num">${L("China", "China")}</th><th class="num">${L("Importe", "Imports")}</th><th class="num">${L("Rotes Meer", "Red Sea")}</th><th class="num">σ</th></tr></thead><tbody>` +
      P.slice(0, 30).map((r) => `<tr><td class="num">${r[0]}</td><td>${esc(EN ? r[2] : (r[1] || r[2]))}${EN ? "" : `<span class="ex">${esc(r[2])}</span>`}</td><td>${esc(cname(r[3]) || r[3])}</td><td class="num">${pc(r[4])}</td><td class="num">${pc(r[5])}</td><td class="num">${bn(fmt(r[6], 2))}</td><td class="num">${pc(r[9])}</td><td class="num">${r[11] === null || r[11] === undefined ? "–" : (r[11] <= 1.05 ? "≤\u202f1,05".replace(",", EN ? "." : ",") : fmt(r[11], 1))}${r[11] !== null && r[11] !== undefined && r[11] < 2 ? ' <span class="chip bad">▲</span>' : ""}</td></tr>`).join("") + "</tbody>";
    const secNames = EN ? S.sector_names_en : S.sector_names;
    $("depIndustries").innerHTML = `<thead><tr><th>${L("Branche in Deutschland", "Industry in Germany")}</th><th class="num">${L("Abhängige Vorleistungen aus China, direkt", "Dependent inputs from China, direct")}</th><th class="num">${L("mit indirekten Lieferketten", "incl. indirect supply chains")}</th><th class="num">${L("Chinesische Wertschöpfung insgesamt", "Chinese value added, all goods")}</th><th class="num">${L("Produktion bei Lieferstopp", "Output if China stops")}</th></tr></thead><tbody>` +
      Dd.germany_industries.map((r) => `<tr><td>${esc(secNames[r[0]] || r[0])}</td><td class="num">${fmt(r[1], 2)}\u202f%</td><td class="num">${fmt(r[4], 2)}\u202f%</td><td class="num">${fmt(r[5], 1)}\u202f%</td><td class="num">${pct(r[2], 1)}</td></tr>`).join("") + "</tbody>";
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
