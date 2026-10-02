import { useState, useEffect } from 'react';
import { Minus, Square, X } from 'lucide-react';

// 声明 Electron 预加载脚本暴露的 API 类型
declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      onMaximizeChange: (cb: (isMaximized: boolean) => void) => void;
      offMaximizeChange: () => void;
      /** 在线升级：手动触发检查（更新服务器地址由打包配置 / 本机运维文件决定，渲染进程不可改写） */
      updater?: {
        check: () => void;
      };
      isElectron: boolean;
    };
  }
}

/**
 * Electron 自定义标题栏
 * 仅在 Electron 环境下渲染，提供拖拽区、最小化/最大化/关闭按钮
 */
export default function ElectronTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const api = globalThis.window?.electronAPI;

  useEffect(() => {
    if (!api) return;
    api.onMaximizeChange(setIsMaximized);
    return () => api.offMaximizeChange();
  }, [api]);

  // 非 Electron 环境不渲染
  if (!api?.isElectron) return null;

  // macOS 使用系统原生红绿灯，无需自定义按钮
  if (navigator.userAgent.includes('Mac OS')) return null;

  return (
    <div
      className="electron-titlebar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        background: 'var(--color-layout-bg, #f5f5f5)',
        borderBottom: '1px solid var(--semi-color-border)',
        userSelect: 'none',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        WebkitAppRegion: 'drag' as any,
        flexShrink: 0,
        zIndex: 100,
      } as React.CSSProperties}
    >
      {/* 应用名称 */}
      <span style={{ paddingLeft: 12, fontSize: 12, color: 'var(--semi-color-text-1)', fontWeight: 500 }}>
        ArcBase
      </span>

      {/* 窗口控制按钮 */}
      <div
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={{ display: 'flex', WebkitAppRegion: 'no-drag' as any } as React.CSSProperties}
      >
        <button
          type="button"
          title="最小化"
          onClick={() => api.minimize()}
          style={{ width: 46, height: 32, border: 'none', background: 'transparent', color: 'var(--semi-color-text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--semi-color-fill-1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Minus size={12} />
        </button>
        <button
          type="button"
          title={isMaximized ? '还原' : '最大化'}
          onClick={() => api.maximize()}
          style={{ width: 46, height: 32, border: 'none', background: 'transparent', color: 'var(--semi-color-text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--semi-color-fill-1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Square size={isMaximized ? 10 : 12} />
        </button>
        <button
          type="button"
          title="关闭"
          onClick={() => api.close()}
          style={{ width: 46, height: 32, border: 'none', background: 'transparent', color: 'var(--semi-color-text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s, color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#e81123'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--semi-color-text-1)'; }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
