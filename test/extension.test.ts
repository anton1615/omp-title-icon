import { describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import registerTitleIcon, {
  computeBaseTitle,
  computeVisualState,
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

  it("does not expose renderTitle as a public helper", () => {
    expect(extensionModule).not.toHaveProperty("renderTitle");
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

const registerTitleIconOptionsRemovesEnvOverride: AssertFalse<
  "env" extends keyof RegisterTitleIconOptions ? true : false
> = false;

void registerTitleIconOptionsRemovesHomeDirOverride;
void registerTitleIconOptionsRemovesReadTextOverride;
void registerTitleIconOptionsRemovesEnvOverride;

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

function withProcessEnv<T>(
  updates: Record<string, string | undefined>,
  run: () => T,
  clears: string[] = [],
): T {
  const previousValues = new Map<string, string | undefined>();

  for (const key of new Set([...Object.keys(updates), ...clears])) {
    previousValues.set(key, process.env[key]);
  }

  for (const key of clears) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withProcessHome<T>(homeDir: string, run: () => T): T {
  return withProcessEnv({ HOME: homeDir, USERPROFILE: homeDir }, run);
}

function expectLoadedIdleTitle(
  sessionName = "Build Fix",
  registerTitleIconImpl: typeof registerTitleIcon = registerTitleIcon,
) {
  const { pi, handlers } = createFakePi(sessionName);
  const scheduler = createFakeScheduler();
  const { ctx, titles } = createFakeContext();

  withProcessEnv(
    { WT_SESSION: "abc" },
    () => {
      registerTitleIconImpl(pi, {
        scheduler: scheduler.scheduler,
      });
    },
    ["TERM"],
  );

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
      const { titles } = withProcessHome(fixture.homeDir, () => expectLoadedIdleTitle());

      expect(titles).toEqual(["CFG Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("loads config from process home rather than any removed env override", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "REAL"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);

    try {
      const { titles } = withProcessHome(fixture.homeDir, () => expectLoadedIdleTitle());

      expect(titles).toEqual(["REAL Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("falls back to USERPROFILE when HOME is an empty string", () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "USR"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);

    try {
      const { titles } = withProcessEnv(
        { WT_SESSION: "abc", HOME: "", USERPROFILE: fixture.homeDir },
        () => expectLoadedIdleTitle(),
      );

      expect(titles).toEqual(["USR Build Fix"]);
    } finally {
      fixture.cleanup();
    }
  });

  it("falls back to USERPROFILE when HOME has no config files", () => {
    const userProfileFixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "USR"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);
    const unusableHomeFixture = createTempHome([]);

    try {
      const { titles } = withProcessEnv(
        {
          WT_SESSION: "abc",
          HOME: unusableHomeFixture.homeDir,
          USERPROFILE: userProfileFixture.homeDir,
        },
        () => expectLoadedIdleTitle(),
      );

      expect(titles).toEqual(["USR Build Fix"]);
    } finally {
      userProfileFixture.cleanup();
      unusableHomeFixture.cleanup();
    }
  });

  it("falls back to USERPROFILE when HOME config.yml is malformed", () => {
    const userProfileFixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "USR"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);
    const malformedHomeFixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: "ompTitleIcon: [unterminated",
      },
    ]);

    try {
      const { titles } = withProcessEnv(
        {
          WT_SESSION: "abc",
          HOME: malformedHomeFixture.homeDir,
          USERPROFILE: userProfileFixture.homeDir,
        },
        () => expectLoadedIdleTitle(),
      );

      expect(titles).toEqual(["USR Build Fix"]);
    } finally {
      userProfileFixture.cleanup();
      malformedHomeFixture.cleanup();
    }
  });

  it("falls back to USERPROFILE when HOME settings.json lacks ompTitleIcon.icons", () => {
    const userProfileFixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "USR"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);
    const legacyHomeFixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "settings.json"),
        content: JSON.stringify({ legacy: true }),
      },
    ]);

    try {
      const { titles } = withProcessEnv(
        {
          WT_SESSION: "abc",
          HOME: legacyHomeFixture.homeDir,
          USERPROFILE: userProfileFixture.homeDir,
        },
        () => expectLoadedIdleTitle(),
      );

      expect(titles).toEqual(["USR Build Fix"]);
    } finally {
      userProfileFixture.cleanup();
      legacyHomeFixture.cleanup();
    }
  });

  it("falls back to os.homedir when HOME and USERPROFILE are missing", async () => {
    const fixture = createTempHome([
      {
        relativePath: path.join(".omp", "agent", "config.yml"),
        content: [
          "ompTitleIcon:",
          "  icons:",
          '    idle: "OS"',
          '    running: "RUN"',
          '    ask: "ASK"',
        ].join("\n"),
      },
    ]);

    try {
      mock.module("node:os", () => ({
        ...os,
        homedir: () => fixture.homeDir,
      }));
      const freshExtension = await import(`../src/extension.ts?os-home-${Date.now()}`);
      const { titles } = withProcessEnv(
        {},
        () => expectLoadedIdleTitle("Build Fix", freshExtension.default),
        ["HOME", "USERPROFILE"],
      );

      expect(titles).toEqual(["OS Build Fix"]);
    } finally {
      mock.restore();
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
      const { titles } = withProcessHome(fixture.homeDir, () => expectLoadedIdleTitle());

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
      withProcessHome(fixture.homeDir, () => {
        withProcessEnv({ WT_SESSION: "abc" }, () => {
          registerTitleIcon(pi, {
            scheduler: scheduler.scheduler,
          });
        }, ["TERM"]);

        handlers.get("session_start")?.({ type: "session_start" }, ctx);
        handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
        handlers.get("tool_execution_start")?.(
          { type: "tool_execution_start", toolName: "ask" },
          ctx,
        );
      });

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
      const { titles } = withProcessHome(fixture.homeDir, () => expectLoadedIdleTitle());

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
      const { titles } = withProcessHome(fixture.homeDir, () => expectLoadedIdleTitle());

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
      withProcessHome(fixture.homeDir, () => {
        withProcessEnv({ WT_SESSION: "abc" }, () => {
          registerTitleIcon(pi, {
            scheduler: scheduler.scheduler,
          });
        }, ["TERM"]);

        handlers.get("session_start")?.({ type: "session_start" }, ctx);
        handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
        handlers.get("tool_execution_start")?.(
          { type: "tool_execution_start", toolName: "ask" },
          ctx,
        );
        handlers.get("tool_execution_end")?.(
          { type: "tool_execution_end", toolName: "ask" },
          ctx,
        );
        handlers.get("agent_end")?.({ type: "agent_end" }, ctx);
      });

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

    withProcessEnv({ TERM: "dumb" }, () => {
      registerTitleIcon(pi, {
        scheduler: createFakeScheduler().scheduler,
      });
    });

    expect(handlers.size).toBe(0);
  });

  it("applies idle, running, ask, and back to idle titles", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    withProcessEnv({ WT_SESSION: "abc" }, () => {
      registerTitleIcon(pi, {
        scheduler: scheduler.scheduler,
      });
    }, ["TERM"]);

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

    withProcessEnv({ TERM_PROGRAM: "iTerm.app" }, () => {
      registerTitleIcon(pi, {
        scheduler: scheduler.scheduler,
      });
    }, ["TERM"]);

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

    withProcessEnv({ WT_SESSION: "abc" }, () => {
      registerTitleIcon(pi, {
        scheduler: scheduler.scheduler,
      });
    }, ["TERM"]);

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);

    expect(titles).toEqual(["◆ Build Fix", "◆ Build Fix"]);
  });

  it("force-reasserts the same title during the takeover window and then stops", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    withProcessEnv({ WT_SESSION: "abc" }, () => {
      registerTitleIcon(pi, {
        scheduler: scheduler.scheduler,
      });
    }, ["TERM"]);

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
