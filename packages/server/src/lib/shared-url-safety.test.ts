import { describe, expect, it } from 'vitest';
import {
  isHttpUrl,
  isHttpUrlTemplate,
  isRootRelativePath,
  isSafeExternalUrl,
  isSafeLinkUrl,
  isSafeLinkUrlTemplate,
  isSameOriginUrl,
  httpUrl,
  linkUrl,
  optionalHttpUrl,
  optionalLinkUrl,
} from '@arcbase/shared/core';

describe('url safety predicates', () => {
  it('isHttpUrl accepts only absolute http(s)', () => {
    expect(isHttpUrl('https://example.com/a?b=1#c')).toBe(true);
    expect(isHttpUrl('HTTP://localhost:3000/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isHttpUrl('file://server/share/x.exe')).toBe(false);
    expect(isHttpUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isHttpUrl('//evil.com/x')).toBe(false);
    expect(isHttpUrl('/api/files/1/content')).toBe(false);
    expect(isHttpUrl('java\nscript:alert(1)')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('isRootRelativePath accepts single-slash in-site paths only', () => {
    expect(isRootRelativePath('/api/files/abc/content')).toBe(true);
    expect(isRootRelativePath('/')).toBe(true);
    expect(isRootRelativePath('//evil.com/x')).toBe(false);
    expect(isRootRelativePath('/\\evil.com/x')).toBe(false);
    expect(isRootRelativePath('api/files')).toBe(false);
    expect(isRootRelativePath('/a\tb')).toBe(false);
  });

  it('isSafeLinkUrl / isSafeExternalUrl', () => {
    expect(isSafeLinkUrl('/uploads/a.png')).toBe(true);
    expect(isSafeLinkUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeLinkUrl('javascript:void(0)')).toBe(false);
    expect(isSafeLinkUrl('mailto:a@b.c')).toBe(false);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeExternalUrl('tel:+8610000')).toBe(true);
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isSafeExternalUrl('smb://server/share')).toBe(false);
    expect(isSafeExternalUrl('/relative')).toBe(false);
  });

  it('templates: placeholders are neutralised before checking', () => {
    expect(isHttpUrlTemplate('https://crm.example.com/customers/{value}')).toBe(true);
    expect(isHttpUrlTemplate('https://x.example.com/?q=${keyword}&v={value}')).toBe(true);
    expect(isHttpUrlTemplate('{value}')).toBe(false);
    expect(isHttpUrlTemplate('javascript:alert({value})')).toBe(false);
    expect(isSafeLinkUrlTemplate('/api/files/${fileId}/content')).toBe(true);
    expect(isSafeLinkUrlTemplate('data:image/png;base64,${x}')).toBe(false);
  });

  it('isSameOriginUrl treats relative paths as same origin', () => {
    expect(isSameOriginUrl('/system/db-admin', 'https://admin.example.com')).toBe(true);
    expect(isSameOriginUrl('https://admin.example.com/x', 'https://admin.example.com')).toBe(true);
    expect(isSameOriginUrl('https://grafana.example.com/d/1', 'https://admin.example.com')).toBe(false);
  });
});

describe('url zod helpers', () => {
  it('httpUrl rejects non-http schemes that z.url() would accept', () => {
    expect(httpUrl().safeParse('https://example.com').success).toBe(true);
    expect(httpUrl().safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrl().safeParse('file://server/share').success).toBe(false);
    expect(httpUrl().safeParse('ftp://example.com/x').success).toBe(false);
    expect(httpUrl('自定义提示').safeParse('data:,x').error?.issues[0]?.message).toBe('自定义提示');
  });

  it('linkUrl accepts http(s) or root-relative paths and supports .max()', () => {
    expect(linkUrl().safeParse('/api/files/1/content').success).toBe(true);
    expect(linkUrl().safeParse('https://example.com/a.png').success).toBe(true);
    expect(linkUrl().safeParse('javascript:alert(1)').success).toBe(false);
    expect(linkUrl().max(5).safeParse('/api/files/1/content').success).toBe(false);
  });

  it('optional variants allow empty string only', () => {
    expect(optionalLinkUrl().safeParse('').success).toBe(true);
    expect(optionalLinkUrl().safeParse('data:,x').success).toBe(false);
    expect(optionalHttpUrl().safeParse('').success).toBe(true);
    expect(optionalHttpUrl().safeParse('/relative').success).toBe(false);
  });
});
