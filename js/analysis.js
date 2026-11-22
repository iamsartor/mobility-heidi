// Analyse-Seite für die ärztliche Auswertung.
//
// Angelehnt an das Parkinson-Tagebuch nach Hauser, das in Studien und in der Sprechstunde
// üblich ist. Die vier App-Werte werden so zugeordnet:
//   good   → ON ohne Dyskinesien („gute Zeit“)
//   over   → ON mit Dyskinesien (Überbeweglichkeit)
//   poor   → OFF
//   freeze → OFF mit Freezing (zählt zur OFF-Zeit, wird zusätzlich ausgewiesen)
// Alle Anteile beziehen sich auf die ERFASSTEN halben Stunden; Lücken werden nicht geschätzt.
//
// Darstellung nach Edward Tufte: Zahlen und Sparklines statt Diagramm-Dekoration, direkte
// Beschriftung statt Legenden, Small Multiples, keine Gitterlinien.

const pad = (n) => String(n).padStart(2, "0");
const SLOTS = [];
for (let h = 6; h <= 23; h++) for (const m of ["00", "30"]) SLOTS.push(`${pad(h)}:${m}`);
const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const wd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return WD[new Date(y, m - 1, d).getDay()];
};
const dm = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}.`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => (x == null || isNaN(x) ? "–" : `${Math.round(x * 100)} %`);
const num = (x, d = 1) => (x == null || isNaN(x) ? "–" : x.toFixed(d).replace(".", ","));
const active = (m, d) => m.validFrom <= d && (!m.validTo || m.validTo >= d);
const isOff = (s) => s === "poor" || s === "freeze";

const C = { off: "#c4601c", dysk: "#7a52c0", freeze: "#2f86c4", good: "#8a8a8a", ink: "#222", muted: "#8b8594" };

// ---------------------------------------------------------------- Berechnung

function intakesOf(d, meds, devs, cutoff) {
  const out = [];
  for (const m of meds.filter((m) => active(m, d))) {
    const rel = m.doseRelevant !== false;
    for (const t of m.times || []) {
      if (cutoff && t > cutoff) continue;
      const dev = devs.find((x) => x.date === d && x.medId === m.id && x.plannedTime === t && x.type !== "extra");
      if (!dev) out.push({ min: toMin(t), planned: toMin(t), status: "plan", rel, name: m.name });
      else if (dev.type === "late") out.push({ min: toMin(dev.actualTime), planned: toMin(t), status: "late", rel, name: m.name });
      else out.push({ min: null, planned: toMin(t), status: "skipped", rel, name: m.name });
    }
  }
  for (const x of devs.filter((x) => x.date === d && x.type === "extra")) {
    const med = meds.find((m) => m.id === x.medId);
    out.push({ min: toMin(x.actualTime), planned: null, status: "extra", rel: med ? med.doseRelevant !== false : true, name: x.medName });
  }
  return out;
}

const BIN = 30;
const NBINS = 9; // 0–4,5 h, danach „> 4,5 h“

export function analyze({ days, meds, devs, ths }, { from, to, today, nowTime }) {
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const empty = () => ({ over: 0, good: 0, poor: 0, freeze: 0, n: 0 });

  const perDay = dates.map((d) => {
    const day = days[d] || {};
    const mob = day.mobility || {};
    const c = empty();
    for (const s of SLOTS) if (mob[s]) (c[mob[s]]++, c.n++);
    const intakes = intakesOf(d, meds, devs, d === today ? nowTime : null);
    return { d, mob, c, sleep: day.sleepHours ?? null, meals: day.meals || [], notes: day.notes || "", intakes };
  });
  const withData = perDay.filter((x) => x.c.n > 0);
  const tot = empty();
  for (const x of withData) for (const k in tot) tot[k] += x.c[k];
  const share = (k) => (tot.n ? tot[k] / tot.n : null);
  const hoursPerDay = (k) => (withData.length ? (tot[k] * 0.5) / withData.length : null);

  // Wirkverlauf nach Einnahme (nur Medikamente, die direkt auf die Beweglichkeit wirken)
  const bins = [...Array(NBINS + 1)].map(empty);
  const before = empty(); // vor der ersten Einnahme des Tages (Morgen-Akinese)
  // Tagesverlauf
  const tod = SLOTS.map(empty);
  // Mahlzeiten-Effekt: OFF-Anteil 30–90 min nach Einnahme, mit/ohne Mahlzeit ±30 min
  const meal = { with: empty(), without: empty() };

  for (const x of withData) {
    const taken = x.intakes.filter((i) => i.rel && i.min != null).map((i) => i.min).sort((a, b) => a - b);
    SLOTS.forEach((s, i) => {
      const st = x.mob[s];
      if (!st) return;
      tod[i][st]++;
      tod[i].n++;
      const t = toMin(s) + 15;
      const last = taken.filter((m) => m <= t).pop();
      const b = last == null ? before : bins[Math.min(NBINS, Math.floor((t - last) / BIN))];
      b[st]++;
      b.n++;
    });
    for (const dose of taken) {
      const hasMeal = x.meals.some((m) => Math.abs(toMin(m) + 15 - dose) <= 30);
      const g = hasMeal ? meal.with : meal.without;
      for (const s of SLOTS) {
        const t = toMin(s) + 15;
        if (x.mob[s] && t > dose + 30 && t <= dose + 90) (g[x.mob[s]]++, g.n++);
      }
    }
  }
  const offOf = (c) => (c.n ? (c.poor + c.freeze) / c.n : null);
  const dyskOf = (c) => (c.n ? c.over / c.n : null);

  // Wirkeintritt / Wirkdauer aus dem Verlauf ableiten (OFF-Anteil unter / über 50 %)
  let onsetBin = null;
  let wearBin = null;
  for (let i = 0; i < NBINS; i++) {
    if (bins[i].n < 3) continue;
    if (onsetBin == null && offOf(bins[i]) < 0.5) onsetBin = i;
    else if (onsetBin != null && wearBin == null && offOf(bins[i]) >= 0.5) wearBin = i;
  }

  // Einnahmetreue
  const allIntakes = perDay.flatMap((x) => x.intakes.filter((i) => i.rel));
  const planned = allIntakes.filter((i) => i.status !== "extra");
  const late = allIntakes.filter((i) => i.status === "late");
  const adherence = {
    planned: planned.length,
    onTime: planned.filter((i) => i.status === "plan").length,
    late: late.length,
    lateMin: late.length ? late.reduce((s, i) => s + (i.min - i.planned), 0) / late.length : null,
    skipped: planned.filter((i) => i.status === "skipped").length,
    extra: allIntakes.filter((i) => i.status === "extra").length,
  };

  // Phasen: Abschnitte zwischen THS-Änderungen und Änderungen am Medikamentenplan
  const thsSorted = [...ths].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const thsAt = (d) => thsSorted.filter((s) => s.validFrom.slice(0, 10) <= d).pop();
  const thsLabel = (s) => (!s ? "THS ?" : s.mode === "closedLoop" ? "THS Closed-Loop" : `THS ${num(Number(s.sensitivity))}`);
  const planKey = (d) =>
    meds
      .filter((m) => active(m, d) && m.doseRelevant !== false)
      .map((m) => `${m.name}@${(m.times || []).join(",")}`)
      .sort()
      .join("|");
  const phases = [];
  for (const x of perDay) {
    const key = `${thsAt(x.d)?.validFrom || ""}#${planKey(x.d)}`;
    let p = phases[phases.length - 1];
    if (!p || p.key !== key) {
      const prev = p;
      p = { key, from: x.d, to: x.d, c: empty(), days: 0, ths: thsLabel(thsAt(x.d)), planChanged: prev && prev.key.split("#")[1] !== key.split("#")[1] };
      phases.push(p);
    }
    p.to = x.d;
    p.days++;
    for (const k in p.c) p.c[k] += x.c[k];
  }

  // Schlaf und OFF-Anteil am selben Tag
  const sleepPairs = withData.filter((x) => x.sleep != null && x.c.n >= 6).map((x) => [x.sleep, offOf(x.c)]);
  let r = null;
  if (sleepPairs.length >= 5) {
    const mx = sleepPairs.reduce((s, p) => s + p[0], 0) / sleepPairs.length;
    const my = sleepPairs.reduce((s, p) => s + p[1], 0) / sleepPairs.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of sleepPairs) (sxy += (x - mx) * (y - my), sxx += (x - mx) ** 2, syy += (y - my) ** 2);
    r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }

  return {
    from, to, dates, perDay, withData, tot, share, hoursPerDay, coverage: tot.n / (SLOTS.length * dates.length),
    bins, before, onsetBin, wearBin, tod, meal, adherence, phases, thsChanges: thsSorted.filter((s) => s.validFrom.slice(0, 10) > from && s.validFrom.slice(0, 10) <= to),
    sleepPairs, r, offOf, dyskOf, thsLabel,
  };
}

