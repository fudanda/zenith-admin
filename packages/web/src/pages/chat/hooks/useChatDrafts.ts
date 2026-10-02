import { useCallback } from 'react';
import type { Setter } from '../types';

/** 聊天草稿：localStorage 持久化 + draftsMap 同步（自 ChatPage 原样搬移） */
export function useChatDrafts({
  setDraftsMap,
}: {
  setDraftsMap: Setter<Record<number, string>>;
}) {
  const DRAFT_STORAGE_KEY = 'zenith_chat_drafts';

  const saveDraft = useCallback((convId: number, text: string) => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      const drafts: Record<string, string> = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      if (text.trim()) {
        drafts[String(convId)] = text;
      } else {
        delete drafts[String(convId)];
      }
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
      setDraftsMap((prev) => {
        if (text.trim()) return { ...prev, [convId]: text };
        const next = { ...prev };
        delete next[convId];
        return next;
      });
    } catch { /* ignore */ }
  }, [setDraftsMap]);

  const loadDraft = useCallback((convId: number): string => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return '';
      const drafts = JSON.parse(raw) as Record<string, string>;
      return drafts[String(convId)] ?? '';
    } catch {
      return '';
    }
  }, []);

  return { saveDraft, loadDraft };
}
