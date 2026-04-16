# omp-title-icon Icon Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Superseded note (2026-04-16): The original built-in default preset targeted by this plan (`◆ / · / ?!`) was superseded later the same day by `docs/superpowers/specs/2026-04-16-omp-title-icon-default-preset-refresh-design.md` and `docs/superpowers/plans/2026-04-16-omp-title-icon-default-preset-refresh.md`. Use those documents for the current preset values; keep this plan only as historical context for the configurable override work.

**Goal:** Replace the hard-coded title glyphs with configurable status prefixes, ship the new default preset `◆ / · / ?!`, and let users override the prefixes from `~/.omp/agent/config.yml` with legacy fallback to `~/.omp/agent/settings.json`.

**Architecture:** Keep the plugin in one runtime module and one Bun test file, but separate the work into three layers: pure prefix rendering, pure config-source resolution, and file-backed loading/integration. Load the user config once at extension registration, keep runtime state machine behavior unchanged, and thread the resolved prefixes into title rendering without making the plugin depend on marketplace/plugin runtime settings.

**Tech Stack:** TypeScript, Bun test runner, `node:fs`, `node:os`, `node:path`, Bun `YAML.parse`, Oh My Pi extension API.

---

## File Structure

- `src/extension.ts` — add status-prefix types/defaults, config resolution helpers, file-backed config loading, and integrate prefixes into title rendering.
- `test/extension.test.ts` — add regression coverage for new defaults, empty-prefix rendering, config source precedence, parse failures, and register-time override behavior.
- `README.md` — document the new default preset and the supported user override file formats.
- `docs/superpowers/specs/2026-04-16-omp-title-icon-icon-config-design.md` — approved design reference.

### Task 1: Replace fixed glyph rendering with configurable prefixes

**Files:**
- Modify: `src/extension.ts`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Write failing tests for the new default preset and empty-prefix behavior**

```ts
describe("renderTitle", () => {
  it("renders the new default prefixes", () => {
    expect(renderTitle("Build Fix", "idle")).toBe("◆ Build Fix");
    expect(renderTitle("Build Fix", "running")).toBe("· Build Fix");
    expect(renderTitle("Build Fix", "ask")).toBe("?! Build Fix");
  });

  it("omits the leading space when a prefix is empty", () => {
    expect(
      renderTitle("Build Fix", "running", {
        idle: "◆",
        running: "",
        ask: "?!",
      }),
    ).toBe("Build Fix");
  });
});

describe("applyTitle", () => {
  it("uses configured prefixes when provided", () => {
    const { pi } = createFakePi("Build Fix");
    const { ctx, titles } = createFakeContext();
    const state: TitleControllerState = {
      agentRunning: false,
      askDepth: 0,
      reassertTimer: undefined,
      reassertUntil: 0,
      lastAppliedTitle: undefined,
    };

    applyTitle(pi, ctx, state, {
      prefixes: { idle: "■", running: "·", ask: "?!" },
    });

    expect(titles).toEqual(["■ Build Fix"]);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL because `renderTitle()` still returns `● / ○ / ?`
- FAIL because `applyTitle()` does not accept configurable prefixes yet

- [ ] **Step 3: Implement prefix types, defaults, and rendering in `src/extension.ts`**

```ts
export interface TitlePrefixes {
  idle: string;
  running: string;
  ask: string;
}

export const DEFAULT_TITLE_PREFIXES: TitlePrefixes = {
  idle: "◆",
  running: "·",
  ask: "?!",
};

function getPrefix(prefixes: TitlePrefixes, state: TitleIconState): string {
  switch (state) {
    case "idle":
      return prefixes.idle;
    case "running":
      return prefixes.running;
    case "ask":
      return prefixes.ask;
  }
}

export function renderTitle(
  baseTitle: string,
  state: TitleIconState,
  prefixes: TitlePrefixes = DEFAULT_TITLE_PREFIXES,
): string {
  const prefix = getPrefix(prefixes, state);
  return prefix ? `${prefix} ${baseTitle}` : baseTitle;
}

