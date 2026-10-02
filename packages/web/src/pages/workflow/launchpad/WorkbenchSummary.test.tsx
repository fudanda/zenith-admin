import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { workflowInstanceContract } from '@arcbase/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import WorkbenchSummary from './WorkbenchSummary';

const SUMMARY_URL = workflowInstanceContract.workbenchSummary.fullPath;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderSummary() {
  const qc = createTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/workflow/launchpad']}>
        <Routes>
          <Route path="*" element={<><WorkbenchSummary /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  recorder.reset();
});

describe('WorkbenchSummary', () => {
  it('renders one card per permitted metric, flags overdue pending tasks and keeps zero cards visible', async () => {
    recorder.on('GET', SUMMARY_URL, { pending: 12, pendingOverdue: 3, consultsPending: 0, ccUnread: 5, myReturned: 1, myDrafts: 2, myRunning: 4 });
    renderSummary();
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());

    expect(screen.getByText('待我审批')).toBeTruthy();
    expect(screen.getByText('超时 3')).toBeTruthy();
    // 0 不隐藏卡片
    expect(screen.getByText('待我协办')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('hides metrics the server returned as null (no permission) and navigates on click', async () => {
    recorder.on('GET', SUMMARY_URL, { pending: null, pendingOverdue: null, consultsPending: null, ccUnread: 0, myReturned: 1, myDrafts: 0, myRunning: 2 });
    renderSummary();
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(4));

    expect(screen.getByText('退回待修改')).toBeTruthy();
    expect(screen.queryByText('待我审批')).toBeNull();
    expect(screen.queryByText('待我协办')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /退回待修改/ }));
    expect(screen.getByTestId('location').textContent).toBe('/workflow/applications?status=returned');
  });
});
