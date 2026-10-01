import type { ReactNode } from 'react';
import { ConfigProvider } from '@douyinfe/semi-ui';
import AppLogo from '@/components/AppLogo';
import { useAdminTitle } from '@/admin/runtime';
import type { NavLayout } from '@/hooks/usePreferences';
import { TopNavWithOverflow } from '../TopNavWithOverflow';
import type { NavItem } from './utils';

// Top bar for horizontal and mixed layouts
export function TopBar({
  showLogo,
  navigateHome,
  handleNavigateHomeKey,
  navLayout,
  mixedTopNavItems,
  navItems,
  topNavSelectedKeys,
  renderWrapper,
  handleMixedTopSelect,
  headerActions,
  darkClassName = '',
  getPopupContainer,
}: Readonly<{
  showLogo: boolean;
  navigateHome: () => void;
  handleNavigateHomeKey: (e: React.KeyboardEvent) => void;
  navLayout: NavLayout;
  mixedTopNavItems: Pick<NavItem, 'itemKey' | 'text' | 'icon' | 'isExternal' | 'badge'>[];
  navItems: NavItem[];
  topNavSelectedKeys: string[];
  renderWrapper: (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => React.ReactNode;
  handleMixedTopSelect: (data: { itemKey: string | number }) => void;
  headerActions: ReactNode;
  /** 分区深色时挂到顶栏根元素的 Semi 局部暗色类名（含前导空格） */
  darkClassName?: string;
  /** 分区深色时把导航子菜单与「更多」溢出菜单挂进带 .semi-always-dark 的节点。
   *  仅包裹导航本身：头部功能面板（消息、公告、用户菜单等）保持全局配色 */
  getPopupContainer?: () => HTMLElement;
}>) {
  return (
    <header className={`admin-topbar${darkClassName}`}>
      {showLogo && (
        <button
          type="button"
          className="admin-topbar__brand"
          style={{ cursor: 'pointer', background: 'transparent', border: 0, padding: 0, font: 'inherit', color: 'inherit' }}
          onClick={navigateHome}
          onKeyDown={handleNavigateHomeKey}
        >
          <AppLogo size={28} />
          <span className="admin-sidebar__title"><AdminBrandName /></span>
        </button>
      )}
      <ConfigProvider getPopupContainer={getPopupContainer}>
        <TopNavWithOverflow
          className="admin-topbar__nav"
          ariaLabel={navLayout === 'mixed' ? '分类导航' : '主导航'}
          items={navLayout === 'mixed' ? mixedTopNavItems : navItems}
          selectedKeys={topNavSelectedKeys}
          renderWrapper={renderWrapper}
          onItemClick={navLayout === 'mixed' ? (key) => handleMixedTopSelect({ itemKey: key }) : undefined}
        />
      </ConfigProvider>
      {headerActions}
    </header>
  );
}

function AdminBrandName() { return <>{useAdminTitle()}</>; }
