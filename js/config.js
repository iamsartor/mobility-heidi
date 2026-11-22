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

// Gemeinsames Konto in Firebase Authentication (E-Mail/Passwort).
// Das Passwort ist die PIN und steht NICHT im Code.
export const FAMILY_EMAIL = "familie@mobility-heidi.app";

// Patientin, deren Daten erfasst werden.
export const PATIENT = { id: "heidi", name: "Heidi" };

// Wer trägt ein? Wird beim ersten Start pro Gerät gewählt.
export const PEOPLE = ["Heidi", "Heino"];
