export const ARCBASE_OPERATION_COLUMN_SYMBOL = Symbol('arcbase.operationColumn');

export interface ArcBaseOperationColumnMarker {
  [ARCBASE_OPERATION_COLUMN_SYMBOL]?: true;
}
