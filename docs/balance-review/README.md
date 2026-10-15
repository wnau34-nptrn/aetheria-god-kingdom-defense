# Playtest evidence

See [the Thai review](../BALANCE_REVIEW.th.md) for findings, measurements and limits.

- `before-food-fix/`: three complete UI-driven runs at `21b50a6` after the clock/navigation fixes, before food/shelter corrections.
- `after-npc-fix/`: the same three policy types at `80e4cdf`, with food, shelter and fishing corrections. Worlds/events/enemies are unpaired; these six runs are exploratory, not a statistical strategy ranking.
- Each complete run contains `summary.json`, `timeline.jsonl`, `latest.json` and screenshots. Read the phase `metadata.json` for the source hash, viewport, renderer and policy.
- `pre-navigation-fix/`: an interrupted diagnostic playthrough that exposed the river-bank spawn defect, excluded from the six-run comparison.
- `food-only-diagnostic/`: one complete intermediate observation run at `0dec70f`, plus an interrupted economic run. Excluded from the comparison.
- `navigation-*.json`, `food-choice-trial.json`, `fishing-check.json`, `shelter-check.json`: controlled jsdom logic/geometry experiments, with pixels/audio stubbed. These are separate from browser gameplay evidence.
- `metrics.json`, `series.json`, `population-food.svg/png`: summaries and figures derived from the six complete comparison runs.
- `screenshots/landscape-*.png`: real-WebGL HUD regression evidence.

Browser runs use UI input only and read-only API snapshots. They do not establish human fun, final difficulty balance, full-world determinism or hardware GPU performance.
