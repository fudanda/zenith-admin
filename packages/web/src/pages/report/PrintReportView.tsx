import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { Button } from '@douyinfe/semi-ui';
import JsBarcode from 'jsbarcode';
import { Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import dayjs from 'dayjs';
import { findPrintMerge, isPrintCellCoveredByMerge, resolvePrintBandText } from '@arcbase/shared/report';
import type { ReportPrintCell, ReportPrintRenderPage, ReportPrintRenderResult } from '@arcbase/shared/report';
import { DATE_TIME_FORMAT } from '@/utils/date';
import './print-report.css';

interface PrintReportViewProps {
  result: ReportPrintRenderResult;
  params?: Record<string, unknown>;
  showActions?: boolean;
}

const PAPER_SIZE_MM = {
  A4: [210, 297],
  A3: [297, 420],
  A5: [148, 210],
  Letter: [216, 279],
} as const;

function mm(value: number | undefined, fallback: number) {
  return `${value ?? fallback}mm`;
}

function cellKey(row: number, col: number) {
  return `${row}:${col}`;
}

function stringifyCellValue(value: ReportPrintCell['v']) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function getPaperSize(page: Pick<ReportPrintRenderPage, 'pageConfig'>) {
  const paper = page.pageConfig.paper ?? 'A4';
  const [width, height] = PAPER_SIZE_MM[paper] ?? PAPER_SIZE_MM.A4;
  return page.pageConfig.orientation === 'landscape' ? [height, width] : [width, height];
}

function borderStyle(cell: ReportPrintCell | undefined): CSSProperties {
  const border = cell?.s?.border;
  if (!border) return {};
  if (border === true) return { border: '1px solid #111827' };
  const side = (value: { style?: string; color?: string } | undefined) => {
    if (!value) return undefined;
    const width = value.style === 'medium' ? 2 : value.style === 'double' ? 3 : 1;
    const lineStyle = value.style === 'dashed' || value.style === 'dotted' || value.style === 'double'
      ? value.style
      : 'solid';
    return `${width}px ${lineStyle} ${value.color ?? '#111827'}`;
  };
  return {
    borderTop: side(border.top),
    borderRight: side(border.right),
    borderBottom: side(border.bottom),
    borderLeft: side(border.left),
  };
}

function buildCellStyle(cell: ReportPrintCell | undefined, height: number | undefined): CSSProperties {
  const style = cell?.s;
  return {
    height: height ? `${height}px` : undefined,
    fontFamily: style?.fontFamily,
    fontWeight: style?.bold ? 700 : undefined,
    fontStyle: style?.italic ? 'italic' : undefined,
    fontSize: style?.fontSize ? `${style.fontSize}px` : undefined,
    color: style?.color,
    background: style?.background,
    textAlign: style?.align,
    verticalAlign: style?.valign,
    ...borderStyle(cell),
  };
}

function triggerPrint() {
  document.body.classList.add('report-printing');
  const cleanup = () => document.body.classList.remove('report-printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1200);
}

function BarcodeGraphic({ value }: Readonly<{ value: string }>) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value || ' ', {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 32,
      width: 1.4,
    });
  }, [value]);
  return <svg ref={ref} className="print-report-graphic" aria-label="barcode" />;
}

function CellGraphic({ cell }: Readonly<{ cell: ReportPrintCell }>) {
  if (cell.kind === 'qrcode') {
    return <QRCodeSVG value={String(cell.v ?? '')} size={56} level="M" includeMargin={false} />;
  }
  if (cell.kind === 'barcode') {
    return <BarcodeGraphic value={String(cell.v ?? '')} />;
  }
  if (cell.image?.src) {
    return <img src={cell.image.src} alt={cell.image.alt ?? ''} className="print-report-graphic print-report-graphic--image" />;
  }
  return <>{stringifyCellValue(cell.v)}</>;
}

function normalizePages(result: ReportPrintRenderResult, renderedAt: string): ReportPrintRenderPage[] {
  if (result.pages?.length) return result.pages;
  return [{
    sheetId: result.sheets?.[0]?.id ?? 'sheet-01',
    sheetName: result.sheets?.[0]?.name ?? result.name,
    pageNumber: 1,
    totalPages: 1,
    grid: result.grid,
    pageConfig: result.pageConfig,
    headerText: resolvePrintBandText(result.pageConfig.header, {}, { page: 1, pages: 1, date: renderedAt }),
    footerText: resolvePrintBandText(result.pageConfig.footer, {}, { page: 1, pages: 1, date: renderedAt }),
  }];
}

