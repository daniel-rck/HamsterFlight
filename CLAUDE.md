# Claude-Code-Hinweise für HamsterFlight

Browser-Portierung des Flash-Spiels *Flight of the Hamsters*, aus einer
Bytecode-Analyse des originalen SWF rekonstruiert.

**Diese App ist die bewusste Ausnahme der Flotte.** Sie teilt das
web-base-*Tooling* (Bun, Biome, reusable CI, Hygiene-Dateien) — und sonst
nichts. Kein React, kein Tailwind, kein Router, kein IndexedDB-Layer, kein
Service Worker. Nicht „angleichen".

## Quelle der Wahrheit

1. **`docs/specs/00-hamsterflight.md`** — Architektur und die dokumentierten
   Abweichungen. Vor jeder Arbeit lesen.
2. **`reference/doc/porting-notes.md`** — was aus dem Bytecode stammt und was
   Interpretation ist. Vor jeder Änderung an Physik-Konstanten lesen.
3. **Foundation [`daniel-rck/web-base`](https://github.com/daniel-rck/web-base)**
   — nur für Tooling-Fragen (Bun, Biome, CI, Pins).

## Quality Gates

```bash
bun run verify   # lint, sim purity, atlas, typecheck, tests, build, bundle budget
bun run smoke    # öffnet die gebaute Seite in Chromium (Shader, Asset-404s)
```

`verify` ist das eigentliche Gate — nicht die vier Einzelbefehle der anderen Apps.

## Leitplanken

- **`src/sim/**` bleibt rein und deterministisch.** Kein DOM, kein `performance`,
  keine Zeit, kein I/O — die Sim läuft in festen 50-ms-Ticks, und genau das macht
  Replays und die Golden-Tests reproduzierbar. Drei unabhängige Wächter halten
  das: `scripts/check-sim-purity.ts`, die `noRestrictedGlobals`-Deny-Liste in
  `biome.json` (mit Begründung pro Eintrag) und `tsconfig.sim.json`
  (`types: []`, kein DOM). **Alle drei sind tragend — keinen davon entschärfen.**
- **Physik-Konstanten sind Belege, keine Geschmacksfrage.** Werte in
  `src/sim/constants.ts` stammen überwiegend aus dem Bytecode. Nicht tunen.
  Echte Ermessensentscheidungen gehören in `tuning.ts`; eine Änderung an
  `constants.ts` braucht eine Bytecode-Referenz im PR.
- **`reference/` ist vendored.** Dekompilierter Bytecode und
  Extraktions-Tools — nicht von Hand editieren, in `biome.json` ausgeschlossen.
- **Der `gate`-Job in der CI muss wortgleich bleiben.** `secrets` ist in einem
  Job-`if` nicht referenzierbar, deshalb wandelt `gate` den
  `CLOUDFLARE_API_TOKEN` in einen Job-Output um, den `deploy` prüft. Das ist der
  Schalter gegen einen Doppel-Deploy neben der Cloudflare-Dashboard-Integration.
- **`check --strict` hier nie ausführen.** `layout`, `storage`, `router` und
  `pwa` sind bewusst nicht adoptiert; `web-base check` meldet sie korrekt als
  „not adopted" und ist grün.
- **Strengere Lint-Regeln als die Basis**: `noUnusedVariables`,
  `noUnusedImports` und `noExplicitAny` stehen hier auf `error` statt `warn`.
  Bewusst — nicht an die Basis angleichen.
- **README bleibt Englisch.** Die Konvention „deutsche README" gilt für
  Endnutzer-Apps; das hier ist eine technische Port-Dokumentation für die
  Emulations-Community.
