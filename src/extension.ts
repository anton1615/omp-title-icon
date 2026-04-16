import * as path from "node:path";

export interface ExtensionUIContext {
  setTitle(title: string): void;
}

export interface ExtensionContext {
  cwd: string | undefined;
  ui: ExtensionUIContext;
}

export interface NamedToolEvent {
  toolName: string;
}

export interface ExtensionAPI {
  getSessionName(): string | undefined;
  on(
    eventName: string,
    handler: (event: unknown, ctx: ExtensionContext) => void,
  ): void;
}

export type TitleIconState = "idle" | "running" | "ask";

export interface TitlePrefixes {
  idle: string;
  running: string;
  ask: string;
}

export interface TitleControllerState {
  agentRunning: boolean;
  askDepth: number;
  reassertTimer: NodeJS.Timeout | undefined;
  reassertUntil: number;
  lastAppliedTitle: string | undefined;
}

export interface TitleScheduler {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

export interface RegisterTitleIconOptions {
  scheduler?: TitleScheduler;
  env?: Record<string, string | undefined>;
}

const REASSERT_DURATION_MS = 2000;
const REASSERT_INTERVAL_MS = 250;
const ASK_TOOL_NAME = "ask";
const DEFAULT_FALLBACK_TITLE = "π";

const DEFAULT_TITLE_PREFIXES: TitlePrefixes = {
  idle: "◆",
  running: "·",
  ask: "?!",
};
const defaultScheduler: TitleScheduler = {
  now: () => Date.now(),
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: handle => clearInterval(handle),
};

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

function selectPathModule(cwd: string): typeof path.win32 | typeof path.posix {
  if (/^[A-Za-z]:(?:[\\/]|$)/.test(cwd) || cwd.startsWith("\\\\") || cwd.includes("\\")) {
    return path.win32;
  }

  return path.posix;
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

  const pathModule = selectPathModule(trimmedCwd);
  const baseName = pathModule.basename(trimmedCwd);
  if (!baseName || baseName === pathModule.parse(trimmedCwd).root) {
    return DEFAULT_FALLBACK_TITLE;
  }

  return baseName;
}

export function computeVisualState(
  agentRunning: boolean,
  askDepth: number,
): TitleIconState {
  if (askDepth > 0) {
    return "ask";
  }

  if (agentRunning) {
    return "running";
  }

  return "idle";
}

function formatTitle(prefix: string, baseTitle: string): string {
  return prefix ? `${prefix} ${baseTitle}` : baseTitle;
}

export function renderTitle(
  baseTitle: string,
  state: TitleIconState,
  prefixes: TitlePrefixes = DEFAULT_TITLE_PREFIXES,
): string {
  switch (state) {
    case "ask":
      return formatTitle(prefixes.ask, baseTitle);
    case "running":
      return formatTitle(prefixes.running, baseTitle);
    case "idle":
      return formatTitle(prefixes.idle, baseTitle);
  }
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

function stopReassert(state: TitleControllerState, scheduler: TitleScheduler): void {
  if (!state.reassertTimer) {
    return;
  }

  scheduler.clearInterval(state.reassertTimer);
  state.reassertTimer = undefined;
}

function startReassert(
  pi: Pick<ExtensionAPI, "getSessionName">,
  ctx: Pick<ExtensionContext, "cwd" | "ui">,
  state: TitleControllerState,
  scheduler: TitleScheduler,
 ): void {
  stopReassert(state, scheduler);
  state.reassertUntil = scheduler.now() + REASSERT_DURATION_MS;

  applyTitle(pi, ctx, state, { force: true });

  state.reassertTimer = scheduler.setInterval(() => {
    if (scheduler.now() >= state.reassertUntil) {
      stopReassert(state, scheduler);
      return;
    }

    applyTitle(pi, ctx, state, { force: true });
  }, REASSERT_INTERVAL_MS);
}

function registerReassertEvent(
  pi: Pick<ExtensionAPI, "on">,
  eventName: "session_start" | "session_switch" | "session_branch" | "session_tree",
  handler: (ctx: ExtensionContext) => void,
): void {
  pi.on(eventName, (_event: unknown, ctx: ExtensionContext) => {
    handler(ctx);
  });
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

  const reassert = (ctx: ExtensionContext) => {
    startReassert(pi, ctx, state, scheduler);
  };

  registerReassertEvent(pi, "session_start", reassert);
  registerReassertEvent(pi, "session_switch", reassert);
  registerReassertEvent(pi, "session_branch", reassert);
  registerReassertEvent(pi, "session_tree", reassert);

  pi.on("agent_start", (_event: unknown, ctx: ExtensionContext) => {
    state.agentRunning = true;
    startReassert(pi, ctx, state, scheduler);
  });

  pi.on("agent_end", (_event: unknown, ctx: ExtensionContext) => {
    state.agentRunning = false;
    startReassert(pi, ctx, state, scheduler);
  });

  pi.on("tool_execution_start", (event: unknown, ctx: ExtensionContext) => {
    if (!isNamedToolEvent(event) || event.toolName !== ASK_TOOL_NAME) {
      return;
    }

    state.askDepth += 1;
    startReassert(pi, ctx, state, scheduler);
  });

  pi.on("tool_execution_end", (event: unknown, ctx: ExtensionContext) => {
    if (!isNamedToolEvent(event) || event.toolName !== ASK_TOOL_NAME) {
      return;
    }

    state.askDepth = Math.max(0, state.askDepth - 1);
    startReassert(pi, ctx, state, scheduler);
  });
}

function isNamedToolEvent(event: unknown): event is NamedToolEvent {
  return Boolean(
    event &&
      typeof event === "object" &&
      "toolName" in event &&
      typeof (event as { toolName?: unknown }).toolName === "string",
  );
}