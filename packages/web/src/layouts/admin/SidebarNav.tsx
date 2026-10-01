import { useMemo } from 'react';
import { ConfigProvider, Nav } from '@douyinfe/semi-ui';
import AppLogo from '@/components/AppLogo';
import { useAdminTitle } from '@/admin/runtime';
import { decorateNavItemsWithBadges, type NavItem } from './utils';

// 垂直 / mixed 布局的侧边栏（double 布局见 DoubleSidebar）
export function SidebarNav({
  sidebarClassName,
  onMouseEnter,
  onMouseLeave,
  items,
  effectiveCollapsed,
  currentSelectedKeys,
  openKeys,
  handleSidebarOpenChange,
  handleCollapseChange,
  showBrand,
  navigateHome,
  handleNavigateHomeKey,
  renderWrapper,
  getPopupContainer,
  toggleIconPosition = 'right',
}: Readonly<{
  sidebarClassName: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  items: NavItem[];
  effectiveCollapsed: boolean;
  currentSelectedKeys: string[];
  openKeys: string[];
  handleSidebarOpenChange: (data: { openKeys?: (string | number)[] }) => void;
  handleCollapseChange: (isCollapsed: boolean) => void;
  showBrand: boolean;
  navigateHome: () => void;
  handleNavigateHomeKey: (e: React.KeyboardEvent) => void;
  renderWrapper: (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => React.ReactNode;
  /** 分区深色时把折叠飞出菜单与折叠项 Tooltip 挂进带 .semi-always-dark 的节点 */
  getPopupContainer?: () => HTMLElement;
  /** 子菜单展开/收起箭头位置，默认右侧 */
  toggleIconPosition?: 'left' | 'right';
}>) {
  // 未读徽标：展开态拼在文字后，收起态显示图标红点
  const decoratedItems = useMemo(
    () => decorateNavItemsWithBadges(items, effectiveCollapsed),
    [items, effectiveCollapsed],
  );
  return (
    <aside
      className={sidebarClassName}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <ConfigProvider getPopupContainer={getPopupContainer}>
        <Nav
          className="admin-sidebar__nav"
          mode="vertical"
          items={decoratedItems}
          toggleIconPosition={toggleIconPosition}
          style={{ height: '100%' }}
          bodyStyle={{ paddingTop: 8 }}
          isCollapsed={effectiveCollapsed}
          selectedKeys={currentSelectedKeys}
          openKeys={effectiveCollapsed ? [] : openKeys}
          onOpenChange={handleSidebarOpenChange}
          onCollapseChange={handleCollapseChange}
          header={
            showBrand
              ? {
                  logo: (
                    <button
                      type="button"
                      className="admin-sidebar__brand"
                      onClick={navigateHome}
                      onKeyDown={handleNavigateHomeKey}
                    >
                      <AppLogo size={28} />
                      <span className="admin-sidebar__title"><AdminBrandName /></span>
                    </button>
                  ),
                }
              : undefined
          }
          footer={{
            collapseButton: true,
            collapseText: (isCollapsed) => (isCollapsed ? '展开侧边栏' : '收起侧边栏'),
          }}
          renderWrapper={renderWrapper}
        />
      </ConfigProvider>
    </aside>
  );
}

function AdminBrandName() { return <>{useAdminTitle()}</>; }
