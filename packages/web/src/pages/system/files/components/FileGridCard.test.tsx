import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ManagedFile } from '@arcbase/shared/platform';
import { FileGridCard } from './FileGridCard';

vi.mock('@/components/CursorContextDropdown', () => ({
  CursorContextDropdown: ({
    point,
    contextKey,
  }: {
    point: { x: number; y: number };
    contextKey: string | number;
  }) => (
    <div
      data-testid="file-context-menu"
      data-context-key={contextKey}
      data-point={`${point.x},${point.y}`}
    />
  ),
}));

const file: ManagedFile = {
  id: 'file-1',
  storageConfigId: 1,
  storageName: '本地存储',
  provider: 'local',
  originalName: 'quarterly-report.pdf',
  objectKey: 'reports/quarterly-report.pdf',
  size: 1024,
  mimeType: 'application/pdf',
  visibility: 'public',
  url: '/api/files/file-1/content',
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:00:00.000Z',
};

function renderCard() {
  return render(
    <FileGridCard
      file={file}
      selected={false}
      canSelect
      onSelect={vi.fn()}
      onPreview={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      onDetail={vi.fn()}
      onCopyUrl={vi.fn()}
      canDelete
      previewLoading={false}
    />,
  );
}

describe('FileGridCard context menu', () => {
  it.each([
    ['card surface', '.files-grid-card'],
    ['file name', '.files-grid-card__name'],
    ['file metadata', '.files-grid-card__meta'],
  ])('opens from the %s', (_, selector) => {
    const { container } = renderCard();
    const target = container.querySelector(selector);

    expect(target).not.toBeNull();
    fireEvent.contextMenu(target!, { clientX: 120, clientY: 80 });

    expect(screen.getByTestId('file-context-menu')).toHaveAttribute('data-context-key', file.id);
    expect(screen.getByTestId('file-context-menu')).toHaveAttribute('data-point', '120,80');
  });
});
