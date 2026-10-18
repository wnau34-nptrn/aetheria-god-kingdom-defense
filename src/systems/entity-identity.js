// Session identities are independent of meshes and survive normal progression.
// Restoring allocator state from a world snapshot belongs to Save V2.
export function createEntityIdentity() {
  let sequence = 0;
  return {
    assign(entity) {
      if (!Object.hasOwn(entity, 'entityId')) {
        Object.defineProperty(entity, 'entityId', { value: `entity-${++sequence}`, enumerable: true });
      }
      return entity;
    }
  };
}
