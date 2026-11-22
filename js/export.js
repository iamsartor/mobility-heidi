// FAIR-Export als Frictionless Tabular Data Package (https://specs.frictionlessdata.io/):
// ZIP mit datapackage.json (Metadaten, Datenwörterbuch, Codelisten, Einheiten)
// und CSV-Dateien im Long-Format, Zeitstempel nach ISO 8601 mit Zeitzonen-Offset.

const STATES = {
  over: "Überbeweglichkeit",
  good: "Gute Beweglichkeit",
  poor: "Schlechte Beweglichkeit",
  freeze: "Freezing",
};
const INTAKE = {
  as_planned: "nach Plan (angenommen, keine Abweichung eingetragen)",
  late: "später genommen",
  skipped: "ausgelassen",
  extra: "zusätzliche Einnahme",
};

const pad = (n) => String(n).padStart(2, "0");

// "2026-11-22", "07:30" → "2026-11-22T07:30:00+01:00" (Offset der lokalen Zeitzone an diesem Tag)
function isoLocal(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const off = -new Date(y, m - 1, d, h, mi).getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${date}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
const addMinutes = (time, n) => {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + n;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

export function csv(fields, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [fields.map((f) => f.name).join(","), ...rows.map((r) => fields.map((f) => cell(r[f.name])).join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Tabellen

const F = (name, type, description, extra = {}) => ({ name, type, description, ...extra });
const enumOf = (codes) => ({ constraints: { enum: Object.keys(codes) }, codes });

export function buildTables({ days, meds, devs, ths, patient, today, now = new Date() }) {
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dates = Object.keys(days).sort();
  const tables = [];

  // Beweglichkeit
  const mobFields = [
    F("date", "date", "Kalendertag (lokal)"),
    F("slot_start", "datetime", "Beginn der halben Stunde, ISO 8601 mit Offset"),
    F("slot_end", "datetime", "Ende der halben Stunde, ISO 8601 mit Offset"),
    F("state", "string", "Beweglichkeitszustand (Code)", enumOf(STATES)),
    F("state_label", "string", "Beweglichkeitszustand (Text)"),
  ];
  const mob = [];
  for (const d of dates)
    for (const [slot, state] of Object.entries(days[d].mobility || {}).sort())
      mob.push({ date: d, slot_start: isoLocal(d, slot), slot_end: isoLocal(d, addMinutes(slot, 30)), state, state_label: STATES[state] || state });
  tables.push({ name: "mobility", title: "Beweglichkeit je halbe Stunde", fields: mobFields, rows: mob, key: ["slot_start"] });

  // Medikamentenplan
  const planFields = [
    F("medication_id", "string", "Interne ID der Planversion"),
    F("medication", "string", "Name des Medikaments"),
    F("dose", "string", "Dosis als Freitext (z. B. 125 mg)"),
    F("planned_time", "time", "Geplante Uhrzeit (lokal)"),
    F("valid_from", "date", "Plan gültig ab"),
    F("valid_to", "date", "Plan gültig bis (leer = unbefristet)"),
  ];
  const plan = meds.flatMap((m) =>
    (m.times || []).map((t) => ({ medication_id: m.id, medication: m.name, dose: m.dose || "", planned_time: `${t}:00`, valid_from: m.validFrom, valid_to: m.validTo || "" })),
  );
  tables.push({ name: "medication_plan", title: "Medikamentenplan (Verordnung)", fields: planFields, rows: plan });

  // Einnahmen: Plan je Tag, mit eingetragenen Abweichungen
  const intakeFields = [
    F("date", "date", "Kalendertag (lokal)"),
    F("medication", "string", "Name und Dosis"),
    F("planned_at", "datetime", "Geplanter Zeitpunkt (leer bei zusätzlicher Einnahme)"),
    F("status", "string", "Einnahmestatus (Code)", enumOf(INTAKE)),
    F("taken_at", "datetime", "Tatsächlicher Zeitpunkt; bei as_planned = geplanter Zeitpunkt, leer bei skipped"),
    F("assumed", "boolean", "true, wenn die Einnahme nicht bestätigt, sondern aus dem Plan angenommen ist"),
  ];
  const intake = [];
  const first = [dates[0], ...devs.map((d) => d.date)].filter(Boolean).sort()[0];
  if (first) {
    for (let d = first; d <= today; d = addDays(d, 1)) {
      for (const m of meds.filter((m) => m.validFrom <= d && (!m.validTo || m.validTo >= d))) {
        for (const t of m.times || []) {
          if (d === today && t > nowTime) continue; // noch nicht fällig
          const dev = devs.find((x) => x.date === d && x.medId === m.id && x.plannedTime === t && x.type !== "extra");
          const name = m.name + (m.dose ? ` ${m.dose}` : "");
          const planned = isoLocal(d, t);
          if (!dev) intake.push({ date: d, medication: name, planned_at: planned, status: "as_planned", taken_at: planned, assumed: true });
          else intake.push({ date: d, medication: name, planned_at: planned, status: dev.type, taken_at: dev.type === "late" ? isoLocal(d, dev.actualTime) : "", assumed: false });
        }
      }
      for (const x of devs.filter((x) => x.date === d && x.type === "extra"))
        intake.push({ date: d, medication: x.medName, planned_at: "", status: "extra", taken_at: isoLocal(d, x.actualTime), assumed: false });
    }
  }
  intake.sort((a, b) => (a.taken_at || a.planned_at).localeCompare(b.taken_at || b.planned_at));
  tables.push({ name: "medication_intake", title: "Medikamenteneinnahmen", fields: intakeFields, rows: intake });

  // Schlaf
  tables.push({
    name: "sleep",
    title: "Schlafdauer",
    fields: [F("date", "date", "Tag, an dessen Morgen die Nacht endete"), F("sleep_hours", "number", "Schlafdauer in Stunden", { unit: "h" })],
    rows: dates.filter((d) => days[d].sleepHours != null).map((d) => ({ date: d, sleep_hours: days[d].sleepHours })),
    key: ["date"],
  });

  // Mahlzeiten
  tables.push({
    name: "meals",
    title: "Mahlzeiten",
    fields: [F("date", "date", "Kalendertag (lokal)"), F("meal_at", "datetime", "Zeitpunkt der Mahlzeit (halbstündlich gerundet)")],
    rows: dates.flatMap((d) => (days[d].meals || []).map((t) => ({ date: d, meal_at: isoLocal(d, t) }))),
  });

  // THS
  tables.push({
    name: "dbs_settings",
    title: "THS-Einstellungen (tiefe Hirnstimulation)",
    fields: [
      F("valid_from", "datetime", "Gültig ab, ISO 8601 mit Offset"),
      F("mode", "string", "Modus", enumOf({ closedLoop: "Closed-Loop (Empfindlichkeit unbekannt)", manual: "manuell eingestellte Empfindlichkeit" })),
      F("sensitivity", "number", "Empfindlichkeit, Skala 0–20 in 0,5er-Schritten (leer bei Closed-Loop)", { constraints: { minimum: 0, maximum: 20 } }),
      F("note", "string", "Notiz"),
    ],
    rows: [...ths]
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
      .map((s) => {
        const [d, t] = s.validFrom.split("T");
        return { valid_from: isoLocal(d, t || "00:00"), mode: s.mode, sensitivity: s.mode === "manual" ? s.sensitivity : "", note: s.note || "" };
      }),
  });

  // Bemerkungen
  tables.push({
    name: "notes",
    title: "Bemerkungen",
    fields: [F("date", "date", "Kalendertag (lokal)"), F("note", "string", "Freitext")],
    rows: dates.filter((d) => days[d].notes?.trim()).map((d) => ({ date: d, note: days[d].notes.trim() })),
    key: ["date"],
  });

  return tables;
}

export function datapackage(tables, { patient, created, period }) {
  return {
    profile: "tabular-data-package",
    name: `beweglichkeitsprofil-${patient.id}`,
    title: `Beweglichkeitsprofil ${patient.name}`,
    description:
      "Selbstdokumentation bei Parkinson nach dem Papierbogen „Beweglichkeitsprofil“: Beweglichkeit je halbe Stunde (06:00–23:30), " +
      "Medikamentenplan und Abweichungen, THS-Einstellung, Schlaf, Mahlzeiten und Bemerkungen. Alle Zeitstempel ISO 8601 mit lokalem Offset.",
    version: "1.0.0",
    created,
    temporal: period,
    keywords: ["Parkinson", "Beweglichkeit", "Wearing-off", "Dyskinesie", "Freezing", "THS", "Selbstdokumentation"],
    licenses: [{ name: "other-closed", title: "Private Gesundheitsdaten – nur für die persönliche Auswertung" }],
    contributors: [{ title: patient.name, role: "author" }],
    sources: [{ title: "Web-App Beweglichkeitsprofil", path: "https://github.com/iamsartor/mobility-heidi" }],
    resources: tables.map((t) => ({
      name: t.name,
      path: `data/${t.name}.csv`,
      title: t.title,
      profile: "tabular-data-resource",
      format: "csv",
      mediatype: "text/csv",
      encoding: "utf-8",
      dialect: { delimiter: ",", lineTerminator: "\r\n", header: true },
      schema: {
        fields: t.fields.map(({ codes, ...f }) => (codes ? { ...f, description: `${f.description}: ${Object.entries(codes).map(([k, v]) => `${k} = ${v}`).join("; ")}` } : f)),
        ...(t.key ? { primaryKey: t.key } : {}),
        missingValues: [""],
      },
    })),
  };
}

export function readme(pkg, tables) {
  return [
    `# ${pkg.title}`,
    "",
    pkg.description,
    "",
    `Erstellt: ${pkg.created}  `,
    `Zeitraum: ${pkg.temporal.start} bis ${pkg.temporal.end}  `,
    "Format: Frictionless Tabular Data Package (datapackage.json), CSV UTF-8, Long-Format.",
    "",
    "## Tabellen",
    "",
    ...tables.map((t) => `- data/${t.name}.csv: ${t.title} (${t.rows.length} Zeilen)`),
    "",
    "Hinweis: In medication_intake gilt eine geplante Einnahme ohne eingetragene Abweichung als genommen (assumed = true).",
    "",
    "Einlesen z. B. in Python: `from frictionless import Package; Package('datapackage.json')` oder in R: `frictionless::read_package('datapackage.json')`.",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- ZIP (ohne Kompression)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, content } of files) {
    const nameB = enc.encode(name);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
    local.setUint16(8, 0, true); // ohne Kompression
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameB.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

// ---------------------------------------------------------------- Einstieg

export async function exportPackage(store, patient, today) {
  const [days, meds, devs, ths] = await Promise.all([
    store.getDays("0000-00-00", "9999-99-99"),
    store.list("medications"),
    store.list("deviations"),
    store.list("thsSettings"),
  ]);
  const tables = buildTables({ days, meds, devs, ths, patient, today });
  const allDates = [...Object.keys(days), ...devs.map((d) => d.date)].sort();
  const period = { start: allDates[0] || today, end: today };
  const created = new Date().toISOString();
  const pkg = datapackage(tables, { patient, created, period });
  const folder = `beweglichkeitsprofil-${patient.id}-${today}`;
  const blob = zip([
    { name: `${folder}/datapackage.json`, content: JSON.stringify(pkg, null, 2) },
    { name: `${folder}/README.md`, content: readme(pkg, tables) },
    ...tables.map((t) => ({ name: `${folder}/data/${t.name}.csv`, content: csv(t.fields, t.rows) })),
  ]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${folder}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return tables.map((t) => [t.name, t.rows.length]);
}
