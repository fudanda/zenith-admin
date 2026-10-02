/**
 * WebRTC 通话管理器（模块级单例）
 *
 * 复用现有 WebSocket 做信令中继（offer/answer/ICE），媒体走 P2P。
 * - 1v1：呼叫方在收到 accept 后主动建连发 offer；被叫方收到 offer 时懒建连应答。
 * - 群聊：mesh，加入者向房间内现有成员主动建连；采用 perfect-negotiation 处理
 *   屏幕共享等 renegotiation 的 glare。
 *
 * 仿照 useWebSocket 的共享单例模式：UI 通过 useCallManager 订阅快照，
 * ChatPage 直接调用导出的动作方法。信令入站由 CallOverlayHost 通过 useWebSocket 注入。
 */
import { sendWsMessage } from '@/hooks/useWebSocket';
import { api } from '@/lib/contract-query';
import { chatContract } from '@arcbase/shared/chat';
import type { RtcPeerInfo, RtcCallType, RtcInvitePayload, RtcIceCandidateInit } from '@arcbase/shared/chat';
import type { WsMessage } from '@arcbase/shared/platform';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connected';

export interface CallParticipant {
  info: RtcPeerInfo;
  stream: MediaStream | null;
  connected: boolean;
}

export interface CallSnapshot {
  phase: CallPhase;
  callId: string | null;
  conversationId: number | null;
  conversationName: string | null;
  callType: RtcCallType;
  mode: 'p2p' | 'group';
  incoming: RtcInvitePayload | null;
  participants: CallParticipant[];
  localStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  screenSharing: boolean;
  startedAt: number | null;
  minimized: boolean;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  info: RtcPeerInfo;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream | null;
  connected: boolean;
}

const RING_TIMEOUT_MS = 35_000;

class CallManager {
  private self: RtcPeerInfo | null = null;
  private iceServers: RTCIceServer[] | null = null;
  private readonly peers = new Map<number, PeerEntry>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();

  private snapshot: CallSnapshot = this.buildIdleSnapshot();

  private buildIdleSnapshot(): CallSnapshot {
    return {
      phase: 'idle', callId: null, conversationId: null, conversationName: null,
      callType: 'audio', mode: 'p2p', incoming: null, participants: [],
      localStream: null, muted: false, cameraOff: false, screenSharing: false,
      startedAt: null, minimized: false,
    };
  }

  // ── 订阅（useSyncExternalStore）──
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  getSnapshot = (): CallSnapshot => this.snapshot;

