# omp-title-icon Cross-Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `omp-title-icon` from a Windows-only title plugin into a cross-platform, OSC-title-compatible plugin while fixing the CI failure caused by host-OS-dependent path parsing.

**Architecture:** Keep the plugin as a single runtime module plus one Bun test file, but split behavior conceptually into two pure domains: capability gating and path-shape-aware title derivation. Preserve the existing event-driven title state machine and short reassert takeover window; only replace the enablement decision and path parsing logic, then update package metadata and README to match the new product definition.

**Tech Stack:** TypeScript, Bun test runner, `node:path` (`win32` + `posix` variants), `@oh-my-pi/pi-coding-agent` extension API, GitHub Actions.

---

## File Structure

- `src/extension.ts` — runtime implementation; add cross-platform capability detection, path-shape-aware `computeBaseTitle()`, and preserve the existing title state machine.
- `test/extension.test.ts` — regression coverage for capability gating, cross-platform path handling, and existing lifecycle/reassert behavior.
- `README.md` — product positioning, requirements, manual verification, and troubleshooting for cross-platform best-effort title support.
- `package.json` — package description/keywords aligned with the cross-platform product definition.
- `.github/workflows/ci.yml` — keep current single-runner workflow unchanged unless verification proves a workflow change is required.
- `docs/superpowers/specs/2026-04-16-omp-title-icon-cross-platform-design.md` — approved design reference; implementation must not drift from it.

### Task 1: Replace Windows-only gating and host-OS-dependent path parsing

**Files:**
- Modify: `src/extension.ts`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Write the failing tests for capability gating and path-shape-aware base titles**

```ts
import { describe, expect, it } from "bun:test";
import {
  computeBaseTitle,
  shouldEnableTitlePlugin,
} from "../src/extension";

describe("shouldEnableTitlePlugin", () => {
  it("disables the plugin for dumb terminals", () => {
    expect(shouldEnableTitlePlugin({ TERM: "dumb" })).toBe(false);
  });

  it("enables the plugin for known interactive terminal signals", () => {
    expect(shouldEnableTitlePlugin({ WT_SESSION: "abc" })).toBe(true);
    expect(shouldEnableTitlePlugin({ TERM_PROGRAM: "iTerm.app" })).toBe(true);
    expect(shouldEnableTitlePlugin({ TERM: "xterm-256color" })).toBe(true);
    expect(shouldEnableTitlePlugin({ COLORTERM: "truecolor" })).toBe(true);
  });

  it("defaults to enabled when no deny signal exists", () => {
    expect(shouldEnableTitlePlugin({})).toBe(true);
  });
});

describe("computeBaseTitle", () => {
  it("prefers a trimmed session name over cwd", () => {
    expect(computeBaseTitle("  Build Fix  ", "/tmp/project")).toBe("Build Fix");
  });

  it("handles Windows paths independently of the host OS", () => {
    expect(computeBaseTitle(undefined, "C:/")).toBe("π");
    expect(computeBaseTitle(undefined, "C:\\")).toBe("π");
    expect(computeBaseTitle(undefined, "C:/work/project")).toBe("project");
    expect(computeBaseTitle(undefined, "C:\\work\\project")).toBe("project");
  });

  it("handles POSIX paths independently of the host OS", () => {
    expect(computeBaseTitle(undefined, "/")).toBe("π");
    expect(computeBaseTitle(undefined, "/home/anton/project")).toBe("project");
  });

  it("falls back to π when no useful cwd exists", () => {
    expect(computeBaseTitle(undefined, undefined)).toBe("π");
    expect(computeBaseTitle(undefined, "   ")).toBe("π");
  });
});
```

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL
- Failure includes missing `shouldEnableTitlePlugin` export and/or `computeBaseTitle()` returning Windows-root results incorrectly on the current implementation.

- [ ] **Step 3: Implement the minimal cross-platform helpers in `src/extension.ts`**

```ts
import * as path from "node:path";

const DEFAULT_FALLBACK_TITLE = "π";

function isWindowsStylePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function selectPathApi(cwd: string) {
  if (isWindowsStylePath(cwd) || cwd.includes("\\")) {
    return path.win32;
  }

  return path.posix;
}

export function shouldEnableTitlePlugin(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.TERM === "dumb") {
    return false;
  }

  if (env.WT_SESSION || env.TERM_PROGRAM || env.TERM || env.COLORTERM) {
    return true;
  }

  return true;
}

export function computeBaseTitle(
  sessionName: string | undefined,
  cwd: string | undefined,
): string {
  const trimmedSessionName = sessionName?.trim();
  if (trimmedSessionName) {
    return trimmedSessionName;
  }

  const trimmedCwd = cwd?.trim();
  if (!trimmedCwd) {
    return DEFAULT_FALLBACK_TITLE;
  }

  const pathApi = selectPathApi(trimmedCwd);
  const baseName = pathApi.basename(trimmedCwd);
  const root = pathApi.parse(trimmedCwd).root;
  if (!baseName || baseName === root) {
    return DEFAULT_FALLBACK_TITLE;
  }

  return baseName;
}
```

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run: `bun test test/extension.test.ts`

Expected:
- PASS for the new `shouldEnableTitlePlugin` and `computeBaseTitle` tests
- Existing unrelated failures are acceptable only if they are caused by still-pending event-registration expectations from Task 2.

- [ ] **Step 5: Commit the helper-layer change**

```bash
git add src/extension.ts test/extension.test.ts
git commit -m "feat: add cross-platform title gating"
```

