import { resourceKeyOf, type AnyOperation, type InputOf } from './contract';

/** Contract-derived cache identity; request headers are not resource identity. */
export function contractKey<Op extends AnyOperation>(op: Op, input?: Partial<InputOf<Op>>): readonly unknown[] {
  if (input === undefined) return [resourceKeyOf(op.basePath), op.name];
  const { headers: _headers, ...identity } = input as object & { headers?: unknown };
  return [resourceKeyOf(op.basePath), op.name, identity];
}