  private emit(patch: Partial<CallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const cb of this.listeners) cb();
  }

  private syncParticipants(): void {
    const participants: CallParticipant[] = [...this.peers.values()].map((p) => ({
      info: p.info, stream: p.stream, connected: p.connected,
    }));
    this.emit({ participants });
  }

  configure(self: RtcPeerInfo): void {
    this.self = self;
  }

  private async getIce(): Promise<RTCIceServer[]> {
    if (this.iceServers) return this.iceServers;
    try {
      const config = await api(chatContract.rtcConfig, { silent: true }).catch(() => null);
      this.iceServers = config ? (config.iceServers as RTCIceServer[]) : [];
    } catch {
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    return this.iceServers;
  }

  // ── 本地媒体 ──
  private async ensureLocalStream(callType: RtcCallType): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持音视频通话（需要 HTTPS 或 localhost）');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video',
    });
    this.localStream = stream;
    this.cameraTrack = stream.getVideoTracks()[0] ?? null;
    this.emit({ localStream: stream });
    return stream;
  }

  private send(msg: WsMessage): void {
    sendWsMessage(msg);
  }

  // ── 对端连接 ──
  private createPeer(info: RtcPeerInfo): PeerEntry {
    const existing = this.peers.get(info.userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers ?? [] });
    const entry: PeerEntry = {
      pc, info, polite: (this.self?.userId ?? 0) > info.userId,
      makingOffer: false, ignoreOffer: false, stream: null, connected: false,
    };
    this.peers.set(info.userId, entry);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && this.self) {
        this.send({ type: 'rtc:ice', payload: { callId: this.snapshot.callId ?? '', to: info.userId, from: this.self.userId, candidate: e.candidate.toJSON() as RtcIceCandidateInit } });
      }
    };
    pc.ontrack = (e) => {
      entry.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.syncParticipants();
    };
    pc.onnegotiationneeded = async () => {
      if (!this.self) return;
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.send({ type: 'rtc:offer', payload: { callId: this.snapshot.callId ?? '', to: info.userId, from: this.self.userId, sdp: pc.localDescription.sdp } });
        }
      } catch { /* ignore */ } finally {
        entry.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { entry.connected = true; this.syncParticipants(); }
      else if (st === 'failed' || st === 'closed') { this.removePeer(info.userId); }
    };

    this.syncParticipants();
    return entry;
  }

  private removePeer(userId: number): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    try { entry.pc.close(); } catch { /* ignore */ }
    this.peers.delete(userId);
    this.syncParticipants();
    // 1v1：对端离开即结束；群聊：保持通话
    if (this.snapshot.mode === 'p2p' && this.snapshot.phase === 'connected') {
      this.cleanup('completed');
    }
  }

  // ── 信令入站 ──
  handleSignal = async (msg: WsMessage): Promise<void> => {
    if (!this.self || !msg.type.startsWith('rtc:')) return;
    switch (msg.type) {
      case 'rtc:invite': this.onInvite(msg.payload); return;
      case 'rtc:accept': await this.onAccept(msg.payload); return;
      case 'rtc:reject': this.onReject(); return;
      case 'rtc:busy': this.onBusy(); return;
      case 'rtc:cancel': this.onCancel(msg.payload); return;
      case 'rtc:room-participants': this.onRoomParticipants(msg.payload); return;
      case 'rtc:leave': this.onLeave(msg.payload); return;
      case 'rtc:offer': await this.onOffer(msg.payload); return;
      case 'rtc:answer': await this.onAnswer(msg.payload); return;
      case 'rtc:ice': await this.onIce(msg.payload); return;
      default: return;
    }
  };

  private onInvite(p: RtcInvitePayload): void {
    if (!this.self || p.from.userId === this.self.userId) return;
    if (this.snapshot.phase !== 'idle') {
      if (p.mode === 'p2p') this.send({ type: 'rtc:busy', payload: { callId: p.callId, to: p.from.userId } });
      return;
    }
    this.emit({
      phase: 'incoming', callId: p.callId, conversationId: p.conversationId,
      conversationName: p.conversationName ?? null, callType: p.callType, mode: p.mode,
      incoming: p, participants: [], minimized: false,
    });
  }

  private async onAccept(p: { callId: string; from: RtcPeerInfo }): Promise<void> {
    if (p.callId !== this.snapshot.callId || this.snapshot.phase !== 'outgoing') return;
    this.clearRing();
    this.emit({ phase: 'connected', startedAt: Date.now() });
    this.createPeer(p.from);
  }

  private onReject(): void {
    if (this.snapshot.phase !== 'outgoing') return;
    void this.postCallRecord('rejected');
    this.cleanup('rejected');
  }

  private onBusy(): void {
    if (this.snapshot.phase !== 'outgoing') return;
    void this.postCallRecord('missed');
    this.cleanup('busy');
  }

  private onCancel(p: { callId: string }): void {
    if (p.callId !== this.snapshot.callId) return;
    if (this.snapshot.phase === 'incoming') this.cleanup('canceled');
  }

  private onRoomParticipants(p: { callId: string; participants: RtcPeerInfo[] }): void {
    if (p.callId !== this.snapshot.callId || !this.self) return;
    for (const peer of p.participants) {
      if (peer.userId !== this.self.userId) this.createPeer(peer);
    }
  }

  private onLeave(p: { from: number }): void {
    this.removePeer(p.from);
  }

  private async onOffer(p: { callId: string; from: number; sdp: string }): Promise<void> {
    if (!this.self) return;
    const info = this.resolvePeerInfo(p.from);
    const entry = this.createPeer(info);
    const pc = entry.pc;
    const collision = entry.makingOffer || pc.signalingState !== 'stable';
    entry.ignoreOffer = !entry.polite && collision;
    if (entry.ignoreOffer) return;
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      await pc.setLocalDescription();
      if (pc.localDescription) {
        this.send({ type: 'rtc:answer', payload: { callId: this.snapshot.callId ?? '', to: p.from, from: this.self.userId, sdp: pc.localDescription.sdp } });
      }
    } catch { /* ignore */ }
  }

  private async onAnswer(p: { from: number; sdp: string }): Promise<void> {
    const entry = this.peers.get(p.from);
    if (!entry) return;
    try {
      if (entry.pc.signalingState === 'have-local-offer') {
        await entry.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
      }
    } catch { /* ignore */ }
  }

  private async onIce(p: { from: number; candidate: RtcIceCandidateInit }): Promise<void> {
    const entry = this.peers.get(p.from);
    if (!entry) return;
    try {
      await entry.pc.addIceCandidate(p.candidate as RTCIceCandidateInit);
    } catch { /* ignore (may be discarded during glare) */ }
  }

  private resolvePeerInfo(userId: number): RtcPeerInfo {
    const existing = this.peers.get(userId);
    if (existing) return existing.info;
    if (this.snapshot.incoming && this.snapshot.incoming.from.userId === userId) return this.snapshot.incoming.from;
    return { userId, nickname: `用户${userId}`, avatar: null };
  }

  // ── 对外动作 ──
  async startDirectCall(target: RtcPeerInfo, conversationId: number, conversationName: string | null, callType: RtcCallType): Promise<void> {
    if (this.snapshot.phase !== 'idle' || !this.self) return;
    const callId = crypto.randomUUID();
    // 先展示呼叫界面再申请设备：getUserMedia 弹权限框期间用户能看到「正在呼叫」而非毫无反馈
    this.emit({
      phase: 'outgoing', callId, conversationId, conversationName, callType, mode: 'p2p',
      participants: [{ info: target, stream: null, connected: false }], minimized: false,
    });
    await this.getIce();
    try {
      await this.ensureLocalStream(callType);
    } catch (err) {
      this.cleanup('idle');
      // DOMException = 设备/权限问题；自定义 Error（环境不支持）原样透出
      if (err instanceof Error && !(err instanceof DOMException)) throw err;
      throw new Error('无法访问麦克风/摄像头，请检查设备与浏览器权限', { cause: err });
    }
    // 等待设备期间用户可能已挂断（emit 会替换 snapshot，显式注解避免 TS 沿用早前的收窄）
    const afterMedia: CallSnapshot = this.snapshot;
    if (afterMedia.phase !== 'outgoing' || afterMedia.callId !== callId) return;
    this.send({ type: 'rtc:invite', payload: { callId, conversationId, callType, mode: 'p2p', from: this.self, to: target.userId, conversationName } });
    this.ringTimer = setTimeout(() => {
      if (this.snapshot.phase === 'outgoing') {
        this.send({ type: 'rtc:cancel', payload: { callId, conversationId, to: target.userId } });
        void this.postCallRecord('missed');
        this.cleanup('timeout');
      }
    }, RING_TIMEOUT_MS);
  }

  async startGroupCall(conversationId: number, conversationName: string | null, callType: RtcCallType): Promise<void> {
    if (this.snapshot.phase !== 'idle' || !this.self) return;
    const callId = `g-${conversationId}-${crypto.randomUUID()}`;
    // 同上：先给出可见的呼叫准备状态
    this.emit({
      phase: 'outgoing', callId, conversationId, conversationName, callType, mode: 'group',
      participants: [], minimized: false,
    });
    await this.getIce();
    try {
      await this.ensureLocalStream(callType);
    } catch (err) {
      this.cleanup('idle');
      if (err instanceof Error && !(err instanceof DOMException)) throw err;
      throw new Error('无法访问麦克风/摄像头，请检查设备与浏览器权限', { cause: err });
    }
    const afterMedia: CallSnapshot = this.snapshot;
    if (afterMedia.phase !== 'outgoing' || afterMedia.callId !== callId) return;
    this.emit({ phase: 'connected', startedAt: Date.now() });
    this.send({ type: 'rtc:invite', payload: { callId, conversationId, callType, mode: 'group', from: this.self, conversationName } });
    this.send({ type: 'rtc:join', payload: { callId, conversationId, from: this.self } });
  }

  async accept(): Promise<void> {
    const inc = this.snapshot.incoming;
    if (!inc || this.snapshot.phase !== 'incoming' || !this.self) return;
    await this.getIce();
    try {
      await this.ensureLocalStream(inc.callType);
    } catch {
      this.reject();
      throw new Error('无法访问麦克风/摄像头');
    }
    this.emit({ phase: 'connected', startedAt: Date.now() });
    if (inc.mode === 'p2p') {
      this.send({ type: 'rtc:accept', payload: { callId: inc.callId, to: inc.from.userId, from: this.self } });
    } else {
      this.send({ type: 'rtc:join', payload: { callId: inc.callId, conversationId: inc.conversationId, from: this.self } });
    }
  }

  reject(): void {
    const inc = this.snapshot.incoming;
    if (!inc || !this.self) { this.cleanup('idle'); return; }
    if (inc.mode === 'p2p') {
      this.send({ type: 'rtc:reject', payload: { callId: inc.callId, to: inc.from.userId } });
    }
    this.cleanup('rejected');
  }

  hangup(): void {
    const s = this.snapshot;
    if (s.phase === 'idle' || !this.self) return;
    if (s.mode === 'p2p') {
      const peerId = s.participants[0]?.info.userId ?? s.incoming?.from.userId;
      if (s.phase === 'outgoing' && peerId != null) {
        this.send({ type: 'rtc:cancel', payload: { callId: s.callId ?? '', conversationId: s.conversationId ?? 0, to: peerId } });
        void this.postCallRecord('canceled');
      } else if (peerId != null) {
        this.send({ type: 'rtc:leave', payload: { callId: s.callId ?? '', conversationId: s.conversationId ?? 0, from: this.self.userId, to: peerId } });
        if (s.startedAt) void this.postCallRecord('completed');
      }
    } else {
      this.send({ type: 'rtc:leave', payload: { callId: s.callId ?? '', conversationId: s.conversationId ?? 0, from: this.self.userId } });
    }
    this.cleanup('hangup');
  }

  toggleMute(): void {
    if (!this.localStream) return;
    const next = !this.snapshot.muted;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !next;
    this.emit({ muted: next });
  }

  toggleCamera(): void {
    if (!this.localStream) return;
    const next = !this.snapshot.cameraOff;
    for (const t of this.localStream.getVideoTracks()) t.enabled = !next;
    this.emit({ cameraOff: next });
  }

  async toggleScreenShare(): Promise<void> {
    if (!this.localStream) return;
    if (this.snapshot.screenSharing) {
      this.stopScreenShare();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) return;
      this.screenStream = display;
      for (const entry of this.peers.values()) {
        const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(screenTrack);
        else entry.pc.addTrack(screenTrack, this.localStream);
      }
      if (this.cameraTrack) this.localStream.removeTrack(this.cameraTrack);
      this.localStream.addTrack(screenTrack);
      screenTrack.onended = () => this.stopScreenShare();
      this.emit({ screenSharing: true, localStream: this.localStream });
    } catch { /* 用户取消选择 */ }
  }

  private stopScreenShare(): void {
    if (!this.localStream) return;
    const screenTrack = this.screenStream?.getVideoTracks()[0] ?? null;
    if (screenTrack) {
      try { this.localStream.removeTrack(screenTrack); } catch { /* ignore */ }
      screenTrack.stop();
    }
    this.screenStream = null;
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) void sender.replaceTrack(this.cameraTrack ?? null);
    }
    if (this.cameraTrack) this.localStream.addTrack(this.cameraTrack);
    this.emit({ screenSharing: false, localStream: this.localStream });
  }

  setMinimized(v: boolean): void {
    this.emit({ minimized: v });
  }

  private async postCallRecord(status: 'completed' | 'missed' | 'canceled' | 'rejected'): Promise<void> {
    const s = this.snapshot;
    if (s.mode !== 'p2p' || s.conversationId == null) return;
    const durationSec = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
    try {
      await api(chatContract.postCallRecord, {
        params: { id: s.conversationId },
        body: { callType: s.callType, mode: s.mode, status, durationSec },
      }, { silent: true });
    } catch { /* ignore */ }
  }

  private clearRing(): void {
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = undefined; }
  }

  private cleanup(_reason: string): void {
    this.clearRing();
    for (const entry of this.peers.values()) {
      try { entry.pc.close(); } catch { /* ignore */ }
    }
    this.peers.clear();
    if (this.localStream) { for (const t of this.localStream.getTracks()) t.stop(); }
    if (this.screenStream) { for (const t of this.screenStream.getTracks()) t.stop(); }
    this.localStream = null;
    this.screenStream = null;
    this.cameraTrack = null;
    this.snapshot = this.buildIdleSnapshot();
    for (const cb of this.listeners) cb();
  }
}

export const callManager = new CallManager();
