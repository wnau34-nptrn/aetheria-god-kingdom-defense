// V1 is a progress checkpoint, not a full world snapshot.
export const PROGRESS_KEY = 'AETHERIA_CIV_SAVE_V1';
export function parseProgress(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const ranges = {
      day: [1, 1000000], timeOfDay: [0, 24], civEra: [1, 4], civProgress: [0, 100],
      food: [0, 1e9], wood: [0, 1e9], ore: [0, 1e9], faith: [0, 200]
    };
    const result = {};
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = data[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null;
      if ((key === 'day' || key === 'civEra') && !Number.isInteger(value)) return null;
      if (key === 'timeOfDay' && value === 24) return null;
      result[key] = value;
    }
    return result;
  } catch { return null; }
}
