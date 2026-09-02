# Contributing

Thanks for your interest in this project. It's a personal web app, but
contributions are welcome where they make sense.

## Branch strategy

- `main` is the deployed branch. Cloudflare Workers Builds deploys from it.
- Feature work lives on short-lived branches (`feat/...`, `fix/...`,
  `refactor/...`, `chore/...`).
- Open a PR against `main`. CI must be green before merge.

## Commit messages

Conventional commits:

- `feat: ...` — new feature
- `fix: ...` — bug fix
- `chore: ...` — tooling, deps, no behavior change
- `docs: ...` — documentation only
- `refactor: ...` — code change with no functional difference
- `test: ...` — adding or adjusting tests

Keep the subject line under 72 characters. Use the body for the *why*.

## PR checklist

- [ ] `bun run verify` passes (lint, sim purity, atlas, typecheck, tests, build, bundle budget)
- [ ] `bun run smoke` passes if you touched a renderer, the shader or the boot path
- [ ] No new dependencies added without a reason in the PR description
- [ ] A number in `src/sim/constants.ts` changed only with a bytecode reference; guesses go in `tuning.ts`

## Local development

```bash
bun install
bun run dev          # Vite dev server, http://localhost:5173
bun run worker:dev   # the built site through wrangler, with real header and 404 semantics
```

## Architecture

The simulation under `src/sim/` is pure and deterministic, and the checks that
enforce it (`tsconfig.sim.json`, `check:purity`) are part of `verify`. Read
`README.md` and `reference/doc/porting-notes.md` before changing a physics
number: most of them were read out of the original bytecode and are not tuning.
