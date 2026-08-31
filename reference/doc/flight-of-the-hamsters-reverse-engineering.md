# Flight of the Hamsters — Reverse Engineering

Vollständige Rekonstruktion der Spielmechanik aus `OCybCA4ADbpTKT.swf` (1,2 MB, CWS v8).
Alle Konstanten in diesem Dokument sind aus dem Bytecode gelesen, nicht geschätzt.

---

## 1. Vorgehen

| Schritt | Werkzeug | Ergebnis |
|---|---|---|
| Container zerlegen | eigener Python-Parser (`reference/tools/swfparse.py`) | Tag-Inventar, Stage, Framerate |
| Bytecode dekompilieren | JPEXS ffdec 26.2.1, `-export script` | 94 Scripts, 5 AS2-Klassen |
| Instanznamen + Positionen | eigener Parser über `PlaceObject2`/`DefineSprite` | Weltkoordinaten von `hamster`, `pillow` etc. |
| Symbolnamen | `ExportAssets`-Tag | 49 Linkage-Namen für `attachMovie` |
| Verifikation | Simulation der extrahierten Formeln | Reichweiten decken sich mit realen Scores |

Das Spiel ist **AVM1 (AS2)** — keine `DoABC`-Tags. Dekompilat ist praktisch Originalquellcode
inklusive Variablennamen, Kommentarstruktur und Tippfehlern (`radainsToDegrees`).

## 2. Container

```
Signatur      CWS, SWF-Version 8
Stage         600 x 400 px
Stage-FPS     19          (nur Animationen; Logik läuft unabhängig)
Frames        7           (Preloader, Menü, Game auf Frame 6, Ende)
Tags          659 top-level, davon 109 DefineSprite, 217 DefineShape, 26 DefineSound
Scripts       94 (5 DoAction, 7 DoInitAction, Rest in Sprite-Frames)
```

## 3. Klassenstruktur

| Klasse | Zeilen | Rolle |
|---|---|---|
| `Game` | ~1500 | God-Class: State Machine, Physik-Tick, Spawns, Kollision, Sound, HUD |
| `Bullet` | ~90 | Der Hamster als Projektil: Position, Velocity, Rotation, Schatten |
| `GameCamera` | ~250 | Follow/Pan, Parallax-Hügel, Hintergrund-Offsets |
| `XML_Loader` | ~50 | lädt `gameData` (Node-Daten für `plotNodes`) |
| `CartoonSO` | ~20 | `SharedObject`-Wrapper für den Highscore |
| `MyDispatcher` | ~15 | `mx.events.EventDispatcher`-Bridge |

## 4. Timing-Modell — der wichtigste Punkt für einen Port

Die Physik hängt **nicht** an der Stage-Framerate. Beide Phasen laufen über `setInterval`:

```actionscript
this.jumpInt = setInterval(this,"jumpFrame",50);   // Sprungphase
this.bltInt  = setInterval(this,"onUpdate",50);    // Flugphase
```

**50 ms = exakt 20 Hz.** Alle Beschleunigungen sind Werte *pro Tick*, nicht pro Sekunde.
Ein Port muss einen Fixed Timestep von 20 Hz fahren; mit Delta-Time-Integration weichen
Flugbahnen und Scores ab. Die 19 fps der Stage betreffen nur MovieClip-Animationen.

## 5. Koordinatensystem

Das Spielfeld ist `DefineSprite 235`. y wächst nach unten, der Boden liegt bei y = 950.

| Wert | Bedeutung |
|---|---|
| `hamster` bei (148, 956) | Startposition, x bleibt konstant |
| `pillow` bei (117.3, 740.9) | wird beim Launch auf x = 140 gesetzt |
| y = 950 | Boden (Kollisionsschwelle) |
| y = 949 | Rücksetzposition nach Bounce |
| y = 946 | Schwelle für Übergang in `skidding` |
| y = 963 | y-Position des Schattens |
| y = 940 | unterhalb davon keine Rotation mehr (`Bullet.update`) |
| y = −4790 | `spaceBG` — Weltraum-Hintergrund, erreichbar |
| Distanz | `Math.floor(bltClip._x / 100)` → **100 px = 1 ft** |

