---
date: 2026-03-19
agent: Codex (GPT-5)
status: resolved
severity: high
component: tauri-frontend
---

# Tauri Kanban Static Routing Regression

## Problem

After removing the desktop-specific home UI and rebuilding the static frontend used by Tauri, the desktop flow can still load the unified homepage, but navigating from the homepage to `/workspace/{workspaceId}/kanban` does not successfully render the Kanban page.

## What Happened

- `npm run build:static` succeeded and generated the expected placeholder routes for workspace pages.
- `npm run tauri:build` succeeded and produced a `.app` bundle and `.dmg`.
- The desktop homepage loaded correctly from the Rust static server on `http://127.0.0.1:3210/`.
- The homepage CTA generated a valid `Open Kanban` href such as `/workspace/{workspaceId}/kanban`.
- Opening `/workspace/default/kanban` from the desktop static server did not reach a usable Kanban board.

## Current Symptoms

- Before the first fallback fix, `/workspace/{id}/kanban` rendered the workspace overview page instead of the standalone Kanban page.
- After adding an explicit `/workspace/{id}/kanban -> workspace/__placeholder__/kanban.*` mapping in the Rust fallback, the route no longer renders the workspace overview, but now fails with a client-side application error.
- Browser output shows:
  - `Application error: a client-side exception has occurred while loading 127.0.0.1`
- `traces` still loads in the desktop static server, which suggests the regression is specific to workspace deep-link static routing rather than a total frontend boot failure.

## Why It Matters

- The desktop build currently cannot rely on the homepage launcher to enter the primary Kanban surface.
- The product intent says Kanban is the main execution surface, so this blocks the desktop path that the homepage is supposed to funnel users into.
- The regression is easy to miss because the build succeeds and the homepage itself looks correct.

## Evidence

- Static export includes:
  - `workspace/__placeholder__.html`
  - `workspace/__placeholder__/kanban.html`
  - `workspace/__placeholder__/kanban.txt`
  - nested RSC payload files under `workspace/__placeholder__/kanban/`
- Existing Playwright check results:
  - Homepage loads: pass
  - `Open Kanban` href generation: pass
  - Homepage -> Kanban flow: fail on missing visible Kanban content / application error
- Rust fallback logic under investigation:
  - `crates/routa-server/src/lib.rs`

## Related Files

- `src/app/page.tsx`
- `crates/routa-server/src/lib.rs`
- `apps/desktop/src-tauri/frontend/workspace/__placeholder__/kanban.html`
- `apps/desktop/src-tauri/frontend/workspace/__placeholder__/kanban.txt`

## Resolution

The regression had two separate causes:

- The Rust static fallback served the correct placeholder files for `/workspace/{id}/kanban`, but the exported payload still contained `__placeholder__` route values, so the desktop deep-link path was inconsistent with the actual URL.
- The Rust `/api/kanban/boards` endpoint returned board summaries with `columnCount` only, while the Kanban UI expected full boards with a `columns` array. That caused the client crash `TypeError: r.columns is not iterable` during hydration.

## Fix

- Updated `crates/routa-server/src/lib.rs` so workspace and kanban static responses rewrite `__placeholder__` to the real `workspaceId` for desktop static routing.
- Updated `crates/routa-server/src/api/kanban.rs` so `GET /api/kanban/boards` returns full board payloads by resolving each board via `kanban.getBoard` and preserving runtime metadata.
- Added a defensive `board.columns ?? []` guard in `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx` so incomplete board payloads do not white-screen the page again.

## Verification

- `npm run build:static`
- `cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example standalone_server`
- `npx playwright test --config=playwright.tauri.config.ts e2e/homepage-open-board-tauri.spec.ts --project=chromium`

Result:

- Desktop homepage loads with the unified home UI.
- `Open Kanban` navigates to `/workspace/{id}/kanban`.
- Kanban columns render successfully in desktop static mode.
