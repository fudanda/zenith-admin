const RECENT_KEY = 'arcbase_approval_recent_defs';
const RECENT_MAX = 5;

/** 最近发起的流程定义 ID（localStorage，最新在前） */
export function getRecentDefinitionIds(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(arr) ? arr.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

export function recordRecentDefinition(id: number): void {
  const next = [id, ...getRecentDefinitionIds().filter((v) => v !== id)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
