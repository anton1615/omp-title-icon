# omp-title-icon Default Preset Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the built-in default preset `◆ / · / ?!` with `✳ / ⟳ / ?!` while keeping config override semantics, public API surface, and runtime state behavior unchanged.

**Architecture:** This is a focused preset refresh, not a loader refactor. Keep config loading and state transitions intact; only swap the built-in defaults, update all expectations that assert those defaults, and refresh the README/spec text that documents them.

**Tech Stack:** TypeScript, Bun test runner, Oh My Pi extension API, Markdown docs.

---

## File Structure

- `src/extension.ts` — source of truth for `DEFAULT_TITLE_PREFIXES`
- `test/extension.test.ts` — focused runtime + README contract coverage for built-in defaults and override semantics
- `README.md` — user-facing default preset and override examples
- `docs/superpowers/specs/2026-04-16-omp-title-icon-default-preset-refresh-design.md` — approved design reference for this preset change

### Task 1: Refresh runtime defaults and test expectations

**Files:**
- Modify: `src/extension.ts`
- Modify: `test/extension.test.ts`

- [ ] **Step 1: Write the failing tests for the new preset**

```ts
describe("README contract", () => {
  it("documents the built-in default icons", () => {
    const introSection = extractReadmeIntro(readmeText);

    expectReadmeSectionToMentionStateIcon(introSection, "idle", "✳");
    expectReadmeSectionToMentionStateIcon(introSection, "running", "⟳");
    expect(introSection).toMatch(/(?:ask tool|ask prefix|ask)[\s\S]{0,120}\?!|\?![\s\S]{0,120}(?:ask tool|ask prefix|ask)/i);
  });
});

it("uses built-in defaults when config.yml exists but cannot be read", async () => {
  // ...existing fixture setup...
  expect(titles).toEqual(["✳ Build Fix"]);
});

it("tracks the session lifecycle with the refreshed defaults", () => {
  expect(titles[0]).toBe("✳ Build Fix");
  expect(titles[1]).toBe("⟳ Build Fix");
  expect(titles[2]).toBe("?! Build Fix");
});
```

Update every test that asserts built-in default rendering so the suite expects `✳ / ⟳ / ?!` instead of `◆ / · / ?!`.

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL with assertions still receiving `◆ Build Fix` or `· Build Fix`
- Failure must come from unchanged runtime defaults, not from broken test setup

- [ ] **Step 3: Implement the minimal runtime change**

```ts
const DEFAULT_TITLE_PREFIXES: TitlePrefixes = {
  idle: "✳",
  running: "⟳",
  ask: "?!",
};
```

Do not change config precedence, parsing, public exports, or title state logic.

- [ ] **Step 4: Re-run the focused suite and verify GREEN**

Run: `bun test test/extension.test.ts`

Expected:
- PASS with updated default-rendering assertions
- Override/fallback/empty-string tests remain green

- [ ] **Step 5: Commit the runtime/test refresh**

```bash
git add src/extension.ts test/extension.test.ts
git commit -m "feat: refresh default title preset"
```

### Task 2: Refresh README and spec-aligned documentation

**Files:**
- Modify: `README.md`
- Modify: `test/extension.test.ts`
- Create: `docs/superpowers/specs/2026-04-16-omp-title-icon-default-preset-refresh-design.md`

- [ ] **Step 1: Strengthen README contract expectations first**

```ts
it("documents config-based user overrides semantically", () => {
  const userOverridesSection = extractReadmeSection(readmeText, "User overrides");

  expectReadmeSectionToContainFencedBlock(userOverridesSection, "yaml", [
    /idle\s*:\s*"✳"/,
    /running\s*:\s*"⟳"/,
    /ask\s*:\s*"\?!"/,
  ]);

  expectReadmeSectionToContainFencedBlock(userOverridesSection, "json", [
    /"idle"\s*:\s*"✳"/,
    /"running"\s*:\s*"⟳"/,
    /"ask"\s*:\s*"\?!"/,
  ]);
});
```

- [ ] **Step 2: Run the focused suite and verify README assertions fail for the expected reason**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL because README still documents `◆ / · / ?!`

- [ ] **Step 3: Update README text and examples to the new preset**

```md
By default the extension uses `✳` for idle, `⟳` for running, and `?!` while the `ask` tool is waiting for input.
```

Also update YAML/JSON examples and any manual verification wording that references the built-in defaults.

- [ ] **Step 4: Run full verification**

Run: `bun test test/extension.test.ts && bun run check`

Expected:
- `bun test test/extension.test.ts` passes
- `bun run check` passes (`bun test` + `tsc --noEmit`)

- [ ] **Step 5: Commit the documentation refresh**

```bash
git add README.md test/extension.test.ts docs/superpowers/specs/2026-04-16-omp-title-icon-default-preset-refresh-design.md docs/superpowers/plans/2026-04-16-omp-title-icon-default-preset-refresh.md
git commit -m "docs: refresh default title preset spec"
```
