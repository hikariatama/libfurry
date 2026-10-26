import type { Post, Slot, Settings } from './types';

export interface GridRowLayout {
  height: number;
  width: number;
  ratios: number[];
}

export function reuseGeometrySlots(
  slots: Pick<Slot, 'id' | 'ratio'>[], previous: { id: number; ratio: number }[],
): { id: number; ratio: number }[] {
  if (previous.length === slots.length && slots.every((slot, index) => slot.id === previous[index].id && slot.ratio === previous[index].ratio)) return previous;
  return slots.map(slot => ({ id: slot.id, ratio: slot.ratio }));
}

export function gridGap(columns: number): number {
  return (1 - Math.min(columns, 12) / 12) * 8 + 8;
}

export function gridTileRadius(columns: number): number {
  return Math.max(3, (1 - columns / 12) * 12 + 2.4);
}

export function postRatio(post: Pick<Post, 'width' | 'height'>): number {
  const ratio = (post.width || 1) / Math.max(1, post.height || 1);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function appleTileSize(ratio: number, cellWidth: number): { width: number; height: number } {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return {
    width: cellWidth * Math.min(1, safeRatio),
    height: cellWidth * Math.min(1, 1 / safeRatio),
  };
}

export function gridRowLayouts(slots: Pick<Slot, 'ratio'>[], columns: number, availableWidth: number, gap: number, style: Settings['gridStyle']): GridRowLayout[] {
  const count = Math.ceil(slots.length / columns);
  const cellWidth = (availableWidth - (columns - 1) * gap) / columns;
  return Array.from({ length: count }, (_, row) => {
    const ratios = slots.slice(row * columns, (row + 1) * columns).map(slot => slot.ratio);
    const height = style === 'apple'
      ? Math.max(...ratios.map(ratio => appleTileSize(ratio, cellWidth).height))
      : cellWidth;
    return { height, width: availableWidth, ratios };
  });
}

export function reuseGridRowLayouts(
  slots: Pick<Slot, 'id' | 'ratio'>[], previousSlots: Pick<Slot, 'id' | 'ratio'>[], previous: GridRowLayout[],
  columns: number, availableWidth: number, gap: number, style: Settings['gridStyle'],
): GridRowLayout[] {
  let unchanged = 0;
  while (unchanged < slots.length && unchanged < previousSlots.length &&
    slots[unchanged].id === previousSlots[unchanged].id && slots[unchanged].ratio === previousSlots[unchanged].ratio) unchanged++;
  if (unchanged === slots.length && unchanged === previousSlots.length) return previous;
  const wholeRows = Math.floor(unchanged / columns);
  return previous.slice(0, wholeRows).concat(gridRowLayouts(slots.slice(wholeRows * columns), columns, availableWidth, gap, style));
}
