import { describe, expect, it } from 'vitest';
import { reportWidgetSchema } from '@arcbase/shared/report';
import { chatMessageExtraSchema, isChatMediaContentSafe } from '@arcbase/shared/chat';

const base = { i: 'w1', type: 'bar' as const, title: '', datasetId: 1 };

describe('report widget URL safety (H10)', () => {
  it('drilldown url must be an http(s) template', () => {
    expect(reportWidgetSchema.safeParse({ ...base, drilldown: { enabled: true, type: 'url', url: 'https://crm.example.com/c/{value}' } }).success).toBe(true);
    expect(reportWidgetSchema.safeParse({ ...base, drilldown: { enabled: true, type: 'url', url: '' } }).success).toBe(true);
    const bad = reportWidgetSchema.safeParse({ ...base, drilldown: { enabled: true, type: 'url', url: 'javascript:alert(localStorage.arcbase_token)' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['drilldown', 'url']);
    expect(reportWidgetSchema.safeParse({ ...base, drilldown: { enabled: true, type: 'url', url: '//evil.example/{value}' } }).success).toBe(false);
  });

  it('iframe src must be http(s); image src may also be an in-site path', () => {
    expect(reportWidgetSchema.safeParse({ i: 'f', type: 'iframe', options: { src: 'https://grafana.example.com/d/1?var=${region}' } }).success).toBe(true);
    expect(reportWidgetSchema.safeParse({ i: 'f', type: 'iframe', options: { src: 'javascript:alert(1)' } }).success).toBe(false);
    expect(reportWidgetSchema.safeParse({ i: 'f', type: 'iframe', options: { src: 'data:text/html,<script>alert(1)</script>' } }).success).toBe(false);
    expect(reportWidgetSchema.safeParse({ i: 'f', type: 'iframe', options: { src: '/api/files/1/content' } }).success).toBe(false);
    expect(reportWidgetSchema.safeParse({ i: 'g', type: 'image', options: { src: '/api/files/1/content' } }).success).toBe(true);
    expect(reportWidgetSchema.safeParse({ i: 'g', type: 'image', options: { src: 'javascript:alert(1)' } }).success).toBe(false);
    // 未配置 src 不报错（渲染层提示配置）
    expect(reportWidgetSchema.safeParse({ i: 'g', type: 'image', options: {} }).success).toBe(true);
  });
});

describe('chat link/media URL safety (H9)', () => {
  it('link preview and card urls are limited to http(s) / in-site paths', () => {
    const preview = { title: 't', description: null, siteName: null, image: null, favicon: null };
    expect(chatMessageExtraSchema.safeParse({ linkPreview: { ...preview, url: 'https://example.com' } }).success).toBe(true);
    expect(chatMessageExtraSchema.safeParse({ linkPreview: { ...preview, url: 'file://attacker/share/x.exe' } }).success).toBe(false);
    expect(chatMessageExtraSchema.safeParse({ linkPreview: { ...preview, url: 'https://example.com', image: 'javascript:1' } }).success).toBe(false);
    expect(chatMessageExtraSchema.safeParse({ card: { title: 'c', actions: [{ key: 'k', label: 'l', action: 'link', url: '/workflow/instances/1' }] } }).success).toBe(true);
    expect(chatMessageExtraSchema.safeParse({ card: { title: 'c', actions: [{ key: 'k', label: 'l', action: 'link', url: 'javascript:alert(1)' }] } }).success).toBe(false);
    expect(chatMessageExtraSchema.safeParse({ asset: { kind: 'image', name: 'a', size: 1, mimeType: null, extension: null, thumbnailUrl: 'data:image/png;base64,AAAA' } }).success).toBe(false);
  });

  it('media message content must be an http(s) URL or managed file path', () => {
    expect(isChatMediaContentSafe('image', '/api/files/1/content')).toBe(true);
    expect(isChatMediaContentSafe('file', 'https://cdn.example.com/a.pdf')).toBe(true);
    expect(isChatMediaContentSafe('file', 'file://attacker/share/x.exe')).toBe(false);
    expect(isChatMediaContentSafe('image', 'javascript:alert(1)')).toBe(false);
    expect(isChatMediaContentSafe('text', 'javascript:alert(1)')).toBe(true);
  });
});
