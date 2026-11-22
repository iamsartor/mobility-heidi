import { firebaseConfig, PIN_HASH, PATIENT, PEOPLE } from "./config.js";
import { createStore } from "./store.js";
import { exportPackage } from "./export.js";
import { analyze, renderAnalysisHTML } from "./analysis.js";

// ---------------------------------------------------------------- Konstanten & Hilfen

// Halbstunden-Raster wie im Papierbogen: 06:00 … 23:30 (36 Felder)
const SLOTS = [];
for (let h = 6; h <= 23; h++) for (const m of ["00", "30"]) SLOTS.push(`${String(h).padStart(2, "0")}:${m}`);

const LEVELS = {
  over: { label: "Überbeweglich", sym: "▲" },
  good: { label: "Gut beweglich", sym: "●" },
  poor: { label: "Schlecht beweglich", sym: "▼" },
  freeze: { label: "Freezing", sym: "■" },
};
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

const $app = document.getElementById("app");
const $tabs = document.getElementById("tabs");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
};
const today = () => dateStr(new Date());
const mondayOf = (s) => {
  const d = parseDate(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};
const fmtDate = (s, withYear = false) => {
  const d = parseDate(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${withYear ? d.getFullYear() : ""}`;
};
const weekday = (s) => WEEKDAYS[parseDate(s).getDay()];
const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const slotOf = (time) => {
  const [h, m] = time.split(":").map(Number);
  if (h < 6) return null;
  return `${pad(h)}:${m < 30 ? "00" : "30"}`;
};
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
const activeOn = (med, date) => med.validFrom <= date && (!med.validTo || med.validTo >= date);

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}
window.addEventListener("store-error", () => toast("Speichern hat nicht geklappt. Bitte später erneut versuchen."));

// ---------------------------------------------------------------- Zustand

const state = {
  store: null,
  view: "today",
  date: today(),
  week: mondayOf(today()),
  gapOffer: null,
};

const who = {
  get() {
    try {
      return localStorage.getItem("who");
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem("who", v);
    } catch {}
  },
};

// ---------------------------------------------------------------- Start

async function boot() {
  try {
    state.store = await createStore({ firebaseConfig, patientId: PATIENT.id, getWho: who.get });
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<p class="error">Die App konnte nicht starten. Bitte Internetverbindung prüfen und neu laden.</p>`;
    return;
  }
  if (!(await state.store.waitForAuth())) return renderPin();
  if (!who.get()) return renderWho();
  showApp();
}

function showApp() {
  $tabs.hidden = false;
  render();
}

$tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  state.view = b.dataset.view;
  if (state.view === "today") state.date = today();
  render();
});

function render() {
  for (const b of $tabs.querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === state.view);
  window.scrollTo(0, 0);
  document.body.classList.toggle("wide", state.view === "analysis");
  ({ today: renderToday, week: renderWeek, analysis: renderAnalysis, settings: renderSettings })[state.view]();
}

// ---------------------------------------------------------------- PIN & Person

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderPin(error = "") {
  $tabs.hidden = true;
  let pin = "";
  $app.innerHTML = `
    <section class="login">
      <h1>Beweglichkeitsprofil</h1>
      <p>Bitte die PIN eingeben. Das ist nur einmal pro Gerät nötig.</p>
      <div class="pin-dots" aria-label="Eingegebene Stellen">${"<span></span>".repeat(6)}</div>
      <p class="error" role="alert">${esc(error)}</p>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}
        <button data-k="del" aria-label="Löschen">⌫</button><button data-k="0">0</button><span></span>
      </div>
    </section>`;
  const dots = $app.querySelectorAll(".pin-dots span");
  const show = () => dots.forEach((d, i) => d.classList.toggle("on", i < pin.length));
  $app.querySelector(".keypad").addEventListener("click", async (e) => {
    const k = e.target.closest("button")?.dataset.k;
    if (!k) return;
    if (k === "del") pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += k;
    show();
    if (pin.length === 6) {
      $app.querySelector(".error").textContent = "Wird geprüft …";
      try {
        if ((await sha256(pin)) !== PIN_HASH) throw { code: "wrong-pin" };
        await state.store.signIn();
        who.get() ? showApp() : renderWho();
      } catch (err) {
        const code = err?.code || "";
        renderPin(
          code.includes("too-many-requests")
            ? "Zu viele Versuche. Bitte später erneut versuchen."
            : code.includes("network")
              ? "Keine Internetverbindung. Für die erste Anmeldung wird Internet gebraucht."
              : code === "wrong-pin"
                ? "Die PIN stimmt nicht. Bitte erneut versuchen."
                : /configuration-not-found|operation-not-allowed|admin-restricted/.test(code)
                  ? "Die Anmeldung ist in Firebase noch nicht eingerichtet (anonyme Anmeldung aktivieren)."
                  : `Anmeldung fehlgeschlagen (${code || "unbekannter Fehler"}).`,
        );
      }
    }
  });
}

function renderWho() {
  $tabs.hidden = true;
  $app.innerHTML = `
    <section class="login">
      <h1>Wer benutzt dieses Gerät?</h1>
      <p>So sieht man später, wer etwas eingetragen hat.</p>
      ${PEOPLE.map((p) => `<button class="big-choice" data-who="${esc(p)}">${esc(p)}</button>`).join("")}
    </section>`;
  $app.querySelectorAll("[data-who]").forEach((b) =>
    b.addEventListener("click", () => {
      who.set(b.dataset.who);
      showApp();
    }),
  );
}

