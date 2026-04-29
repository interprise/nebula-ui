import type { UIRow, UITree } from '../../types/ui';

/** True when the view contains an `olapCube` control anywhere in its row tree.
 *  The server reports `viewType: 'query'` for cube views (the cube is a
 *  control inside a query form), so we detect by structure instead. The
 *  Shell uses this to suppress the generic toolbar and the duplicated
 *  view title — the cube renderer carries its own header with export
 *  buttons. */
export function viewHasOlapCube(ui: UITree | undefined): boolean {
  if (!ui) return false;
  return rowsHaveOlapCube(ui.rows);
}

function rowsHaveOlapCube(rows: UIRow[] | undefined): boolean {
  if (!rows) return false;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.control?.type === 'olapCube') return true;
      if (rowsHaveOlapCube(cell.rows)) return true;
      const contentRows = cell.control?.contentRows as UIRow[] | undefined;
      if (rowsHaveOlapCube(contentRows)) return true;
    }
  }
  return false;
}
