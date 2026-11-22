# Beweglichkeitsprofil

Web-App, mit der Heidi ihre Beweglichkeit, ihre Medikamente und die THS-Einstellung erfasst, nach dem Vorbild des Papierbogens „Beweglichkeitsprofil“. Die App läuft als statische Seite auf GitHub Pages, die Daten liegen in Firebase (Firestore, Standort Frankfurt).

## Funktionen

- **Heute:** Mit vier großen Tasten wird die Beweglichkeit für die aktuelle halbe Stunde eingetragen (Überbeweglich, Gut, Schlecht, Freezing). Nach einer Lücke bietet die App an, die fehlenden Zeiten nachzutragen. Im Tagesraster lassen sich Einträge von 06:00 bis 23:30 Uhr ändern und vergangene Tage nachtragen.
- **Medikamente:** Der Plan gilt als eingenommen. Nur Abweichungen werden eingetragen: später genommen, ausgelassen oder eine zusätzliche Einnahme.
- **Außerdem:** Mahlzeiten, Schlaf in Stunden und Bemerkungen.
- **Woche:** Der Bogen sieht aus wie auf Papier, mit Verordnungsplan, Farbraster, THS, Abweichungen und Bemerkungen. Über „Drucken / als PDF speichern“ entsteht der Bogen für den Arzt (A4 quer).
- **Plan & THS:** Hier werden die Medikamente mit Einnahmezeiten gepflegt. Eine Änderung gilt ab einem Datum, frühere Wochen behalten den alten Plan. Bei der THS wird bei jeder Änderung entweder Closed-Loop oder eine Empfindlichkeit von 0 bis 20 in 0,5er-Schritten eingetragen.
- **Offline:** Einträge funktionieren ohne Netz und werden später synchronisiert.
- **Als App:** Auf dem iPhone über Safari → Teilen → „Zum Home-Bildschirm“, auf Android über Chrome → Menü → „App installieren“.

## Einrichtung

Ohne Firebase-Konfiguration in `js/config.js` (`firebaseConfig = null`) läuft die App im **Demo-Modus**. Dann liegen die Daten nur im Browser des jeweiligen Geräts.

1. **Web-App registrieren:** erledigt, die Konfiguration steht in `js/config.js`.
2. **Anmeldung:** Unter Authentication → Sign-in method „Anonym“ aktivieren.
3. **Domain freigeben:** Unter Authentication → Settings → Autorisierte Domains `iamsartor.github.io` hinzufügen.
4. **Regeln:** Den Inhalt von `firestore.rules` unter Firestore → Regeln einfügen und veröffentlichen.

Die PIN prüft die App selbst gegen `PIN_HASH` in `js/config.js`. Danach meldet sie sich anonym bei Firebase an. Neue PIN setzen: `printf 123456 | sha256sum` ausführen und den Wert als `PIN_HASH` eintragen.

Bewusst einfach gehalten: Wer die öffentliche Konfiguration kennt, könnte sich ebenfalls anonym anmelden und die Daten lesen. Die Daten enthalten nur den Vornamen.

Die PIN muss pro Gerät nur einmal eingegeben werden. Danach fragt die App, ob Heidi oder Heino das Gerät benutzt, damit bei jedem Eintrag steht, wer ihn gemacht hat.

## Datenmodell

Alle Daten liegen unter `patients/heidi/…`:

| Collection | Inhalt |
| --- | --- |
| `days/{YYYY-MM-DD}` | `mobility` (Uhrzeit → `over`/`good`/`poor`/`freeze`), `sleepHours`, `meals`, `notes` |
| `medications/{id}` | `name`, `dose`, `times`, `validFrom`, `validTo` |
| `deviations/{id}` | `date`, `medName`, `plannedTime`, `type` (`late`/`skipped`/`extra`), `actualTime` |
| `thsSettings/{id}` | `validFrom`, `mode` (`closedLoop`/`manual`), `sensitivity`, `note` |

Jeder Eintrag speichert außerdem `updatedBy` und `updatedAt`.

## Entwicklung

Die App braucht keinen Build-Schritt. Zum lokalen Testen genügt ein einfacher Webserver:

```
python3 -m http.server 8000
```

Danach ist die App unter http://localhost:8000 erreichbar. Nach Änderungen an den Dateien `VERSION` in `sw.js` erhöhen, damit installierte Apps die neue Fassung laden.
