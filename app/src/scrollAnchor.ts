export function nearestSurvivingId(
  previous: { id: number }[], anchorId: number | null, available: Set<number>,
): number | null {
  if (anchorId !== null && available.has(anchorId)) return anchorId;
  const index = anchorId === null ? -1 : previous.findIndex(slot => slot.id === anchorId);
  for (let next = index + 1; next < previous.length; next++) {
    if (available.has(previous[next].id)) return previous[next].id;
  }
  for (let prior = index - 1; prior >= 0; prior--) {
    if (available.has(previous[prior].id)) return previous[prior].id;
  }
  return available.values().next().value ?? null;
}