// ---------------------------------------------------------------- Bottom-Sheet (Dialog)

function sheet(html, bind) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}
    <button class="secondary close">Abbrechen</button></div>`;
  document.body.append(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest(".close")) close();
  });
  bind(wrap.querySelector(".sheet"), close);
}

// ---------------------------------------------------------------- Heute / Tag

async function renderToday() {
  const { store } = state;
  const date = state.date;
  const isToday = date === today();
  const [day, meds, devs] = await Promise.all([store.getDay(date), store.list("medications"), store.list("deviations")]);
  if (state.view !== "today" || state.date !== date) return; // inzwischen weiternavigiert
  const mobility = day.mobility || {};
  const nowSlot = isToday ? slotOf(nowTime()) : null;
  const dayDevs = devs.filter((d) => d.date === date);

  const levelButtons = (current) =>
    Object.entries(LEVELS)
      .map(
        ([k, l]) => `<button class="level ${k} ${current === k ? "chosen" : ""}" data-level="${k}">
          <span class="sym" aria-hidden="true">${l.sym}</span>${l.label}${current === k ? ' <span class="check">✓</span>' : ""}</button>`,
      )
      .join("");

  // geplante Einnahmen des Tages
  const intakes = meds
    .filter((m) => activeOn(m, date))
    .flatMap((m) => (m.times || []).map((t) => ({ med: m, time: t })))
    .sort((a, b) => a.time.localeCompare(b.time));
  const devFor = (med, time) => dayDevs.find((d) => d.medId === med.id && d.plannedTime === time && d.type !== "extra");
  const extras = dayDevs.filter((d) => d.type === "extra").sort((a, b) => a.actualTime.localeCompare(b.actualTime));

  $app.innerHTML = `
    <header class="day-nav">
      <button class="nav" data-go="-1" aria-label="Vorheriger Tag">‹</button>
      <div><strong>${isToday ? "Heute" : weekday(date)}</strong><span>${weekday(date).slice(0, 2)}, ${fmtDate(date, true)}</span></div>
      <button class="nav" data-go="1" aria-label="Nächster Tag" ${isToday ? "disabled" : ""}>›</button>
    </header>
    ${state.store.demo ? `<p class="demo">Demo-Modus: Daten werden nur auf diesem Gerät gespeichert.</p>` : ""}

    ${
      nowSlot
        ? `<section class="card now">
            <h2>Wie beweglich sind Sie jetzt?</h2>
            <p class="sub">Eintrag für ${nowSlot} Uhr</p>
            <div class="levels">${levelButtons(mobility[nowSlot])}</div>
            <div class="gap-offer"></div>
          </section>`
        : `<section class="card"><p>${
            isToday ? "Einträge sind von 06:00 bis 23:30 Uhr möglich." : "Tippen Sie unten auf eine Uhrzeit, um nachzutragen."
          }</p>${!isToday ? `<button class="secondary" data-today>Zurück zu heute</button>` : ""}</section>`
    }

    <section class="card">
      <h2>Tagesverlauf</h2>
      <p class="sub">Tippen zum Ändern oder Nachtragen</p>
      <div class="slots">
        ${SLOTS.map((s) => {
          const v = mobility[s];
          return `<button class="slot ${v || "empty"} ${s === nowSlot ? "current" : ""}" data-slot="${s}"
            aria-label="${s} Uhr: ${v ? LEVELS[v].label : "keine Angabe"}">
            <span class="t">${s}</span><span class="sym" aria-hidden="true">${v ? LEVELS[v].sym : ""}</span></button>`;
        }).join("")}
      </div>
    </section>

    <section class="card">
      <h2>Medikamente</h2>
      ${
        intakes.length
          ? `<ul class="intakes">${intakes
              .map(({ med, time }) => {
                const d = devFor(med, time);
                const status = !d ? "nach Plan" : d.type === "late" ? `später: ${d.actualTime} Uhr` : "ausgelassen";
                return `<li class="${d ? "deviates" : ""}">
                  <button data-intake="${esc(med.id)}|${time}">
                    <span class="time">${time}</span>
                    <span class="what">${esc(med.name)}${med.dose ? ` <small>${esc(med.dose)}</small>` : ""}</span>
                    <span class="status">${status}</span>
                  </button></li>`;
              })
              .join("")}</ul>`
          : `<p class="sub">Für diesen Tag ist kein Medikamentenplan hinterlegt.</p>`
      }
      ${
        extras.length
          ? `<ul class="intakes">${extras
              .map(
                (d) => `<li class="deviates"><button data-extra="${esc(d.id)}">
                  <span class="time">${d.actualTime}</span><span class="what">${esc(d.medName)}</span>
                  <span class="status">zusätzlich</span></button></li>`,
              )
              .join("")}</ul>`
          : ""
      }
      <p class="sub">Alles nach Plan genommen? Dann ist nichts zu tun. Bei Abweichungen auf die Einnahme tippen.</p>
      <button class="secondary" data-add-extra>+ Zusätzliche Einnahme</button>
    </section>

    <section class="card">
      <h2>Mahlzeiten</h2>
      <p class="sub">Uhrzeiten antippen</p>
      <div class="meals">
        ${SLOTS.map((s) => `<button class="meal ${(day.meals || []).includes(s) ? "on" : ""}" data-meal="${s}" aria-pressed="${(day.meals || []).includes(s)}">${s}</button>`).join("")}
      </div>
    </section>

    <section class="card">
      <h2>Schlaf letzte Nacht</h2>
      <div class="stepper">
        <button data-sleep="-0.5" aria-label="Weniger">−</button>
        <output>${day.sleepHours != null ? `${fmtNum(day.sleepHours)} Std.` : "–"}</output>
        <button data-sleep="0.5" aria-label="Mehr">+</button>
      </div>
    </section>

    <section class="card">
      <h2>Bemerkungen</h2>
      <textarea rows="3" placeholder="z. B. Durchschlafprobleme, Muskelkrämpfe …">${esc(day.notes || "")}</textarea>
    </section>`;

  // --- Navigation
  $app.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => {
      state.date = addDays(state.date, Number(b.dataset.go));
      if (state.date > today()) state.date = today();
      renderToday();
    }),
  );
  $app.querySelector("[data-today]")?.addEventListener("click", () => {
    state.date = today();
    renderToday();
  });

  // --- Beweglichkeit jetzt
  $app.querySelectorAll(".now [data-level]").forEach((b) =>
    b.addEventListener("click", () => {
      const level = b.dataset.level;
      store.updateDay(date, { mobility: { [nowSlot]: level } });
      mobility[nowSlot] = level;
      // Lücke seit dem letzten Eintrag anbieten
      const idx = SLOTS.indexOf(nowSlot);
      let last = -1;
      for (let i = idx - 1; i >= 0; i--) if (mobility[SLOTS[i]]) { last = i; break; }
      const gap = last >= 0 ? SLOTS.slice(last + 1, idx) : [];
      state.gapOffer = gap.length ? { date, slots: gap, level } : null;
      renderToday();
    }),
  );
  const offer = state.gapOffer;
  const $offer = $app.querySelector(".gap-offer");
  if (offer && offer.date === date && $offer) {
    const from = offer.slots[0];
    const to = offer.slots[offer.slots.length - 1];
    $offer.innerHTML = `<p>Zwischen ${from} und ${to} Uhr fehlt ein Eintrag.</p>
      <button class="secondary" data-fill>Auch ${from}–${to} als „${LEVELS[offer.level].label}“ eintragen</button>
      <button class="link" data-nofill>Nein, leer lassen</button>`;
    $offer.querySelector("[data-fill]").addEventListener("click", () => {
      store.updateDay(date, { mobility: Object.fromEntries(offer.slots.map((s) => [s, offer.level])) });
      state.gapOffer = null;
      renderToday();
    });
    $offer.querySelector("[data-nofill]").addEventListener("click", () => {
      state.gapOffer = null;
      $offer.innerHTML = "";
    });
  }

  // --- Tagesraster
  $app.querySelectorAll("[data-slot]").forEach((b) =>
    b.addEventListener("click", () => {
      const slot = b.dataset.slot;
      sheet(
        `<h2>${weekday(date)}, ${slot} Uhr</h2><div class="levels">${levelButtons(mobility[slot])}</div>
         ${mobility[slot] ? `<button class="secondary" data-clear>Eintrag löschen</button>` : ""}`,
        (el, close) => {
          el.querySelectorAll("[data-level]").forEach((lb) =>
            lb.addEventListener("click", () => {
              store.updateDay(date, { mobility: { [slot]: lb.dataset.level } });
              close();
              renderToday();
            }),
          );
          el.querySelector("[data-clear]")?.addEventListener("click", () => {
            store.updateDay(date, { mobility: { [slot]: null } });
            close();
            renderToday();
          });
        },
      );
    }),
  );

  // --- Medikamente
  $app.querySelectorAll("[data-intake]").forEach((b) =>
    b.addEventListener("click", () => {
      const [medId, time] = b.dataset.intake.split("|");
      const med = meds.find((m) => m.id === medId);
      const d = devFor(med, time);
      const devId = `${date}_${medId}_${time.replace(":", "")}`;
      sheet(
        `<h2>${esc(med.name)} – ${time} Uhr</h2>
         <button class="choice ${!d ? "chosen" : ""}" data-t="plan">Nach Plan genommen</button>
         <button class="choice ${d?.type === "late" ? "chosen" : ""}" data-late>Später genommen${d?.type === "late" ? ` (${d.actualTime} Uhr)` : ""}</button>
         <div class="late-box" hidden>
           <label>Genommen um <input type="time" value="${d?.actualTime || nowTime()}"></label>
           <button class="primary" data-t="late">Speichern</button>
         </div>
         <button class="choice ${d?.type === "skipped" ? "chosen" : ""}" data-t="skipped">Ausgelassen</button>`,
        (el, close) => {
          el.querySelector("[data-late]").addEventListener("click", () => {
            el.querySelector(".late-box").hidden = false;
            el.querySelector(".late-box input").focus();
          });
          el.querySelectorAll("[data-t]").forEach((cb) =>
            cb.addEventListener("click", () => {
              const t = cb.dataset.t;
              if (t === "plan") store.remove("deviations", devId);
              else
                store.save("deviations", {
                  id: devId,
                  date,
                  medId,
                  medName: med.name + (med.dose ? ` ${med.dose}` : ""),
                  plannedTime: time,
                  type: t,
                  actualTime: t === "late" ? el.querySelector("input").value || nowTime() : null,
                });
              close();
              renderToday();
            }),
          );
        },
      );
    }),
  );
  const activeMeds = meds.filter((m) => activeOn(m, date));
  $app.querySelector("[data-add-extra]").addEventListener("click", () => extraSheet(date, activeMeds));
  $app.querySelectorAll("[data-extra]").forEach((b) =>
    b.addEventListener("click", () => extraSheet(date, activeMeds, dayDevs.find((d) => d.id === b.dataset.extra))),
  );

  // --- Mahlzeiten
  $app.querySelectorAll("[data-meal]").forEach((b) =>
    b.addEventListener("click", () => {
      const meals = new Set(day.meals || []);
      meals.has(b.dataset.meal) ? meals.delete(b.dataset.meal) : meals.add(b.dataset.meal);
      day.meals = [...meals].sort();
      store.updateDay(date, { meals: day.meals });
      b.classList.toggle("on");
      b.setAttribute("aria-pressed", meals.has(b.dataset.meal));
    }),
  );

  // --- Schlaf
  $app.querySelectorAll("[data-sleep]").forEach((b) =>
    b.addEventListener("click", () => {
      const cur = day.sleepHours ?? 7;
      const next = day.sleepHours == null ? cur : Math.min(24, Math.max(0, cur + Number(b.dataset.sleep)));
      day.sleepHours = next;
      store.updateDay(date, { sleepHours: next });
      $app.querySelector(".stepper output").textContent = `${fmtNum(next)} Std.`;
    }),
  );

  // --- Bemerkungen
  const ta = $app.querySelector("textarea");
  let t;
  ta.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => store.updateDay(date, { notes: ta.value }), 800);
  });
  ta.addEventListener("blur", () => {
    clearTimeout(t);
    if (ta.value !== (day.notes || "")) {
      day.notes = ta.value;
      store.updateDay(date, { notes: ta.value });
    }
  });
}

function extraSheet(date, activeMeds, existing) {
  sheet(
    `<h2>Zusätzliche Einnahme</h2>
     <label>Medikament
       <select>${activeMeds.map((m) => `<option ${existing?.medId === m.id ? "selected" : ""} value="${esc(m.id)}">${esc(m.name)}${m.dose ? ` ${esc(m.dose)}` : ""}</option>`).join("")}
       <option value="" ${existing && !existing.medId ? "selected" : ""}>Anderes …</option></select></label>
     <label class="other" hidden>Name und Dosis <input type="text" value="${existing && !existing.medId ? esc(existing.medName) : ""}"></label>
     <label>Uhrzeit <input type="time" value="${existing?.actualTime || nowTime()}"></label>
     <button class="primary" data-save>Speichern</button>
     ${existing ? `<button class="secondary" data-del>Eintrag löschen</button>` : ""}`,
    (el, close) => {
      const sel = el.querySelector("select");
      const other = el.querySelector(".other");
      const sync = () => (other.hidden = sel.value !== "");
      sel.addEventListener("change", sync);
      sync();
      el.querySelector("[data-save]").addEventListener("click", () => {
        const med = activeMeds.find((m) => m.id === sel.value);
        const name = med ? med.name + (med.dose ? ` ${med.dose}` : "") : other.querySelector("input").value.trim();
        if (!name) return toast("Bitte ein Medikament angeben.");
        state.store.save("deviations", {
          id: existing?.id,
          date,
          medId: med?.id || null,
          medName: name,
          plannedTime: null,
          type: "extra",
          actualTime: el.querySelector('input[type="time"]').value || nowTime(),
        });
        close();
        renderToday();
      });
      el.querySelector("[data-del]")?.addEventListener("click", () => {
        state.store.remove("deviations", existing.id);
        close();
        renderToday();
      });
    },
  );
}

// ---------------------------------------------------------------- Woche (Bogen für den Arzt)

function thsText(s) {
  return s.mode === "closedLoop" ? "Closed-Loop" : `Empfindlichkeit ${fmtNum(Number(s.sensitivity))}`;
}
function fmtDateTime(s) {
  const [d, t] = s.split("T");
  return `${fmtDate(d, true)} ${t || ""}`.trim();
}

// ---------------------------------------------------------------- Analyse (für den Arzt)

// Beispieldaten (synthetisch, aus tools/dummy-data.mjs) – nur zur Ansicht, werden nie gespeichert.
let demoData = null;
async function loadDemo() {
  if (!demoData) {
    const r = await fetch("data/demo-data.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("Beispieldaten nicht gefunden");
    const raw = await r.json();
    const list = (o) => Object.entries(o || {}).map(([id, v]) => ({ id, ...v }));
    demoData = { days: raw.days, meds: list(raw.medications), devs: list(raw.deviations), ths: list(raw.thsSettings) };
    demoData.end = Object.keys(raw.days).sort().pop();
  }
  return demoData;
}

async function renderAnalysis() {
  const { store } = state;
  let data, t, now, patient;
  try {
    if (state.anaDemo) {
      data = await loadDemo();
      t = data.end;
      now = "23:59";
      patient = { id: "demo", name: "– Beispieldaten" };
    } else {
      const [days, meds, devs, ths] = await Promise.all([
        store.getDays("0000-00-00", "9999-99-99"),
        store.list("medications"),
        store.list("deviations"),
        store.list("thsSettings"),
      ]);
      data = { days, meds, devs, ths };
      t = today();
      now = nowTime();
      patient = PATIENT;
    }
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<p class="error">Die Analyse konnte nicht geladen werden. Bitte Internetverbindung prüfen.</p>`;
    return;
  }
  if (state.view !== "analysis") return;
  const first = Object.keys(data.days).sort()[0] || t;
  const span = state.anaDays || 14;
  const from = span === "all" ? first : addDays(t, -(span - 1));
  const a = analyze(data, { from, to: t, today: t, nowTime: now });
  const realDays = state.anaDemo ? null : Object.values(data.days).filter((d) => Object.keys(d.mobility || {}).length).length;
  $app.innerHTML = `
    ${state.anaDemo ? `<p class="demo-banner">Beispieldaten: synthetisch erzeugt, keine echten Werte von ${esc(PATIENT.name)}. Nur zur Ansicht, es wird nichts gespeichert.</p>` : ""}
    ${!state.anaDemo && realDays < 7 ? `<p class="demo">Bisher ${realDays} Tag${realDays === 1 ? "" : "e"} mit Einträgen. Aussagekräftig wird die Analyse nach etwa ein bis zwei Wochen.</p>` : ""}
    <div class="an-toolbar no-print">
      <div class="seg" role="group" aria-label="Zeitraum">
        ${[[7, "7 Tage"], [14, "14 Tage"], [28, "4 Wochen"], ["all", "Alles"]]
          .map(([v, l]) => `<button class="${String(span) === String(v) ? "on" : ""}" data-span="${v}">${l}</button>`)
          .join("")}
      </div>
      <div class="an-actions">
        <button class="secondary" data-demo>${state.anaDemo ? "Echte Daten anzeigen" : "Beispieldaten anzeigen"}</button>
        <button class="secondary" data-print>Drucken / PDF</button>
      </div>
    </div>
    <div class="analysis">${renderAnalysisHTML(a, { patient, LEVELS })}</div>`;
  $app.querySelectorAll("[data-span]").forEach((b) =>
    b.addEventListener("click", () => {
      state.anaDays = b.dataset.span === "all" ? "all" : Number(b.dataset.span);
      renderAnalysis();
    }),
  );
  $app.querySelector("[data-demo]").addEventListener("click", () => {
    state.anaDemo = !state.anaDemo;
    if (state.anaDemo && !state.anaDays) state.anaDays = 28;
    renderAnalysis();
  });
  $app.querySelector("[data-print]").addEventListener("click", () => window.print());
}

