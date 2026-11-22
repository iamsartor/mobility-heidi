// Datenzugriff. Zwei Varianten mit derselben Schnittstelle:
// - FirestoreStore: echte Daten in Firebase (offline-fähig dank lokalem Cache)
// - LocalStore: Demo-Modus, Daten nur im Browser (localStorage)
//
// Datenmodell unter patients/{patientId}/…
//   days/{YYYY-MM-DD}     mobility: {"06:00": "over"|"good"|"poor"}, sleepHours, meals: ["07:30"], notes
//   medications/{id}      name, dose, times: ["07:00"], validFrom, validTo (YYYY-MM-DD oder null)
//   deviations/{id}       date, medId, medName, plannedTime, type: "late"|"skipped"|"extra", actualTime
//   thsSettings/{id}      validFrom (YYYY-MM-DDTHH:MM), mode: "closedLoop"|"manual", sensitivity, note
// Jeder Schreibvorgang setzt zusätzlich updatedBy und updatedAt.

const FB = "https://www.gstatic.com/firebasejs/11.0.2";

export async function createStore({ firebaseConfig, patientId, getWho }) {
  if (!firebaseConfig) return new LocalStore(patientId, getWho);
  const store = new FirestoreStore(patientId, getWho);
  await store.init(firebaseConfig);
  return store;
}

function stamp(getWho) {
  return { updatedBy: getWho() || "?", updatedAt: new Date().toISOString() };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------- Firestore

class FirestoreStore {
  constructor(patientId, getWho) {
    this.patientId = patientId;
    this.getWho = getWho;
    this.demo = false;
  }

  async init(config) {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-auth.js`),
      import(`${FB}/firebase-firestore.js`),
    ]);
    this.fs = fs;
    this.authLib = auth;
    const app = initializeApp(config);
    this.auth = auth.getAuth(app);
    this.db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  }

  // Liefert den aktuell angemeldeten Zustand (true/false), sobald Firebase ihn kennt.
  waitForAuth() {
    return new Promise((resolve) => {
      const off = this.authLib.onAuthStateChanged(this.auth, (user) => {
        off();
        resolve(!!user);
      });
    });
  }

  async signIn(email, pin) {
    await this.authLib.signInWithEmailAndPassword(this.auth, email, pin);
  }

  async signOut() {
    await this.authLib.signOut(this.auth);
  }

  col(name) {
    return this.fs.collection(this.db, "patients", this.patientId, name);
  }

  docRef(name, id) {
    return this.fs.doc(this.db, "patients", this.patientId, name, id);
  }

  // Schreibvorgänge werden nicht abgewartet: offline bestätigt Firestore erst nach
  // dem Sync, die Änderung steht aber sofort im lokalen Cache.
  fire(promise) {
    promise.catch((e) => {
      console.error(e);
      window.dispatchEvent(new CustomEvent("store-error", { detail: e }));
    });
  }

  async getDay(date) {
    const snap = await this.fs.getDoc(this.docRef("days", date));
    return snap.exists() ? snap.data() : {};
  }

  async getDays(from, to) {
    const { query, where, getDocs, documentId } = this.fs;
    const q = query(this.col("days"), where(documentId(), ">=", from), where(documentId(), "<=", to));
    const out = {};
    (await getDocs(q)).forEach((d) => (out[d.id] = d.data()));
    return out;
  }

  // patch: flache Felder; mobility-Einträge mit Wert null werden gelöscht.
  updateDay(date, patch) {
    const data = { ...patch, ...stamp(this.getWho) };
    if (patch.mobility) {
      data.mobility = {};
      for (const [slot, v] of Object.entries(patch.mobility)) {
        data.mobility[slot] = v === null ? this.fs.deleteField() : v;
      }
    }
    this.fire(this.fs.setDoc(this.docRef("days", date), data, { merge: true }));
  }

  async list(name) {
    const out = [];
    (await this.fs.getDocs(this.col(name))).forEach((d) => out.push({ id: d.id, ...d.data() }));
    return out;
  }

  save(name, item) {
    const id = item.id || newId();
    const { id: _, ...data } = item;
    this.fire(this.fs.setDoc(this.docRef(name, id), { ...data, ...stamp(this.getWho) }));
    return id;
  }

  remove(name, id) {
    this.fire(this.fs.deleteDoc(this.docRef(name, id)));
  }
}

// ---------------------------------------------------------------- Demo (localStorage)

class LocalStore {
  constructor(patientId, getWho) {
    this.key = `mobility-demo-${patientId}`;
    this.getWho = getWho;
    this.demo = true;
    try {
      this.data = JSON.parse(localStorage.getItem(this.key)) || {};
    } catch {
      this.data = {};
    }
    for (const c of ["days", "medications", "deviations", "thsSettings"]) this.data[c] ||= {};
  }

  persist() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (e) {
      console.error(e);
    }
  }

  async waitForAuth() {
    return true;
  }
  async signIn() {}
  async signOut() {}

  async getDay(date) {
    return structuredClone(this.data.days[date] || {});
  }

  async getDays(from, to) {
    const out = {};
    for (const [d, v] of Object.entries(this.data.days)) if (d >= from && d <= to) out[d] = structuredClone(v);
    return out;
  }

  updateDay(date, patch) {
    const day = (this.data.days[date] ||= {});
    for (const [k, v] of Object.entries(patch)) {
      if (k === "mobility") {
        day.mobility ||= {};
        for (const [slot, val] of Object.entries(v)) {
          if (val === null) delete day.mobility[slot];
          else day.mobility[slot] = val;
        }
      } else day[k] = v;
    }
    Object.assign(day, stamp(this.getWho));
    this.persist();
  }

  async list(name) {
    return Object.entries(this.data[name]).map(([id, v]) => ({ id, ...structuredClone(v) }));
  }

  save(name, item) {
    const id = item.id || newId();
    const { id: _, ...data } = item;
    this.data[name][id] = { ...data, ...stamp(this.getWho) };
    this.persist();
    return id;
  }

  remove(name, id) {
    delete this.data[name][id];
    this.persist();
  }
}
