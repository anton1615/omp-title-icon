import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import registerTitleIcon, {
  computeBaseTitle,
  computeVisualState,
  renderTitle,
  shouldEnableTitlePlugin,
  type ExtensionAPI,
  type ExtensionContext,
  type RegisterTitleIconOptions,
  type TitleScheduler,
} from "../src/extension";
import * as extensionModule from "../src/extension";

const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  description: string;
  keywords: string[];
};

const marketplaceJson = (await Bun.file(
  new URL("../.claude-plugin/marketplace.json", import.meta.url),
).json()) as {
  metadata: {
    description: string;
  };
  plugins: Array<{
    description: string;
    keywords: string[];
    tags: string[];
  }>;
};

const readmeText = await Bun.file(new URL("../README.md", import.meta.url)).text();

describe("shouldEnableTitlePlugin", () => {
  it("disables dumb terminals", () => {
    expect(shouldEnableTitlePlugin({ TERM: "dumb" })).toBe(false);
  });

  it("enables interactive terminal signals", () => {
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
    expect(computeBaseTitle("  Build Fix  ", "C:/work/project")).toBe("Build Fix");
    expect(computeBaseTitle("  Build Fix  ", "/home/anton/project")).toBe("Build Fix");
  });

  it("returns π for missing, blank, and root paths", () => {
    expect(computeBaseTitle(undefined, undefined)).toBe("π");
    expect(computeBaseTitle(undefined, "   ")).toBe("π");
    expect(computeBaseTitle(undefined, "C:/")).toBe("π");
    expect(computeBaseTitle(undefined, "C:\\")).toBe("π");
    expect(computeBaseTitle(undefined, "/")).toBe("π");
  });

  it("returns the basename for Windows-style paths independent of host OS", () => {
    expect(computeBaseTitle(undefined, "C:/work/project")).toBe("project");
    expect(computeBaseTitle(undefined, "C:\\work\\project")).toBe("project");
  });

  it("returns the basename for POSIX-style paths independent of host OS", () => {
    expect(computeBaseTitle(undefined, "/home/anton/project")).toBe("project");
  });
});

describe("computeVisualState", () => {
  it("gives ask priority over running", () => {
    expect(computeVisualState(true, 1)).toBe("ask");
  });

  it("returns running when the agent is active without ask", () => {
    expect(computeVisualState(true, 0)).toBe("running");
  });

  it("returns idle otherwise", () => {
    expect(computeVisualState(false, 0)).toBe("idle");
  });
});

describe("renderTitle", () => {
  it("renders the built-in default icons", () => {
    expect(renderTitle("Build Fix", "idle")).toBe("◆ Build Fix");
    expect(renderTitle("Build Fix", "running")).toBe("· Build Fix");
    expect(renderTitle("Build Fix", "ask")).toBe("?! Build Fix");
  });
});

describe("README contract", () => {
  it("documents the built-in default icons", () => {
    expect(readmeText).toContain("- `◆` when idle");
    expect(readmeText).toContain("- `·` when running");
    expect(readmeText).toContain("- `?!` when the `ask` tool is waiting for input");
  });
});

describe("public module surface", () => {
  it("does not expose applyTitle as a public helper", () => {
    expect(extensionModule).not.toHaveProperty("applyTitle");
  });
});

describe("package metadata", () => {
  it("describes the extension as best-effort cross-platform", () => {
    expect(packageJson.description).toBe(
      "Best-effort cross-platform terminal title status extension for Oh My Pi / Pi coding agent sessions.",
    );
  });

  it("includes cross-platform discovery keywords", () => {
    expect(packageJson.keywords).toContain("terminal-title");
    expect(packageJson.keywords).toContain("macos");
    expect(packageJson.keywords).toContain("linux");
  });

});