async function renderWeek() {
  const { store } = state;
  const from = state.week;
  const to = addDays(from, 6);
  const dates = [...Array(7)].map((_, i) => addDays(from, i));
  const [days, meds, devs, ths] = await Promise.all([
    store.getDays(from, to),
    store.list("medications"),
    store.list("deviations"),
    store.list("thsSettings"),
  ]);
  if (state.view !== "week" || state.week !== from) return;

  const weekMeds = meds.filter((m) => m.validFrom <= to && (!m.validTo || m.validTo >= from)).sort((a, b) => a.name.localeCompare(b.name));
  const weekDevs = devs
    .filter((d) => d.date >= from && d.date <= to)
    .sort((a, b) => (a.date + (a.actualTime || a.plannedTime)).localeCompare(b.date + (b.actualTime || b.plannedTime)));
  const thsSorted = ths.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const thsAtStart = thsSorted.filter((s) => s.validFrom < from).pop();
  const thsInWeek = thsSorted.filter((s) => s.validFrom >= from && s.validFrom <= `${to}T23:59`);

  // Beide Tabellen nutzen dasselbe Spaltenraster, damit die Uhrzeiten exakt untereinander stehen.
  const cols = `<colgroup><col class="c-first"><col class="c-sleep">${SLOTS.map(() => "<col>").join("")}</colgroup>`;
  const hourHead = (first) =>
    `<tr>${first === "Wochentag" ? `<th class="first">${first}</th><th class="sleep">Schlaf<br>in Std.</th>` : `<th class="first" colspan="2">${first}</th>`}${[...Array(18)]
      .map((_, i) => `<th colspan="2">${pad(i + 6)}:00</th>`)
      .join("")}</tr>`;

  const medRow = (m) => {
    const partial = m.validFrom > from || (m.validTo && m.validTo < to);
    const range = partial ? `<br><small>${m.validFrom > from ? `ab ${fmtDate(m.validFrom)}` : ""} ${m.validTo && m.validTo < to ? `bis ${fmtDate(m.validTo)}` : ""}</small>` : "";
    return `<tr><td class="first" colspan="2">${esc(m.name)}${m.dose ? ` <small>${esc(m.dose)}</small>` : ""}${range}</td>${SLOTS.map(
      (s) => `<td class="${(m.times || []).includes(s) ? "x" : ""}">${(m.times || []).includes(s) ? "✕" : ""}</td>`,
    ).join("")}</tr>`;
  };

  // Einnahmen je Tag: ✕ genommen (nach Plan bzw. zur tatsächlichen Uhrzeit), – ausgelassen, + zusätzlich
  const intakeMarks = (d) => {
    const marks = {};
    const add = (slot, sym, text) => {
      if (!slot) return;
      const m = (marks[slot] ||= { syms: new Set(), text: [] });
      m.syms.add(sym);
      m.text.push(text);
    };
    const isFuture = (t) => d > today() || (d === today() && t > nowTime());
    for (const m of meds.filter((m) => activeOn(m, d))) {
      for (const t of m.times || []) {
        const dev = devs.find((x) => x.date === d && x.medId === m.id && x.plannedTime === t && x.type !== "extra");
        if (!dev) !isFuture(t) && add(slotOf(t), "✕", `${m.name} ${t}`);
        else if (dev.type === "late") add(slotOf(dev.actualTime), "✕", `${m.name} ${dev.actualTime} (geplant ${t})`);
        else add(slotOf(t), "–", `${m.name} ${t} ausgelassen`);
      }
    }
    for (const x of devs.filter((x) => x.date === d && x.type === "extra")) add(slotOf(x.actualTime), "+", `${x.medName} ${x.actualTime} zusätzlich`);
    return marks;
  };

  const dayRow = (d) => {
    const day = days[d] || {};
    const mob = day.mobility || {};
    const meals = day.meals || [];
    const marks = intakeMarks(d);
    return `<tr><td class="first">${weekday(d)}<br><small>${fmtDate(d)}</small></td>
      <td class="sleep">${day.sleepHours != null ? fmtNum(day.sleepHours) : ""}</td>
      ${SLOTS.map((s) => {
        const mk = marks[s];
        const title = [s, mob[s] && LEVELS[mob[s]].label, meals.includes(s) && "Mahlzeit", ...(mk ? mk.text : [])].filter(Boolean).join(", ");
        return `<td class="${mob[s] || ""} ${meals.includes(s) ? "meal" : ""}" title="${esc(title)}">${mk ? `<span class="intake">${[...mk.syms].join("")}</span>` : ""}</td>`;
      }).join("")}</tr>`;
  };

  const devText = (d) =>
    d.type === "late"
      ? `${esc(d.medName)}: geplant ${d.plannedTime}, genommen ${d.actualTime} Uhr`
      : d.type === "skipped"
        ? `${esc(d.medName)}: ${d.plannedTime} Uhr ausgelassen`
        : `${esc(d.medName)}: zusätzlich um ${d.actualTime} Uhr`;

  const notes = dates.filter((d) => days[d]?.notes?.trim());

  $app.innerHTML = `
    <header class="day-nav no-print">
      <button class="nav" data-wk="-7" aria-label="Vorherige Woche">‹</button>
      <div><strong>Woche</strong><span>${fmtDate(from)} – ${fmtDate(to, true)}</span></div>
      <button class="nav" data-wk="7" aria-label="Nächste Woche" ${to >= today() ? "disabled" : ""}>›</button>
    </header>
    <div class="no-print toolbar">
      <button class="primary" data-print>Drucken / als PDF speichern</button>
      <p class="sub">Am besten am Computer oder Tablet, Querformat.</p>
    </div>

    <article class="sheet-print">
      <div class="print-head">
        <div><strong>Name:</strong> ${esc(PATIENT.name)}</div>
        <h1>Beweglichkeitsprofil</h1>
      </div>

      <h3>Verordnungsplan für die Woche vom ${fmtDate(from, true)} bis ${fmtDate(to, true)}</h3>
      <div class="scroll"><table class="grid meds">${cols}
        <thead>${hourHead("Parkinson-Medikamente")}</thead>
        <tbody>${weekMeds.length ? weekMeds.map(medRow).join("") : `<tr><td class="first" colspan="2">Kein Plan hinterlegt</td>${SLOTS.map(() => "<td></td>").join("")}</tr>`}</tbody>
      </table></div>

      <p class="ths"><strong>THS:</strong> ${
        thsAtStart || thsInWeek.length
          ? [
              thsAtStart ? `${thsText(thsAtStart)} (seit ${fmtDateTime(thsAtStart.validFrom)})` : "",
              ...thsInWeek.map((s) => `ab ${weekday(s.validFrom.slice(0, 10)).slice(0, 2)} ${fmtDateTime(s.validFrom)}: ${thsText(s)}`),
            ]
              .filter(Boolean)
              .join(" · ")
          : "keine Angabe"
      }</p>

      <h3>Meine Beweglichkeit</h3>
      <div class="scroll"><table class="grid mobility">${cols}
        <thead>${hourHead("Wochentag")}</thead>
        <tbody>${dates.map(dayRow).join("")}</tbody>
      </table></div>

      <div class="legend">
        ${Object.entries(LEVELS).map(([k, l]) => `<span><i class="${k}"></i>${l.label}</span>`).join("")}
        <span><i class="meal"></i>Mahlzeit</span>
        <span><b class="intake">✕</b>&nbsp;Einnahme <b class="intake">–</b>&nbsp;ausgelassen <b class="intake">+</b>&nbsp;zusätzlich</span>
      </div>

      <div class="two-col">
        <section>
          <h3>Abweichungen vom Plan</h3>
          ${
            weekDevs.length
              ? `<ul>${weekDevs.map((d) => `<li><strong>${weekday(d.date).slice(0, 2)} ${fmtDate(d.date)}</strong> ${devText(d)}</li>`).join("")}</ul>`
              : "<p>Keine – alles nach Plan.</p>"
          }
        </section>
        <section>
          <h3>Bemerkungen</h3>
          ${notes.length ? `<ul>${notes.map((d) => `<li><strong>${weekday(d).slice(0, 2)} ${fmtDate(d)}</strong> ${esc(days[d].notes)}</li>`).join("")}</ul>` : "<p>Keine.</p>"}
        </section>
      </div>
    </article>`;

  $app.querySelectorAll("[data-wk]").forEach((b) =>
    b.addEventListener("click", () => {
      state.week = addDays(state.week, Number(b.dataset.wk));
      renderWeek();
    }),
  );
  $app.querySelector("[data-print]").addEventListener("click", () => window.print());
}

