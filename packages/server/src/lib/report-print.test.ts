/**
 * 报表打印填充引擎单测（@arcbase/shared 纯函数，无 DB 依赖）。
 * 覆盖：#{标量} / ${明细带纵向扩展} / ${SUM 聚合} / 混合文本、
 *      空数据保留单行空带、合并单元格（非带区整体下移 / 带内随数据克隆）、页眉页脚占位符。
 */
import { describe, it, expect } from 'vitest';
import { renderPrintContent, resolvePrintBandText } from '@arcbase/shared/report';
import type { ReportPrintContent, ReportPrintCrosstabConfig, ReportPrintGrid } from '@arcbase/shared/report';

const cellAt = (g: ReportPrintGrid, r: number, c: number) => g.cells.find((x) => x.row === r && x.col === c)?.v;

/** 单 sheet 纵向填充：取渲染结果首个 sheet 的完整网格 */
const fillGrid = (grid: ReportPrintGrid, rows: Record<string, unknown>[], params: Record<string, unknown> = {}) =>
  renderPrintContent(
    '单表',
    { sheets: [{ id: 'sheet-01', name: 'Sheet1', grid, pageConfig: { detailDirection: 'vertical' } }] },
    rows,
    params,
  ).sheets[0]!.grid;

describe('单 sheet 填充 - 标量/明细带/聚合', () => {
  const tpl: ReportPrintGrid = {
    rows: 3,
    cols: 2,
    cells: [
      { row: 0, col: 0, v: '#{title}' },
      { row: 1, col: 0, v: '${name}' },
      { row: 1, col: 1, v: '${qty}' },
      { row: 2, col: 0, v: '合计' },
      { row: 2, col: 1, v: '${SUM(qty)}' },
    ],
  };
  const rows = [
    { title: '订单', name: 'A', qty: 2 },
    { title: '订单', name: 'B', qty: 3 },
  ];

  it('明细带按数据行纵向扩展，标量取首行，聚合求和', () => {
    const out = fillGrid(tpl, rows);
    expect(out.rows).toBe(4); // 1 表头 + 2 明细 + 1 合计
    expect(cellAt(out, 0, 0)).toBe('订单');         // #{title} 标量
    expect(cellAt(out, 1, 0)).toBe('A');
    expect(cellAt(out, 1, 1)).toBe(2);              // 单一 ${qty} 保留数值类型
    expect(cellAt(out, 2, 0)).toBe('B');
    expect(cellAt(out, 2, 1)).toBe(3);
    expect(cellAt(out, 3, 0)).toBe('合计');
    expect(cellAt(out, 3, 1)).toBe(5);              // SUM(qty)
  });

  it('混合文本逐行替换', () => {
    const t: ReportPrintGrid = { rows: 1, cols: 1, cells: [{ row: 0, col: 0, v: '编号:${name}' }] };
    const out = fillGrid(t, [{ name: 'X' }]);
    expect(cellAt(out, 0, 0)).toBe('编号:X');
  });

  it('空数据集保留单行空带，聚合为 0', () => {
    const out = fillGrid(tpl, []);
    expect(out.rows).toBe(3); // 表头 + 1 空带 + 合计
    expect(cellAt(out, 0, 0)).toBe('');   // 无首行
    expect(cellAt(out, 1, 0)).toBe('');   // 空带
    expect(cellAt(out, 2, 1)).toBe(0);    // SUM 空集
  });
});

describe('单 sheet 填充 - 合并单元格', () => {
  it('非带区纵向合并随上方带扩展整体下移', () => {
    const tpl: ReportPrintGrid = {
      rows: 3, cols: 1,
      cells: [
        { row: 0, col: 0, v: '${name}' },     // 明细带
        { row: 1, col: 0, v: '合计' },
        { row: 2, col: 0, v: '签字' },
      ],
      merges: [{ row: 1, col: 0, rowSpan: 2, colSpan: 1 }], // 非带区竖向合并
    };
    const out = fillGrid(tpl, [{ name: 'A' }, { name: 'B' }]);
    // 带扩展为 2 行后，合并应下移到输出第 2 行
    expect(out.merges).toEqual([{ row: 2, col: 0, rowSpan: 2, colSpan: 1 }]);
  });

  it('带内纵向合并随每条数据克隆', () => {
    const tpl: ReportPrintGrid = {
      rows: 2, cols: 2,
      cells: [
        { row: 0, col: 0, v: '${name}' },
        { row: 1, col: 1, v: '${val}' },
      ],
      merges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }], // 跨整带竖向合并
    };
    const out = fillGrid(tpl, [{ name: 'A', val: 1 }, { name: 'B', val: 2 }]);
    expect(out.merges).toHaveLength(2); // 每条数据各克隆一份
    expect(out.merges?.map((m) => m.row).sort((a, b) => a - b)).toEqual([0, 2]);
  });
});