export function applyTitle(
  pi: Pick<ExtensionAPI, "getSessionName">,
  ctx: Pick<ExtensionContext, "cwd" | "ui">,
  state: TitleControllerState,
  options: { force?: boolean; prefixes?: TitlePrefixes } = {},
): void {
  const baseTitle = computeBaseTitle(pi.getSessionName(), ctx.cwd);
  const nextTitle = renderTitle(
    baseTitle,
    computeVisualState(state.agentRunning, state.askDepth),
    options.prefixes ?? DEFAULT_TITLE_PREFIXES,
  );

  if (!options.force && state.lastAppliedTitle === nextTitle) {
    return;
  }

  ctx.ui.setTitle(nextTitle);
  state.lastAppliedTitle = nextTitle;
}
```

Thread `options.prefixes` through `startReassert()` as well so forced reassert uses the same rendering source.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

Run: `bun test test/extension.test.ts`

Expected:
- PASS for new render/apply tests
- Existing lifecycle tests still fail only if they still expect old glyphs; update them in Task 2

- [ ] **Step 5: Commit the prefix-rendering layer**

```bash
git add src/extension.ts test/extension.test.ts
git commit -m "feat: add configurable title prefixes"
```

### Task 2: Add user-config loading with config.yml priority and settings.json fallback

**Files:**
- Modify: `src/extension.ts`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Write failing tests for source precedence, validation, and register-time loading**

```ts
describe("resolveConfiguredTitlePrefixes", () => {
  it("uses config.yml icons before settings.json", () => {
    expect(
      resolveConfiguredTitlePrefixes(
        { ompTitleIcon: { icons: { idle: "■", running: ".", ask: "??" } } },
        { ompTitleIcon: { icons: { idle: "X", running: "Y", ask: "Z" } } },
      ),
    ).toEqual({ idle: "■", running: ".", ask: "??" });
  });

  it("falls back to settings.json when config.yml has no icon block", () => {
    expect(
      resolveConfiguredTitlePrefixes(
        { theme: { dark: "titanium" } },
        { ompTitleIcon: { icons: { idle: "■", running: ".", ask: "??" } } },
      ),
    ).toEqual({ idle: "■", running: ".", ask: "??" });
  });

  it("falls back to defaults for invalid fields and keeps empty strings", () => {
    expect(
      resolveConfiguredTitlePrefixes(
        { ompTitleIcon: { icons: { idle: 123, running: "", ask: false } } },
        undefined,
      ),
    ).toEqual({ idle: "◆", running: "", ask: "?!" });
  });
});

describe("loadConfiguredTitlePrefixes", () => {
  it("reads ~/.omp/agent/config.yml before legacy settings.json", () => {
    const files = new Map<string, string>([
      [
        "/home/test/.omp/agent/config.yml",
        "ompTitleIcon:\n  icons:\n    idle: \"■\"\n    running: \".\"\n    ask: \"??\"\n",
      ],
      [
        "/home/test/.omp/agent/settings.json",
        JSON.stringify({ ompTitleIcon: { icons: { idle: "X", running: "Y", ask: "Z" } } }),
      ],
    ]);

    expect(
      loadConfiguredTitlePrefixes({
        homeDir: "/home/test",
        readText: filePath => files.get(filePath),
      }),
    ).toEqual({ idle: "■", running: ".", ask: "??" });
  });

  it("falls back to defaults when YAML or JSON parsing fails", () => {
    expect(
      loadConfiguredTitlePrefixes({
        homeDir: "/home/test",
        readText: filePath => (filePath.endsWith("config.yml") ? "ompTitleIcon: [" : "{"),
      }),
    ).toEqual(DEFAULT_TITLE_PREFIXES);
  });
});

describe("registerTitleIcon", () => {
  it("uses loaded prefixes for the session lifecycle", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      env: { TERM_PROGRAM: "iTerm.app" },
      homeDir: "/home/test",
      readText: filePath =>
        filePath.endsWith("config.yml")
          ? 'ompTitleIcon:\n  icons:\n    idle: "■"\n    running: "."\n    ask: "??"\n'
          : undefined,
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolName: "ask" }, ctx);

    expect(titles).toEqual(["■ Build Fix", ". Build Fix", "?? Build Fix"]);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL because config helpers and loader do not exist
- FAIL because registerTitleIcon cannot load prefixes from user config

- [ ] **Step 3: Implement config resolution and file-backed loading in `src/extension.ts`**

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import { YAML } from "bun";

export interface LoadTitlePrefixesOptions {
  homeDir?: string;
  readText?: (filePath: string) => string | undefined;
}

function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function getConfiguredIconsBlock(raw: unknown): unknown | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = (raw as { ompTitleIcon?: unknown }).ompTitleIcon;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  return "icons" in candidate ? (candidate as { icons?: unknown }).icons : undefined;
}

export function normalizeTitlePrefixes(raw: unknown): TitlePrefixes {
  const defaults = DEFAULT_TITLE_PREFIXES;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaults };
  }

  const candidate = raw as Partial<Record<keyof TitlePrefixes, unknown>>;
  return {
    idle: typeof candidate.idle === "string" ? candidate.idle : defaults.idle,
    running: typeof candidate.running === "string" ? candidate.running : defaults.running,
    ask: typeof candidate.ask === "string" ? candidate.ask : defaults.ask,
  };
}

