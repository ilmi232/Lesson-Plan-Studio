// Table row/column operations that respect merged cells (colspan/rowspan).
// DOM order (row.cells index) is not the visual column once cells are merged, so every
// operation works on a grid where grid[row][col] is the cell covering that slot.

type Cell = HTMLTableCellElement;

interface TableGrid {
  grid: Cell[][];
  pos: Map<Cell, { row: number; col: number }>;
  width: number;
}

export function buildGrid(table: HTMLTableElement): TableGrid {
  const rows = Array.from(table.rows);
  const grid: Cell[][] = rows.map(() => []);
  const pos = new Map<Cell, { row: number; col: number }>();
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (grid[r][c]) c++;
      pos.set(cell, { row: r, col: c });
      // rowspan="0" means "to the end of the section"; treat it as 1 like most editors
      const rowSpan = Math.min(Math.max(1, cell.rowSpan), rows.length - r);
      const colSpan = Math.max(1, cell.colSpan);
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) grid[r + dr][c + dc] = cell;
      }
      c += colSpan;
    }
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  return { grid, pos, width };
}

function span(cell: Cell) {
  return { rows: Math.max(1, cell.rowSpan), cols: Math.max(1, cell.colSpan) };
}

function emptyCellLike(cell: Cell): Cell {
  const fresh = cell.cloneNode(false) as Cell;
  fresh.removeAttribute("id");
  fresh.removeAttribute("rowspan");
  fresh.removeAttribute("colspan");
  fresh.innerHTML = "<br>";
  return fresh;
}

// Colgroup widths (added by the column resizer) must stay in sync with the column count.
function simpleCols(table: HTMLTableElement, width: number): HTMLTableColElement[] | null {
  const cols = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
  return cols.length === width && cols.every((c) => c.span === 1) ? cols : null;
}

// Tailwind width utilities, with optional variant prefixes (md:w-1/2, print:w-full)
const WIDTH_CLASS = /^(?:[\w-]+:)*(?:w|min-w|max-w)-/;

function stripWidthConstraints(el: HTMLElement) {
  el.style.removeProperty("width");
  el.style.removeProperty("min-width");
  el.style.removeProperty("max-width");
  el.removeAttribute("width");
  Array.from(el.classList).forEach((c) => { if (WIDTH_CLASS.test(c)) el.classList.remove(c); });
  if (!el.getAttribute("class")) el.removeAttribute("class");
  if (!el.getAttribute("style")) el.removeAttribute("style");
}

// AI tables set widths in ways that fight the column resizer: percent <col>s (read as px),
// <col span>, w-1/4 classes or width attributes on cells, colspan in the first row.
// Replace all of that with the widths as rendered right now, as percentages on a fresh
// <colgroup> (percent, not px, so the table still fits the narrower print area).
// Returns the <col> per visual column.
export function freezeColumnWidths(table: HTMLTableElement): HTMLTableColElement[] {
  const { pos, width } = buildGrid(table);
  const cells = Array.from(pos.keys());
  const measured: (number | null)[] = Array(width).fill(null);
  for (const cell of cells) {
    const { col } = pos.get(cell)!;
    if (span(cell).cols === 1 && measured[col] === null) measured[col] = cell.getBoundingClientRect().width;
  }
  // Columns covered only by merged cells: split what remains of the merged cell's width
  for (const cell of cells) {
    const { col } = pos.get(cell)!;
    const range = Array.from({ length: span(cell).cols }, (_, i) => col + i).filter((c) => c < width);
    const unknown = range.filter((c) => measured[c] === null);
    if (unknown.length === 0) continue;
    const known = range.reduce((sum, c) => sum + (measured[c] ?? 0), 0);
    const share = Math.max(20, (cell.getBoundingClientRect().width - known) / unknown.length);
    unknown.forEach((c) => (measured[c] = share));
  }
  const pixels = measured.map((w) => w ?? 20);
  const total = pixels.reduce((a, b) => a + b, 0) || 1;

  // Keep the table's current size relative to its container, so fixed layout has a real width
  const parent = table.parentElement;
  if (parent) {
    const cs = parent.ownerDocument.defaultView!.getComputedStyle(parent);
    const inner = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const pct = inner > 0 ? (table.getBoundingClientRect().width / inner) * 100 : 100;
    stripWidthConstraints(table);
    table.style.width = pct >= 99 ? "100%" : `${pct.toFixed(2)}%`;
  }
  table.style.tableLayout = "fixed";

  table.querySelectorAll(":scope > colgroup").forEach((g) => g.remove());
  const doc = table.ownerDocument;
  const group = doc.createElement("colgroup");
  const cols = pixels.map((px) => {
    const col = doc.createElement("col");
    col.style.width = `${((px / total) * 100).toFixed(2)}%`;
    group.appendChild(col);
    return col;
  });
  if (table.caption) table.caption.after(group);
  else table.prepend(group);

  cells.forEach(stripWidthConstraints);
  return cols;
}

