// Firebase-Konfiguration der Web-App.
// Zu finden in der Firebase-Konsole unter Projekteinstellungen → Allgemein → Meine Apps → Web-App.
// Diese Werte sind nicht geheim; geschützt werden die Daten durch firestore.rules.
//
// Solange firebaseConfig null ist, läuft die App im Demo-Modus:
// Daten liegen dann nur im Browser dieses Geräts, ohne Anmeldung.
export const firebaseConfig = {
  apiKey: "AIzaSyD_W1zVQWrJwuIGZcA3cy3EgBt_NUJvyx0",
  authDomain: "mobility-heidi.firebaseapp.com",
  projectId: "mobility-heidi",
  storageBucket: "mobility-heidi.firebasestorage.app",
  messagingSenderId: "261960690888",
  appId: "1:261960690888:web:8634ec7e6e27b23cf8c9fd",
};

// PIN für die erste Anmeldung auf einem Gerät, als SHA-256-Hash.
// Neue PIN setzen: im Terminal  printf 123456 | sha256sum  und den Wert hier eintragen.
// Nach der PIN meldet sich die App anonym bei Firebase an.
export const PIN_HASH = "4fde1e4a4ee18989cceb26cef174b918204d8e141e00c1203b530f5005ef87d2";

// Patientin, deren Daten erfasst werden.
export const PATIENT = { id: "heidi", name: "Heidi" };

// Wer trägt ein? Wird beim ersten Start pro Gerät gewählt.
export const PEOPLE = ["Heidi", "Heino"];
