---
title: Consolidate Harness Fluency on routa-cli and retire the standalone TS engine
date: "2026-03-28"
status: open
severity: medium
area: cli
tags: [fitness, fluency, routa-cli, typescript, rust]
reported_by: Codex
related_issues: ["https://github.com/phodal/routa/issues/238"]
---

# Harness Fluency 仍然存在双实现，维护重心需要继续收口到 routa-cli

## What Happened

仓库内同时存在两套 Harness Fluency 实现：

- Rust 侧 `routa fitness fluency`
- `tools/harness-fluency` 下的独立 TypeScript 版本

当前根 `package.json` 和主文档已经默认走 Rust CLI，但旧 TS 实现仍保留完整 engine/model/tests，容易继续被误认为主实现并单独演进。

## Expected Behavior

Harness Fluency 应该只有一个权威实现，CLI、文档、测试和后续 feature 演进都应围绕 `routa-cli` 展开。历史 TS 入口如果保留，也应只是兼容转发层。

## Reproduction Context

- Environment: both
- Trigger: 浏览仓库入口、CLI 文档和 `tools/harness-fluency` 目录时，可以看到 Rust 与 TS 两套完整实现并存

## Why This Might Happen

- 迁移先完成了 Rust 版本，但旧目录没有同步降级为兼容层
- `tools/harness-fluency` 保留了完整测试和实现，增加了“继续在旧实现上修 bug/加 feature”的可能性
- CLI 参数兼容策略没有在 `routa-cli` 侧完全显式声明，导致旧入口很容易继续独立维护

## Relevant Files

- `crates/routa-cli/src/commands/fitness.rs`
- `crates/routa-cli/src/commands/fitness/fluency/`
- `tools/harness-fluency/src/cli.ts`
- `tools/harness-fluency/src/index.ts`
- `docs/fitness/README.md`

## Observations

- 目前 `npm run fitness:fluency` 已直接调用 `cargo run -p routa-cli -- fitness fluency`
- `tools/harness-fluency` 已可以改造成兼容转发层，不需要继续保留完整 TS 引擎
- 仍需后续确认何时彻底删除兼容层，以及是否需要为发布用户保留一个过渡版本

## References

- `package.json`
- `docs/fitness/README.md`
- `crates/routa-cli/README.md`
- `https://github.com/phodal/routa/issues/238`
