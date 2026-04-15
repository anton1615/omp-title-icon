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
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

const REASSERT_DURATION_MS = 2000;
const REASSERT_INTERVAL_MS = 250;
const ASK_TOOL_NAME = "ask";
const DEFAULT_FALLBACK_TITLE = "π";

const defaultScheduler: TitleScheduler = {
  now: () => Date.now(),
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: handle => clearInterval(handle),
};

export function isWindowsTerminal(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return platform === "win32" && Boolean(env.WT_SESSION);
}

export function computeBaseTitle(
  sessionName: string | undefined,
  cwd: string | undefined,
): string {
  const trimmedSessionName = sessionName?.trim();
  if (trimmedSessionName) {
    return trimmedSessionName;
  }

  if (!cwd) {
    return DEFAULT_FALLBACK_TITLE;
  }

  const baseName = path.basename(cwd);
  if (!baseName || baseName === path.parse(cwd).root) {
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

export function renderTitle(baseTitle: string, state: TitleIconState): string {
  switch (state) {
    case "ask":
      return `? ${baseTitle}`;
    case "running":
      return `○ ${baseTitle}`;
    case "idle":
      return `● ${baseTitle}`;
  }
}

export function applyTitle(
  pi: Pick<ExtensionAPI, "getSessionName">,
  ctx: Pick<ExtensionContext, "cwd" | "ui">,
  state: TitleControllerState,
  options: { force?: boolean } = {},
): void {
  const baseTitle = computeBaseTitle(pi.getSessionName(), ctx.cwd);
  const nextTitle = renderTitle(baseTitle, computeVisualState(state.agentRunning, state.askDepth));

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
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (!isWindowsTerminal(platform, env)) {
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