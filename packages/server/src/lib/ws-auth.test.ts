import { beforeEach, describe, expect, it } from 'vitest';
import { getCallConversation, getRoomSize, joinRoom, leaveAllRooms, leaveRoom, resetRtcRooms } from './rtc-manager';
import { extractWsBearerToken } from './ws-auth';

const peer = (userId: number) => ({ userId, nickname: `u${userId}`, avatar: null });

describe('rtc-manager：callId 绑定会话', () => {
  beforeEach(() => resetRtcRooms());

  it('首次 join 建房并绑定会话，后续同会话 join 返回已有成员', () => {
    expect(joinRoom('c1', 10, peer(1))).toEqual([]);
    expect(joinRoom('c1', 10, peer(2))).toEqual([peer(1)]);
    expect(getCallConversation('c1')).toBe(10);
    expect(getRoomSize('c1')).toBe(2);
  });

  it('同一 callId 换会话加入被拒绝（防止借他人 callId 跨会话中继）', () => {
    joinRoom('c1', 10, peer(1));
    expect(joinRoom('c1', 99, peer(3))).toBeNull();
    expect(getRoomSize('c1')).toBe(1);
  });

  it('未知 callId 无会话归属', () => {
    expect(getCallConversation('nope')).toBeNull();
  });

  it('离开 / 断线清理房间并返回剩余成员', () => {
    joinRoom('c1', 10, peer(1));
    joinRoom('c1', 10, peer(2));
    joinRoom('c2', 11, peer(1));
    expect(leaveRoom('c1', 1)).toEqual([2]);
    expect(leaveAllRooms(2)).toEqual([{ callId: 'c1', conversationId: 10, remaining: [] }]);
    expect(getCallConversation('c1')).toBeNull();
    expect(getCallConversation('c2')).toBe(11);
  });
});

describe('extractWsBearerToken', () => {
  const ctx = (header?: string) => ({ req: { header: () => header } }) as never;

  it('从 arcbase-auth 子协议中取出 JWT，忽略 URL 查询串', () => {
    expect(extractWsBearerToken(ctx('arcbase-auth, aaa.bbb.ccc'))).toBe('aaa.bbb.ccc');
    expect(extractWsBearerToken(ctx('aaa.bbb.ccc, arcbase-auth'))).toBe('aaa.bbb.ccc');
  });

  it('缺少子协议名 / 无头 / 非 JWT 形态一律返回 null', () => {
    expect(extractWsBearerToken(ctx(undefined))).toBeNull();
    expect(extractWsBearerToken(ctx('aaa.bbb.ccc'))).toBeNull();
    expect(extractWsBearerToken(ctx('arcbase-auth'))).toBeNull();
    expect(extractWsBearerToken(ctx('arcbase-auth, not-a-jwt'))).toBeNull();
  });
});