// ---------------------------------------------------------------- Bausteine (SVG)

function sparkline(values, { w = 120, h = 22, max = null, color = C.ink } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`;
  const n = values.length - 1 || 1;
  const vmax = max ?? Math.max(...pts.map(([, v]) => v));
  const vmin = 0;
  const x = (i) => 2 + (i / n) * (w - 4);
  const y = (v) => h - 2 - ((v - vmin) / (vmax - vmin || 1)) * (h - 4);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const iMin = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const iMax = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.1"/>
    <circle cx="${x(iMin[0])}" cy="${y(iMin[1])}" r="1.8" fill="#2a7ab8"/>
    <circle cx="${x(iMax[0])}" cy="${y(iMax[1])}" r="1.8" fill="#c0392b"/>
    <circle cx="${x(last[0])}" cy="${y(last[1])}" r="1.8" fill="${color}"/>
  </svg>`;
}

function lineChart({ series, xLabels, w = 380, h = 180, xTitle, marks = [] }) {
  const L = 30, R = 78, T = 10, B = 30;
  const iw = w - L - R, ih = h - T - B;
  const len = series[0].values.length;
  const x = (i) => L + (len === 1 ? 0 : (i / (len - 1)) * iw);
  const y = (v) => T + ih - v * ih;
  let out = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  // y-Achse: nur 0, 50, 100 %
  for (const v of [0, 0.5, 1]) out += `<text x="${L - 6}" y="${y(v) + 3}" class="ax" text-anchor="end">${v * 100}</text>`;
  out += `<line x1="${L}" x2="${L + iw}" y1="${y(0.5)}" y2="${y(0.5)}" class="ref"/>`;
  for (const [i, lab] of xLabels) out += `<text x="${x(i)}" y="${h - 12}" class="ax" text-anchor="middle">${lab}</text>`;
  if (xTitle) out += `<text x="${L + iw}" y="${h - 1}" class="ax" text-anchor="end">${xTitle}</text>`;
  for (const m of marks) out += `<line x1="${x(m.i)}" x2="${x(m.i)}" y1="${T + ih + 1}" y2="${T + ih + 7}" stroke="${C.ink}" stroke-width="1.2"/>`;
  const labels = [];
  for (const s of series) {
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null) return (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.6}"/>`;
    const lastI = s.values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    if (lastI != null) labels.push({ y: y(s.values[lastI]), x: x(lastI), text: s.label, color: s.color });
  }
  // direkte Beschriftung am Linienende, Überlappung vermeiden
  // von unten nach oben ausweichen, damit nichts unter die Achse rutscht
  labels.sort((a, b) => b.y - a.y);
  for (let i = 1; i < labels.length; i++) if (labels[i - 1].y - labels[i].y < 12) labels[i].y = labels[i - 1].y - 12;
  for (const l of labels) out += `<text x="${l.x + 6}" y="${l.y + 3}" class="lab" fill="${l.color}">${l.text}</text>`;
  return out + `</svg>`;
}