// ---------------------------------------------------------------- Plan & THS

async function renderSettings() {
  const { store } = state;
  const [meds, ths] = await Promise.all([store.list("medications"), store.list("thsSettings")]);
  if (state.view !== "settings") return;
  const t = today();
  const current = meds.filter((m) => activeOn(m, t) || m.validFrom > t).sort((a, b) => a.name.localeCompare(b.name));
  const thsSorted = ths.sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const nowIso = `${t}T${nowTime()}`;
  const thsNow = thsSorted.find((s) => s.validFrom <= nowIso);

  $app.innerHTML = `
    <section class="card">
      <h2>Medikamentenplan</h2>
      <p class="sub">Gilt als eingenommen, solange keine Abweichung eingetragen ist.</p>
      ${
        current.length
          ? `<ul class="list">${current
              .map(
                (m) => `<li><button data-med="${esc(m.id)}">
                  <strong>${esc(m.name)}</strong> ${m.dose ? esc(m.dose) : ""}
                  <span class="sub">${(m.times || []).join(", ") || "keine Uhrzeit"}${m.validFrom > t ? ` · ab ${fmtDate(m.validFrom, true)}` : ""}</span>
                </button></li>`,
              )
              .join("")}</ul>`
          : `<p>Noch keine Medikamente eingetragen.</p>`
      }
      <button class="primary" data-med-new>+ Medikament hinzufügen</button>
    </section>

    <section class="card">
      <h2>THS-Einstellung</h2>
      <p class="big">${thsNow ? `${thsText(thsNow)}<span class="sub"> seit ${fmtDateTime(thsNow.validFrom)}</span>` : "Noch nicht eingetragen"}</p>
      <button class="primary" data-ths-new>Einstellung geändert</button>
      ${
        thsSorted.length
          ? `<details><summary>Verlauf (${thsSorted.length})</summary><ul class="list">${thsSorted
              .map(
                (s) => `<li><button data-ths="${esc(s.id)}">${fmtDateTime(s.validFrom)}: <strong>${thsText(s)}</strong>
                  ${s.note ? `<span class="sub">${esc(s.note)}</span>` : ""}</button></li>`,
              )
              .join("")}</ul></details>`
          : ""
      }
    </section>

    <section class="card">
      <h2>Daten exportieren</h2>
      <p class="sub">Alle Einträge als ZIP für eigene Auswertungen, z. B. in Excel, R oder Python: CSV-Tabellen mit Datenbeschreibung (Frictionless Data Package).</p>
      <button class="secondary" data-export>Export herunterladen</button>
    </section>

    <section class="card">
      <h2>Dieses Gerät</h2>
      <p>Einträge werden gespeichert als: <strong>${esc(who.get())}</strong></p>
      <div class="row">${PEOPLE.map((p) => `<button class="secondary ${who.get() === p ? "chosen" : ""}" data-who="${esc(p)}">${esc(p)}</button>`).join("")}</div>
      ${store.demo ? `<p class="demo">Demo-Modus: Daten liegen nur auf diesem Gerät.</p>` : `<button class="link" data-logout>Abmelden</button>`}
    </section>`;

  $app.querySelectorAll("[data-med]").forEach((b) => b.addEventListener("click", () => medSheet(meds.find((m) => m.id === b.dataset.med))));
  $app.querySelector("[data-med-new]").addEventListener("click", () => medSheet(null));
  $app.querySelector("[data-ths-new]").addEventListener("click", () => thsSheet(null, thsNow));
  $app.querySelectorAll("[data-ths]").forEach((b) => b.addEventListener("click", () => thsSheet(ths.find((s) => s.id === b.dataset.ths))));
  $app.querySelectorAll("[data-who]").forEach((b) =>
    b.addEventListener("click", () => {
      who.set(b.dataset.who);
      renderSettings();
    }),
  );
  $app.querySelector("[data-export]").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const counts = await exportPackage(store, PATIENT, today());
      toast(`Export erstellt: ${counts.find(([n]) => n === "mobility")[1]} Beweglichkeitseinträge.`);
    } catch (err) {
      console.error(err);
      toast("Export fehlgeschlagen.");
    } finally {
      e.target.disabled = false;
    }
  });
  $app.querySelector("[data-logout]")?.addEventListener("click", async () => {
    await store.signOut();
    renderPin();
  });
}

