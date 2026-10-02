import { forwardRef, type ReactNode } from 'react';

/** `useRenderedSlot` 的探针容器：`display: contents`，子元素照常参与父级布局 */
export const SlotProbe = forwardRef<HTMLSpanElement, { children?: ReactNode }>(function SlotProbe({ children }, ref) {
  return <span ref={ref} style={{ display: 'contents' }}>{children}</span>;
});