Kamera: `_$mc._x = -targetX + 150`, `_$mc._y = -targetY + 200`, geklemmt auf `_y >= -600`.
`getCameraPos()` liefert diese negativen Container-Offsets, was in den Spawn-Formeln als
`camX` auftaucht.

## 6. Launch — zwei Klicks

### Klick 1: Sprungphase (`jumpFrame`, 20 Hz)

```
yvel = -(random(5) + 10)                       // -10 .. -14
je Tick:
  if (!boost && y < 930) { yvel -= random(5) + 15; boost = true }   // einmaliger Boost
  yvel += (yvel < 0) ? 1.5 : 0.75              // asymmetrische Gravitation
  y += yvel
  if (y >= 956) -> faceplant, 0 ft             // Fenster verpasst
```

Der Apex liegt bei y ≈ 726, der Boost triggert beim ersten Tick unter y = 930.
Die asymmetrische Gravitation (Aufstieg 1.5, Fall 0.75) macht den Fall langsamer als
den Aufstieg — das verlängert das Trefferfenster nach oben.

### Klick 2: Treffer (`getPillowCollision` + `shoot`)

```
if (!hamster.core.hitTest(pillow)) -> "miss", Sprung läuft weiter bis zum Faceplant

if (y > 759) { y = 759; yvel = 0 }             // Clamp: tötet den Rising-Bonus
dx   = hamster._x - pillow._x + 30             // = 38 bei pillow._x = 140
dy   = y - pillow._y - 5                       // = y - 745.9
dist = sqrt(dx² + dy²)
ad   = atan2(dy, dx) * 180/pi + 90             // Abschusswinkel in Grad
vel  = 90 - dist                               // näher an der Pillow-Mitte = schneller
if (yvel < 0) vel += (ad <= 90) ? -yvel/2 : yvel/2     // Bonus fürs Treffen im Aufstieg
xvel =  sin(ad) * vel
yvel = -cos(ad) * vel
grav = 0.99
```

Zwei Dinge fallen auf:

- **`vel = 90 - dist`** — die Geschwindigkeit ist die *Nähe* zur Pillow-Mitte, nicht ein
  Kraftbalken. Maximum bei dy = 0 (y = 745.9): `dist = 38`, `vel = 52`.
- Der Clamp bei y = 759 setzt `yvel = 0`. Jeder Treffer unterhalb y = 759 verliert damit
  den Rising-Bonus **und** bekommt `ad ≈ 109°`, also einen leicht nach unten gerichteten
  Schuss. Der optimale Treffer liegt oberhalb von 759 im Aufstieg: `ad` zwischen 40° und 80°
  plus bis zu +9.5 Bonus-Velocity.

## 7. Flugphase — `onUpdate()` in exakter Reihenfolge

```
1  generatePowerups(); generateClouds(); generateBushes()
2  checkPowerUpsColl()                  // hitTest auf .core-Boxen
3  checkCollision()                     // Boden
4  Powerup-Effekte anwenden (wind, grav, speed, rebound)
5  xvel *= 0.99                          // Luftwiderstand
6  yvel += grav
7  Fall-Erkennung: yvel > 50 -> "drop"-Animation
8  skidding-Erkennung bei y >= 946
9  blt.update()                          // x += xvel; y += yvel; Rotation aus atan2
10 cam.doFollow()
11 if (xvel < 1 && hit) -> onShotDone()
12 gravPoints: -10 wenn Maus gehalten, sonst +1 (Max 100)
```

Reihenfolge ist relevant: Kollision wird **vor** der Integration geprüft, mit
`bc._y + yvel` als Vorhersage.

## 8. Physik-Konstanten

