import type { CSSProperties, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFormField } from '@arcbase/shared/workflow';

interface MockDropdownProps {
  readonly children?: ReactNode;
  readonly render?: ReactNode | (() => ReactNode);
  readonly visible?: boolean;
  readonly trigger?: string;
  readonly position?: string;
  readonly autoAdjustOverflow?: boolean;
  readonly clickToHide?: boolean;
  readonly rePosKey?: string | number;
  readonly getPopupContainer?: () => HTMLElement;
  readonly onClickOutSide?: () => void;
  readonly onVisibleChange?: (visible: boolean) => void;
}

interface MockMenuProps {
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
}

interface MockItemProps {
  readonly children?: ReactNode;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly type?: string;
  readonly onClick?: () => void;
}

const dropdownState = vi.hoisted(() => ({
  calls: [] as MockDropdownProps[],
}));

vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  const React = await import('react');

  const MockDropdown = (props: MockDropdownProps) => {
    if (props.rePosKey !== undefined) dropdownState.calls.push(props);
    const content = typeof props.render === 'function' ? props.render() : props.render;
    return React.createElement(React.Fragment, null, props.children, props.visible ? content : null);
  };
  MockDropdown.Menu = ({ children, style }: MockMenuProps) => React.createElement('ul', { role: 'menu', style }, children);
  MockDropdown.Item = ({ children, icon, disabled, type, onClick }: MockItemProps) => React.createElement(
    'li',
    null,
    React.createElement('button', { type: 'button', disabled, onClick, 'data-dropdown-type': type }, icon, children),
  );
  MockDropdown.Divider = () => React.createElement('li', { role: 'separator' });

  return { ...actual, Dropdown: MockDropdown };
});

import FormDesigner from './FormDesigner';

const fields: WorkflowFormField[] = [
  { key: 'name', label: '姓名', type: 'text' },
];

function latestContextMenuProps(): MockDropdownProps {
  const props = dropdownState.calls.at(-1);
  if (!props) throw new Error('context menu was not rendered');
  return props;
}

describe('FormDesigner context menu', () => {
  beforeEach(() => {
    dropdownState.calls.length = 0;
  });

  it('uses viewport-aware positioning and keeps menu actions intact', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FormDesigner fields={fields} onChange={onChange} showToolbar={false} />,
    );
    const field = container.querySelector<HTMLElement>('[data-field-key="name"]');
    expect(field).not.toBeNull();

    fireEvent.contextMenu(field as HTMLElement, { clientX: 998, clientY: 742 });

    const firstProps = latestContextMenuProps();
    expect(firstProps).toMatchObject({
      visible: true,
      trigger: 'click',
      position: 'bottomLeft',
      autoAdjustOverflow: true,
      clickToHide: true,
      rePosKey: 'name:998:742',
    });
    expect(firstProps.getPopupContainer?.()).toBe(document.body);

    const menu = screen.getByRole('menu');
    expect(menu).toHaveStyle({ overflowY: 'auto' });
    // jsdom 30 起 getComputedStyle 会对 calc() 求值，断言内联声明以免耦合默认视口高度
    expect(menu.style.maxHeight).toBe('calc(100vh - 16px)');
    const menuQueries = within(menu);
    expect(menuQueries.getByRole('button', { name: '上移' })).toBeInTheDocument();
    expect(menuQueries.getByRole('button', { name: '下移' })).toBeInTheDocument();
    expect(menuQueries.getByRole('button', { name: /复制 Ctrl\+C/ })).toBeInTheDocument();
    expect(menuQueries.getByRole('button', { name: /粘贴到其后 Ctrl\+V/ })).toBeDisabled();
    expect(menuQueries.getByRole('button', { name: '创建副本' })).toBeInTheDocument();
    expect(menuQueries.getByRole('button', { name: '存为我的模板' })).toBeInTheDocument();
    expect(menuQueries.getByRole('button', { name: '设为必填' })).toBeInTheDocument();
    expect(menuQueries.getByRole('button', { name: /删除 Del/ })).toHaveAttribute('data-dropdown-type', 'danger');

    fireEvent.contextMenu(field as HTMLElement, { clientX: 240, clientY: 180 });
    expect(latestContextMenuProps().rePosKey).toBe('name:240:180');

    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: '设为必填' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'name', required: true }),
    ]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
