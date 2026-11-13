// Static masonry for the window on the page. Spacing follows app/src/gridLayout.ts.
(() => {
  // Post ID and height / width of each image in media/posts/.
  const posts = [
    [6345112, 0.52], [4855031, 1.768], [5349222, 0.451], [4776847, 1.333], [4750735, 0.52],
    [4712169, 1.717], [4720198, 0.564], [4659316, 0.583], [4136320, 1.277], [4477910, 0.529],
    [4322983, 0.631], [4066634, 1.22], [3019615, 1.587], [4062855, 0.735], [4112137, 1.151],
    [6704736, 1.524], [4590276, 0.54], [4068435, 0.679], [4108245, 1.422], [5232738, 0.575],
  ];
  const focused = 3;
  const grid = document.getElementById('grid');
  const label = document.getElementById('columns');

  const gridGap = columns => (1 - Math.min(columns, 12) / 12) * 8 + 8;
  const gridTileRadius = columns => Math.max(3, (1 - columns / 12) * 12 + 2.4);
  const columnCount = () => innerWidth > 1100 ? 5 : innerWidth > 820 ? 4 : innerWidth > 520 ? 3 : 2;

  let rendered = 0;
  function render() {
    const count = columnCount();
    if (count === rendered) return;
    rendered = count;
    grid.style.setProperty('--gap', `${gridGap(count)}px`);
    grid.style.setProperty('--radius', `${gridTileRadius(count)}px`);
    label.textContent = count;

    const columns = Array.from({ length: count }, () => {
      const column = document.createElement('div');
      column.className = 'column';
      return column;
    });
    const heights = new Array(count).fill(0);
    posts.forEach(([id, ratio], index) => {
      const shortest = heights.indexOf(Math.min(...heights));
      heights[shortest] += ratio + 0.06;
      const tile = document.createElement('div');
      tile.className = index === focused ? 'tile focused' : 'tile';
      tile.style.aspectRatio = String(1 / ratio);
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.addEventListener('load', () => image.classList.add('ready'));
      image.src = `media/posts/${id}.jpg`;
      tile.append(image);
      columns[shortest].append(tile);
    });
    grid.replaceChildren(...columns);
  }

  addEventListener('resize', render);
  render();
})();
