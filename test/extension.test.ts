import { describe, expect, it } from "bun:test";
import registerTitleIcon, {
  applyTitle,
  computeBaseTitle,
  computeVisualState,
  isWindowsTerminal,
  renderTitle,
  type ExtensionAPI,
  type ExtensionContext,
  type TitleControllerState,
  type TitleScheduler,
} from "../src/extension";

describe("isWindowsTerminal", () => {
  it("returns true only on win32 with WT_SESSION", () => {
    expect(isWindowsTerminal("win32", { WT_SESSION: "abc" })).toBe(true);
    expect(isWindowsTerminal("win32", {})).toBe(false);
    expect(isWindowsTerminal("linux", { WT_SESSION: "abc" })).toBe(false);
  });
});

describe("computeBaseTitle", () => {
  it("prefers the session name", () => {
    expect(computeBaseTitle("Build Fix", "C:/work/project")).toBe("Build Fix");
  });

  it("falls back to the cwd basename", () => {
    expect(computeBaseTitle(undefined, "C:/work/project")).toBe("project");
  });

  it("falls back to π when no useful cwd exists", () => {
    expect(computeBaseTitle(undefined, undefined)).toBe("π");
    expect(computeBaseTitle(undefined, "C:/")).toBe("π");
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
  it("renders the configured icons", () => {
    expect(renderTitle("Build Fix", "idle")).toBe("● Build Fix");
    expect(renderTitle("Build Fix", "running")).toBe("○ Build Fix");
    expect(renderTitle("Build Fix", "ask")).toBe("? Build Fix");
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

describe("applyTitle", () => {
  it("skips duplicate non-forced writes but allows forced reassert writes", () => {
    const { pi } = createFakePi("Build Fix");
    const { ctx, titles } = createFakeContext();
    const state: TitleControllerState = {
      agentRunning: false,
      askDepth: 0,
      reassertTimer: undefined,
      reassertUntil: 0,
      lastAppliedTitle: undefined,
    };

    applyTitle(pi, ctx, state);
    applyTitle(pi, ctx, state);
    applyTitle(pi, ctx, state, { force: true });

    expect(titles).toEqual(["● Build Fix", "● Build Fix"]);
  });
});

describe("registerTitleIcon", () => {
  it("does nothing outside Windows Terminal", () => {
    const { pi, handlers } = createFakePi();
    registerTitleIcon(pi, {
      platform: "linux",
      env: {},
      scheduler: createFakeScheduler().scheduler,
    });

    expect(handlers.size).toBe(0);
  });

  it("applies idle, running, ask, and back to idle titles", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      platform: "win32",
      env: { WT_SESSION: "abc" },
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolName: "ask" }, ctx);
    handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);
    handlers.get("agent_end")?.({ type: "agent_end" }, ctx);

    expect(titles[0]).toBe("● Build Fix");
    expect(titles[1]).toBe("○ Build Fix");
    expect(titles[2]).toBe("? Build Fix");
    expect(titles[3]).toBe("○ Build Fix");
    expect(titles[4]).toBe("● Build Fix");
  });

  it("clamps ask depth at zero when ask ends extra times", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      platform: "win32",
      env: { WT_SESSION: "abc" },
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolName: "ask" }, ctx);

    expect(titles).toEqual(["● Build Fix", "● Build Fix"]);
  });

  it("force-reasserts the same title during the takeover window and then stops", () => {
    const { pi, handlers } = createFakePi("Build Fix");
    const scheduler = createFakeScheduler();
    const { ctx, titles } = createFakeContext();

    registerTitleIcon(pi, {
      platform: "win32",
      env: { WT_SESSION: "abc" },
      scheduler: scheduler.scheduler,
    });

    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    expect(titles).toEqual(["● Build Fix"]);
    expect(scheduler.hasInterval).toBe(true);

    scheduler.advance(250);
    scheduler.advance(250);
    expect(titles).toEqual(["● Build Fix", "● Build Fix", "● Build Fix"]);

    scheduler.advance(2000);
    expect(scheduler.hasInterval).toBe(false);
  });
});