export function PrintReportView({ result, params = {}, showActions = true }: Readonly<PrintReportViewProps>) {
  const renderedAt = useMemo(() => dayjs().format(DATE_TIME_FORMAT), []);
  const pages = useMemo(() => normalizePages(result, renderedAt), [renderedAt, result]);

  return (
    <div className="print-report-area">
      {showActions && (
        <div className="print-report-actions">
          <Button type="primary" icon={<Printer size={14} />} onClick={triggerPrint}>打印</Button>
        </div>
      )}
      <div className="print-report-view">
        {pages.map((page) => {
          const merges = page.grid.merges ?? [];
          const cellMap = new Map(page.grid.cells.map((cell) => [cellKey(cell.row, cell.col), cell]));
          const [paperWidth, paperHeight] = getPaperSize(page);
          const paper = (page.pageConfig.paper ?? 'A4').toLowerCase();
          const orientation = page.pageConfig.orientation ?? 'portrait';
          const margin = page.pageConfig.margin ?? { top: 12, right: 12, bottom: 12, left: 12 };
          const pageStyle = {
            '--report-paper-width': `${paperWidth}mm`,
            '--report-paper-height': `${paperHeight}mm`,
            '--report-margin-top': mm(margin.top, 12),
            '--report-margin-right': mm(margin.right, 12),
            '--report-margin-bottom': mm(margin.bottom, 12),
            '--report-margin-left': mm(margin.left, 12),
            '--report-grid-width': `${Array.from({ length: Math.max(page.grid.cols, 1) }, (_, col) => page.grid.colWidths?.[col] ?? 96).reduce((sum, width) => sum + width, 0)}px`,
            '--report-background-image': page.pageConfig.backgroundImage ? `url("${page.pageConfig.backgroundImage}")` : 'none',
          } as CSSProperties;
          const headerText = page.headerText || resolvePrintBandText(page.pageConfig.header, params, {
            page: page.pageNumber,
            pages: page.totalPages,
            date: renderedAt,
          });
          const footerText = page.footerText || resolvePrintBandText(page.pageConfig.footer, params, {
            page: page.pageNumber,
            pages: page.totalPages,
            date: renderedAt,
          });
          const headerRowCount = page.pageConfig.repeatHeaderRows
            ? Math.min(page.grid.rows, page.pageConfig.repeatHeaderRows.end - page.pageConfig.repeatHeaderRows.start + 1)
            : 0;
          const renderRow = (row: number) => (
            <tr key={row} style={{ height: page.grid.rowHeights?.[row] ? `${page.grid.rowHeights[row]}px` : undefined }}>
              {Array.from({ length: Math.max(page.grid.cols, 1) }).map((_, col) => {
                if (isPrintCellCoveredByMerge(row, col, merges)) return null;
                const cell = cellMap.get(cellKey(row, col));
                const merge = findPrintMerge(row, col, merges);
                return (
                  <td
                    key={col}
                    rowSpan={merge?.rowSpan}
                    colSpan={merge?.colSpan}
                    className={cell?.s?.wrap ? 'print-report-cell--wrap' : undefined}
                    style={buildCellStyle(cell, page.grid.rowHeights?.[row])}
                  >
                    {cell ? <CellGraphic cell={cell} /> : null}
                  </td>
                );
              })}
            </tr>
          );

          return (
            <div
              key={`${page.sheetId}-${page.pageNumber}`}
              className={`print-report-page print-report-page--${paper}-${orientation}`}
              style={pageStyle}
            >
              <div className="print-report-page__inner">
                {headerText && <div className="print-report-band print-report-band--header">{headerText}</div>}
                <table className="print-report-table" aria-label={`${result.name}-${page.sheetName}-${page.pageNumber}`}>
                  <colgroup>
                    {Array.from({ length: Math.max(page.grid.cols, 1) }).map((_, col) => (
                      <col key={col} style={{ width: `${page.grid.colWidths?.[col] ?? 96}px` }} />
                    ))}
                  </colgroup>
                  {headerRowCount > 0 && (
                    <thead>{Array.from({ length: headerRowCount }, (_, row) => renderRow(row))}</thead>
                  )}
                  <tbody>
                    {Array.from(
                      { length: Math.max(page.grid.rows - headerRowCount, headerRowCount > 0 ? 0 : 1) },
                      (_, index) => renderRow(index + headerRowCount),
                    )}
                  </tbody>
                </table>
                {footerText && <div className="print-report-band print-report-band--footer">{footerText}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PrintReportView;
