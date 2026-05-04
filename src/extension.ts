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
  runningFrames: string[];
}

export interface TitleControllerState {
  agentRunning: boolean;
  askDepth: number;
  isShutdown: boolean;
  reassertTimer: NodeJS.Timeout | undefined;
  reassertUntil: number;
  lastAppliedTitle: string | undefined;
}

interface InternalTitleControllerState extends TitleControllerState {
  isCompacting: boolean;
  runningFrameIndex: number;
  runningFrameUpdatedAt: number | undefined;
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
const RUNNING_FRAME_INTERVAL_MS = 960;
const ASK_TOOL_NAME = "ask";
const DEFAULT_FALLBACK_TITLE = "π";

const DEFAULT_TITLE_PREFIXES: TitlePrefixes = { idle: "✳", running: "⟳", runningFrames: ["⠂", "⠐"], ask: "?!" }
const defaultScheduler: TitleScheduler = {
  now: () => Date.now(),
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: handle => clearInterval(handle),
};

const CONFIG_RELATIVE_PATH = [".omp", "agent", "config.yml"] as const;
const LEGACY_SETTINGS_RELATIVE_PATH = [".omp", "agent", "settings.json"] as const;

type ReadTextResult =
  | { kind: "read"; text: string }
  | { kind: "missing" }
  | { kind: "error" };

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && typeof error.code === "string";
}