| Symbol | Wert | Wirkung |
|---|---|---|
| Tickrate | 20 Hz | `setInterval(...,50)` |
| `grav` | 0.99 | Standardgravitation pro Tick |
| Luftwiderstand | `xvel *= 0.99` | pro Tick, wirkt immer |
| `f` | 0.6 | horizontale Restitution beim Bounce |
| `slidef` | 0.99 | horizontale Restitution im Slide-Modus |
| Bounce (normal) | `yvel /= -2` | ohne Powerup |
| Winkelschwelle | 70° | Einschlagwinkel > 70° = Faceplant statt Bounce |
| `gravPointsMax` | 100 | Glide-Vorrat |
| Glide-Verbrauch | −10 / Tick | 10 Ticks = 0,5 s Dauerlift |
| Glide-Regeneration | +1 / Tick | 100 Ticks = 5 s für volle Anzeige |
| Glide-Lift | `grav = -0.17 * xvel` | **geschwindigkeitsproportionaler Auftrieb** |
| `turn == 6` | Game Over | 5 Versuche |

Der Glide ist der Kern des ganzen Spiels: Der Auftrieb skaliert mit `xvel`. Bei xvel = 50
ergibt `-0.17 * 50 = -8.5` pro Tick gegen 0.99 Gravitation — das ist Faktor 8,5 Netto-Lift.
Deshalb erreicht man mit genug Speed-Powerups tatsächlich den `spaceBG` bei y = −4790.
Gleichzeitig bremst `xvel *= 0.99` jeden Tick, weshalb pures Dauerhalten hoch aber nicht
weit fliegt — genau das, was der Hilfetext des Spiels behauptet.

## 9. Powerups

Spawn in `generatePowerups()`, jeden Tick geprüft:

```
if (600 - camX < powerupMark) return          // powerupMark startet bei 650
powerupMark += 150                            // also alle 150 px Kameraweg
x = 800 - camX                                // 200 px rechts außerhalb des Viewports
y = (typ == "rebound") ? 930 : 840 - random(1200)     // -360 .. 840
```

Verteilung über `random(11)`:

| Roll | Typ | Wahrscheinlichkeit | Effekt |
|---|---|---|---|
| 0–1 | `bounce` | 2/11 | nächster Bodenkontakt: `xvel *= 0.6`, `yvel *= -0.6`, min −30 |
| 2–4 | `speed` | 3/11 | `xvel += 20` |
| 5–7 | `wind` | 3/11 | `yvel -= 8`, `xvel += 2` |
| 8 | `slide` | 1/11 | Skid-Modus: `xvel *= 0.99` statt 0.6 am Boden |
| 9 | `rebound` | 1/11 | `xvel = 40`, `yvel = -40`, `hit = false` — Bodenitem |
| 10 | `superbounce` | 1/11 | `xvel *= 1.6`, `yvel *= -1.5`, min −50 |

Zusätzlich: `grav`-Powerup (`grav -= 2`) existiert im Code (`gravOn`), wird von
`generatePowerups` aber nie erzeugt. Clouds (`cloudMark` 400) und Bushes (`bushMark` 650)
sind reine Deko, Vehicles (`vehicleMark` 1200) ebenfalls.

Kollision läuft über `clip.core.hitTest(bc.core)` — **Bounding-Box-Test auf Subclips**,
nicht Kreis, nicht Shape-genau. Für einen 1:1-Port müssen die Bounds der `core`-Sprites
aus den Shape-Records gelesen werden.

## 10. Bodenkollision — Verzweigung

Ausgelöst wenn `bc._y + yvel >= 950`. Der Einschlagwinkel entscheidet:

```
angle = atan2(y_predicted - blt.oy, bc._x - blt.ox) in Grad
```

| Bedingung | Ergebnis |
|---|---|
| `angle < 70` und kein Powerup | Bounce: `xvel *= 0.6`, `yvel /= -2`, `bounce_fx` |
| `bounce` aktiv | `yvel *= -0.6`, gedeckelt auf min −30, `hit = false` |
| `superbounce` aktiv | `xvel *= 1.6`, `yvel *= -1.5`, gedeckelt auf min −50 |
| `angle > 70` | **Faceplant**: `xvel = yvel = 0`, Shot beendet |
| `falling == true` beim Faceplant | `hit_hole` statt `hit_faceplant` (Krater-Animation) |
| `slide` aktiv | `xvel *= 0.99` statt 0.6 → sehr lange Rollphase |

