import { Button, Descriptions, SideSheet, Tag, Typography } from '@douyinfe/semi-ui';
import { ExternalLink } from 'lucide-react';
import { SECURITY_SCHEME_LABELS } from '@arcbase/shared/permission-catalog-core';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { MethodTag, type PermissionLabels } from './ApiCatalogTable';
import { describeAccess, type CatalogRow } from './catalog-model';

interface ApiOperationSheetProps {
  readonly row: CatalogRow | null;
  readonly permissionLabels: PermissionLabels;
  /** 权限码 → 引用它的接口（页面按目录构建一次） */
  readonly byPermission: ReadonlyMap<string, readonly CatalogRow[]>;
  readonly onClose: () => void;
  readonly onOpen: (row: CatalogRow) => void;
}

const DOCS_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/docs`;

/** 单个接口的完整声明 + 引用同一权限码的其他接口（配角色时看一眼这个码放开了哪些接口） */
export default function ApiOperationSheet({ row, permissionLabels, byPermission, onClose, onOpen }: ApiOperationSheetProps) {
  const related = row
    ? [...new Map(row.permissions.flatMap((code) => byPermission.get(code) ?? []).filter((r) => r.key !== row.key).map((r) => [r.key, r])).values()]
    : [];
  return (
    <SideSheet
      title={row ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><MethodTag method={row.method} />{row.summary}</span> : '接口详情'}
      visible={row !== null}
      onCancel={onClose}
      closeOnEsc
      width={560}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button icon={<ExternalLink size={14} />} onClick={() => window.open(DOCS_URL, '_blank', 'noopener')}>在 API 文档中查看</Button>
        </div>
      )}
    >
      {row && (
        <>
          <Descriptions
            align="left"
            data={[
              { key: '模块', value: row.domainLabel },
              { key: '契约组', value: <Typography.Text code>{row.basePath}</Typography.Text> },
              { key: '操作名', value: <Typography.Text code>{row.name}</Typography.Text> },
              { key: '请求地址', value: <Typography.Text copyable style={{ fontFamily: 'var(--semi-font-family-mono, monospace)' }}>{row.fullPath}</Typography.Text> },
              { key: '说明', value: row.description ?? EMPTY_PLACEHOLDER },
              { key: '认证方式', value: SECURITY_SCHEME_LABELS[row.security] },
              { key: '访问要求', value: describeAccess(row) },
              {
                key: '权限码',
                value: row.permissions.length > 0
                  ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {row.permissions.map((code) => (
                        <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Typography.Text code>{code}</Typography.Text>
                          <Typography.Text type="tertiary" size="small">{permissionLabels[code] ?? '未在注册表登记'}</Typography.Text>
                        </span>
                      ))}
                      {row.permissions.length > 1 && <Typography.Text type="tertiary" size="small">任一权限码即可调用</Typography.Text>}
                    </div>
                  )
                  : EMPTY_PLACEHOLDER,
              },
              { key: '审计', value: row.audit ?? '不记录操作日志' },
              { key: '功能门控', value: row.feature ?? EMPTY_PLACEHOLDER },
              { key: 'OpenAPI 标签', value: row.tags.length > 0 ? row.tags.map((tag) => <Tag key={tag} size="small" style={{ marginRight: 4 }}>{tag}</Tag>) : EMPTY_PLACEHOLDER },
              ...(row.deprecated ? [{ key: '状态', value: <Tag size="small" color="grey">已废弃</Tag> }] : []),
            ]}
          />
          {related.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <Typography.Title heading={6} style={{ margin: '0 0 8px' }}>引用相同权限码的接口（{related.length}）</Typography.Title>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {related.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onOpen(item)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', border: 'none', background: 'transparent',
                      textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', borderRadius: 'var(--semi-border-radius-small)',
                    }}
                  >
                    <MethodTag method={item.method} />
                    <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0, fontFamily: 'var(--semi-font-family-mono, monospace)' }}>{item.fullPath}</Typography.Text>
                    <Typography.Text type="tertiary" size="small" ellipsis style={{ maxWidth: 140 }}>{item.summary}</Typography.Text>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </SideSheet>
  );
}
