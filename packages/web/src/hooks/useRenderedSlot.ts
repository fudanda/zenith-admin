import { useLayoutEffect, useState, type RefCallback } from 'react';

/**
 * 判断一段节点「实际上」有没有渲染出元素。
 *
 * 工具栏只拿到 ReactNode，看不出 `<ExportButton permission=… />` 这类组件在运行时返回了 null；
 * 单看 `Boolean(node)` 会让移动端出现一个点开是空的「更多操作」菜单。
 * 用 `display: contents` 的探针 span 包住节点（不产生盒子，不影响 Space 的 gap 布局），
 * 首次挂载后测量，并监听子节点变化（包括子组件自行切换为 null 的情况）。
 */
export function useRenderedSlot(): { probeRef: RefCallback<HTMLSpanElement>; rendered: boolean } {
  // A callback ref also handles actions/probes mounted after permissions load.
  const [probe, probeRef] = useState<HTMLSpanElement | null>(null);
  const [rendered, setRendered] = useState(false);
  useLayoutEffect(() => {
    if (!probe) {
      setRendered(false);
      return;
    }
    const measure = () => {
      const next = probe.childElementCount > 0;
      setRendered((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(probe, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [probe]);
  return { probeRef, rendered };
}
