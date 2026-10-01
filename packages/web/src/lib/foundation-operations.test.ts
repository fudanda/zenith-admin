import { describe, expect, it, vi } from 'vitest';
import { defineContract, op } from '@zenith/shared/core';
import { authContract, menuContract, positionContract, userContract } from '@zenith/shared/identity';
import { goAuthContract } from '@zenith/shared/identity';
import { dictContract } from '@zenith/shared/platform';
import { inAppMessageContract } from '@zenith/shared/messaging';
vi.mock('./foundation-mode', () => ({ IS_GO_FOUNDATION: true }));
import { apiQueryOptions, urlOf } from './contract-query';
import { foundationPath, foundationRequestBody } from './foundation-operations';
import { foundationProfileContract } from '@zenith/shared/foundation-transfer';

describe('Go module boundary', () => {
  it('maps original contract parameters to v1 without changing contract keys', () => {
    expect(urlOf(positionContract.detail, { params: { id: 12 } })).toBe('/api/v1/positions/12');
    expect(urlOf(dictContract.itemsByCode, { params: { code: 'common_status' } })).toBe('/api/v1/dicts/code/common_status/items');
    expect(foundationPath(authContract.preferences)).toBe('/api/v1/auth/preferences');
    expect(foundationPath(goAuthContract.me)).toBe('/api/v1/auth/me');
  });
  it('blocks unported operations even when their query requests enabled=true', () => {
    expect(apiQueryOptions(inAppMessageContract.unreadCount, { enabled: true }).enabled).toBe(false);
    expect(() => foundationPath(inAppMessageContract.unreadCount)).toThrow('尚未接入 Go');
    const unknown = defineContract('/api/v1/unported', { list: op.get('/', { public: true, summary: 'Unported test operation' }) }).list;
    expect(apiQueryOptions(unknown, { enabled: true }).enabled).toBe(false);
    expect(() => foundationPath(unknown)).toThrow('尚未接入 Go');
  });
  it('strips entity metadata from original forms without filling omitted updates or removing explicit nulls', () => {
    expect(foundationRequestBody(menuContract.update, {id: 45, title:'Changed', createdAt:'old', children:[]})).toEqual({title:'Changed'});
    expect(foundationRequestBody(userContract.update, {nickname:'Changed', departmentId:null, email:null, tenantId:null})).toEqual({nickname:'Changed', departmentId:null, email:null});
  });
  it('preserves multipart form data for the personal avatar operation', () => {
    const form = new FormData();
    form.append('file', new Blob(['image']), 'avatar.png');
    expect(foundationRequestBody(foundationProfileContract.avatar, form)).toBe(form);
  });
});
