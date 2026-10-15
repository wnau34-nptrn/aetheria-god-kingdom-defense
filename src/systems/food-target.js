// null means the central store (or no ripe fruit when the store is empty).
// Compare food sources by distance instead of the order trees were generated.
export function chooseFoodTree(agent, food, trees) {
  let closest = null;
  let distance = food >= 2 ? Math.hypot(agent.x, agent.z) : Infinity;
  for (const tree of trees) {
    if (!tree.hasFruit || tree.growth < 0.75) continue;
    const candidate = Math.hypot(tree.x - agent.x, tree.z - agent.z);
    if (candidate < distance) { distance = candidate; closest = tree; }
  }
  return closest;
}
