/**
 * 导入模板生成：表头（必填标星）+ 枚举数据验证下拉 + 示例行 + 说明批注。
 */
import type { ImportColumnMeta } from '@arcbase/shared/tasks';

export async function buildImportTemplate(title: string, columns: ImportColumnMeta[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${title}导入模板`);

  sheet.columns = columns.map((col) => ({
    key: col.key,
    width: Math.max(14, col.header.length * 2 + 4),
  }));

  const headerRow = sheet.getRow(1);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.required ? `${col.header}*` : col.header;
    cell.font = { bold: true, color: col.required ? { argb: 'FFCC0000' } : undefined };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    const noteParts = [
      col.required ? '必填' : '选填',
      col.enumValues?.length ? `可选值：${col.enumValues.join(' / ')}` : null,
      col.note ?? null,
    ].filter(Boolean);
    cell.note = noteParts.join('；');
  });

  // 枚举列：前 1000 行加数据验证下拉
  columns.forEach((col, i) => {
    if (!col.enumValues?.length) return;
    for (let r = 2; r <= 1000; r++) {
      sheet.getRow(r).getCell(i + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${col.enumValues.join(',')}"`],
      };
    }
  });

  // 示例行
  const exampleRow = sheet.getRow(2);
  columns.forEach((col, i) => {
    if (col.example) exampleRow.getCell(i + 1).value = col.example;
  });
  exampleRow.font = { color: { argb: 'FF999999' } };

  return workbook.xlsx.writeBuffer();
}
