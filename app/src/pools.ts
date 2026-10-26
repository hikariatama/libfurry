export function parsePoolIds(value: string | number[] | null | undefined): number[] {
  const tokens = Array.isArray(value) ? value.map(String) : String(value || '').split(/[\s,;]+/);
  const ids = new Set<number>();
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) continue;
    const id = Number(token);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}
