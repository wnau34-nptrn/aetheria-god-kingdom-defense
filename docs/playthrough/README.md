# Extended playthrough evidence

Start with [PLAYTHROUGH.th.md](../PLAYTHROUGH.th.md) for the Thai narrative and [SYSTEMS.th.md](../SYSTEMS.th.md) for the existing-system inventory.

- `summary.json`: aggregate measurements, event results and explicit manual era/time-jump inputs.
- `original/metadata.json`: target, viewport and method.
- `original/timeline.jsonl`: chronological snapshots, UI commands, screenshots and errors.
- `original/latest.json`: final state after the paused era-4 night preview.
- `original/screenshots/`: representative states, event menus and effects. Names describe the capture intent; HUD transitions/toasts can still be visible.
- `original-interrupted/`: a separate initial attempt interrupted by the environment connection. Excluded from the main duration and totals.

The extended harness is an observational UI controller, not an unattended regression test. It does not automatically choose strategies. With the dev server running:

```bash
CHROMIUM_PATH=/usr/bin/chromium node tests/session-playthrough.mjs
```

It starts a fresh original-game browser session, records state, and reads newline-separated JSON commands from `/tmp/aetheria-play-actions.jsonl` for up to 25 minutes. Omit `CHROMIUM_PATH` to use a Playwright-installed Chromium. `PLAYTEST_TARGET=current` selects the extracted application. `PLAYTEST_WIDTH`, `PLAYTEST_HEIGHT`, `PLAYTEST_URL`, and `PLAYTEST_COMMANDS` override viewport, server URL and command file.

Example commands appended to that file, one JSON object per line:

```json
{"type":"click","selector":"[data-speed=\"5\"]"}
{"type":"key","key":"h"}
{"type":"screenshot","name":"observed-state"}
{"type":"stop"}
```

All mutations go through UI controls. Read-only API snapshots are used for evidence. World-coordinate targeting is approximate and can fail or be blocked by overlays; these input errors are recorded and must not be reported as game defects without reproduction. Screenshots and on-screen cursor targeting were used to finish spell checks in this review.
