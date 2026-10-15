# Contributing

Use Node.js 22.12+ and `npm ci`. Read `docs/AUDIT.th.md` and `docs/ARCHITECTURE.md` before changing simulation or rendering.

- Keep the original upload unchanged. Update application code in `src/`.
- Use one simulation time source for gameplay. Camera and cosmetic animation may use real time.
- Keep touch and pointer command ownership explicit.
- Validate saved data before changing the current world. V1 is a checkpoint, not a full save.
- When fixing gameplay bugs, add a regression test that checks observable state or player behavior.
- For render/UI changes, capture desktop/mobile screenshots and inspect them. Measure performance on actual target hardware before making FPS claims.
- Run `npm test`, `npm run build`, and `npm run test:browser` before a PR. A system Chromium can be selected with `CHROMIUM_PATH`.
- Keep credentials, `.env`, build output and `node_modules` out of Git. Record licenses/provenance for new art, audio and models.

A PR should explain the player-visible problem, resulting behavior, relevant screenshots and validation. Keep engine migration separate from content/balance changes so regressions can be isolated.
