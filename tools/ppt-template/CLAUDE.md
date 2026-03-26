# Slides Skill

Use this file as the local reference material when creating or editing
presentation slide decks under `tools/ppt-template/`.

## Local Folder Contents

Contents of the `tools/ppt-template/` folder:

- `package.json`: local scripts and dependency boundary for `pptxgenjs`.
- `src/`: deck generators, theme helpers, screenshot capture, and token adapters.
- `src/ppt-theme.mjs`: shared PptxGenJS theme/bootstrap and drawing helpers.
- `src/color-tokens.mjs`: resolves Routa CSS variables into PPT-safe colors.
- `output/`: generated `.pptx` files and related screenshots. Treat as build
  artifacts unless the task explicitly targets them.

Relevant entrypoints in `src/`:

- `generate-template.mjs`: generates the reusable Routa template deck.
- `release-notes-to-ppt.js`: generates the release-notes deck from `docs/releases/`.
- `generate-architecture-deck.js`: generates the architecture deck.
- `generate-product-showcase-deck.js`: generates the product showcase deck.
- `generate-all.js`: runs multiple deck generators.
- `capture-app-screenshots.js`: captures application screenshots for slides.

## Implementation

You MUST use PptxGenJS to implement slide decks in this directory.

Even when a user provides a template or asks for edits to an existing deck, the
resulting deck must still be generated through the local PptxGenJS code and
must preserve the intended visual style, typography, spacing, color palette,
and layout conventions.

The only exception is a trivial quick-edit request where the user explicitly
asks for a narrow artifact tweak and no generator change is required.

Use the local helpers in `src/ppt-theme.mjs` and `src/color-tokens.mjs`.
Import and extend them instead of copy-pasting helper logic into each deck
generator.

Work in this directory while coding. Generate and validate the deck here first.
Only copy or move artifacts to other requested locations after the deck passes
basic validation.

## Source Of Truth

- Treat `/Users/phodal/ai/routa-js/src/app/globals.css` as the canonical token
  source for brand and semantic colors.
- `src/color-tokens.mjs` is the adapter that converts app CSS variables into
  PowerPoint-safe hex values.
- Do not duplicate palette definitions when the value can be derived from the
  token loader.
- Keep this file as an operating contract and index, not as a place for large
  design notes.

## Working Rules

- Prefer extending shared slide helpers instead of adding one-off inline layout
  code repeatedly.
- Keep slide generation scripts modular: theme/bootstrap, shared drawing
  helpers, and slide-specific composition should stay separable.
- When a script grows toward repository file-size limits, refactor by workflow
  boundary first, not into a generic `utils` file.
- Preserve deterministic output paths unless the task explicitly asks for
  parameterization.
- Unless explicitly requested, do not add extra documentation beyond local
  agent-instruction files.

## Generation Entry Points

- `npm run generate`
- `npm run generate:all`
- `npm run generate:release:v0.2.7`
- `npm run generate:architecture`
- `npm run generate:showcase`
- `npm run capture:screenshots`

Run commands from `tools/ppt-template/` so local `package.json` resolution
stays unambiguous.

## PPTX Workflow

- If editing or extending an existing deck, inspect the current output first
  and preserve its visual system before changing layout logic.
- If creating new slides without a template, build them from reusable helpers
  instead of ad hoc coordinates everywhere.
- Every slide needs a visual element: shape composition, grid, stat callout,
  icon treatment, or image area. Avoid plain title-plus-bullets slides.
- Do not create generic AI-looking slides. Pick a deliberate palette hierarchy,
  a repeated motif, and noticeable contrast between title and content slides.
- Do not add decorative accent lines under titles. Use spacing, blocks, or
  color fields instead.
- Keep roughly `0.5"` outer margins and consistent internal spacing.
- Watch text-box padding when aligning text with shapes; `margin: 0` is often
  the correct fix in PptxGenJS text boxes.
- Prefer a small set of layout families across a deck, but do not repeat the
  exact same composition on every slide.

## Validation And QA

Treat first render as draft quality. Assume there are layout issues until
proven otherwise.

After modifying slide-generating code:

1. regenerate the deck
2. inspect the resulting `.pptx`
3. perform at least one fix-and-verify cycle

When content fidelity matters:

- run `python -m markitdown output/<file>.pptx`

For visual QA:

- inspect generated decks under `output/`
- review slide renderings or screenshots for overflow, overlap, clipping,
  uneven spacing, weak contrast, and leftover placeholders
- confirm the expected file was rewritten
- search extracted text for obvious leftovers such as `xxxx`, `lorem`, `ipsum`,
  or template instructions
- when changing token resolution, verify both light and dark derived mappings
  still resolve to valid hex values

## Practical Commands

```bash
npm run generate
npm run generate:all
npm run generate:release:v0.2.7
npm run generate:architecture
npm run generate:showcase
npm run capture:screenshots
python -m markitdown output/routa-color-template.pptx
python -m markitdown output/routa-v0.2.7-release-notes.pptx
```

## After Code Changes

- If you modify source files in this directory, run the affected generation
  script.
- Fix runtime errors before stopping.
- If the change affects layout or content, perform at least a basic QA pass on
  the generated deck.