describe("marketplace metadata", () => {
  it("describes the marketplace source as cross-platform", () => {
    expect(marketplaceJson.metadata.description).toBe(
      "Marketplace source for the omp-title-icon best-effort cross-platform terminal title plugin.",
    );
  });

  it("describes the plugin as best-effort cross-platform", () => {
    expect(marketplaceJson.plugins[0]?.description).toBe(
      "Best-effort cross-platform terminal title status extension with idle/running/ask icons for OMP sessions.",
    );
  });

  it("includes cross-platform discovery keywords and tags", () => {
    expect(marketplaceJson.plugins[0]?.keywords).toEqual(
      expect.arrayContaining(["terminal-title", "cross-platform", "macos", "linux"]),
    );
    expect(marketplaceJson.plugins[0]?.tags).toEqual(
      expect.arrayContaining(["cross-platform", "terminal", "best-effort"]),
    );
  });
});

function createFakeContext(cwd = "C:/work/project") {
  const titles: string[] = [];
  const ctx = {
    cwd,
    ui: {
      setTitle(title: string) {
        titles.push(title);
      },
    },
  } as unknown as ExtensionContext;

  return { ctx, titles };
}

function createFakeScheduler() {
  let now = 0;
  let callback: (() => void) | undefined;

  const scheduler: TitleScheduler = {
    now: () => now,
    setInterval(fn: () => void) {
      callback = fn;
      return 1 as unknown as NodeJS.Timeout;
    },
    clearInterval() {
      callback = undefined;
    },
  };

  return {
    scheduler,
    advance(ms: number) {
      now += ms;
      callback?.();
    },
    get hasInterval() {
      return callback !== undefined;
    },
  };
}

