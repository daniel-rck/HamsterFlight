# reference/

Research artifacts. **Nothing in here is a build input** - no file under
`reference/` is imported by `src/`, and Biome and the TypeScript projects both
exclude it.

## Contents

| Path | What it is |
|---|---|
| `as2/Game.as`, `as2/Bullet.as` | Decompiler output (JPEXS ffdec) from the original SWF. The behavioural source of truth for the port. |
| `doc/flight-of-the-hamsters-reverse-engineering.md` | The original analysis: container, class structure, timing model, constants, all read from bytecode. |
| `doc/porting-notes.md` | Where this port diverges from the bytecode, from the document, and from `legacy/sim.js` - and why. **Read this before comparing any numbers.** |
| `tools/swfparse.py` | Standalone SWF container parser. `python3 reference/tools/swfparse.py <file.swf>` for the tag inventory, `... <file.swf> names` for instance names and positions. |
| `tools/extract_hitboxes.py` | Resolves the `core` subclip bounds into `src/sim/hitboxes.generated.ts`. Closes gap 13.1 of the document. |
| `legacy/sim.js` | The physics validation script that produced the document's section 12 table. **Kept frozen as a historical artifact.** It diverges from the bytecode in three ways - see `doc/porting-notes.md`. Superseded by `scripts/bench-strategies.ts`. |

## The SWF is not committed

The original `OCybCA4ADbpTKT.swf` (1,223,524 bytes, CWS v8,
`sha256:86b4de0d112e057d73465d337513750a2c114d226a946e9f5f7dff7b50c558b6`) is
deliberately absent, and `*.swf` is gitignored. Both tools take a path to it, so
supply your own copy when regenerating:

```sh
python3 reference/tools/extract_hitboxes.py path/to/OCybCA4ADbpTKT.swf \
  > src/sim/hitboxes.generated.ts
```

## Assets

`reference/extracted/` is gitignored and is where a full
`ffdec -export script,shape,sound,image` run should go. It exists for
measurement and visual reference only.

**The sprites under `src/assets/sprites/` are extracted from this SWF** by
`tools/build_sprites.py` and are the original publisher's artwork, not this
project's. Section 13.4 of the analysis notes that shipping it in a published
project is a different matter from analysing it privately; that is a deliberate
choice by the repository owner rather than an oversight. Audio is not extracted
yet.

The asset layer is data-driven behind `src/assets/sprites.generated.ts`, so
swapping in original or licensed art is a data change rather than a rewrite.

The decompiled `.as` files are derivative works of someone else's bytecode.
Publishing them is a distinct exposure from analysing them privately; they live
in their own top-level directory so that removing them from a public repository
is a one-line change.