describe('resolvePrintBandText', () => {
  it('解析 ${param} 与 {page}/{pages}/{date}', () => {
    expect(resolvePrintBandText('${company} 第{page}/{pages} 页 {date}', { company: 'ACME' }, { page: 1, pages: 3, date: '2026-01-01' }))
      .toBe('ACME 第1/3 页 2026-01-01');
  });
  it('空文本返回空串', () => {
    expect(resolvePrintBandText(undefined, {})).toBe('');
  });
  it('未提供的 param 替换为空', () => {
    expect(resolvePrintBandText('${x}-${y}', { x: '1' })).toBe('1-');
  });
});

describe('renderPrintContent - 多 sheet / 真分页 / 分组', () => {
  it('支持 repeatHeaderRows、rowsPerPage、PAGE_SUM 与页码', () => {
    const content: ReportPrintContent = {
      grid: {
        rows: 3,
        cols: 2,
        cells: [
          { row: 0, col: 0, v: '商品' },
          { row: 0, col: 1, v: '数量' },
          { row: 1, col: 0, v: '${name}' },
          { row: 1, col: 1, v: '${qty}' },
          { row: 2, col: 0, v: '页小计' },
          { row: 2, col: 1, v: '${PAGE_SUM(qty)}' },
        ],
      },
    };
    const result = renderPrintContent(
      '分页报表',
      content,
      [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }, { name: 'C', qty: 3 }],
      {},
      {
        repeatHeaderRows: { start: 0, end: 0 },
        rowsPerPage: 2,
        pageSubtotalRows: { start: 2, end: 2 },
        footer: '第 {page}/{pages} 页',
      },
    );
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.footerText).toBe('第 1/2 页');
    expect(result.pages[1]?.footerText).toBe('第 2/2 页');
    expect(cellAt(result.pages[0]!.grid, 0, 0)).toBe('商品');
    expect(cellAt(result.pages[1]!.grid, 0, 0)).toBe('商品');
    expect(cellAt(result.pages[0]!.grid, 3, 1)).toBe(3);
    expect(cellAt(result.pages[1]!.grid, 2, 1)).toBe(3);
  });

  it('支持强制 pageBreaks', () => {
    const result = renderPrintContent(
      '强制分页',
      {
        grid: {
          rows: 2,
          cols: 1,
          cells: [
            { row: 0, col: 0, v: '表头' },
            { row: 1, col: 0, v: '${name}' },
          ],
        },
      },
      [{ name: 'A' }, { name: 'B' }],
      {},
      { repeatHeaderRows: { start: 0, end: 0 }, pageBreaks: [1] },
    );
    expect(result.pages).toHaveLength(2);
    expect(cellAt(result.pages[0]!.grid, 1, 0)).toBe('A');
    expect(cellAt(result.pages[1]!.grid, 1, 0)).toBe('B');
  });

  it('支持 groupByFields、组头组尾、GROUP_SUM 与总计', () => {
    const result = renderPrintContent(
      '分组报表',
      {
        grid: {
          rows: 5,
          cols: 2,
          cells: [
            { row: 0, col: 0, v: '报表' },
            { row: 1, col: 0, v: '组:${category}' },
            { row: 2, col: 0, v: '${name}' },
            { row: 2, col: 1, v: '${qty}' },
            { row: 3, col: 0, v: '组小计' },
            { row: 3, col: 1, v: '${GROUP_SUM(qty)}' },
            { row: 4, col: 0, v: '总计' },
            { row: 4, col: 1, v: '${SUM(qty)}' },
          ],
        },
      },
      [
        { category: 'A', name: 'A-1', qty: 2 },
        { category: 'A', name: 'A-2', qty: 3 },
        { category: 'B', name: 'B-1', qty: 4 },
      ],
      {},
      {
        groupByFields: ['category'],
        groupHeaderRows: { start: 1, end: 1 },
        groupFooterRows: { start: 3, end: 3 },
        totalRows: { start: 4, end: 4 },
      },
    );
    expect(cellAt(result.grid, 1, 0)).toBe('组:A');
    expect(cellAt(result.grid, 4, 1)).toBe(5);
    expect(cellAt(result.grid, 5, 0)).toBe('组:B');
    expect(cellAt(result.grid, 7, 1)).toBe(4);
    expect(cellAt(result.grid, 8, 1)).toBe(9);
  });

  it('空数据时仍保留单行明细带', () => {
    const result = renderPrintContent(
      '空数据',
      {
        grid: {
          rows: 3,
          cols: 2,
          cells: [
            { row: 0, col: 0, v: '名称' },
            { row: 1, col: 0, v: '${name}' },
            { row: 2, col: 1, v: '${SUM(qty)}' },
          ],
        },
      },
      [],
    );
    expect(result.grid.rows).toBe(3);
    expect(cellAt(result.grid, 1, 0)).toBe('');
    expect(cellAt(result.grid, 2, 1)).toBe(0);
  });

  it('支持横向扩展列与多 sheet', () => {
    const result = renderPrintContent(
      '多 sheet',
      {
        sheets: [
          {
            id: 's1',
            name: '横向',
            grid: {
              rows: 1,
              cols: 3,
              cells: [
                { row: 0, col: 0, v: '项目' },
                { row: 0, col: 1, v: '${name}' },
                { row: 0, col: 2, v: '${qty}' },
              ],
            },
            pageConfig: { detailDirection: 'horizontal' },
          },
          {
            id: 's2',
            name: '汇总',
            grid: {
              rows: 1,
              cols: 1,
              cells: [{ row: 0, col: 0, v: '${SUM(qty)}' }],
            },
          },
        ],
      },
      [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }],
    );
    expect(result.sheets).toHaveLength(2);
    expect(result.sheets[0]?.grid.cols).toBe(5);
    expect(cellAt(result.sheets[0]!.grid, 0, 1)).toBe('A');
    expect(cellAt(result.sheets[0]!.grid, 0, 3)).toBe('B');
    expect(cellAt(result.sheets[1]!.grid, 0, 0)).toBe(3);
  });
});

