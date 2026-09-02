# Cloudflare Setup

Ein einziger Cloudflare-Service reicht, im kostenlosen Free-Tier:

| Service | Resource-Name (Dashboard) | Wofür | Free Tier |
|---|---|---|---|
| **Workers** | `hamsterflight` | Hostet die statische Seite (Assets-only, kein Worker-Code) | 100k Requests/Tag |

Der Worker-Name `hamsterflight` ist der `wrangler.jsonc`-Default und wird zur
Subdomain: `https://hamsterflight.<account>.workers.dev`. Es gibt keine
Bindings, kein KV, keine Secrets - nur `dist/` als Assets.

Deployt wird **nicht** aus GitHub Actions, sondern von **Cloudflare Workers
Builds** bei jedem Push auf `main`. CI (`.github/workflows/ci.yml`) prüft nur
den Pull Request. Das ist dieselbe Aufteilung wie in den anderen Apps dieser
Familie (`daniel-rck/web-base`).

---

## Schritt-für-Schritt

### 0. Voraussetzungen

- Cloudflare-Account: <https://dash.cloudflare.com/sign-up>
- Wrangler CLI kommt mit dem Repo (`bun install`), eingeloggt über
  `bunx wrangler login` - nur für manuelle Deploys nötig.

### 1. Worker mit Git verbinden

Im Cloudflare-Dashboard:

1. **Workers & Pages → Create → Workers → Connect to Git**
   (existiert der Worker schon, z. B. aus einem manuellen `wrangler deploy`:
   **Workers & Pages → hamsterflight → Settings → Builds → Connect to Git**)
2. Repo `daniel-rck/HamsterFlight` auswählen
3. Build settings:
   - Build command: `bun install --frozen-lockfile && bun run verify`
   - Deploy command: *(leer lassen - `wrangler deploy` ist Default)*
   - Root directory: *(leer)*
4. Branch: `main`
5. **Save & Deploy**

Cloudflare erkennt Bun über `packageManager` in `package.json`; die
Node-Version für Vite und Wrangler kommt aus `.nvmrc`.

**Der Build command ist nicht optional.** Ohne ihn läuft nur der Deploy
command, findet kein `dist/` und bricht ab mit:

```
✘ [ERROR] The directory specified by the "assets.directory" field in your
  configuration file does not exist: /opt/buildhome/repo/dist
```

Das ist der Build, der nicht gelaufen ist - nicht eine kaputte
`wrangler.jsonc`.

`bun run verify` statt `bun run build` ist Absicht: Workers Builds wartet
nicht auf GitHub-Checks, also laufen Lint, Purity-Check, Typecheck und Tests
hier noch einmal und halten einen roten Commit von der Produktion fern. Was
Workers Builds nicht kann, ist der Browser-Smoke-Test - dafür hat die CI den
`smoke`-Job, der den PR gated.

### 2. Verifizieren

Nach dem ersten Build ist die Seite unter
`https://hamsterflight.<account>.workers.dev` erreichbar. Unter der Bühne steht
der Build-Stempel (Commit-Hash und Datum); er muss zum letzten Commit auf
`main` passen. Jeder weitere Merge nach `main` erzeugt einen neuen Build und
ein neues Deployment; die Historie steht unter **Deployments**.

---

## Manuell deployen

```bash
bun run verify && bun run smoke && bun run check:cf   # dieselben Gates wie CI
bun run worker:deploy                                  # wrangler deploy
```

Ein `+` hinter dem Hash im Build-Stempel heißt, der Build kam aus einem
Arbeitsverzeichnis mit uncommitteten Änderungen.

## Lokal mit echter Cloudflare-Semantik

```bash
bun run build && bun run worker:dev    # http://localhost:8787
```

`wrangler dev` ist der einzige lokale Server, der `wrangler.jsonc` und
`public/_headers` so anwendet wie die Produktion; `bun run check:cf` prüft
genau das automatisch.

## Troubleshooting

### "assets.directory … does not exist"

Build command leer, siehe Schritt 1.

### Es deployt zweimal pro Merge

Dann ist zusätzlich ein Deploy aus einem anderen Weg aktiv. Diese Repo
deployt ausschließlich über Workers Builds; ein GitHub-Actions-Deploy gibt
es hier nicht mehr.

### Der Build ist grün, die Seite zeigt alten Stand

`index.html` ist mit `max-age=0, must-revalidate` ausgeliefert und die
Assets sind content-gehasht, also ist das kein Caching-Problem der Seite.
Prüfe im Dashboard unter **Deployments**, ob das neue Deployment wirklich
aktiv ist, und vergleiche den Build-Stempel.

## Was du **nicht** brauchst

- ❌ KV, R2, D1, Durable Objects, Queues - die Seite hat keinen Zustand
- ❌ Pages - das Projekt nutzt Workers mit Static Assets
- ❌ Ein `CLOUDFLARE_API_TOKEN`-Secret in GitHub - CI deployt nicht
- ❌ Eine bezahlte Workers-Stufe