function medSheet(med) {
  const t = today();
  const times = new Set(med?.times || []);
  sheet(
    `<h2>${med ? "Medikament ändern" : "Neues Medikament"}</h2>
     <label>Name <input type="text" name="name" value="${esc(med?.name || "")}" placeholder="z. B. Levodopa/Benserazid"></label>
     <label>Dosis <input type="text" name="dose" value="${esc(med?.dose || "")}" placeholder="z. B. 125 mg"></label>
     <label class="check-row"><input type="checkbox" name="rel" ${med?.doseRelevant === false ? "" : "checked"}>
       Wirkt direkt auf die Beweglichkeit (z. B. Levodopa)</label>
     <p class="sub">Für die Analyse: Nur diese Einnahmen zählen beim Wirkverlauf nach der Einnahme.</p>
     <p><strong>Einnahmezeiten</strong></p>
     <div class="meals">${SLOTS.map((s) => `<button type="button" class="meal ${times.has(s) ? "on" : ""}" data-time="${s}" aria-pressed="${times.has(s)}">${s}</button>`).join("")}</div>
     <label>Gilt ab <input type="date" name="from" value="${med && med.validFrom > t ? med.validFrom : t}"></label>
     <p class="sub">Änderungen gelten ab diesem Datum. Frühere Wochen behalten den alten Plan.</p>
     <button class="primary" data-save>Speichern</button>
     ${med ? `<button class="secondary danger" data-del>Ab heute absetzen</button>` : ""}`,
    (el, close) => {
      el.querySelectorAll("[data-time]").forEach((b) =>
        b.addEventListener("click", () => {
          times.has(b.dataset.time) ? times.delete(b.dataset.time) : times.add(b.dataset.time);
          b.classList.toggle("on");
          b.setAttribute("aria-pressed", times.has(b.dataset.time));
        }),
      );
      const val = (n) => el.querySelector(`[name="${n}"]`).value.trim();
      el.querySelector("[data-save]").addEventListener("click", () => {
        const name = val("name");
        const from = val("from") || t;
        if (!name) return toast("Bitte einen Namen eingeben.");
        if (!times.size) return toast("Bitte mindestens eine Uhrzeit wählen.");
        const data = { name, dose: val("dose"), doseRelevant: el.querySelector('[name="rel"]').checked, times: [...times].sort(), validFrom: from, validTo: null };
        const { store } = state;
        if (med && med.validFrom < from) {
          // alte Version bis zum Vortag gültig lassen, neue Version anlegen
          store.save("medications", { ...med, validTo: addDays(from, -1) });
          store.save("medications", data);
        } else {
          store.save("medications", { ...data, id: med?.id });
        }
        close();
        renderSettings();
      });
      el.querySelector("[data-del]")?.addEventListener("click", () => {
        if (med.validFrom >= t) state.store.remove("medications", med.id);
        else state.store.save("medications", { ...med, validTo: addDays(t, -1) });
        close();
        renderSettings();
      });
    },
  );
}

