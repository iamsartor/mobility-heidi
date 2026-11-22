// Firebase-Konfiguration der Web-App.
// Zu finden in der Firebase-Konsole unter Projekteinstellungen → Allgemein → Meine Apps → Web-App.
// Diese Werte sind nicht geheim; geschützt werden die Daten durch firestore.rules.
//
// Solange firebaseConfig null ist, läuft die App im Demo-Modus:
// Daten liegen dann nur im Browser dieses Geräts, ohne Anmeldung.
export const firebaseConfig = null;
/* Beispiel:
export const firebaseConfig = {
  apiKey: "…",
  authDomain: "mobility-heidi.firebaseapp.com",
  projectId: "mobility-heidi",
  storageBucket: "mobility-heidi.appspot.com",
  messagingSenderId: "…",
  appId: "…",
};
*/

// Gemeinsames Konto in Firebase Authentication (E-Mail/Passwort).
// Das Passwort ist die PIN und steht NICHT im Code.
export const FAMILY_EMAIL = "familie@mobility-heidi.app";

// Patientin, deren Daten erfasst werden.
export const PATIENT = { id: "heidi", name: "Heidi" };

// Wer trägt ein? Wird beim ersten Start pro Gerät gewählt.
export const PEOPLE = ["Heidi", "Heino"];
