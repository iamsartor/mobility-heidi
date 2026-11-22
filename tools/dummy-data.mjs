// Erzeugt realistische Dummy-Daten im exakt gleichen Format wie der FAIR-Export der App.
// Aufruf:  TZ=Europe/Berlin node tools/dummy-data.mjs [Zielordner]
// Ergebnis: <Zielordner>/beweglichkeitsprofil-dummy-<Datum>.zip und der entpackte Ordner.
//
// Modell (vereinfacht, nur für Testzwecke, medizinisch nicht validiert):
// - Levodopa wirkt nach ~30–45 min, Spitze nach 1–2 h (dort Überbeweglichkeit möglich),
//   lässt nach ~3 h nach (Wearing-off, schlechte Beweglichkeit, manchmal Freezing).
// - Vor der ersten Einnahme morgens meist schlechte Beweglichkeit.
// - Einnahmen manchmal später, selten ausgelassen oder zusätzlich.
// - THS-Wechsel verändern die Stärke der Schwankungen.
// - Lücken: einzelne Slots und gelegentlich längere Blöcke ohne Eintrag.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTables, datapackage, readme, csv, zip } from "../js/export.js";

const OUT = process.argv[2] || "dummy-export";
const START = "2026-10-26"; // Montag
const END = "2026-11-22"; // Sonntag, 4 Wochen
const PATIENT = { id: "dummy", name: "Dummy (Testdaten)" };

// deterministischer Zufall
let seed = 20261122;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n) => String(n).padStart(2, "0");
const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const SLOTS = [];
for (let h = 6; h <= 23; h++) for (const m of ["00", "30"]) SLOTS.push(`${pad(h)}:${m}`);
const slotOf = (t) => (toMin(t) < 360 ? null : toTime(Math.floor(toMin(t) / 30) * 30));

// Medikamentenplan mit Planänderung am 09.11.
const meds = [
  { id: "madopar-v1", name: "Madopar", dose: "125 mg", times: ["07:00", "11:00", "15:00", "19:00"], validFrom: "2026-10-01", validTo: "2026-11-08" },
  { id: "madopar-v2", name: "Madopar", dose: "125 mg", times: ["07:00", "10:30", "14:00", "17:30", "21:00"], validFrom: "2026-11-09", validTo: null },
  { id: "madopar-depot", name: "Madopar Depot", dose: "125 mg", times: ["22:00"], validFrom: "2026-10-01", validTo: null },
  { id: "rasagilin", name: "Rasagilin", dose: "1 mg", doseRelevant: false, times: ["08:00"], validFrom: "2026-10-01", validTo: null },
];
const LEVODOPA = new Set(["madopar-v1", "madopar-v2"]);

// THS-Verlauf
const ths = [
  { id: "ths1", validFrom: "2026-10-01T09:00", mode: "manual", sensitivity: 3, note: "Einstellung nach Klinikaufenthalt" },
  { id: "ths2", validFrom: "2026-11-03T10:30", mode: "manual", sensitivity: 3.5, note: "Erhöht wegen Wearing-off am Nachmittag" },
  { id: "ths3", validFrom: "2026-11-16T09:15", mode: "closedLoop", sensitivity: null, note: "Umstellung auf Closed-Loop in der Ambulanz" },
];
const thsAt = (d) => [...ths].reverse().find((s) => s.validFrom.slice(0, 10) <= d);

const NOTES = [
  "Durchschlafprobleme, zweimal wach",
  "Muskelkrampf im linken Bein am Morgen",
  "Spaziergang mit Heino, ging gut",
  "Nachmittags sehr müde",
  "Beim Aufstehen kurz schwindelig",
  "Freezing an der Haustür",
  "Arzttermin, Tablette unterwegs vergessen",
  "Gut geschlafen",
];

const days = {};
const devs = [];