function bar(v, color, w = 80) {
  if (v == null) return "";
  return `<svg class="bar" viewBox="0 0 ${w} 8" width="${w}" height="8" aria-hidden="true"><rect x="0" y="1" width="${Math.max(0.5, v * w)}" height="6" fill="${color}"/></svg>`;
}

// ---------------------------------------------------------------- Seite

export function renderAnalysisHTML(a, { patient, LEVELS }) {
  const days = a.withData.length;
  const seriesOff = a.perDay.map((x) => a.offOf(x.c));
  const seriesDysk = a.perDay.map((x) => a.dyskOf(x.c));
  const seriesFreeze = a.perDay.map((x) => (x.c.n ? x.c.freeze * 0.5 : null));
  const seriesGood = a.perDay.map((x) => (x.c.n ? x.c.good / x.c.n : null));
  const seriesSleep = a.perDay.map((x) => x.sleep);
  const seriesCov = a.perDay.map((x) => x.c.n / SLOTS.length);
  const range = (arr, f) => {
    const v = arr.filter((x) => x != null);
    return v.length ? `${f(Math.min(...v))}–${f(Math.max(...v))}` : "–";
  };
  const h = (k) => num(a.hoursPerDay(k));

  if (!days) return `<section class="an-card"><p>Im gewählten Zeitraum gibt es noch keine Einträge zur Beweglichkeit.</p></section>`;

  // Auf einen Blick
  const rows = [
    ["OFF-Zeit", "schlecht beweglich + Freezing", pct(a.share("poor") + a.share("freeze")), `${num(a.hoursPerDay("poor") + a.hoursPerDay("freeze"))} h/Tag`, sparkline(seriesOff, { max: 1, color: C.off }), range(seriesOff, pct)],
    ["ON mit Dyskinesien", "überbeweglich", pct(a.share("over")), `${h("over")} h/Tag`, sparkline(seriesDysk, { max: 1, color: C.dysk }), range(seriesDysk, pct)],
    ["Freezing", "Teil der OFF-Zeit", pct(a.share("freeze")), `${h("freeze")} h/Tag`, sparkline(seriesFreeze, { color: C.freeze }), range(seriesFreeze, (v) => `${num(v)} h`)],
    ["ON ohne Dyskinesien", "gut beweglich", pct(a.share("good")), `${h("good")} h/Tag`, sparkline(seriesGood, { max: 1, color: C.good }), range(seriesGood, pct)],
    ["Schlaf", "Angabe pro Nacht", `${num(avg(seriesSleep))} h`, "", sparkline(seriesSleep, { color: C.ink }), range(seriesSleep, (v) => `${num(v)} h`)],
    ["Erfassung", "erfasste halbe Stunden 06–24 Uhr", pct(a.coverage), `${days} von ${a.dates.length} Tagen`, sparkline(seriesCov, { max: 1, color: C.muted }), range(seriesCov, pct)],
  ];

  // Wirkverlauf
  // Punkte in der Mitte des 30-min-Intervalls: i = 0 → 15 min; Achse in Stunden
  const binLabels = [[1.5, "1 h"], [3.5, "2 h"], [5.5, "3 h"], [7.5, "4 h"]];
  const onset = a.onsetBin != null ? `${a.onsetBin * 30}–${a.onsetBin * 30 + 30} min` : "nicht erkennbar";
  const wear = a.wearBin != null ? `${num((a.wearBin * 30) / 60)}–${num((a.wearBin * 30 + 30) / 60)} h` : "innerhalb von 4,5 h nicht erkennbar";
  const doseChart = lineChart({
    series: [
      { label: "OFF", color: C.off, values: a.bins.slice(0, NBINS).map(a.offOf) },
      { label: "Dyskinesien", color: C.dysk, values: a.bins.slice(0, NBINS).map(a.dyskOf) },
      { label: "Freezing", color: C.freeze, values: a.bins.slice(0, NBINS).map((c) => (c.n ? c.freeze / c.n : null)), width: 1 },
    ],
    xLabels: binLabels,
    xTitle: "Zeit seit Einnahme",
  });

  // Tagesverlauf
  const todLabels = [0, 4, 8, 12, 16, 20, 24, 28, 32].map((i) => [i, SLOTS[i].slice(0, 2)]);
  const doseSlots = new Set(a.perDay.flatMap((x) => x.intakes.filter((i) => i.rel && i.status !== "extra").map((i) => Math.floor((i.planned - 360) / 30))));
  // über drei benachbarte halbe Stunden (1,5 h) geglättet
  const smooth = a.tod.map((_, i) => {
    const c = { over: 0, good: 0, poor: 0, freeze: 0, n: 0 };
    for (const j of [i - 1, i, i + 1]) if (a.tod[j]) for (const k in c) c[k] += a.tod[j][k];
    return c;
  });
  const todChart = lineChart({
    series: [
      { label: "OFF", color: C.off, values: smooth.map((c) => (c.n >= 4 ? a.offOf(c) : null)) },
      { label: "Dyskinesien", color: C.dysk, values: smooth.map((c) => (c.n >= 4 ? a.dyskOf(c) : null)) },
    ],
    xLabels: todLabels,
    xTitle: "Uhrzeit · Striche = geplante Einnahmen",
    marks: [...doseSlots].filter((i) => i >= 0 && i < SLOTS.length).map((i) => ({ i })),
  });

  // Alle Tage (Small Multiples als Raster)
  const thsByDay = new Map(a.thsChanges.map((s) => [s.validFrom.slice(0, 10), s]));
  const grid = `<div class="an-grid" role="img" aria-label="Beweglichkeit aller Tage">
    <div class="an-row an-head"><span class="an-day"></span><span class="an-cells">${[6, 9, 12, 15, 18, 21].map((hh) => `<i style="left:${((hh - 6) / 18) * 100}%">${hh}</i>`).join("")}</span></div>
    ${a.perDay
      .map((x) => {
        const change = thsByDay.get(x.d);
        const marks = x.intakes.filter((i) => i.rel && i.min != null && i.min >= 360).map((i) => `<b class="dose ${i.status}" style="left:${((i.min - 360) / (18 * 60)) * 100}%"></b>`).join("");
        const skipped = x.intakes.filter((i) => i.rel && i.status === "skipped").map((i) => `<b class="dose skipped" style="left:${((i.planned - 360) / (18 * 60)) * 100}%"></b>`).join("");
        return `${change ? `<div class="an-change">ab ${dm(x.d)} ${a.thsLabel(change)}</div>` : ""}
        <div class="an-row"><span class="an-day">${wd(x.d)} ${dm(x.d)}</span><span class="an-cells">${SLOTS.map((s) => `<i class="${x.mob[s] || ""}"></i>`).join("")}${marks}${skipped}</span></div>`;
      })
      .join("")}
  </div>`;

  // Phasen
  const maxShare = Math.max(...a.phases.map((p) => (p.c.n ? Math.max(a.offOf(p.c), a.dyskOf(p.c)) : 0)), 0.01);
  const phaseRows = a.phases
    .map(
      (p) => `<tr><td>${dm(p.from)}–${dm(p.to)}<br><small>${p.ths}${p.planChanged ? " · neuer Plan" : ""}</small></td>
        <td class="num">${p.days}</td>
        <td class="num">${pct(a.offOf(p.c))}</td><td>${bar(a.offOf(p.c) / maxShare, C.off, 70)}</td>
        <td class="num">${pct(a.dyskOf(p.c))}</td><td>${bar(a.dyskOf(p.c) / maxShare, C.dysk, 70)}</td>
        <td class="num">${pct(p.c.n ? p.c.freeze / p.c.n : null)}</td>
        <td class="num">${pct(p.c.n / (SLOTS.length * p.days))}</td></tr>`,
    )
    .join("");

  // Einnahmetreue, Mahlzeiten, Schlaf
  const ad = a.adherence;
  const mealWith = a.offOf(a.meal.with);
  const mealWithout = a.offOf(a.meal.without);
  const scatter = sleepScatter(a.sleepPairs);

  return `
  <header class="an-head-block">
    <h1>Beweglichkeit ${esc(patient.name)}</h1>
    <p class="an-sub">${wd(a.from)} ${dm(a.from)} bis ${wd(a.to)} ${dm(a.to)}${a.to.slice(0, 4)} · ${days} Tage mit Einträgen · Anteile bezogen auf erfasste halbe Stunden</p>
  </header>

  <section class="an-card an-wide">
    <h2>Auf einen Blick</h2>
    <table class="an-table an-glance">
      <thead><tr><th></th><th class="num">Anteil</th><th class="num hide-mob">Ø</th><th class="spark-col">Verlauf je Tag</th><th class="num">Spanne</th></tr></thead>
      <tbody>${rows.map(([l, sub, p, hh, sp, rg]) => `<tr><td>${l}<br><small>${sub}</small></td><td class="num big">${p}${hh ? `<small class="mob-only">${hh}</small>` : ""}</td><td class="num hide-mob">${hh}</td><td class="spark-col">${sp}</td><td class="num">${rg}</td></tr>`).join("")}</tbody>
    </table>
    <p class="an-note">Sparklines: ein Punkt je Tag; <span style="color:#c0392b">●</span> höchster, <span style="color:#2a7ab8">●</span> niedrigster Wert.</p>
  </section>

  <section class="an-card">
    <h2>Wirkverlauf nach der Einnahme</h2>
    <p>Anteil der erfassten Zeit in %, gestaffelt nach der Zeit seit der letzten Einnahme. OFF sinkt unter 50 % nach <strong>${onset}</strong>; die Wirkung lässt nach <strong>${wear}</strong> nach.
    Vor der ersten Einnahme des Tages: <strong>${pct(a.offOf(a.before))} OFF</strong> (n = ${a.before.n}).</p>
    ${doseChart}
  </section>

  <section class="an-card">
    <h2>Tagesverlauf</h2>
    <p>Anteil in % nach Uhrzeit über alle Tage (gleitend über 1,5 h). Zeigt typische Tageszeiten für OFF-Phasen und Dyskinesien.</p>
    ${todChart}
  </section>

  <section class="an-card an-wide">
    <h2>Alle Tage</h2>
    <p class="an-legend">${Object.entries(LEVELS).map(([k, l]) => `<span><i class="${k}"></i>${l.label}</span>`).join("")}<span><b class="dose plan"></b>Einnahme</span><span><b class="dose late"></b>verspätet</span><span><b class="dose skipped"></b>ausgelassen</span></p>
    ${grid}
  </section>

  <section class="an-card an-wide">
    <h2>Phasen: THS-Einstellung und Medikamentenplan</h2>
    <div class="scroll"><table class="an-table">
      <thead><tr><th>Zeitraum</th><th class="num">Tage</th><th class="num" colspan="2">OFF</th><th class="num" colspan="2">Dyskinesien</th><th class="num">Freezing</th><th class="num">Erfasst</th></tr></thead>
      <tbody>${phaseRows}</tbody>
    </table></div>
    <p class="an-note">Kurze Phasen und geringe Erfassung schwanken stark; Unterschiede sind Hinweise, keine Belege.</p>
  </section>

  <section class="an-card">
    <h2>Einnahmetreue</h2>
    <p>${ad.planned} geplante Einnahmen: <strong>${pct(ad.planned ? ad.onTime / ad.planned : null)}</strong> nach Plan, ${ad.late} verspätet${ad.lateMin != null ? ` (Ø ${Math.round(ad.lateMin)} min)` : ""}, ${ad.skipped} ausgelassen, ${ad.extra} zusätzlich.</p>
    <h2>Mahlzeiten</h2>
    <p>OFF-Anteil 30–90 min nach der Einnahme: <strong>${pct(mealWith)}</strong> mit Mahlzeit (±30 min, n = ${a.meal.with.n}) gegenüber <strong>${pct(mealWithout)}</strong> ohne (n = ${a.meal.without.n}). Eiweißreiche Mahlzeiten können die Aufnahme von Levodopa verzögern.</p>
  </section>

  <section class="an-card">
    <h2>Schlaf und OFF-Zeit am Tag</h2>
    ${scatter}
    <p class="an-note">${a.r != null ? `Korrelation r = ${num(a.r, 2)} bei ${a.sleepPairs.length} Tagen.` : "Zu wenige Tage für eine Aussage."}</p>
  </section>

  <section class="an-card an-wide an-method">
    <h2>Methode</h2>
    <p>Zuordnung wie im Parkinson-Tagebuch nach Hauser: gut beweglich = ON ohne Dyskinesien, überbeweglich = ON mit Dyskinesien, schlecht beweglich = OFF, Freezing = OFF mit Freezing (in der OFF-Zeit enthalten).
    Prozente beziehen sich auf erfasste halbe Stunden zwischen 06:00 und 24:00 Uhr, Lücken werden nicht geschätzt. Stunden pro Tag = erfasste halbe Stunden × 0,5 h geteilt durch Tage mit Einträgen.
    Der Wirkverlauf berücksichtigt nur Medikamente, die als „wirkt direkt auf die Beweglichkeit“ markiert sind, und die tatsächlichen Einnahmezeiten (Plan, korrigiert um eingetragene Abweichungen).</p>
  </section>`;
}

function avg(arr) {
  const v = arr.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function sleepScatter(pairs) {
  const w = 300, h = 150, L = 34, B = 28, T = 8, R = 10;
  if (pairs.length < 3) return "";
  const xs = pairs.map((p) => p[0]);
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const x = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (w - L - R);
  const y = (v) => T + (1 - v) * (h - T - B);
  let s = `<svg class="chart small" viewBox="0 0 ${w} ${h}" role="img">`;
  for (const v of [0, 0.5, 1]) s += `<text x="${L - 6}" y="${y(v) + 3}" class="ax" text-anchor="end">${v * 100}</text>`;
  for (let v = x0; v <= x1; v++) s += `<text x="${x(v)}" y="${h - 12}" class="ax" text-anchor="middle">${v}</text>`;
  s += `<text x="${w - R}" y="${h - 1}" class="ax" text-anchor="end">Schlaf (h) · y: OFF-Anteil (%)</text>`;
  for (const [a, b] of pairs) s += `<circle cx="${x(a).toFixed(1)}" cy="${y(b).toFixed(1)}" r="2.6" fill="${C.off}" fill-opacity=".75"/>`;
  return s + `</svg>`;
}