export function insertColumnAfter(table: HTMLTableElement, cell: Cell) {
  const { grid, pos, width } = buildGrid(table);
  const target = pos.get(cell)!.col + span(cell).cols - 1;
  const handled = new Set<Cell>();
  grid.forEach((row, r) => {
    const current = row[target];
    if (!current || handled.has(current)) return;
    handled.add(current);
    const start = pos.get(current)!;
    if (start.col + span(current).cols - 1 > target) {
      current.colSpan = span(current).cols + 1; // merged cell straddles the new column
    } else if (start.row === r) {
      const fresh = emptyCellLike(current);
      if (span(current).rows > 1) fresh.rowSpan = span(current).rows;
      current.after(fresh);
    }
  });
  const cols = simpleCols(table, width);
  if (cols) cols[target].after(cols[target].cloneNode(false));
}

function deleteColumn(table: HTMLTableElement, col: number) {
  const { grid, width } = buildGrid(table);
  const cols = simpleCols(table, width);
  const handled = new Set<Cell>();
  for (const row of grid) {
    const current = row[col];
    if (!current || handled.has(current)) continue;
    handled.add(current);
    if (span(current).cols > 1) current.colSpan = span(current).cols - 1;
    else current.remove();
  }
  cols?.[col].remove();
}

// Deletes every column the selected cell spans. Returns false if the table became empty.
export function deleteColumns(table: HTMLTableElement, cell: Cell): boolean {
  const { pos } = buildGrid(table);
  const start = pos.get(cell)!.col;
  for (let c = start + span(cell).cols - 1; c >= start; c--) deleteColumn(table, c);
  // Rows left without cells go through deleteRow so rowspans crossing them shrink too
  for (let r = table.rows.length - 1; r >= 0; r--) {
    if (table.rows[r].cells.length === 0) deleteRow(table, r);
  }
  return buildGrid(table).width > 0;
}

export function insertRowAfter(table: HTMLTableElement, cell: Cell) {
  const { grid, pos, width } = buildGrid(table);
  const target = pos.get(cell)!.row + span(cell).rows - 1;
  const targetRow = table.rows[target];
  const newRow = targetRow.cloneNode(false) as HTMLTableRowElement;
  const handled = new Set<Cell>();
  for (let c = 0; c < width; c++) {
    const current = grid[target][c];
    if (!current || handled.has(current)) continue;
    handled.add(current);
    const start = pos.get(current)!;
    if (start.row + span(current).rows - 1 > target) {
      current.rowSpan = span(current).rows + 1; // merged cell continues through the new row
    } else {
      const fresh = emptyCellLike(current);
      if (span(current).cols > 1) fresh.colSpan = span(current).cols;
      newRow.appendChild(fresh);
    }
  }
  targetRow.after(newRow);
}

function deleteRow(table: HTMLTableElement, r: number) {
  const { grid, pos, width } = buildGrid(table);
  const row = table.rows[r];
  const nextRow = table.rows[r + 1] as HTMLTableRowElement | undefined;
  const handled = new Set<Cell>();
  for (let c = 0; c < width; c++) {
    const current = grid[r][c];
    if (!current || handled.has(current)) continue;
    handled.add(current);
    const start = pos.get(current)!;
    const rows = span(current).rows;
    if (rows === 1) continue; // removed together with the row
    current.rowSpan = rows - 1;
    if (start.row === r && nextRow) {
      // Cell starts in the deleted row but continues below: move it down, keeping its column position
      const before = Array.from(nextRow.cells).find((other) => {
        const p = pos.get(other)!;
        return p.row === r + 1 && p.col > start.col;
      });
      nextRow.insertBefore(current, before ?? null);
    }
  }
  row.remove();
}

// Deletes every row the selected cell spans. Returns false if the table became empty.
export function deleteRows(table: HTMLTableElement, cell: Cell): boolean {
  const { pos } = buildGrid(table);
  const start = pos.get(cell)!.row;
  for (let r = start + span(cell).rows - 1; r >= start; r--) deleteRow(table, r);
  return table.rows.length > 0;
}
