# Architecture and migration notes

## Current implementation

`src/main.js` loads CSS and the legacy WebGL namespace, then dynamically imports the game with visible startup failure handling. `window.THREE` is a custom compatibility namespace, **not the Three.js package**. `window.AETHERIA_API` remains a development/test interface; it should not become the persistent data model.

The extracted game still uses one IIFE, mutable entity arrays and direct DOM access. Splitting files is preparation, not a completed architectural rewrite. Embedded 2D scene images are still in the legacy game and should later move to named assets with provenance.

The original uploaded HTML is preserved under `original/`, with SHA-256 recorded in `source-provenance.json`. It is useful as a behavioral reference and is not part of the Vite production bundle. The browser audit runner can load it from the development server.

## Proposed boundaries

| Module | Owns | Must not own |
|---|---|---|
| simulation/world | Serializable IDs, resources, positions, health, orders, RNG | DOM nodes, WebGL objects |
| simulation/systems | Economy, needs, combat, waves, progression; fixed simulation delta | Render frame scheduling |
| renderer | Entity-to-mesh mapping, interpolation, lights, camera, resource disposal | Save schema or combat damage |
| input/commands | Mouse/touch/keyboard mapped to validated game commands | Direct mutation of arbitrary entities |
| ui | HUD, events, accessibility, placement feedback | Independent gameplay timers |
| persistence | Schema validation, migration, storage and error reporting | Rebuilding unrelated world state implicitly |

Simulation time freezes during pause and dilemmas; camera and purely cosmetic animation may continue. Do not apply timeScale twice. Use a fixed accumulator with a maximum number of catch-up steps and reset the accumulator after background tab suspension.

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

`npm run build` emits static `dist/`. Vite `base: './'` supports serving from a repository subpath such as GitHub Pages. No backend or remote gameplay service is required. CI validates builds/tests; it does not automatically publish a live site. Repository upload and site hosting are separate actions.
