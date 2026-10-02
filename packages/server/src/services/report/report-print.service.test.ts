import { describe, expect, it, vi } from 'vitest';
import { resolvePrintDatasetBindings, resolvePrintSubreportParams } from './report-print.service';
import type { ReportPrintDatasetBinding } from '@arcbase/shared/report';

const input = {
  templateParams: [{ name: 'tenantCode', label: '租户', type: 'string' as const }],
  resolvedTemplateParams: { tenantCode: 'T-01' },
  tenantId: 1,
  limit: 500,
};

describe('resolvePrintDatasetBindings', () => {
  it('映射声明参数、限制每绑定行数，并复用相同查询', async () => {
    const loadDataset = vi.fn(async () => ({
      id: 9,
      tenantId: 1,
      params: [{ name: 'tenant', label: '租户', type: 'string' as const, required: true }],
    }));
    const fetchRows = vi.fn(async () => [{ id: 1, tenant: 'T-01' }]);
    const bindings: ReportPrintDatasetBinding[] = [
      { key: 'details', datasetId: 9, rowLimit: 50, paramBindings: { tenant: 'tenantCode' } },
      { key: 'detailsCopy', datasetId: 9, rowLimit: 50, paramBindings: { tenant: 'tenantCode' } },
    ];

    const rows = await resolvePrintDatasetBindings(bindings, input, { loadDataset, fetchRows });

    expect(loadDataset).toHaveBeenCalledTimes(1);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows).toHaveBeenCalledWith(9, { tenant: 'T-01' }, 50, 'details');
    expect(rows.details).toEqual([{ id: 1, tenant: 'T-01' }]);
    expect(rows.detailscopy).toBe(rows.details);
  });

  describe('resolvePrintSubreportParams', () => {
    it('仅允许父子模板双方声明的参数映射', () => {
      const childParams = [{ name: 'childCode', label: '子编码', type: 'string' as const }];
      const parentParams = [{ name: 'parentCode', label: '父编码', type: 'string' as const }];
      expect(resolvePrintSubreportParams(
        { templateId: 2, paramBindings: { childCode: 'parentCode' } },
        childParams,
        parentParams,
        { parentCode: 'P-01' },
      )).toEqual({ childCode: 'P-01' });
      expect(() => resolvePrintSubreportParams(
        { templateId: 2, paramBindings: { missing: 'parentCode' } },
        childParams,
        parentParams,
        { parentCode: 'P-01' },
      )).toThrow('子报表参数未声明');
      expect(() => resolvePrintSubreportParams(
        { templateId: 2, paramBindings: { childCode: 'missing' } },
        childParams,
        parentParams,
        { parentCode: 'P-01' },
      )).toThrow('父模板参数未声明');
    });
  });

  it('全局并发不超过 3', async () => {
    let active = 0;
    let maximum = 0;
    const runGoverned = async <T>(value: T) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    };
    const bindings = Array.from({ length: 7 }, (_, index): ReportPrintDatasetBinding => ({
      key: `binding${index}`,
      datasetId: index + 1,
    }));

    await resolvePrintDatasetBindings(bindings, input, {
      loadDataset: (datasetId) => runGoverned({ id: datasetId, tenantId: 1, params: [] }),
      fetchRows: (datasetId) => runGoverned([{ id: datasetId }]),
    });

    expect(maximum).toBe(3);
  });

  it('ACL/租户或治理取数失败时整体失败，不返回部分绑定', async () => {
    const fetchRows = vi.fn(async () => [{ id: 1 }]);
    await expect(resolvePrintDatasetBindings(
      [{ key: 'secret', datasetId: 2 }],
      input,
      {
        loadDataset: async () => { throw new Error('无权访问该数据集'); },
        fetchRows,
      },
    )).rejects.toThrow('无权访问该数据集');
    expect(fetchRows).not.toHaveBeenCalled();

    await expect(resolvePrintDatasetBindings(
      [{ key: 'otherTenant', datasetId: 3 }],
      input,
      {
        loadDataset: async () => ({ id: 3, tenantId: 2, params: [] }),
        fetchRows,
      },
    )).rejects.toThrow('不属于同一租户');
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it('仅消费治理层已应用行规则后的结果', async () => {
    const governedRows = [{ id: 2, ownerId: 7 }];
    const rows = await resolvePrintDatasetBindings(
      [{ key: 'owned', datasetId: 4 }],
      input,
      {
        loadDataset: async () => ({ id: 4, tenantId: 1, params: [] }),
        fetchRows: async (_datasetId, _params, _limit, bindingKey) => {
          expect(bindingKey).toBe('owned');
          return governedRows;
        },
      },
    );
    expect(rows.owned).toBe(governedRows);
  });

  it('拒绝未声明参数与重复/保留 key', async () => {
    const dependencies = {
      loadDataset: async () => ({
        id: 5,
        tenantId: 1,
        params: [{ name: 'target', label: '目标', type: 'string' as const }],
      }),
      fetchRows: async () => [],
    };
    await expect(resolvePrintDatasetBindings(
      [{ key: 'invalid', datasetId: 5, paramBindings: { target: 'missing' } }],
      input,
      dependencies,
    )).rejects.toThrow('模板未声明参数');
    await expect(resolvePrintDatasetBindings(
      [{ key: 'main', datasetId: 5 }],
      input,
      dependencies,
    )).rejects.toThrow('保留名称');
    await expect(resolvePrintDatasetBindings(
      [{ key: 'Dup', datasetId: 5 }, { key: 'dup', datasetId: 5 }],
      input,
      dependencies,
    )).rejects.toThrow('重复');
  });
});