describe('renderPrintContent - 交叉表', () => {
  const content = (crosstab: ReportPrintCrosstabConfig): ReportPrintContent => ({
    sheets: [{
      id: 'pivot',
      name: '交叉表',
      grid: {
        rows: 3,
        cols: 3,
        colWidths: [120, 90, 90],
        rowHeights: [28, 24, 26],
        cells: [
          { row: 0, col: 0, v: '表头', s: { bold: true, background: '#eeeeee' } },
          { row: 1, col: 0, v: '数据' },
          { row: 2, col: 0, v: '总计', s: { bold: true } },
        ],
      },
      pageConfig: { detailDirection: 'crosstab', crosstab },
    }],
  });

  it('空数据与单维度数据均可渲染，并处理空维度和总计', () => {
    const config = {
      rowFields: ['region'],
      columnFields: ['quarter'],
      valueFields: [{ field: 'amount', aggregate: 'sum' as const, label: '销售额' }],
      showRowTotals: true,
      showColumnTotals: true,
      nullLabel: '未分类',
      emptyValue: 0,
      headerRow: 0,
      dataRow: 1,
      totalRow: 2,
    };
    const empty = renderPrintContent('空交叉表', content(config), []);
    expect(empty.grid.rows).toBe(3);
    expect(cellAt(empty.grid, 0, 0)).toBe('region');

    const result = renderPrintContent('交叉表', content(config), [
      { region: '华东', quarter: 'Q1', amount: 10 },
      { region: '华东', quarter: 'Q2', amount: 20 },
      { region: null, quarter: 'Q1', amount: 5 },
    ]);
    expect(cellAt(result.grid, 2, 0)).toBe('未分类');
    expect(cellAt(result.grid, 2, 1)).toBe(5);
    expect(cellAt(result.grid, 3, 1)).toBe(10);
    expect(cellAt(result.grid, 3, 3)).toBe(30);
    expect(cellAt(result.grid, 4, 3)).toBe(35);
    expect(result.grid.colWidths?.[0]).toBe(120);
  });

  it('多维度、多指标支持 SUM/COUNT/AVG/MAX/MIN 且维度顺序确定', () => {
    const result = renderPrintContent('多指标交叉表', content({
      rowFields: ['region', 'city'],
      columnFields: ['year', 'quarter'],
      valueFields: [
        { field: 'amount', aggregate: 'sum', label: 'SUM' },
        { field: 'amount', aggregate: 'count', label: 'COUNT' },
        { field: 'amount', aggregate: 'avg', label: 'AVG' },
        { field: 'amount', aggregate: 'max', label: 'MAX' },
        { field: 'amount', aggregate: 'min', label: 'MIN' },
      ],
      showRowTotals: true,
      showColumnTotals: true,
      headerRow: 0,
      dataRow: 1,
      totalRow: 2,
    }), [
      { region: 'B', city: 'B2', year: 2026, quarter: 'Q1', amount: 4 },
      { region: 'A', city: 'A1', year: 2026, quarter: 'Q1', amount: 2 },
      { region: 'A', city: 'A1', year: 2026, quarter: 'Q1', amount: 6 },
      { region: 'A', city: 'A1', year: 2026, quarter: 'Q2', amount: 8 },
    ]);
    expect(cellAt(result.grid, 3, 0)).toBe('A');
    expect(cellAt(result.grid, 3, 2)).toBe(8);
    expect(cellAt(result.grid, 3, 3)).toBe(2);
    expect(cellAt(result.grid, 3, 4)).toBe(4);
    expect(cellAt(result.grid, 3, 5)).toBe(6);
    expect(cellAt(result.grid, 3, 6)).toBe(2);
    expect(result.grid.merges?.some((merge) => merge.colSpan === 5)).toBe(true);
    expect(result.grid.merges?.some((merge) => merge.colSpan === 10)).toBe(true);
  });

  it('高基数在分配网格前被明确拒绝', () => {
    expect(() => renderPrintContent(
      '超限交叉表',
      content({
        rowFields: ['region'],
        columnFields: ['quarter'],
        valueFields: [{ field: 'amount', aggregate: 'sum' }],
      }),
      Array.from({ length: 10 }, (_, index) => ({ region: 'R', quarter: `Q${index}`, amount: index })),
      {},
      {},
      { crosstabBudget: { maxDynamicColumns: 4, maxCells: 100, maxBytes: 100_000 } },
    )).toThrow(/动态列数 5 超过上限 4/);
  });

  it('自动扩展 CJK 换行行高并保持旧模板默认行为', () => {
    const wrapped = renderPrintContent('换行', {
      grid: {
        rows: 1,
        cols: 1,
        colWidths: [40],
        rowHeights: [24],
        cells: [{ row: 0, col: 0, v: '中文自动换行高度测试', s: { wrap: true, fontSize: 12 } }],
      },
    }, []);
    expect(wrapped.grid.rowHeights?.[0]).toBeGreaterThan(24);

    const legacy = fillGrid({ rows: 1, cols: 1, rowHeights: [24], cells: [{ row: 0, col: 0, v: '旧模板' }] }, []);
    expect(legacy.rowHeights?.[0]).toBe(24);
  });
});

