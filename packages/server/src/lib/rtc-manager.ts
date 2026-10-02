/**
 * WebRTC 通话房间管理（内存）
 *
 * WebSocket 仅做信令中继，房间状态用于：
 * - 把每个 callId 绑定到发起时的会话（conversationId）：后续所有信令都必须来自该会话成员，
 *   且只能发给该会话成员——callId 不再是任意字符串，服务端据此拒绝伪造 / 跨会话的信令
 * - 新成员加入群通话时，告知其当前已在房间内的成员（以便发起 mesh 连接）
 * - 用户断线时自动离开所有房间并通知其余成员
 *
 * 参与者身份由服务端按连接的认证主体写入，不接受客户端声明的 userId。
 * 单进程内存方案；多实例部署需改造为共享存储（与 ws-manager 同等约束）。
 */
import type { RtcPeerInfo } from '@arcbase/shared/chat';

interface CallRoom {
  conversationId: number;
  createdAt: number;
  touchedAt: number;
  peers: Map<number, RtcPeerInfo>;
}

/** 空房间 / 无活动房间保留上限，超过即回收（防止未正常挂断的通话残留） */
const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ROOMS = 10_000;

// callId → 房间
const rooms = new Map<string, CallRoom>();
// userId → Set<callId>（断线时快速定位需清理的房间）
const userRooms = new Map<number, Set<string>>();

function sweep(now = Date.now()) {
  for (const [callId, room] of rooms) {
    if (room.peers.size === 0 || now - room.touchedAt > ROOM_IDLE_TTL_MS) {
      for (const userId of room.peers.keys()) userRooms.get(userId)?.delete(callId);
      rooms.delete(callId);
    }
  }
}

/**
 * 登记 / 加入通话：首次出现的 callId 以本次的 conversationId 建房；已存在的房间必须属于同一会话。
 * 返回加入前已在房间内的其他成员；会话不匹配返回 null（调用方应丢弃该信令）。
 */
export function joinRoom(callId: string, conversationId: number, peer: RtcPeerInfo): RtcPeerInfo[] | null {
  let room = rooms.get(callId);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) sweep();
    if (rooms.size >= MAX_ROOMS) return null;
    room = { conversationId, createdAt: Date.now(), touchedAt: Date.now(), peers: new Map() };
    rooms.set(callId, room);
  } else if (room.conversationId !== conversationId) {
    return null;
  }
  const existing = [...room.peers.values()].filter((p) => p.userId !== peer.userId);
  room.peers.set(peer.userId, peer);
  room.touchedAt = Date.now();

  let set = userRooms.get(peer.userId);
  if (!set) {
    set = new Set();
    userRooms.set(peer.userId, set);
  }
  set.add(callId);
  return existing;
}

/** 通话所属会话；未知 callId 返回 null */
export function getCallConversation(callId: string): number | null {
  const room = rooms.get(callId);
  if (!room) return null;
  room.touchedAt = Date.now();
  return room.conversationId;
}

/** 离开房间，返回剩余成员的 userId 列表（供通知） */
export function leaveRoom(callId: string, userId: number): number[] {
  const room = rooms.get(callId);
  const set = userRooms.get(userId);
  if (set) {
    set.delete(callId);
    if (set.size === 0) userRooms.delete(userId);
  }
  if (!room) return [];
  room.peers.delete(userId);
  if (room.peers.size === 0) {
    rooms.delete(callId);
    return [];
  }
  return [...room.peers.keys()];
}

/** 用户断线：离开其所有房间，返回 [{ callId, conversationId, remaining: userId[] }] 供通知 */
export function leaveAllRooms(userId: number): Array<{ callId: string; conversationId: number; remaining: number[] }> {
  const set = userRooms.get(userId);
  if (!set) return [];
  const result: Array<{ callId: string; conversationId: number; remaining: number[] }> = [];
  for (const callId of [...set]) {
    const conversationId = rooms.get(callId)?.conversationId ?? 0;
    const remaining = leaveRoom(callId, userId);
    result.push({ callId, conversationId, remaining });
  }
  return result;
}

/** 房间当前成员数 */
export function getRoomSize(callId: string): number {
  return rooms.get(callId)?.peers.size ?? 0;
}

/** 供单测：清空全部房间 */
export function resetRtcRooms(): void {
  rooms.clear();
  userRooms.clear();
}