function thsSheet(entry, current) {
  const base = entry || current;
  const opts = [];
  for (let v = 0; v <= 20; v += 0.5) opts.push(v);
  const [d, tm] = entry ? entry.validFrom.split("T") : [today(), nowTime()];
  sheet(
    `<h2>${entry ? "THS-Eintrag ändern" : "Neue THS-Einstellung"}</h2>
     <div class="row">
       <button class="choice ${base?.mode !== "closedLoop" ? "chosen" : ""}" data-mode="manual">Empfindlichkeit</button>
       <button class="choice ${base?.mode === "closedLoop" ? "chosen" : ""}" data-mode="closedLoop">Closed-Loop</button>
     </div>
     <label class="sens">Empfindlichkeit
       <select name="sens">${opts.map((v) => `<option value="${v}" ${Number(base?.sensitivity ?? 0) === v ? "selected" : ""}>${fmtNum(v)}</option>`).join("")}</select></label>
     <p class="sub cl" hidden>Bei Closed-Loop regelt das Gerät selbst, die Empfindlichkeit ist nicht bekannt.</p>
     <label>Gilt ab <input type="date" name="d" value="${d}"></label>
     <label>Uhrzeit <input type="time" name="t" value="${tm}"></label>
     <label>Notiz (optional) <input type="text" name="note" value="${esc(entry?.note || "")}"></label>
     <button class="primary" data-save>Speichern</button>
     ${entry ? `<button class="secondary danger" data-del>Eintrag löschen</button>` : ""}`,
    (el, close) => {
      let mode = base?.mode === "closedLoop" ? "closedLoop" : "manual";
      const sync = () => {
        el.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("chosen", b.dataset.mode === mode));
        el.querySelector(".sens").hidden = mode !== "manual";
        el.querySelector(".cl").hidden = mode === "manual";
      };
      el.querySelectorAll("[data-mode]").forEach((b) =>
        b.addEventListener("click", () => {
          mode = b.dataset.mode;
          sync();
        }),
      );
      sync();
      const val = (n) => el.querySelector(`[name="${n}"]`).value;
      el.querySelector("[data-save]").addEventListener("click", () => {
        state.store.save("thsSettings", {
          id: entry?.id,
          validFrom: `${val("d") || today()}T${val("t") || "00:00"}`,
          mode,
          sensitivity: mode === "manual" ? Number(val("sens")) : null,
          note: val("note").trim(),
        });
        close();
        renderSettings();
      });
      el.querySelector("[data-del]")?.addEventListener("click", () => {
        state.store.remove("thsSettings", entry.id);
        close();
        renderSettings();
      });
    },
  );
}

// ---------------------------------------------------------------- Service Worker (offline)

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service Worker:", e));
}

boot();