describe('renderPrintContent - 多数据集、重复块与子报表', () => {
  it('支持页签级数据集与同页重复块', () => {
    const result = renderPrintContent(
      '多数据集',
      {
        datasetBindings: [
          { key: 'details', datasetId: 2 },
          { key: 'summary', datasetId: 3 },
        ],
        sheets: [
          {
            id: 'main-sheet',
            name: '明细',
            grid: {
              rows: 2,
              cols: 1,
              cells: [
                { row: 0, col: 0, v: '#{title}' },
                { row: 1, col: 0, v: '${item}', datasetKey: 'details' },
              ],
            },
            repeatBlocks: [{ id: 'details-block', datasetKey: 'details', range: { start: 1, end: 1 } }],
          },
          {
            id: 'summary-sheet',
            name: '摘要',
            datasetKey: 'summary',
            grid: { rows: 1, cols: 1, cells: [{ row: 0, col: 0, v: '${label}' }] },
          },
        ],
      },
      [{ title: '订单' }],
      {},
      {},
      {
        datasets: {
          details: [{ item: 'A' }, { item: 'B' }],
          summary: [{ label: 'S1' }, { label: 'S2' }],
        },
        bindings: [
          { key: 'details', datasetId: 2 },
          { key: 'summary', datasetId: 3 },
        ],
      },
    );

    expect(result.sheets).toHaveLength(2);
    expect(result.sheets[0]?.grid.rows).toBe(3);
    expect(cellAt(result.sheets[0]!.grid, 0, 0)).toBe('订单');
    expect(cellAt(result.sheets[0]!.grid, 1, 0)).toBe('A');
    expect(cellAt(result.sheets[0]!.grid, 2, 0)).toBe('B');
    expect(cellAt(result.sheets[1]!.grid, 0, 0)).toBe('S1');
    expect(cellAt(result.sheets[1]!.grid, 1, 0)).toBe('S2');
  });

  it('把已治理渲染的子报表网格嵌入锚点并移动后续行', () => {
    const child = renderPrintContent('子报表', {
      grid: {
        rows: 2,
        cols: 2,
        cells: [
          { row: 0, col: 0, v: '子标题' },
          { row: 0, col: 1, v: '值' },
          { row: 1, col: 0, v: '子数据' },
          { row: 1, col: 1, v: 10 },
        ],
      },
    }, []);
    const parent = renderPrintContent(
      '主报表',
      {
        sheets: [{
          id: 'parent',
          name: '主表',
          grid: {
            rows: 2,
            cols: 2,
            cells: [
              { row: 0, col: 0, kind: 'subreport', subreport: { templateId: 2 } },
              { row: 1, col: 0, v: '签字' },
            ],
            merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
          },
        }],
      },
      [],
      {},
      {},
      { subreports: [{ sheetId: 'parent', row: 0, col: 0, templateId: 2, result: child }] },
    );

    expect(parent.grid.rows).toBe(3);
    expect(cellAt(parent.grid, 0, 0)).toBe('子标题');
    expect(cellAt(parent.grid, 1, 1)).toBe(10);
    expect(cellAt(parent.grid, 2, 0)).toBe('签字');
    expect(parent.grid.cells.some((cell) => cell.subreport)).toBe(false);
  });

  it('子报表插行后同步移动下方重复块', () => {
    const child = renderPrintContent('子报表', {
      grid: {
        rows: 3,
        cols: 1,
        cells: [
          { row: 0, col: 0, v: '子行1' },
          { row: 1, col: 0, v: '子行2' },
          { row: 2, col: 0, v: '子行3' },
        ],
      },
    }, []);
    const parent = renderPrintContent(
      '主报表',
      {
        datasetBindings: [{ key: 'details', datasetId: 2 }],
        sheets: [{
          id: 'parent',
          name: '主表',
          grid: {
            rows: 3,
            cols: 1,
            cells: [
              { row: 0, col: 0, v: '标题' },
              { row: 1, col: 0, kind: 'subreport', subreport: { templateId: 2 } },
              { row: 2, col: 0, v: '${item}', datasetKey: 'details' },
            ],
          },
          repeatBlocks: [{ id: 'details', datasetKey: 'details', range: { start: 2, end: 2 } }],
        }],
      },
      [],
      {},
      {},
      {
        datasets: { details: [{ item: 'A' }, { item: 'B' }] },
        bindings: [{ key: 'details', datasetId: 2 }],
        subreports: [{ sheetId: 'parent', row: 1, col: 0, templateId: 2, result: child }],
      },
    );

    expect(parent.grid.rows).toBe(6);
    expect(cellAt(parent.grid, 4, 0)).toBe('A');
    expect(cellAt(parent.grid, 5, 0)).toBe('B');
  });
});