`falling` wird ab `yvel > 50` gesetzt. Steiler Einschlag ist also doppelt bestraft:
Faceplant statt Bounce, plus Loch-Animation.

## 11. Gefundene Eigenheiten und Bugs

- **`if (this.blt.yvel > 50 && !this.bounce & !this.superbounce)`** — bitweises `&` statt `&&`.
  Funktioniert hier zufällig, weil Booleans zu 0/1 koerzieren, ist aber ein echter Bug.
- **`glideVals`** — Array mit 25 handgetunten Werten wird initialisiert und nie benutzt.
  Toter Code aus einer früheren Glide-Implementierung. Nicht portieren.
- **`deleteBlt()`** hat als Body nur den Ausdruck `false;`. Tut nichts.
- **`increaseGravity(n)`** ignoriert seinen Parameter und rechnet immer `-0.17 * xvel`.
- **`radainsToDegrees`** — Tippfehler im Methodennamen, in beiden Klassen konsistent.
- **`pi = 3.141593`** als Klassenkonstante statt `Math.PI` — 7 Stellen, minimal ungenau.
- `Bullet.update()` unterdrückt die Rotation bei `xvel < 7 && _y > 940`, damit der Hamster
  am Boden nicht zappelt.
- Der Schatten skaliert linear mit der Höhe: `xscale = yscale = 100 * (y - 700) / 263`.

## 12. Verifikation

Die extrahierten Formeln wurden als 20-Hz-Simulation nachgerechnet (Sprungphase, Launch,
Flug, Powerup-Spawns mit approximierten 40-px-Boxen, Bodenkollision):

| Strategie | Median | Maximum |
|---|---|---|
| Nie halten | ~13 ft | ~59 ft |
| Dauerhalten ("mashen") | ~45 ft | ~52 ft, dafür >100.000 px Höhe |
| Halten nur im Sinkflug | 46 ft | 313 ft |

Reale Spielerwerte aus den Kommentaren der Portalseite liegen bei 153, 339 und einem
behaupteten 19023. Größenordnung und Verhalten stimmen: Dauerhalten fliegt hoch und kurz,
dosiertes Halten plus Speed-Ketten skaliert praktisch unbegrenzt.

## 13. Was für einen echten 1:1-Port noch fehlt

1. **Bounding Boxes der `core`-Subclips** aus den `DefineShape`-Records (Powerups, Hamster,
   Pillow). Ohne die stimmt das Trefferfenster nicht exakt.
2. **Sprite-Timelines** der Powerup-Clips — die Animationen bestimmen, wie lange ein
   `_wind`-Clip aktiv `wind = true` setzt (der Effekt feuert pro Tick, solange die Box
   überlappt).
3. **`gameData`-XML** und `plotNodes()` — vermutlich Debug-/Editor-Funktion, prüfen ob im
   Release überhaupt geladen wird.
4. **Assets**: 217 Shapes als SVG, 26 Sounds als MP3, 9 Bitmaps sind mit
   `ffdec -export shape,sound,image` extrahierbar. Rechtlich: Analyse ja, Übernahme in ein
   eigenes veröffentlichtes Projekt nein.
5. **Zufallszahlen**: `random(n)` ist `Math.floor(Math.random()*n)`. Für reproduzierbare
   Läufe im Port einen seedbaren PRNG einsetzen, sonst sind Runs nicht vergleichbar.

## 14. Portierungs-Skelett

```ts
const TICK_MS = 50;          // 20 Hz, nicht verhandelbar
const GRAV = 0.99;
const DRAG = 0.99;
const BOUNCE_F = 0.6;
const SLIDE_F = 0.99;
const GLIDE_FACTOR = -0.17;  // grav = GLIDE_FACTOR * xvel
const GLIDE_MAX = 100;
const GLIDE_DRAIN = 10;
const GLIDE_REGEN = 1;
const GROUND_Y = 950;
const FACEPLANT_ANGLE = 70;
const PX_PER_FOOT = 100;
const SPAWN_EVERY_PX = 150;
const TURNS = 5;
```