function createFakePi(sessionName: string | undefined = "Build Fix") {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();

  const pi = {
    getSessionName: () => sessionName,
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  return { pi, handlers };
}
type AssertFalse<T extends false> = T;

const registerTitleIconOptionsRemovesHomeDirOverride: AssertFalse<
  "homeDir" extends keyof RegisterTitleIconOptions ? true : false
> = false;

const registerTitleIconOptionsRemovesReadTextOverride: AssertFalse<
  "readText" extends keyof RegisterTitleIconOptions ? true : false
> = false;

void registerTitleIconOptionsRemovesHomeDirOverride;
void registerTitleIconOptionsRemovesReadTextOverride;


function createTempHome(files: Array<{ relativePath: string; content: string }>) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-title-icon-"));

  for (const file of files) {
    const filePath = path.join(homeDir, file.relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, "utf8");
  }

  return {
    homeDir,
    cleanup() {
      fs.rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

function expectLoadedIdleTitle(
  env: Record<string, string | undefined>,
  sessionName = "Build Fix",
) {
  const { pi, handlers } = createFakePi(sessionName);
  const scheduler = createFakeScheduler();
  const { ctx, titles } = createFakeContext();

  registerTitleIcon(pi, {
    env: { ...env, WT_SESSION: "abc" },
    scheduler: scheduler.scheduler,
  });

  handlers.get("session_start")?.({ type: "session_start" }, ctx);

  return { titles, handlers };
}

describe("config-backed title prefixes", () => {
  it("prefers config.yml icons over settings.json", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "CFG"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
      {
        relativePath: path.join(".omp", "agent", "settings.json"),
        content: JSON.stringify({
          ompTitleIcon: {
            icons: { idle: "SET", running: "SET-RUN", ask: "SET-ASK" },
          },
        }),
      },
    ]);

    try {
      const { titles } = expectLoadedIdleTitle({
        HOME: fixture.homeDir,
        USERPROFILE: fixture.homeDir,
      });

      expect(titles).toEqual(["CFG Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("falls back to settings.json when config.yml has no ompTitleIcon.icons block", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: ["other:", "  value: true"].join("\n"),
      },
      {
        relativePath: path.join(".omp", "agent", "settings.json"),
        content: JSON.stringify({
          ompTitleIcon: {
            icons: { idle: "LEGACY", running: "LEG-RUN", ask: "LEG-ASK" },
          },
        }),
      },
    ]);

    try {
      const { titles } = expectLoadedIdleTitle({
        HOME: fixture.homeDir,
        USERPROFILE: fixture.homeDir,
      });

      expect(titles).toEqual(["LEGACY Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("falls back per field for invalid values while preserving empty strings", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: ""',
          "    running: 123",
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    try {
      registerTitleIcon(pi, {
        env: {
          HOME: fixture.homeDir,
          USERPROFILE: fixture.homeDir,
          WT_SESSION: "abc",
        },
        scheduler: scheduler.scheduler,
      });

      handlers.get("session_start")?.({ type: "session_start" }, ctx);
      handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
      handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolName: "ask" }, ctx);

      expect(titles).toEqual(["Build Fix", "· Build Fix", "ASK Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("ignores settings.json when config.yml is malformed", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: "ompTitleIcon: [unterminated",
      },
      {
        relativePath: path.join(".omp", "agent", "settings.json"),
        content: JSON.stringify({
          ompTitleIcon: {
            icons: { idle: "LEGACY", running: "LEG-RUN", ask: "LEG-ASK" },
          },
        }),
      },
    ]);

    try {
      const { titles } = expectLoadedIdleTitle({
        HOME: fixture.homeDir,
        USERPROFILE: fixture.homeDir,
      });

      expect(titles).toEqual(["◆ Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("falls back safely when config parsing fails", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: "ompTitleIcon: [unterminated",
      },
    ]);

    try {
      const { titles } = expectLoadedIdleTitle({
        HOME: fixture.homeDir,
        USERPROFILE: fixture.homeDir,
      });

      expect(titles).toEqual(["◆ Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("uses loaded config.yml prefixes across the lifecycle", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: ""',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    try {
      registerTitleIcon(pi, {
        env: {
          HOME: fixture.homeDir,
          USERPROFILE: fixture.homeDir,
          WT_SESSION: "abc",
        },
        scheduler: scheduler.scheduler,
      });

      handlers.get("session_start")?.({ type: "session_start" }, ctx);
      handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
      handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolName: "ask" }, ctx);
      handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);
      handlers.get("agent_end")?.({ type: "agent_end" }, ctx);

      expect(titles).toEqual([
        "Build Fix",
        "RUN Build Fix",
        "ASK Build Fix",
        "RUN Build Fix",
        "Build Fix",
      ]);
    } finally {
      fixture.cleanup();
    }
  });
});



describe("registerTitleIcon", () => {
  it("does nothing when capability gating disables the plugin", () => {
    const { pi, handlers } = createFakePi();
    registerTitleIcon(pi, {
      env: { TERM: "dumb" },
      scheduler: createFakeScheduler().scheduler,
    });

    expect(handlers.size).toBe(0);
  });

  it("applies idle, running, ask, and back to idle titles", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      env: { WT_SESSION: "abc" },
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolName: "ask" }, ctx);
    handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);
    handlers.get("agent_end")?.({ type: "agent_end" }, ctx);

    expect(titles[0]).toBe("◆ Build Fix");
    expect(titles[1]).toBe("· Build Fix");
    expect(titles[2]).toBe("?! Build Fix");
    expect(titles[3]).toBe("· Build Fix");
    expect(titles[4]).toBe("◆ Build Fix");
  });

  it("registers and drives the title lifecycle when TERM_PROGRAM enables the plugin", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext("/Users/anton/project");

    registerTitleIcon(pi, {
      env: { TERM_PROGRAM: "iTerm.app" },
      scheduler: scheduler.scheduler,
    });

    expect(handlers.size).toBeGreaterThan(0);

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolName: "ask" }, ctx);
    handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);
    handlers.get("agent_end")?.({ type: "agent_end" }, ctx);

    expect(titles[0]).toBe("◆ Build Fix");
    expect(titles[1]).toBe("· Build Fix");
    expect(titles[2]).toBe("?! Build Fix");
    expect(titles[3]).toBe("· Build Fix");
    expect(titles[4]).toBe("◆ Build Fix");
  });

  it("clamps ask depth at zero when ask ends extra times", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      env: { WT_SESSION: "abc" },
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);

    expect(titles).toEqual(["◆ Build Fix", "◆ Build Fix"]);
  });

  it("force-reasserts the same title during the takeover window and then stops", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      env: { WT_SESSION: "abc" },
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    expect(titles).toEqual(["◆ Build Fix"]);
    expect(scheduler.hasInterval).toBe(true);

    scheduler.advance(250);
    scheduler.advance(250);
    expect(titles).toEqual(["◆ Build Fix", "◆ Build Fix", "◆ Build Fix"]);

    scheduler.advance(2000);
    expect(scheduler.hasInterval).toBe(false);
  });
});