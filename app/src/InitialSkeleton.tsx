import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { appleTileSize, gridGap, gridRowLayouts, gridTileRadius } from './gridLayout';
import type { Settings } from './types';

const previewRatios = [1.48, 0.76, 1.22, 0.95, 1.7, 0.83, 1.36, 1.08, 0.68, 1.54, 1.13, 0.88, 1.32, 0.79, 1.61, 1.02];

export function InitialSkeleton({ columns, style }: { columns: number; style: Settings['gridStyle'] }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ width: Math.max(1, window.innerWidth - 32), height: Math.max(1, window.innerHeight - 82) }));

  useLayoutEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize(previous => Math.abs(previous.width - width) > 0.5 || Math.abs(previous.height - height) > 0.5 ? { width, height } : previous);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const gap = gridGap(columns);
  const cellWidth = Math.max(64, (size.width - (columns - 1) * gap) / columns);
  const rowCount = Math.max(5, Math.min(16, Math.ceil(size.height / Math.max(90, cellWidth * 0.85)) + 1));
  const ratios = Array.from({ length: columns * rowCount }, (_, index) => ({
    ratio: previewRatios[(index * 7 + Math.floor(index / columns) * 3) % previewRatios.length],
  }));
  const radius = `${gridTileRadius(columns)}px`;
  const tile = (index: number, height?: number, width?: number) => <span key={index} className="tile-skeleton" aria-hidden="true" style={{
    width, height, '--tile-radius': radius, '--skeleton-delay': `${(index % 17) * -0.07}s`,
  } as CSSProperties} />;

  return <div ref={container} className="initial-skeleton" role="status" aria-label="Loading posts" style={{ '--skeleton-gap': `${gap}px` } as CSSProperties}>
    {style === 'masonry' ? <div className="skeleton-lanes" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: columns }, (_, lane) => <div className="skeleton-lane" key={lane}>
        {Array.from({ length: rowCount }, (_, row) => {
          const index = row * columns + lane;
          return tile(index, cellWidth / ratios[index].ratio);
        })}
      </div>)}
    </div> : gridRowLayouts(ratios, columns, size.width, gap, style).map((row, rowIndex) => <div className="skeleton-row" key={rowIndex} style={{
      height: row.height,
      width: row.width,
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    }}>
      {Array.from({ length: columns }, (_, column) => {
        const index = rowIndex * columns + column;
        if (style !== 'apple') return tile(index);
        const dimensions = appleTileSize(ratios[index].ratio, cellWidth);
        return <span className="skeleton-cell" key={index}>{tile(index, dimensions.height, dimensions.width)}</span>;
      })}
    </div>)}
  </div>;
}
