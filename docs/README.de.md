# Markda

[English](../README.md) · [日本語](README.ja.md) · [简体中文](README.zh-cn.md) · [Español](README.es.md) · **Deutsch**

**Bearbeite das Dokument, das du siehst. Behalte das Markdown, das dir gehört.**

Markda ist ein Markdown-Editor für VS Code Desktop, der die Quelldatei erhält. Er richtet sich an Autor:innen, Entwickler:innen, Forschende und Notiznehmende, die ein formatiertes Dokument bearbeiten möchten, ohne auf lesbare Markdown-Dateien zu verzichten. Bearbeite Überschriften, Aufgaben, Tabellen, Code, Formeln, Diagramme und Bilder direkt an Ort und Stelle; die Datei auf der Festplatte bleibt sauberes, transportables Markdown.

[Offizielle Website](https://o-server.main.jp/markda/) · [Installation aus dem Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda) · [Quellcode auf GitHub ansehen](https://github.com/tetsuji16/Markda) · [Fehler melden](https://github.com/tetsuji16/Markda/issues)

Markda 0.1 ist eine Vorschauversion.

> **Markda in Aktion:** [16-Sekunden-Einführung ansehen](../media/videos/markda-intro.mp4) · [GUI-Besichtigung ansehen](../media/videos/markda-gui-demo.mp4)

## Erste Schritte

1. Installiere Markda aus dem [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda).
2. Öffne eine Markdown-Datei. Falls sie im Standard-Texteditor von VS Code geöffnet wird, wähle im Editor-Titel **Open with markda**, führe **Markda: Open with Markda** aus oder wähle im Menü des Editor-Tabs **Reopen Editor With… → Markda**.
3. Bearbeite das gerenderte Dokument. Verwende die `</>`-Schaltfläche oder **Markda: Toggle Source Code Mode**, wann immer du mit der Markdown-Quelldatei arbeiten möchtest.

Markda unterstützt Dateien mit den Endungen `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn` und `.txt`. Um zum eingebauten Editor von VS Code zurückzukehren, verwende im Titel des Markda-Editors **Reopen with Another Editor**.

![Markda — bearbeite das gerenderte Dokument und behalte eine saubere, transportable Markdown-Quelldatei](../media/marketing/marketplace-hero.png)

## Quellenerhaltend by design

![Kompakte Produktvorstellung von Markda im Live-Editor: Quellmodus, Fokus- und Schreibmaschinenmodus, Tabellen, Aufgaben, Formeln, Code und lokale Markdown-Darstellung](../media/screenshots/live-editing.png)

Das Textdokument von VS Code bleibt die einzige Quelle der Wahrheit. Markda wendet gezielte Änderungen an diesem Dokument an und erhält unveränderte Inhalte sowie die Markdown-Syntax. Wechsle jederzeit in den vollständigen Quellmodus, um die Datei direkt zu prüfen oder zu ändern.

## Verbundene Dokumente organisieren

- **Abschnitte einklappen:** Führe die Maus neben eine Überschrift, um deren Einklappmarkierung zu verwenden. Das Outline-Menü bietet Fold All Sections, Expand All Sections und Focus Current Section. Die Überschriftennavigation klammert den umgebenden Abschnitt automatisch aus. Einklappen ändert die Markdown-Datei nicht.
- **Links prüfen:** Nach dem Bearbeiten werden Links zu lokalen Dateien, Bildern und Markdown-Überschriften geprüft. Führe **Markda: Check Document Links** aus, um die Ergebnisse in Problems zu öffnen. Remote-URLs werden nicht abgerufen. Deaktivierte automatische Prüfungen mit `markda.links.checkOnEdit`.
- **Aus einer Vorlage erstellen:** Führe **Markda: New Document from Template** aus, um Meeting-Notizen, eine Projektspezifikation oder ein Tagesjournal zu erstellen. Das Ergebnis öffnet sich als ungespeichertes Dokument. Füge eigene `{name, description, body}`-Einträge zu `markda.templates` hinzu; `{{title}}` und `{{date}}` werden beim Ersetzen des Dokuments ersetzt.
- **Umbenennen mit Link-Updates:** Benenne eine Datei oder einen Ordner über VS Code oder Markda um. Prüfe die Ziele vor und nach der Umbenennung, wähle Änderungen ab, die du nicht möchtest, und bestätige. Escape setzt die Umbenennung ohne Link-Updates fort. Relative Pfade, Überschriftenanker, Query-Strings und Link-Titel werden beibehalten; eingefasster, eingerückter und Inline-Code wird ausgeschlossen. Updates verwenden Workspace-Edits von VS Code und können rückgängig gemacht werden. Schalte dies mit `markda.links.updateOnRename` aus.
- **Verweisende Dokumente finden:** Öffne die eingeklappte **Backlinks**-Ansicht oder führe **Markda: Show Backlinks** aus. Klicke auf ein Ergebnis, um das Dokument zu öffnen. Aktualisiere die Ansicht, nachdem du Links in einer anderen Datei bearbeitet hast.

Backlinks und Umbenennungsprüfungen umfassen bis zu 5.000 Markdown-/Textdateien im geöffneten Workspace, mit Ausnahme von Abhängigkeits- und Build-Verzeichnissen. Sie verwenden geöffnete Dokumente, einschließlich ungespeicherter Änderungen. Link-Updates erfordern einen vertrauenswürdigen Workspace und gelten für Markdown-Link-/Bildziele und Referenzdefinitionen; HTML-Links und außerhalb von VS Code durchgeführte Umbenennungen werden nicht umgeschrieben.

## Highlights

- Bearbeite unterstützte CommonMark- und Markda-Erweiterungssyntax an Ort und Stelle – einschließlich Referenzlinks und -bilder, Fußnoten, eingerückten Code, Entitäten, Emoji-Shortcodes, YAML Front Matter, `[toc]` und ausdrücklich erlaubtes HTML – oder wechsle in die vollständige Quellansicht.
- Verwende dokumenttypische Absatzumbrüche, intelligentes Einfügen von HTML in Markdown und das Öffnen von Links mit Modifikator-Tasten.
- Arbeite mit Tabellen über direkte Zellenbearbeitung, Zeilen- und Spaltensteuerung, Drag-Reihenfolge, Größenänderung, Ausrichtung und Tab-Navigation.
- Bearbeite Codeblöcke mit Syntaxhervorhebung direkt, ohne den Quellmodus zu öffnen, mit einheitlichem Undo- und Redo-Verhalten.
- Rendere KaTeX-Formeln, nummerierte und beschriftete Gleichungen mit Verweisen sowie Mermaid-Diagramme, ohne den Dokumentinhalt an einen Online-Rendering-Dienst zu senden.
- Füge mehrere Bilder ein, speichere Bilder aus der Zwischenablage und ziehe sie per Drag-and-Drop in ein konfigurierbares Asset-Verzeichnis.
- Navigiere mit filterbaren Outline- und Files-Ansichten, Markdown-Suche im Workspace und Quick Open.
- Verwende Fokus- und Schreibmaschinenmodus, helle und dunkle Themen, Suche und Dokumentstatistiken.
- Exportiere formatiertes oder schlichtes HTML, erstelle PDF über einen installierten Chromium-Browser oder rufe vertrauenswürdige externe Exportziele wie Pandoc auf.
- Folge Überschriftenlinks innerhalb und zwischen Dokumenten und zeige VS Code-Diagnosen von Rechtschreibprüfern, markdownlint, Vale und anderen Sprachwerkzeugen im Live-Editor an.
- Halte geteilte Editoren über das zugrunde liegende VS Code-Textdokument synchron.
- Halte das gewählte Editor-Theme über offene Markdown-Tabs hinweg synchron.
- Bleibe in langen Dokumenten reaktionsfähig dank optimierter Statistiken, Outline-Verfolgung und Live-View-Cursor-Updates.
- Formatiere über eine responsive Toolbar, Auswahlsteuerungen, den Link-Dialog oder die `/`-Schnelleinfüge, ohne das gerenderte Dokument zu verlassen.
- Sieh die Speichersynchronisation, den aktuellen Abschnitt, Dokumentstatistiken und handlungsrelevante Diagnosen in der Statusleiste des Editors.

Die Markda-Ansicht in der Aktivitätsleiste bietet Dokument-Outline und Markdown-Dateinavigation.

## Nützliche Befehle und Shortcuts

Die von Markda bereitgestellten Shortcuts sind standardmäßig deaktiviert, damit sie VS Code-Tastaturbelegungen nicht überschreiben. Aktiviere **Markda › Editor: Enable Default Keybindings**, um die folgenden Belegungen zu verwenden, wechsle die Shortcut-Priorität über die Toolbar des Markda-Editors oder weise einzelne `Markda:`-Befehle in **Keyboard Shortcuts** zu.

| Aktion | Windows/Linux | macOS |
| --- | --- | --- |
| Quellmodus umschalten | `Ctrl+/` | `Cmd+/` |
| Fokusmodus umschalten | `F8` | `F8` |
| Schreibmaschinenmodus umschalten | `F9` | `F9` |
| Fett | `Ctrl+B` | `Cmd+B` |
| Kursiv | `Ctrl+I` | `Cmd+I` |
| Link einfügen | `Ctrl+K` | `Cmd+K` |
| Nummerierte Liste | `Ctrl+Shift+[` | `Cmd+Option+O` |
| Aufzählungsliste | `Ctrl+Shift+]` | `Cmd+Option+U` |
| Blockzitat | `Ctrl+Shift+Q` | `Cmd+Option+Q` |
| Codeblock | `Ctrl+Shift+K` | `Cmd+Option+C` |
| Durchgestrichen | `Alt+Shift+5` | `Ctrl+Shift+Backtick` |
| Als Markdown kopieren | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| Als Klartext einfügen | `Ctrl+Shift+V` | `Cmd+Shift+V` |

Suche in der Befehlspalette nach `Markda:`, um alle verfügbaren Befehle zu sehen, einschließlich Tabellen- und Formeleinfügung, Workspace-Suche, Statistiken, HTML/PDF-Export und konfigurierte externe Exportziele.

Führe **Markda: Configure File Associations** aus, um auszuwählen, welche von `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn` und `.txt` standardmäßig mit Markda geöffnet werden. Zuordnungen können für den aktuellen Benutzer oder nur für den aktuellen Workspace gespeichert werden. Sie werden in der VS Code-Einstellung `workbench.editorAssociations` abgelegt und können später auch in den Einstellungen geprüft oder geändert werden.

## Einstellungen

Einstellungen unter `markda.*` steuern die Editor-Breite, Delimiter-Paarung, das Schreibmaschinenverhalten, die Verzögerung der Split-Vorschau, die Größenbeschränkung der Live-Tabelle, Markdown-Funktionen, Bildpfade, Themen, Exportverhalten, Remote-Ressourcen und unsicheres HTML. `markda.export.pdfBrowserPath` wählt eine benutzerdefinierte Edge/Chrome/Chromium-Binary; wenn leer, durchsucht Markda `PATH` sowie gängige System- und Benutzerverzeichnisse. `markda.export.targets` registriert vertrauenswürdige Argument-Array-Befehle mit `${source}`, `${destination}`, `${documentDir}`, `${documentName}` und `${workspaceFolder}`. Öffne **Settings** und suche nach `markda`, um Beschreibungen und Standardwerte zu sehen.

Standardmäßig erfordern Remote-Ressourcen eine Bestätigung und unsicheres HTML ist deaktiviert. In einem nicht vertrauenswürdigen Workspace werden workspacegesteuerte Bildziele und Sicherheitsüberschreibungen eingeschränkt.

## Voraussetzungen und Umfang

- VS Code Desktop 1.100 oder neuer
- Lokale oder Remote-Desktop-Extension-Hosts; diese Version ist keine Web-Extension für `vscode.dev`
- HTML- und PDF-Export werden unterstützt. Andere Formate können als externe Exportziele konfiguriert werden; ihre Konvertierungswerkzeuge werden nicht mitgeliefert.
- Die Extension-UI ist lokalisiert für Englisch, Arabisch, Deutsch, Spanisch, Französisch, Japanisch, Koreanisch, Brasilianisches Portugiesisch, Russisch, Vereinfachtes Chinesisch und Traditionelles Chinesisch. VS Code verwendet die in seinen Einstellungen gewählte Anzeigesprache.

## Datenschutz und Sicherheit

Markda enthält keine Telemetrie. Das Markdown-Rendering und die mitgelieferte Diagramm- und Formelunterstützung laufen lokal. Das Öffnen externer Links und das Laden entfernter Ressourcen unterliegen weiterhin den Sicherheitseinstellungen von Markda und VS Code Workspace Trust.

## Entwicklung

```text
npm install
npm run check
npm test
npm run build
```

Drücke in VS Code `F5`, um den Extension Development Host mit `docs/DEMO.md` zu öffnen. Siehe [`docs/SPECIFICATION.md`](SPECIFICATION.md) für den Kompatibilitätsvertrag und den Implementierungsstand sowie [`docs/PUBLISHING.md`](PUBLISHING.md) für die Release-Checkliste.

Fehlerberichte und fokussierte Funktionswünsche sind in [GitHub Issues](https://github.com/tetsuji16/Markda/issues) willkommen.

## Lizenz

MIT