function defaultReadText(filePath: string): ReadTextResult {
  try {
    return { kind: "read", text: fs.readFileSync(filePath, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { kind: "missing" };
    }

    return { kind: "error" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ExtractConfiguredIconsResult =
  | { kind: "configured"; icons: unknown }
  | { kind: "missing-icons" }
  | { kind: "invalid-structure" };

function extractConfiguredIcons(config: unknown): ExtractConfiguredIconsResult {
  if (!isRecord(config)) {
    return { kind: "invalid-structure" };
  }

  if (!("ompTitleIcon" in config)) {
    return { kind: "missing-icons" };
  }

  const extensionConfig = config.ompTitleIcon;
  if (!isRecord(extensionConfig)) {
    return { kind: "invalid-structure" };
  }

  if (!("icons" in extensionConfig)) {
    return { kind: "missing-icons" };
  }

  return { kind: "configured", icons: extensionConfig.icons };
}

function normalizePrefix(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function normalizeRunningFrames(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const frames = value.filter((frame): frame is string => typeof frame === "string");
  return frames.length > 0 ? frames : [...fallback];
}


function normalizeTitlePrefixes(configuredIcons: unknown): TitlePrefixes {
  if (!isRecord(configuredIcons)) {
    return {
      ...DEFAULT_TITLE_PREFIXES,
      runningFrames: [...DEFAULT_TITLE_PREFIXES.runningFrames],
    };
  }

  const hasConfiguredStaticRunning = typeof configuredIcons.running === "string";
  const fallbackRunningFrames = hasConfiguredStaticRunning ? [] : DEFAULT_TITLE_PREFIXES.runningFrames;

  return {
    idle: normalizePrefix(configuredIcons.idle, DEFAULT_TITLE_PREFIXES.idle),
    running: normalizePrefix(configuredIcons.running, DEFAULT_TITLE_PREFIXES.running),
    runningFrames: normalizeRunningFrames(configuredIcons.runningFrames, fallbackRunningFrames),
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
    if (configuredIcons.kind === "missing-icons") {
      return { kind: "missing-icons" };
    }

    const prefixes =
      configuredIcons.kind === "invalid-structure"
        ? {
            ...DEFAULT_TITLE_PREFIXES,
            runningFrames: [...DEFAULT_TITLE_PREFIXES.runningFrames],
          }
        : normalizeTitlePrefixes(configuredIcons.icons);

    return { kind: "parsed", prefixes };
  } catch {
    return { kind: "parse-error" };
  }
}

function resolveHomeDir(): string {
  return os.homedir();
}

function loadTitlePrefixesFromHome(homeDir: string): TitlePrefixes | undefined {
  const configPath = path.join(homeDir, ...CONFIG_RELATIVE_PATH);
  const configText = defaultReadText(configPath);
  if (configText.kind === "read") {
    const configPrefixes = parseConfiguredPrefixes(configText.text, "yaml");
    if (configPrefixes.kind === "parsed") {
      return configPrefixes.prefixes;
    }

    if (configPrefixes.kind === "parse-error") {
      return undefined;
    }
  } else if (configText.kind === "error") {
    return undefined;
  }

  const settingsPath = path.join(homeDir, ...LEGACY_SETTINGS_RELATIVE_PATH);
  const settingsText = defaultReadText(settingsPath);
  if (settingsText.kind === "read") {
    const legacyPrefixes = parseConfiguredPrefixes(settingsText.text, "json");
    if (legacyPrefixes.kind === "parsed") {
      return legacyPrefixes.prefixes;
    }

    return undefined;
  }

  return undefined;
}

function loadTitlePrefixes(): TitlePrefixes {
  const loadedPrefixes = loadTitlePrefixesFromHome(resolveHomeDir());
  if (loadedPrefixes !== undefined) {
    return loadedPrefixes;
  }

  return {
    ...DEFAULT_TITLE_PREFIXES,
    runningFrames: [...DEFAULT_TITLE_PREFIXES.runningFrames],
  };
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

function hasRunningTitleSource(
  state: Pick<InternalTitleControllerState, "agentRunning" | "isCompacting">,
 ): boolean {
  return state.agentRunning || state.isCompacting;
}
function hasPersistentTitleSource(
  state: Pick<InternalTitleControllerState, "agentRunning" | "isCompacting" | "askDepth">,
): boolean {
  return hasRunningTitleSource(state) || state.askDepth > 0;
}


export function computeVisualState(agentRunning: boolean, askDepth: number): TitleIconState {
  if (askDepth > 0) {
    return "ask";
  }

  if (agentRunning) {
    return "running";
  }

  return "idle";
}
function setCompactingState(state: InternalTitleControllerState, isCompacting: boolean): void {
  if (state.isShutdown) {
    return;
  }

  state.isCompacting = isCompacting;
}

function formatTitle(prefix: string, baseTitle: string): string {
  return prefix ? `${prefix} ${baseTitle}` : baseTitle;
}
function selectRunningPrefix(prefixes: TitlePrefixes, runningFrameIndex: number): string {
  if (prefixes.runningFrames.length === 0) {
    return prefixes.running;
  }

  return prefixes.runningFrames[runningFrameIndex % prefixes.runningFrames.length] ?? prefixes.running;
}


function renderTitleWithPrefixes(
  baseTitle: string,
  state: TitleIconState,
  prefixes: TitlePrefixes,
  runningFrameIndex: number,
): string {
  switch (state) {
    case "ask":
      return formatTitle(prefixes.ask, baseTitle);
    case "running":
      return formatTitle(selectRunningPrefix(prefixes, runningFrameIndex), baseTitle);
    case "idle":
      return formatTitle(prefixes.idle, baseTitle);
  }
}

function updateRunningFrame(state: InternalTitleControllerState, now: number): void {
  if (!hasRunningTitleSource(state)) {
    state.runningFrameIndex = 0;
    state.runningFrameUpdatedAt = undefined;
    return;
  }

  if (state.runningFrameUpdatedAt === undefined) {
    state.runningFrameIndex = 0;
    state.runningFrameUpdatedAt = now;
    return;
  }

  const elapsed = now - state.runningFrameUpdatedAt;
  if (elapsed < RUNNING_FRAME_INTERVAL_MS) {
    return;
  }

  const steps = Math.floor(elapsed / RUNNING_FRAME_INTERVAL_MS);
  state.runningFrameIndex += steps;
  state.runningFrameUpdatedAt += steps * RUNNING_FRAME_INTERVAL_MS;
}


function applyTitle(
  pi: Pick<ExtensionAPI, "getSessionName">,
  ctx: Pick<ExtensionContext, "cwd" | "ui">,
  state: InternalTitleControllerState,
  prefixes: TitlePrefixes,
  options: { force?: boolean } = {},
): void {
  const baseTitle = computeBaseTitle(pi.getSessionName(), ctx.cwd);
  const nextTitle = renderTitleWithPrefixes(
    baseTitle,
    computeVisualState(hasRunningTitleSource(state), state.askDepth),
    prefixes,
    state.runningFrameIndex,
  );

  if (!options.force && state.lastAppliedTitle === nextTitle) {
    return;
  }

  ctx.ui.setTitle(nextTitle);
  state.lastAppliedTitle = nextTitle;
}

function stopReassert(state: InternalTitleControllerState, scheduler: TitleScheduler): void {
  if (!state.reassertTimer) {
    return;
  }

  scheduler.clearInterval(state.reassertTimer);
  state.reassertTimer = undefined;
}

function startReassert(
  pi: Pick<ExtensionAPI, "getSessionName">,
  ctx: Pick<ExtensionContext, "cwd" | "ui">,
  state: InternalTitleControllerState,
  scheduler: TitleScheduler,
  prefixes: TitlePrefixes,
): void {
  if (state.isShutdown) {
    return;
  }

  stopReassert(state, scheduler);
  updateRunningFrame(state, scheduler.now());
  state.reassertUntil = scheduler.now() + REASSERT_DURATION_MS;

  applyTitle(pi, ctx, state, prefixes, { force: true });

  state.reassertTimer = scheduler.setInterval(() => {
    if (state.isShutdown) {
      stopReassert(state, scheduler);
      return;
    }

    if (!hasPersistentTitleSource(state) && scheduler.now() >= state.reassertUntil) {
      stopReassert(state, scheduler);
      return;
    }

    updateRunningFrame(state, scheduler.now());
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
  const state: InternalTitleControllerState = {
    agentRunning: false,
    isCompacting: false,
    askDepth: 0,
    isShutdown: false,
    reassertTimer: undefined,
    reassertUntil: 0,
    runningFrameIndex: 0,
    runningFrameUpdatedAt: undefined,
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

  pi.on("session_before_compact", (_event: unknown, ctx: ExtensionContext) => {
    setCompactingState(state, true);
    startReassert(pi, ctx, state, scheduler, prefixes);
  });

  pi.on("session_compact", (_event: unknown, ctx: ExtensionContext) => {
    setCompactingState(state, false);
    startReassert(pi, ctx, state, scheduler, prefixes);
  });


  pi.on("session_shutdown", () => {
    state.isShutdown = true;
    state.agentRunning = false;
    state.isCompacting = false;
    state.askDepth = 0;
    state.runningFrameIndex = 0;
    state.runningFrameUpdatedAt = undefined;
    stopReassert(state, scheduler);
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