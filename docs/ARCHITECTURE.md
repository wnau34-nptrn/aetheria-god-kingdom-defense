# Architecture and migration notes

## Current implementation

`src/main.js` loads CSS and the legacy WebGL namespace, then dynamically imports the game with visible startup failure handling. `window.THREE` is a custom compatibility namespace, **not the Three.js package**. `window.AETHERIA_API` remains a development/test interface; it should not become the persistent data model.

Gameplay now advances in fixed 50ms ticks via `src/systems/fixed-step.js`, with AI goals using simulation time. Day/night presentation is separate from clock/damage updates so it can render while paused. The legacy 50ms frame clamp and real-time cosmetic/event interval behavior remain. See `SPEED_REVIEW.th.md` for controlled-test results and limits.

`src/systems/food-target.js` compares nearby ripe fruit against the central store when it can provide a meal. It is a pure decision helper with no DOM or mesh dependency. River-bank spawn correction and bridge routing remain in the legacy movement code; they are targeted fixes rather than a complete navigation system. See `BALANCE_REVIEW.th.md` for browser evidence and controlled reproductions.

Shelter selection excludes completed houses inside the river walking restriction unless they are on a bridge deck, with the existing temple fallback when none qualify. It does not compute full path reachability. Fishing targets use the same river-bank boundary as walking. Bridge-deck access is shared by spawning and shelter selection.

The extracted game still uses one IIFE, mutable entity arrays and direct DOM access. Splitting files is preparation, not a completed architectural rewrite. Embedded 2D scene images are still in the legacy game and should later move to named assets with provenance.

Normal progression now uses pure rules in `systems/progression.js` and never repopulates the world. Sandbox preview and V1 checkpoint restoration retain their explicit scene-building path. Selectable entities receive immutable, serializable session `entityId`s from `systems/entity-identity.js`, separate from numeric agent IDs; buildings record their construction era. Actual bridge/site layout controls navigation and reserved footprints rather than inferring infrastructure from the current era. Full snapshot restoration and allocator persistence remain Save V2 work. See [ERA_CONTINUITY.th.md](ERA_CONTINUITY.th.md).

The original uploaded HTML is preserved under `original/`, with SHA-256 recorded in `source-provenance.json`. It is useful as a behavioral reference and is not part of the Vite production bundle. The browser audit runner can load it from the development server.

## Proposed boundaries

The current product sequence is documented in [ROADMAP.th.md](ROADMAP.th.md), based on the [October 18 system review](CURRENT_REVIEW.th.md). Extract serializable entity identity, progression and world persistence first, then add orders/threat state and contextual DOM HUDs. Existing economy and combat helpers remain the starting point. Treat render migration as a separate parity spike rather than a prerequisite for issuing army orders.

| Module | Owns | Must not own |
|---|---|---|
| simulation/world | Serializable IDs, resources, positions, health, orders, RNG | DOM nodes, WebGL objects |
| simulation/systems | Economy, needs, combat, waves, progression; fixed simulation delta | Render frame scheduling |
| renderer | Entity-to-mesh mapping, interpolation, lights, camera, resource disposal | Save schema or combat damage |
| input/commands | Mouse/touch/keyboard mapped to validated game commands | Direct mutation of arbitrary entities |
| ui | HUD, events, accessibility, placement feedback | Independent gameplay timers |
| persistence | Schema validation, migration, storage and error reporting | Rebuilding unrelated world state implicitly |

Army orders, formation slots, phase classification and local civilian danger are pure helpers in `systems/battle.js`; `ui/army-controls.js` owns group IDs, HUD overrides and camera bookmarks, while `render/army-view.js` pools selection/destination rings. Legacy movement/combat execute the accepted orders. This does not add a full navigation mesh or bridge reservation queue. See [ARMY_RTS.th.md](ARMY_RTS.th.md).

Simulation time freezes during pause and full-story dilemmas (also peacetime compact cards); compact battle cards retain the current speed and focus; camera and purely cosmetic animation may continue. Do not apply timeScale twice. The accumulator bounds frame delta and step count and clears pending debt on pause; background tab suspension cannot trigger a large catch-up burst. Further extraction into serializable world systems is still pending.

## Three.js migration hazards

A script tag or `npm install three` alone is insufficient:

- Custom `BufferGeometry.index` is a raw `Uint32Array`; real Three.js uses a BufferAttribute with `.array` and `.count`. Audit every direct access and baking helper.
- The shim uses Vector3 for rotation. Three.js uses Euler. `Object3D` hierarchy and transform/normal semantics need image comparisons for baked objects.
- Replace `sRGBEncoding` with the chosen release's color-space API; review colors as linear vs sRGB and tone mapping together.
- Real geometry raycasting returns actual triangles; the shim approximates terrain and entity selection. Pick through invisible/group wrappers deliberately and test building/agent selection after each port.
- A real `IcosahedronGeometry` is not the shim's `SphereGeometry` alias. Constructor arguments and visuals can differ.
- Shader material classification by color is custom. Standard materials will need explicit roughness/metalness/textures, lights and environment setup.
- Migrate shared geometry/material ownership before disposing anything on entity deletion. Use asset-level retain/release or a resource registry; shared trees cannot each dispose the same geometry.
- Preserve terrain sampling for AI and placement independently of render meshes.

Port a representative terrain patch, house, tree, villager and spell into a separate branch; compare screenshots and picking, then validate a complete day/night cycle. Keep the current prototype running until parity is established.

## Performance strategy

Profile CPU and GPU separately. Record browser/hardware, resolution, device pixel ratio, preset, entity counts, draw calls, triangles and frame-time percentiles. SwiftShader screenshots prove that rendering starts, not hardware performance.

Use instancing for repeated foliage/props, spatial indexing for AI neighbors, dirty/low-frequency HUD and minimap updates, pooled effects, explicit disposal and bounded render quality. Decide budgets from measured devices. Do not add heavy ambient occlusion, volumetrics and high-resolution shadows simultaneously.

## Hosting

`npm run build` emits static `dist/`. Vite `base: './'` supports serving from a repository subpath such as GitHub Pages. No backend or remote gameplay service is required. The current CI validates builds/tests and production-path smoke checks, deploys successful `main` builds to Pages, then verifies the hosted game against the expected commit. See [PAGES.th.md](PAGES.th.md).