for (let d = START; d <= END; d = addDays(d, 1)) {
  const setting = thsAt(d);
  // Stärke der Schwankungen: höher bei niedriger Empfindlichkeit, geringer bei Closed-Loop
  const swing = setting.mode === "closedLoop" ? 0.55 : setting.sensitivity >= 3.5 ? 0.8 : 1;

  // tatsächliche Levodopa-Einnahmen des Tages
  const taken = [];
  for (const m of meds.filter((m) => m.validFrom <= d && (!m.validTo || m.validTo >= d))) {
    for (const t of m.times) {
      const r = rnd();
      if (r < 0.03) {
        devs.push({ id: `${d}_${m.id}_${t}`, date: d, medId: m.id, medName: `${m.name} ${m.dose}`, plannedTime: t, type: "skipped", actualTime: null });
      } else if (r < 0.13) {
        const actual = toTime(toMin(t) + 15 + Math.floor(rnd() * 4) * 15);
        devs.push({ id: `${d}_${m.id}_${t}`, date: d, medId: m.id, medName: `${m.name} ${m.dose}`, plannedTime: t, type: "late", actualTime: actual });
        if (LEVODOPA.has(m.id)) taken.push(toMin(actual));
      } else if (LEVODOPA.has(m.id)) taken.push(toMin(t));
    }
  }
  if (rnd() < 0.15) {
    const t = toTime(14 * 60 + Math.floor(rnd() * 12) * 30 + 10);
    devs.push({ id: `${d}_extra`, date: d, medId: null, medName: "Madopar LT 125 mg", plannedTime: null, type: "extra", actualTime: t });
    taken.push(toMin(t));
  }
  taken.sort((a, b) => a - b);

  // Beweglichkeit je Slot
  const mobility = {};
  const bed = toMin(pick(["21:30", "22:00", "22:30", "23:00"]));
  const gapStart = rnd() < 0.3 ? toMin(pick(["10:00", "13:00", "15:30", "17:00"])) : -1;
  const gapLen = 60 + Math.floor(rnd() * 4) * 30;
  for (const s of SLOTS) {
    const t = toMin(s) + 15;
    if (t > bed) break;
    if (gapStart >= 0 && t >= gapStart && t < gapStart + gapLen) continue;
    if (rnd() < 0.12) continue;
    const last = taken.filter((x) => x <= t).pop();
    const since = last === undefined ? Infinity : t - last;
    let state;
    if (since < 35) state = rnd() < 0.7 ? "poor" : "good"; // Wirkung setzt noch ein
    else if (since < 150) state = rnd() < 0.3 * swing ? "over" : "good"; // Wirkspitze
    else if (since < 200) state = rnd() < 0.35 * swing ? "poor" : "good";
    else state = rnd() < 0.8 ? "poor" : "good"; // Wearing-off
    if (state === "poor" && rnd() < 0.22 * swing) state = "freeze";
    mobility[s] = state;
  }

  const breakfast = pick(["07:30", "08:00"]);
  const lunch = pick(["12:00", "12:30"]);
  const dinner = pick(["18:00", "18:30"]);
  const day = {
    mobility,
    meals: rnd() < 0.15 ? [breakfast, dinner] : [breakfast, lunch, dinner],
    sleepHours: 4.5 + Math.round(rnd() * 7) * 0.5,
  };
  if (rnd() < 0.3) day.notes = pick(NOTES);
  if (rnd() < 0.05) delete day.sleepHours;
  days[d] = day;
}

// Export im App-Format
const tables = buildTables({ days, meds, devs, ths, patient: PATIENT, today: END, now: new Date(`${END}T23:59:00`) });
const pkg = datapackage(tables, { patient: PATIENT, created: new Date().toISOString(), period: { start: START, end: END } });
pkg.title += " – synthetische Testdaten";
pkg.licenses = [{ name: "CC0-1.0", title: "Synthetische Daten, frei verwendbar", path: "https://creativecommons.org/publicdomain/zero/1.0/" }];
const folder = `beweglichkeitsprofil-${PATIENT.id}-${END}`;
const files = [
  { name: `${folder}/datapackage.json`, content: JSON.stringify(pkg, null, 2) },
  { name: `${folder}/README.md`, content: readme(pkg, tables) },
  ...tables.map((t) => ({ name: `${folder}/data/${t.name}.csv`, content: csv(t.fields, t.rows) })),
];
for (const f of files) {
  mkdirSync(join(OUT, f.name, ".."), { recursive: true });
  writeFileSync(join(OUT, f.name), f.content);
}
// Rohdaten im App-Format (für Tests der Analyse-Seite im Demo-Modus)
writeFileSync(join(OUT, "app-data.json"), JSON.stringify({ days, medications: Object.fromEntries(meds.map(({ id, ...m }) => [id, m])), deviations: Object.fromEntries(devs.map(({ id, ...d }) => [id, d])), thsSettings: Object.fromEntries(ths.map(({ id, ...t }) => [id, t])) }));
writeFileSync(join(OUT, `${folder}.zip`), Buffer.from(await zip(files).arrayBuffer()));
console.log(tables.map((t) => `${t.name}: ${t.rows.length}`).join("\n"));
