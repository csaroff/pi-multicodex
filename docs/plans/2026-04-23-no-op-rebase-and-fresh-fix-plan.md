# Plan: `pi-multicodex` upstream sync / rebase status and implementation path

## Goal

Document the exact rebase status for `~/Dev/pi-multicodex`, explain why an interactive rebase is currently a no-op, and give the agent a clean implementation path for the stale-context fix work on top of current `main`.

## Current branch state

- repo: `~/Dev/pi-multicodex`
- branch: `main`
- local `HEAD`: `f80c63c8ff00ae29c1b8c88821c65b4d4ef9da81`
- `origin/main`: `f80c63c8ff00ae29c1b8c88821c65b4d4ef9da81`
- `upstream/main`: `f80c63c8ff00ae29c1b8c88821c65b4d4ef9da81`
- ahead/behind vs `upstream/main`: `0 / 0`

## Key conclusion

There is **no interactive rebase to perform right now**.

Because `main` and `upstream/main` are identical, rebasing `main` onto `upstream/main` would produce no history change and no conflicts. Any work for this repo should be done as **new commits on top of current main**.

## Exact no-op rebase verification commands

These commands are safe verification steps only:

```zsh
cd ~/Dev/pi-multicodex
git fetch origin upstream --prune
git status --short --branch
git rev-parse HEAD
git rev-parse upstream/main
git rev-list --left-right --count HEAD...upstream/main
```

Expected result:

- `HEAD == upstream/main`
- ahead/behind prints `0 0`

## Why there is no commit-by-commit rebase/conflict plan

An interactive rebase plan requires local commits not yet present upstream. This repo has none.

Therefore:

- there is no rebase todo list to edit
- there are no replayed commits
- there are no conflict expectations commit-by-commit

## Implementation strategy instead

Create a fresh work branch from current `main` and implement the stale-context fix there.

## Branching plan

```zsh
cd ~/Dev/pi-multicodex
git fetch origin upstream --prune
git switch main
git pull --ff-only origin main
git switch -c fix/stale-extension-context-handling
```

## Problem statement to solve

Live subagent smoke failures showed stale extension instance errors with fatal stack traces through:

- `status.ts`
- `extension.ts`

The core pattern is:

- extension stores a previous `ExtensionContext`
- async timers / queued refreshes continue using that old context
- Pi invalidates that extension instance after session replacement/reload
- later `ctx.hasUI` / `ctx.ui.*` access throws

## Primary files to inspect and likely change

### 1) `status.ts`

This is the highest-priority file.

Relevant current patterns:

- stores `activeContext`
- uses `setTimeout` and `setInterval`
- reuses old context in:
  - `refreshFor(activeContext)`
  - delayed `refreshFor(ctx)` in model-select debounce
- calls:
  - `ctx.hasUI`
  - `ctx.ui.setStatus(...)`

This is the most likely source of stale-context crashes.

### 2) `extension.ts`

Secondary priority.

Relevant current patterns:

- keeps `lastContext`
- refreshes status on:
  - `session_start`
  - `session_switch`
  - `turn_end`
  - `model_select`
- starts/stops auto refresh

The extension entrypoint may need to stop retaining stale contexts directly or delegate that responsibility more safely.

### 3) `hooks.ts`

Inspect for any context retention or async follow-up behavior triggered by session lifecycle events.

### 4) Any UI/status helper used by `status.ts`

If there is a way to centralize safe UI access, prefer that over scattering repeated try/catch blocks.

## Intended fix shape

Keep the fix minimal and behavior-preserving.

### Required properties

1. stale/replaced session contexts must not crash the process
2. footer/status updates should degrade to no-op when context is stale
3. timers should not keep using invalidated contexts indefinitely
4. normal footer/status behavior should remain unchanged for active sessions

## Preferred implementation approach

### A. Make status refresh stale-safe

In `status.ts`, wrap UI/status interactions so stale-context failures become no-op instead of fatal process errors.

Examples of operations that must be protected:

- `ctx.hasUI`
- `ctx.ui.setStatus(...)`
- any `ctx.ui.theme...` usage executed after session replacement

### B. Stop recursive reuse of stale contexts

Current logic stores `activeContext` and later reuses it in queued/debounced refreshes.

The implementation should ensure one of these is true:

- stale contexts are detected and abandoned before UI access, or
- queued/timer refreshes only run against a still-valid current context, or
- both

### C. Keep timers from becoming crash multipliers

If a timer fires after session replacement:

- it should quietly stop or no-op
- it must not turn a finished session into a fatal extension error

## Suggested implementation order

1. inspect `status.ts`
2. add the smallest stale-safe guard around UI access
3. harden queued/debounced refresh flows
4. inspect `extension.ts` for retained-context cleanup opportunities
5. run full checks

## Concrete validation plan

Run these before and after the fix:

```zsh
cd ~/Dev/pi-multicodex
pnpm lint
pnpm tsgo
pnpm test
npm pack --dry-run
```

## Runtime smoke validation after implementation

Outside this repo, validate with the same kind of smoke test that previously failed:

1. run a plain read-only Pi smoke with extension enabled
2. run a subagent smoke that previously crashed in `status.ts`
3. confirm no stale-extension fatal error appears

## Success criteria

- no-op rebase status remains true (`0 / 0` vs upstream)
- stale-context runtime crash in `pi-multicodex` is eliminated
- footer/status behavior still works in active sessions
- checks pass:
  - `pnpm lint`
  - `pnpm tsgo`
  - `pnpm test`
  - `npm pack --dry-run`

## Out of scope

- no upstream sync work beyond routine fetch verification
- no release/version bump in this change
- no command-family redesign
- no rotation behavior redesign

## Agent notes

- Do not waste time preparing an interactive rebase here; there is none to do.
- Start directly from a fresh branch on top of current `main`.
- Keep the fix narrow and centered on stale-safe context/status handling.
