import * as fs from "node:fs";
import * as os from "node:os";
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

interface TitlePrefixes {
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

const CONFIG_RELATIVE_PATH = [".omp", "agent", "config.yml"] as const;
const LEGACY_SETTINGS_RELATIVE_PATH = [".omp", "agent", "settings.json"] as const;

function defaultReadText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractConfiguredIcons(config: unknown): unknown | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  const extensionConfig = config.ompTitleIcon;
  if (!isRecord(extensionConfig) || !("icons" in extensionConfig)) {
    return undefined;
  }

  return extensionConfig.icons;
}

function normalizePrefix(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeTitlePrefixes(configuredIcons: unknown): TitlePrefixes {
  if (!isRecord(configuredIcons)) {
    return { ...DEFAULT_TITLE_PREFIXES };
  }

  return {
    idle: normalizePrefix(configuredIcons.idle, DEFAULT_TITLE_PREFIXES.idle),
    running: normalizePrefix(configuredIcons.running, DEFAULT_TITLE_PREFIXES.running),
    ask: normalizePrefix(configuredIcons.ask, DEFAULT_TITLE_PREFIXES.ask),
  };
}

type ParsedPrefixesResult =
  | { kind: "parsed"; prefixes: TitlePrefixes }
  | { kind: "missing-icons" }
  | { kind: "parse-error" };

function parseConfiguredPrefixes(
  text: string,
  format: "yaml" | "json",
): ParsedPrefixesResult {
  try {
    const parsed = format === "yaml" ? Bun.YAML.parse(text) : JSON.parse(text);
    const configuredIcons = extractConfiguredIcons(parsed);
    if (configuredIcons === undefined) {
      return { kind: "missing-icons" };
    }

    return { kind: "parsed", prefixes: normalizeTitlePrefixes(configuredIcons) };
  } catch {
    return { kind: "parse-error" };
  }
}

function resolveHomeDirs(): string[] {
  const homeDirs: string[] = [];

  for (const candidate of [process.env.HOME, process.env.USERPROFILE, os.homedir()]) {
    if (candidate === undefined || candidate === "" || homeDirs.includes(candidate)) {
      continue;
    }

    homeDirs.push(candidate);
  }

  return homeDirs;
}

function loadTitlePrefixesFromHome(homeDir: string): TitlePrefixes | undefined {
  const configPath = path.join(homeDir, ...CONFIG_RELATIVE_PATH);
  const configText = defaultReadText(configPath);
  if (configText !== undefined) {
    const configPrefixes = parseConfiguredPrefixes(configText, "yaml");
    if (configPrefixes.kind === "parsed") {
      return configPrefixes.prefixes;
    }
    if (configPrefixes.kind === "parse-error") {
      return undefined;
    }
  }

  const settingsPath = path.join(homeDir, ...LEGACY_SETTINGS_RELATIVE_PATH);
  const settingsText = defaultReadText(settingsPath);
  if (settingsText !== undefined) {
    const legacyPrefixes = parseConfiguredPrefixes(settingsText, "json");
    if (legacyPrefixes.kind === "parsed") {
      return legacyPrefixes.prefixes;
    }
    if (legacyPrefixes.kind === "parse-error") {
      return undefined;
    }

    return undefined;
  }

  return undefined;
}

function loadTitlePrefixes(): TitlePrefixes {
  for (const homeDir of resolveHomeDirs()) {
    const loadedPrefixes = loadTitlePrefixesFromHome(homeDir);
    if (loadedPrefixes !== undefined) {
      return loadedPrefixes;
    }
  }

  return { ...DEFAULT_TITLE_PREFIXES };
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

function renderTitleWithPrefixes(
  baseTitle: string,
  state: TitleIconState,
  prefixes: TitlePrefixes,
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


function applyTitle(
  pi: Pick<ExtensionAPI, "getSessionName">,
  ctx: Pick<ExtensionContext, "cwd" | "ui">,
  state: TitleControllerState,
  prefixes: TitlePrefixes,
  options: { force?: boolean } = {},
): void {
  const baseTitle = computeBaseTitle(pi.getSessionName(), ctx.cwd);
  const nextTitle = renderTitleWithPrefixes(
    baseTitle,
    computeVisualState(state.agentRunning, state.askDepth),
    prefixes,
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
  prefixes: TitlePrefixes,
): void {
  stopReassert(state, scheduler);
  state.reassertUntil = scheduler.now() + REASSERT_DURATION_MS;

  applyTitle(pi, ctx, state, prefixes, { force: true });

  state.reassertTimer = scheduler.setInterval(() => {
    if (scheduler.now() >= state.reassertUntil) {
      stopReassert(state, scheduler);
      return;
    }

    applyTitle(pi, ctx, state, prefixes, { force: true });
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

  if (!shouldEnableTitlePlugin()) {
    return;
  }

  const prefixes = loadTitlePrefixes();
  const state: TitleControllerState = {
    agentRunning: false,
    askDepth: 0,
    reassertTimer: undefined,
    reassertUntil: 0,
    lastAppliedTitle: undefined,
  };

  const reassert = (ctx: ExtensionContext) => {
    startReassert(pi, ctx, state, scheduler, prefixes);
  };

  registerReassertEvent(pi, "session_start", reassert);
  registerReassertEvent(pi, "session_switch", reassert);
  registerReassertEvent(pi, "session_branch", reassert);
  registerReassertEvent(pi, "session_tree", reassert);

  pi.on("agent_start", (_event: unknown, ctx: ExtensionContext) => {
    state.agentRunning = true;
    startReassert(pi, ctx, state, scheduler, prefixes);
  });

  pi.on("agent_end", (_event: unknown, ctx: ExtensionContext) => {
    state.agentRunning = false;
    startReassert(pi, ctx, state, scheduler, prefixes);
  });

  pi.on("tool_execution_start", (event: unknown, ctx: ExtensionContext) => {
    if (!isNamedToolEvent(event) || event.toolName !== ASK_TOOL_NAME) {
      return;
    }

    state.askDepth += 1;
    startReassert(pi, ctx, state, scheduler, prefixes);
  });

  pi.on("tool_execution_end", (event: unknown, ctx: ExtensionContext) => {
    if (!isNamedToolEvent(event) || event.toolName !== ASK_TOOL_NAME) {
      return;
    }

    state.askDepth = Math.max(0, state.askDepth - 1);
    startReassert(pi, ctx, state, scheduler, prefixes);
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