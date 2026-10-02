import { useCallback, useMemo, useReducer } from 'react';
import type { CellPos, SelectionAction, SelectionSnapshot, SelectionState } from './types';
import { clamp } from '@arcbase/shared/core';

export const EMPTY_SELECTION: SelectionState = {
  anchor: null,
  focus: null,
  discrete: new Set<string>(),
  rows: new Set<number>(),
  rowAnchor: null,
};

export function cellKey(pos: CellPos): string {
  return `${pos.row}:${pos.col}`;
}

function samePos(a: CellPos | null, b: CellPos | null): boolean {
  return a !== null && b !== null && a.row === b.row && a.col === b.col;
}

/** 区域选区归一化矩形 */
export function selectionRect(
  state: SelectionState,
): { r1: number; r2: number; c1: number; c2: number } | null {
  if (!state.anchor || !state.focus) return null;
  return {
    r1: Math.min(state.anchor.row, state.focus.row),
    r2: Math.max(state.anchor.row, state.focus.row),
    c1: Math.min(state.anchor.col, state.focus.col),
    c2: Math.max(state.anchor.col, state.focus.col),
  };
}

/** 判断单元格是否被选中（渲染高亮用） */
export function isCellSelected(state: SelectionState, row: number, col: number): boolean {
  if (state.rows.has(row)) return true;
  if (state.discrete.size > 0) return state.discrete.has(`${row}:${col}`);
  const rect = selectionRect(state);
  if (!rect) return false;
  return row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2;
}

/**
 * 单行选中状态签名：仅当行的高亮外观变化时才变化，供行组件 memo 比较。
 * 格式紧凑即可，不要求可读。
 */
export function rowSelectionSignature(state: SelectionState, row: number, colCount: number): string {
  if (state.rows.has(row)) return 'R';
  let sig = '';
  if (state.discrete.size > 0) {
    for (let c = 0; c < colCount; c++) {
      if (state.discrete.has(`${row}:${c}`)) sig += `${c},`;
    }
  } else {
    const rect = selectionRect(state);
    if (rect && row >= rect.r1 && row <= rect.r2) sig = `g${rect.c1}-${rect.c2}`;
  }
  if (state.anchor?.row === row) sig += `|a${state.anchor.col}`;
  return sig;
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'cellMouseDown': {
      const { pos, shift, ctrl } = action;
      if (ctrl) {
        // Ctrl 离散选择：把现有区域并入离散集，再 toggle 当前格
        const discrete = new Set(state.discrete);
        if (discrete.size === 0) {
          const rect = selectionRect(state);
          if (rect) {
            for (let r = rect.r1; r <= rect.r2; r++) {
              for (let c = rect.c1; c <= rect.c2; c++) discrete.add(`${r}:${c}`);
            }
          }
        }
        const key = cellKey(pos);
        if (discrete.has(key)) discrete.delete(key);
        else discrete.add(key);
        return { ...state, discrete, rows: new Set(), rowAnchor: null, anchor: pos, focus: pos };
      }
      if (shift && state.anchor) {
        return { ...state, focus: pos, discrete: new Set(), rows: new Set(), rowAnchor: null };
      }
      return { anchor: pos, focus: pos, discrete: new Set(), rows: new Set(), rowAnchor: null };
    }
    case 'cellDragOver': {
      if (!state.anchor || samePos(state.focus, action.pos)) return state;
      return { ...state, focus: action.pos, discrete: new Set(), rows: new Set() };
    }
    case 'rowClick': {
      const { row, shift, ctrl } = action;
      const rows = new Set(state.rows);
      if (shift && state.rowAnchor !== null) {
        const [lo, hi] = state.rowAnchor <= row ? [state.rowAnchor, row] : [row, state.rowAnchor];
        if (!ctrl) rows.clear();
        for (let r = lo; r <= hi; r++) rows.add(r);
        return { ...EMPTY_SELECTION, rows, rowAnchor: state.rowAnchor };
      }
      if (ctrl) {
        if (rows.has(row)) rows.delete(row);
        else rows.add(row);
        return { ...EMPTY_SELECTION, rows, rowAnchor: row };
      }
      if (rows.size === 1 && rows.has(row)) {
        return { ...EMPTY_SELECTION };
      }
      return { ...EMPTY_SELECTION, rows: new Set([row]), rowAnchor: row };
    }
    case 'move': {
      const { dRow, dCol, shift, rowCount, colCount } = action;
      if (rowCount === 0 || colCount === 0) return state;
      const base = (shift ? state.focus : state.anchor) ?? state.anchor ?? { row: 0, col: 0 };
      const next: CellPos = {
        row: clamp(base.row + dRow, 0, rowCount - 1),
        col: clamp(base.col + dCol, 0, colCount - 1),
      };
      if (shift) {
        const anchor = state.anchor ?? next;
        return { ...state, anchor, focus: next, discrete: new Set(), rows: new Set(), rowAnchor: null };
      }
      return { anchor: next, focus: next, discrete: new Set(), rows: new Set(), rowAnchor: null };
    }
    case 'moveTo': {
      if (action.shift && state.anchor) {
        return { ...state, focus: action.pos, discrete: new Set(), rows: new Set(), rowAnchor: null };
      }
      return { anchor: action.pos, focus: action.pos, discrete: new Set(), rows: new Set(), rowAnchor: null };
    }
    case 'selectAll': {
      const rows = new Set<number>();
      for (let r = 0; r < action.rowCount; r++) rows.add(r);
      return { ...EMPTY_SELECTION, rows, rowAnchor: 0 };
    }
    case 'ensureCellSelected': {
      // 右键时：若目标格已在选区内则保持，否则改选单格
      if (isCellSelected(state, action.pos.row, action.pos.col)) return state;
      return { anchor: action.pos, focus: action.pos, discrete: new Set(), rows: new Set(), rowAnchor: null };
    }
    case 'clear':
      return { ...EMPTY_SELECTION };
    default:
      return state;
  }
}

