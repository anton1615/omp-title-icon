# omp-title-icon

Best-effort cross-platform terminal title status extension for Oh My Pi / Pi coding agent sessions.

It prefixes the visible terminal title with:

- `✳` when idle
- `⠂` / `⠐` alternating while running, including while OMP is compacting the session
- `?!` when the `ask` tool is waiting for input

## User overrides

By default the extension uses `✳` for idle, alternates `⠂` / `⠐` while running, and uses `?!` while the `ask` tool is waiting for input. Configure `icons.running` to use a static running prefix instead.

For per-user overrides, define `ompTitleIcon.icons` in `~/.omp/agent/config.yml`:

```yaml
ompTitleIcon:
  icons:
    idle: "✳"
    running: "⟳"
    ask: "?!"
```

`~/.omp/agent/config.yml` is the primary config source. If that file does not define an `ompTitleIcon.icons` block, the extension falls back to the legacy `~/.omp/agent/settings.json` location:

If the canonical `~/.omp/agent/config.yml` exists but is unreadable, cannot be parsed, or has an invalid structure, the extension does not consult legacy `~/.omp/agent/settings.json` and uses the built-in defaults instead.

Once `~/.omp/agent/config.yml` defines `ompTitleIcon.icons`, the extension does not merge missing fields from the legacy `~/.omp/agent/settings.json` file. Any icon values omitted there fall back to the built-in defaults instead.

```json
{
  "ompTitleIcon": {
    "icons": {
      "idle": "✳",
      "running": "⟳",
      "ask": "?!"
    }
  }
}
```

Set any icon to an empty string to remove the prefix for that state.

```yaml
ompTitleIcon:
  icons:
    idle: ""
    running: "⟳"
    ask: "?!"
```

The title update remains best-effort: the configured prefixes are only visible when your terminal host accepts OSC title changes and does not immediately overwrite them.

## Installation

### Marketplace status

This repository now includes a marketplace catalog for `anton1615/omp-title-icon` at `.claude-plugin/marketplace.json`, but current OMP marketplace/plugin-root loading does not execute extension modules declared only through `package.json -> omp.extensions`. In the current OMP architecture, marketplace install is prepared but not yet functional for this plugin type.

Use one of the local extension loading paths below until upstream marketplace support for extension-module plugins exists.

### Local extension path

```bash
bun --cwd <path-to-oh-my-pi>/packages/coding-agent src/cli.ts --extension <path-to-omp-title-icon>
```

### Project settings

Add the plugin root as an explicit extension path in `.omp/settings.json`:

```json
{
  "extensions": [
    "<path-to-omp-title-icon>"
  ]
}
```

## Requirements

- Interactive terminal host that supports OSC title updates
- Best-effort support across Windows, macOS, and Linux terminal environments
- The host terminal must allow applications to set the visible title (for example, Windows Terminal profiles must not set `suppressApplicationTitle: true`)

## What it does

The extension subscribes to session, agent, and tool lifecycle events, computes the visible title from `session name -> cwd basename -> π`, and writes it through OSC-compatible terminal title updates. It briefly force-reasserts idle titles after key state transitions, and keeps reasserting animated running/ask titles until those states end.

This is a best-effort takeover strategy. It improves title stability, but does not guarantee permanent ownership if your terminal ignores OSC title writes or another tool continuously rewrites the title.

## Local development

```bash
bun install
bun run check
```

## Manual verification

1. Open an interactive terminal host that supports OSC title updates, such as Windows Terminal, iTerm2, or a Linux terminal emulator with application-title support.
2. If you are using Windows Terminal, make sure the active profile does **not** set `suppressApplicationTitle: true`.
3. Start OMP with the local extension path, substituting your own checkout paths:

```bash
bun --cwd <path-to-oh-my-pi>/packages/coding-agent src/cli.ts --extension <path-to-omp-title-icon>
```

4. Start a normal prompt. While the model is responding, the title should alternate between the built-in running frames or keep your configured running prefix.
5. Trigger a compact cycle. While OMP is compacting the session, the title should keep the same running animation or configured running prefix.
6. Use a prompt that triggers the `ask` tool. While the question is waiting for input, the title should start with your configured ask prefix.
7. When the turn is idle again, the title should return to your configured idle prefix.

## Troubleshooting

- If the title never changes, confirm your terminal host supports OSC title updates and allows applications to set the visible title.
- If the title changes briefly and snaps back, check whether your shell profile or prompt module rewrites the title.
- If the visible tab never updates in Windows Terminal, check `suppressApplicationTitle` in the active profile.
- If you want less competition from OMP's built-in auto-title generation, try launching with `PI_NO_TITLE=1`.

## Marketplace note

- Marketplace metadata for `anton1615/omp-title-icon` is checked in at `.claude-plugin/marketplace.json`.
- Current OMP marketplace/plugin-root loading does not activate extension-module plugins that rely only on `package.json -> omp.extensions`.
- Until upstream support exists, load this plugin via `--extension` or an explicit `extensions` setting path.