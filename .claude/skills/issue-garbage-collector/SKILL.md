---
name: issue-garbage-collector
description: AI-powered cleanup of duplicate and outdated issue files in docs/issues/. Identifies duplicates by filename patterns and content similarity, merges related issues, and archives resolved ones.
when_to_use: When the issues directory becomes cluttered, after resolving multiple issues, or as periodic maintenance (weekly during active development, monthly otherwise).
version: 1.0.0
---

## Quick Start

Run the full garbage collection check:

```bash
claude -p "Run issue garbage collection on docs/issues/ following the SKILL at .claude/skills/issue-garbage-collector/SKILL.md. Scan all issues, detect duplicates, and generate a cleanup report. Ask before deleting anything."
```

## AI-Powered Health Checks

### 1. Full Garbage Collection

```bash
claude -p "
Scan docs/issues/ directory and perform garbage collection:

1. List all .md files (excluding _template.md)
2. Parse YAML front-matter (title, status, area, tags)
3. Detect duplicates by:
   - Filename similarity (same keywords, different dates)
   - Content similarity (same error messages, same relevant files)
   - Same area + overlapping description
4. For each duplicate pair, recommend: MERGE, CROSS-REFERENCE, or KEEP BOTH
5. Flag stale issues (status: open, older than 30 days)
6. Generate a cleanup report in markdown format

Safety rules:
- Never suggest deleting _template.md
- Never suggest deleting issues with status: investigating
- Always ask for confirmation before any deletion

Output format:
## Duplicate Detection Report
| File A | File B | Similarity | Recommendation |
...

## Stale Issues (needs review)
...

## Suggested Actions
...
"
```

### 2. Duplicate Detection Only

```bash
claude -p "
Scan docs/issues/ and detect potential duplicates:

Check for:
- Files with similar keywords in filename (e.g., 'drizzle-connection' vs 'drizzle-timeout')
- Files with same 'area' tag in front-matter
- Files with identical error messages or stack traces
- Files referencing the same 'Relevant Files'

For each potential duplicate pair, explain WHY they might be duplicates.
Do NOT suggest any deletions - just report findings.
"
```

### 3. Stale Issue Detection

```bash
claude -p "
Scan docs/issues/ for stale issues:

Flag issues that are:
- status: open AND older than 30 days (by filename date)
- status: investigating AND older than 14 days
- Referenced files no longer exist in codebase

For each stale issue, suggest:
- CLOSE (if likely resolved)
- ESCALATE (if still relevant)
- ARCHIVE (if no longer applicable)
"
```

### 4. Cross-Reference Validation

```bash
claude -p "
Validate cross-references in docs/issues/:

Check that:
- All 'related_issues' in front-matter point to existing files
- All 'github_issue' links are valid (if accessible)
- No orphaned issues (not referenced anywhere)

Report broken references and suggest fixes.
"
```

### 5. Merge Duplicates (Interactive)

```bash
claude -p "
I want to merge these duplicate issues:
- docs/issues/2026-03-02-drizzle-connection-failure.md (older)
- docs/issues/2026-03-05-drizzle-timeout.md (newer)

Please:
1. Read both files
2. Identify unique content in the older file
3. Propose merged content for the newer file
4. Show me the diff before making changes
5. After I approve, update the newer file and delete the older one
"
```

## Detection Rules

### Filename Similarity

| Pattern | Example | Action |
|---------|---------|--------|
| Same keywords, different dates | `2026-03-02-drizzle-error.md` vs `2026-03-05-drizzle-error.md` | Likely duplicate |
| Same area prefix | `api-timeout.md` vs `api-connection.md` | Check content |
| Typo variants | `playwright-test.md` vs `playwrite-test.md` | Likely duplicate |

### Content Similarity

| Signal | Weight | Example |
|--------|--------|---------|
| Same error message | High | Both contain `ECONNREFUSED` |
| Same stack trace | High | Identical traceback |
| Same `Relevant Files` | Medium | Both reference `src/db/connection.ts` |
| Same `area` tag | Medium | Both tagged `database` |
| Similar `What Happened` | Low | Manual review needed |

### Status-Based Rules

| Status | Age | Action |
|--------|-----|--------|
| `open` | > 30 days | Flag for review |
| `investigating` | > 14 days | Check if still active |
| `resolved` | any | Keep as knowledge base |
| `wontfix` | any | Keep for context |
| `duplicate` | any | Verify target exists, then archive |

## Merge Strategy

When merging duplicates:

1. **Keep the newer file** (by date in filename)
2. **Preserve unique observations** from older file
3. **Update `related_issues`** to cross-reference
4. **Combine tags** from both files
5. **Delete older file** only after confirmation

```markdown
# Merged file should include:
---
title: Combined title
related_issues:
  - 2026-03-02-drizzle-connection-failure.md  # merged from
---

## What Happened
[Content from newer file]

## Additional Context (from 2026-03-02)
[Unique content from older file]
```

## Safety Rules

1. **Never delete `_template.md`**
2. **Never delete issues with `status: investigating`** — active work in progress
3. **Always ask for confirmation** before any deletion
4. **Show diff before merge** — let human verify
5. **Commit incrementally** — one logical change per commit
6. **Preserve knowledge** — resolved issues are valuable

## Periodic Maintenance Schedule

| Frequency | Check | Command |
|-----------|-------|---------|
| After adding issues | Duplicate detection | Check #2 |
| Weekly (active dev) | Full GC | Check #1 |
| Monthly (stable) | Full GC + stale | Check #1 + #3 |
| After major refactor | Cross-reference validation | Check #4 |

## Output Symbols

- ✅ **Clean** — No issues found
- ⚠️ **Warning** — Potential duplicate, needs review
- ❌ **Error** — Broken reference, must fix
- 🗑️ **Archive** — Safe to remove/archive
- 🔗 **Link** — Should add cross-reference

## Integration with Workflow

### After Resolving Issues

```bash
# 1. Update issue status to resolved
# 2. Run duplicate check
claude -p "Check if docs/issues/2026-03-08-my-issue.md duplicates any existing resolved issues. If so, suggest merging."
```

### Before Creating New Issue

```bash
# Check if similar issue exists
claude -p "I'm about to create an issue about 'Playwright test timeout on CI'. Check docs/issues/ for similar existing issues."
```

### Weekly Maintenance

```bash
# Run full garbage collection
claude -p "Run weekly issue garbage collection on docs/issues/. Generate report, ask before any changes."
```