### Task 2: Rewire plugin registration to use the new capability model without breaking the state machine

**Files:**
- Modify: `src/extension.ts`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Replace the old registration gating test with cross-platform expectations**

```ts
describe("registerTitleIcon", () => {
  it("does nothing only when capability gating disables the plugin", () => {
    const { pi, handlers } = createFakePi();

    registerTitleIcon(pi, {
      env: { TERM: "dumb" },
      scheduler: createFakeScheduler().scheduler,
    });

    expect(handlers.size).toBe(0);
  });

  it("registers handlers for non-Windows interactive terminals", () => {
    const { pi, handlers } = createFakePi();

    registerTitleIcon(pi, {
      env: { TERM_PROGRAM: "iTerm.app" },
      scheduler: createFakeScheduler().scheduler,
    });

    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("agent_start")).toBe(true);
    expect(handlers.has("tool_execution_start")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL because `registerTitleIcon()` still checks the removed Windows-only gate.

- [ ] **Step 3: Update registration to use the new capability helper and remove platform-specific options**

```ts
export interface RegisterTitleIconOptions {
  scheduler?: TitleScheduler;
  env?: Record<string, string | undefined>;
}

export default function registerTitleIcon(
  pi: ExtensionAPI,
  options: RegisterTitleIconOptions = {},
): void {
  const scheduler = options.scheduler ?? defaultScheduler;
  const env = options.env ?? process.env;

  if (!shouldEnableTitlePlugin(env)) {
    return;
  }

  const state: TitleControllerState = {
    agentRunning: false,
    askDepth: 0,
    reassertTimer: undefined,
    reassertUntil: 0,
    lastAppliedTitle: undefined,
  };

  // existing session/agent/tool event registration remains unchanged
}
```

Update the affected tests and helpers to stop passing `platform` unless a test explicitly needs legacy compatibility removed.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `bun test test/extension.test.ts`

Expected:
- PASS with the full title-state sequence still green:
  - idle → running → ask → running → idle
- PASS for ask-depth clamp and forced reassert behavior
- PASS for the new non-Windows interactive-terminal registration case

- [ ] **Step 5: Commit the registration change**

```bash
git add src/extension.ts test/extension.test.ts
git commit -m "feat: enable title plugin across terminals"
```

### Task 3: Align package metadata and README with the cross-platform product definition

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Verify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing metadata assertions in the existing test file**

```ts
import pkg from "../package.json" assert { type: "json" };

describe("package metadata", () => {
  it("describes the plugin as cross-platform", () => {
    expect(pkg.description).toContain("Cross-platform");
    expect(pkg.keywords).toContain("terminal-title");
    expect(pkg.keywords).toContain("macos");
    expect(pkg.keywords).toContain("linux");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL because the current description and keywords still describe a Windows-only package.

- [ ] **Step 3: Update `package.json` and `README.md` to match the approved product scope**

`package.json`

```json
{
  "description": "Cross-platform terminal title status extension for Oh My Pi/Pi coding agent sessions.",
  "keywords": [
    "omp-package",
    "omp-extension",
    "pi-extension",
    "terminal-title",
    "cross-platform",
    "windows",
    "macos",
    "linux",
    "title",
    "session-title",
    "ask",
    "idle",
    "running"
  ]
}
```

`README.md`

````md
# omp-title-icon

Best-effort cross-platform terminal title status extension for Oh My Pi / Pi coding agent sessions.

## Requirements

- Any interactive terminal host that supports OSC title updates
- Best-effort support across Windows, macOS, and Linux
- The terminal host must not ignore or permanently suppress application title updates

## What it does

The extension subscribes to session, agent, and tool lifecycle events, computes the visible title from `session name -> cwd basename -> π`, and prefixes it with:

- `●` when idle
- `○` when running
- `?` when the `ask` tool is waiting for input

## Manual verification

1. Start OMP with the local extension path.
2. Run it in an interactive terminal that supports OSC title updates.
3. Confirm the title changes to `○` while the model is working.
4. Trigger an `ask` prompt and confirm the title changes to `?`.
5. Confirm the title returns to `●` once the turn is idle again.

## Troubleshooting

- If the title never changes, verify the terminal host supports OSC title updates.
- If the title changes briefly and snaps back, your shell or prompt theme is likely rewriting the title.
- If the terminal ignores the update entirely, the host may suppress application title changes.
````

Keep the existing marketplace limitation note intact.

- [ ] **Step 4: Run the full repo checks and verify GREEN**

Run: `bun run check`

Expected:
- PASS
- `bun test` reports all tests passing, including metadata assertions and lifecycle tests
- `bun run typecheck` exits 0

- [ ] **Step 5: Verify the CI workflow still matches the intended scope and commit**

Run:
- `bun test test/extension.test.ts`
- `bun run check`

Then inspect `.github/workflows/ci.yml` and confirm it still only needs:

```yml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run check
```

If verification passes without workflow changes, commit only the docs/metadata/runtime/test files:

```bash
git add README.md package.json src/extension.ts test/extension.test.ts
git commit -m "feat: support cross-platform terminal titles"
```

## Self-Review Checklist

- [ ] The plan fully covers spec sections 5 through 12.
- [ ] No step relies on host-OS-default path semantics.
- [ ] No step expands scope into terminal brand allowlists, user-configurable policy, or CI matrix work.
- [ ] Every production code change has a preceding failing test step.
- [ ] Verification commands are concrete and scoped to this repo.
