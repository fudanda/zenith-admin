import { useState, useCallback } from 'react';

const LOCK_CREDENTIAL_KEY = 'arcbase_lock_credential';
const LOCK_STATE_KEY = 'arcbase_is_locked';

/** 锁屏相关 localStorage key：凭证跟随账号，账号切换/退出时必须一并清除 */
export const LOCK_SCREEN_STORAGE_KEYS = [LOCK_CREDENTIAL_KEY, LOCK_STATE_KEY] as const;

export function useLockScreen() {
  const [isLocked, setIsLocked] = useState(() => {
    return localStorage.getItem(LOCK_STATE_KEY) === '1';
  });

  const hasPassword = useCallback(() => {
    return !!localStorage.getItem(LOCK_CREDENTIAL_KEY);
  }, []);

  const setLockPassword = useCallback((password: string) => {
    localStorage.setItem(LOCK_CREDENTIAL_KEY, btoa(encodeURIComponent(password)));
  }, []);

  const clearLockPassword = useCallback(() => {
    localStorage.removeItem(LOCK_CREDENTIAL_KEY);
    localStorage.removeItem(LOCK_STATE_KEY);
    setIsLocked(false);
  }, []);

  const lock = useCallback(() => {
    if (!localStorage.getItem(LOCK_CREDENTIAL_KEY)) return false;
    localStorage.setItem(LOCK_STATE_KEY, '1');
    setIsLocked(true);
    return true;
  }, []);

  const unlock = useCallback((password: string): boolean => {
    const stored = localStorage.getItem(LOCK_CREDENTIAL_KEY);
    if (!stored) {
      setIsLocked(false);
      return true;
    }
    try {
      const isCorrect = decodeURIComponent(atob(stored)) === password;
      if (isCorrect) {
        localStorage.removeItem(LOCK_STATE_KEY);
        setIsLocked(false);
      }
      return isCorrect;
    } catch {
      return false;
    }
  }, []);

  /** 仅校验密码正确性，不改变锁屏状态（供动画过渡使用） */
  const verifyLockPassword = useCallback((password: string): boolean => {
    const stored = localStorage.getItem(LOCK_CREDENTIAL_KEY);
    if (!stored) return true;
    try {
      return decodeURIComponent(atob(stored)) === password;
    } catch {
      return false;
    }
  }, []);

  /** 直接解除锁屏状态（在退出动画结束后调用） */
  const doUnlock = useCallback(() => {
    localStorage.removeItem(LOCK_STATE_KEY);
    setIsLocked(false);
  }, []);

  return { isLocked, lock, unlock, verifyLockPassword, doUnlock, setLockPassword, clearLockPassword, hasPassword };
}
