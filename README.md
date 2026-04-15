# omp-title-icon

Best-effort Windows Terminal title takeover for Oh My Pi / Pi coding agent sessions.

It prefixes the visible terminal title with:

- `●` when idle
- `○` when running
- `?` when the `ask` tool is waiting for input

## Installation

### Marketplace status

This repository now includes a marketplace catalog for `omp-title-icon/omp-title-icon` at `.claude-plugin/marketplace.json`, but current OMP marketplace/plugin-root loading does not execute extension modules declared only through `package.json -> omp.extensions`. In the current OMP architecture, marketplace install is prepared but not yet functional for this plugin type.

Use one of the local extension loading paths below until upstream marketplace support for extension-module plugins exists.

### Local extension path

```bash
bun --cwd C:/Users/Anton/.omp/temp/oh-my-pi/packages/coding-agent src/cli.ts --extension C:/Users/Anton/.omp/temp/omp-title-icon
```

### Project settings

Add the repo root as an explicit extension path in `.omp/settings.json`:

```json
{
  "extensions": [
    "C:/Users/Anton/.omp/temp/omp-title-icon"
  ]
}
```

## Requirements

- Windows Terminal
- Windows (`process.platform === "win32"`)
- `WT_SESSION` must be present
- The Windows Terminal profile must not set `suppressApplicationTitle: true`

## What it does

The extension subscribes to session, agent, and tool lifecycle events, computes the visible title from `session name -> cwd basename -> π`, and briefly force-reasserts the same title for 2 seconds after key state transitions.

This is a best-effort takeover strategy. It improves title stability, but does not guarantee permanent ownership if your shell or another tool continuously rewrites the title.

## Local development

```bash
bun install
bun run check
```

## Manual verification

1. Open **Windows Terminal**.
2. Make sure the active profile does **not** set `suppressApplicationTitle: true`.
3. Start OMP with the local extension path:

```bash
bun --cwd C:/Users/Anton/.omp/temp/oh-my-pi/packages/coding-agent src/cli.ts --extension C:/Users/Anton/.omp/temp/omp-title-icon
```

4. Start a normal prompt. While the model is responding, the title should start with `○`.
5. Use a prompt that triggers the `ask` tool. While the question is waiting for input, the title should start with `?`.
6. When the turn is idle again, the title should return to `●`.

## Troubleshooting

- If the title never changes, confirm you are in **Windows Terminal**, not another terminal host.
- If the title changes briefly and snaps back, check whether your shell profile or prompt module rewrites the title.
- If the title never updates in the visible tab, check `suppressApplicationTitle` in the Windows Terminal profile.
- If you want less competition from OMP's built-in auto-title generation, try launching with `PI_NO_TITLE=1`.

## Marketplace note

- Marketplace metadata for `omp-title-icon/omp-title-icon` is checked in at `.claude-plugin/marketplace.json`.
- Current OMP marketplace/plugin-root loading does not activate extension-module plugins that rely only on `package.json -> omp.extensions`.
- Until upstream support exists, load this plugin via `--extension` or an explicit `extensions` setting path.