export function resolveConfiguredTitlePrefixes(
  configYmlData: unknown,
  settingsJsonData: unknown,
): TitlePrefixes {
  const configIcons = getConfiguredIconsBlock(configYmlData);
  if (configIcons !== undefined) {
    return normalizeTitlePrefixes(configIcons);
  }

  const settingsIcons = getConfiguredIconsBlock(settingsJsonData);
  if (settingsIcons !== undefined) {
    return normalizeTitlePrefixes(settingsIcons);
  }

  return { ...DEFAULT_TITLE_PREFIXES };
}

export function loadConfiguredTitlePrefixes(
  options: LoadTitlePrefixesOptions = {},
): TitlePrefixes {
  const homeDir = options.homeDir ?? os.homedir();
  const readText = options.readText ?? readTextFile;
  const configYmlPath = path.join(homeDir, ".omp", "agent", "config.yml");
  const settingsJsonPath = path.join(homeDir, ".omp", "agent", "settings.json");

  let configYmlData: unknown;
  const configYmlContent = readText(configYmlPath);
  if (configYmlContent !== undefined) {
    try {
      configYmlData = YAML.parse(configYmlContent);
    } catch {
      return { ...DEFAULT_TITLE_PREFIXES };
    }
  }

  let settingsJsonData: unknown;
  const settingsJsonContent = readText(settingsJsonPath);
  if (settingsJsonContent !== undefined) {
    try {
      settingsJsonData = JSON.parse(settingsJsonContent);
    } catch {
      if (getConfiguredIconsBlock(configYmlData) !== undefined) {
        return normalizeTitlePrefixes(getConfiguredIconsBlock(configYmlData));
      }
      return { ...DEFAULT_TITLE_PREFIXES };
    }
  }

  return resolveConfiguredTitlePrefixes(configYmlData, settingsJsonData);
}
```

Extend `RegisterTitleIconOptions` with `homeDir?: string` and `readText?: (filePath: string) => string | undefined`, load prefixes once inside `registerTitleIcon()`, and pass them into every `startReassert()` / `applyTitle()` call.

- [ ] **Step 4: Update existing lifecycle tests to the new defaults and verify GREEN**

Replace old expectations like `● / ○ / ?` with `◆ / · / ?!`, then run:

Run: `bun test test/extension.test.ts`

Expected:
- PASS for default prefix tests
- PASS for config precedence / validation / parse-failure tests
- PASS for register-time override test
- PASS for existing lifecycle, ask-depth, and reassert behavior with the new default preset

- [ ] **Step 5: Commit the config-loading integration**

```bash
git add src/extension.ts test/extension.test.ts
git commit -m "feat: load title prefixes from user config"
```

### Task 3: Document the new preset and override workflow

**Files:**
- Modify: `README.md`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Add a documentation regression test for the new defaults**

```ts
describe("README contract", () => {
  it("documents the default title prefixes and override path", async () => {
    const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();

    expect(readme).toContain("- `◆` when idle");
    expect(readme).toContain("- `·` when running");
    expect(readme).toContain("- `?!` when the `ask` tool is waiting for input");
    expect(readme).toContain("~/.omp/agent/config.yml");
    expect(readme).toContain("ompTitleIcon:");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test test/extension.test.ts`

Expected:
- FAIL because README still documents `● / ○ / ?` and does not show config override instructions

- [ ] **Step 3: Update `README.md` with the new preset and configuration examples**

````md
It prefixes the visible terminal title with:

- `◆` when idle
- `·` when running
- `?!` when the `ask` tool is waiting for input

## User overrides

Set custom prefixes in `~/.omp/agent/config.yml`:

```yml
ompTitleIcon:
  icons:
    idle: "◆"
    running: "·"
    ask: "?!"
```

Legacy fallback: `~/.omp/agent/settings.json`

```json
{
  "ompTitleIcon": {
    "icons": {
      "idle": "◆",
      "running": "·",
      "ask": "?!"
    }
  }
}
```

Set any prefix to an empty string to remove it for that state.
````

Keep the existing marketplace limitation note intact.

- [ ] **Step 4: Run the full repo checks and verify GREEN**

Run:
- `bun test test/extension.test.ts`
- `bun run check`

Expected:
- `bun test test/extension.test.ts` PASS
- `bun run check` PASS
- No README contract regressions

- [ ] **Step 5: Commit the documentation update**

```bash
git add README.md test/extension.test.ts
git commit -m "docs: document icon prefix overrides"
```

## Self-Review Checklist

- [ ] The plan covers all approved icon-config spec sections that require code or docs changes.
- [ ] No task introduces plugin settings-schema / marketplace config plumbing.
- [ ] The runtime still loads prefixes without depending on host OS or marketplace install behavior.
- [ ] Empty-prefix rendering, invalid config, and source precedence each have explicit tests.
- [ ] Verification commands are concrete and scoped to this repo.
