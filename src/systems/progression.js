// Simulation rules only. Previewing a sandbox scene is a separate operation.
export const MAX_ERA = 4;

export function progressionIssue(state) {
  if (!Number.isInteger(state.civEra) || state.civEra < 1 || state.civEra > MAX_ERA) return 'ข้อมูลยุคไม่ถูกต้อง';
  if (state.civEra === MAX_ERA) return 'อารยธรรมอยู่ในยุคสูงสุดแล้ว';
  if (!Number.isFinite(state.civProgress) || state.civProgress < 100) return `พัฒนายุคเมื่อความก้าวหน้าครบ 100% · ตอนนี้ ${Math.floor(state.civProgress)}%`;
  return null;
}

export function nextCivilization(state) {
  if (progressionIssue(state)) return null;
  const civEra = state.civEra + 1;
  return { civEra, civProgress: civEra === MAX_ERA ? 100 : 0 };
}