/** 轻量计算选区单元格数（不构建矩阵，供状态条实时展示） */
export function selectionCellCount(state: SelectionState, colCount: number): number {
  if (state.rows.size > 0) return state.rows.size * colCount;
  if (state.discrete.size > 0) return state.discrete.size;
  const rect = selectionRect(state);
  if (!rect) return 0;
  return (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
}

/** 导出选区快照（行升序、列升序） */
export function buildSelectionSnapshot(state: SelectionState, colCount: number): SelectionSnapshot {
  if (state.rows.size > 0) {
    const rowIndexes = Array.from(state.rows).sort((a, b) => a - b);
    const matrix = rowIndexes.map((row) => {
      const line: CellPos[] = [];
      for (let c = 0; c < colCount; c++) line.push({ row, col: c });
      return line;
    });
    return { mode: 'rows', rowIndexes, matrix, cellCount: rowIndexes.length * colCount };
  }
  if (state.discrete.size > 0) {
    const byRow = new Map<number, number[]>();
    for (const key of state.discrete) {
      const [r, c] = key.split(':').map(Number);
      const arr = byRow.get(r) ?? [];
      arr.push(c);
      byRow.set(r, arr);
    }
    const rowIndexes = Array.from(byRow.keys()).sort((a, b) => a - b);
    const matrix = rowIndexes.map((row) =>
      (byRow.get(row) ?? []).sort((a, b) => a - b).map((col) => ({ row, col })));
    return { mode: 'cells', rowIndexes, matrix, cellCount: state.discrete.size };
  }
  const rect = selectionRect(state);
  if (rect) {
    const rowIndexes: number[] = [];
    const matrix: CellPos[][] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      rowIndexes.push(r);
      const line: CellPos[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) line.push({ row: r, col: c });
      matrix.push(line);
    }
    return {
      mode: 'cells',
      rowIndexes,
      matrix,
      cellCount: (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1),
    };
  }
  return { mode: 'none', rowIndexes: [], matrix: [], cellCount: 0 };
}

/** 选区 hook：包装 reducer 并派生常用量 */
export function useGridSelection() {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION, () => ({ ...EMPTY_SELECTION }));

  const activeCell = state.anchor;
  const hasSelection = useMemo(
    () => state.rows.size > 0 || state.discrete.size > 0 || state.anchor !== null,
    [state],
  );

  const snapshot = useCallback(
    (colCount: number) => buildSelectionSnapshot(state, colCount),
    [state],
  );

  return { state, dispatch, activeCell, hasSelection, snapshot };
}
