import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlotProbe } from '@/components/rendered-slot';
import { useRenderedSlot } from './useRenderedSlot';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ConditionalAction() {
  const [visible, setVisible] = useState(true);
  return visible ? <button onClick={() => setVisible(false)}>隐藏操作</button> : null;
}

function Toolbar({ mounted = true }: { mounted?: boolean }) {
  const { probeRef, rendered } = useRenderedSlot();
  return <>
    <output data-testid="has-actions">{String(rendered)}</output>
    {mounted && <SlotProbe ref={probeRef}><ConditionalAction /></SlotProbe>}
  </>;
}

describe('useRenderedSlot', () => {
  it('tracks a child returning null without a parent render', async () => {
    render(<StrictMode><Toolbar /></StrictMode>);
    expect(screen.getByTestId('has-actions').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '隐藏操作' }));
    await waitFor(() => expect(screen.getByTestId('has-actions').textContent).toBe('false'));
  });

  it('disconnects the observer when the toolbar unmounts', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const view = render(<Toolbar />);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('tracks probes mounted later and removed after a permission change', () => {
    const view = render(<Toolbar mounted={false} />);
    expect(screen.getByTestId('has-actions').textContent).toBe('false');
    view.rerender(<Toolbar />);
    expect(screen.getByTestId('has-actions').textContent).toBe('true');
    view.rerender(<Toolbar mounted={false} />);
    expect(screen.getByTestId('has-actions').textContent).toBe('false');
  });
});
