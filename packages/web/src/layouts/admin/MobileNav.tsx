import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useMemo } from 'react';
import { Nav, SideSheet } from '@douyinfe/semi-ui';
import { Menu as MenuIcon, Search } from 'lucide-react';
import AppLogo from '@/components/AppLogo';
import { useAdminTitle } from '@/admin/runtime';
import { decorateNavItemsWithBadges, type NavItem } from './utils';

// 移动端顶栏（汉堡菜单 + 品牌 + 头部操作区）
export function MobileHeader({
  setMobileNavVisible,
  navigateHome,
  handleNavigateHomeKey,
  mobileHeaderTitle,
  headerActions,
}: Readonly<{
  setMobileNavVisible: Dispatch<SetStateAction<boolean>>;
  navigateHome: () => void;
  handleNavigateHomeKey: (e: React.KeyboardEvent) => void;
  mobileHeaderTitle: string;
  headerActions: ReactNode;
}>) {
  return (
    <header className="admin-mobile-header">
      <button
        type="button"
        className="admin-mobile-header__menu"
        aria-label="打开导航菜单"
        onClick={() => setMobileNavVisible(true)}
      >
        <MenuIcon size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="admin-mobile-header__brand"
        onClick={navigateHome}
        onKeyDown={handleNavigateHomeKey}
      >
        <AppLogo size={26} />
        <span className="admin-mobile-header__title">{mobileHeaderTitle}</span>
      </button>
      {headerActions}
    </header>
  );
}

// 移动端抽屉导航
export function MobileNavSheet({
  mobileNavVisible,
  setMobileNavVisible,
  navigateHome,
  handleNavigateHomeKey,
  navItems,
  currentSelectedKeys,
  openKeys,
  handleSidebarOpenChange,
  renderMobileWrapper,
  showMenuSearch = true,
  toggleIconPosition = 'right',
}: Readonly<{
  mobileNavVisible: boolean;
  setMobileNavVisible: Dispatch<SetStateAction<boolean>>;
  navigateHome: () => void;
  handleNavigateHomeKey: (e: React.KeyboardEvent) => void;
  navItems: NavItem[];
  currentSelectedKeys: string[];
  openKeys: string[];
  handleSidebarOpenChange: (data: { openKeys?: (string | number)[] }) => void;
  renderMobileWrapper: (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => React.ReactNode;
  showMenuSearch?: boolean;
  /** 子菜单展开/收起箭头位置，默认右侧 */
  toggleIconPosition?: 'left' | 'right';
}>) {
  // 未读徽标拼进文字（抽屉恒为展开态）
  const decoratedItems = useMemo(() => decorateNavItemsWithBadges(navItems), [navItems]);
  return (
    <SideSheet
      className="admin-mobile-nav-sheet"
      title={
        <button
          type="button"
          className="admin-mobile-nav-sheet__brand"
          onClick={() => {
            setMobileNavVisible(false);
            navigateHome();
          }}
          onKeyDown={handleNavigateHomeKey}
        >
          <AppLogo size={26} />
          <span><AdminBrandName /></span>
        </button>
      }
      visible={mobileNavVisible}
      onCancel={() => setMobileNavVisible(false)}
      placement="left"
      width="min(86vw, 320px)"
      bodyStyle={{ padding: 0 }}
    >
      {/* 菜单搜索入口：移动端菜单为长手风琴列表，逐级展开查找成本高；
          这里复用桌面端的命令面板（Modal 走 portal，不受抽屉关闭影响） */}
      {showMenuSearch && (
        <button
          type="button"
          className="admin-mobile-nav-sheet__search"
          onClick={() => {
            setMobileNavVisible(false);
            globalThis.dispatchEvent(new CustomEvent('open-menu-palette'));
          }}
        >
          <Search size={15} strokeWidth={1.8} />
          <span>搜索菜单</span>
        </button>
      )}
      <Nav
        className="admin-mobile-nav"
        mode="vertical"
        items={decoratedItems}
        toggleIconPosition={toggleIconPosition}
        selectedKeys={currentSelectedKeys}
        openKeys={openKeys}
        onOpenChange={handleSidebarOpenChange}
        renderWrapper={renderMobileWrapper}
      />
    </SideSheet>
  );
}

function AdminBrandName() { return <>{useAdminTitle()}</>; }
