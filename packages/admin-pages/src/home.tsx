import { PageHeader } from '@zenith/admin-ui';
import { useAuth } from '@zenith/admin-core';
import { useQuery } from '@tanstack/react-query';
import { request } from '@zenith/admin-client';

export function HomePage() {
  const { session } = useAuth();
  const stats = useQuery({ queryKey:['dashboard-stats',session?.tenantViewId], queryFn:()=>request<{users:number;activeSessions:number;loginsToday:number;operationsToday:number}>('/stats') });
  const cards = [{label:'账号总数',value:stats.data?.users},{label:'在线会话',value:stats.data?.activeSessions},{label:'今日登录',value:stats.data?.loginsToday},{label:'今日操作',value:stats.data?.operationsToday}];
  return <><PageHeader title="工作台" description={`欢迎回来，${session?.user.nickname}。以下为当前租户视角的实时统计。`}/><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:16}}>{cards.map(card=><div className="zenith-card" key={card.label}><div style={{color:'var(--semi-color-text-2)',fontSize:13}}>{card.label}</div><strong style={{display:'block',fontSize:28,marginTop:8}}>{card.value ?? (stats.isLoading?'…':'—')}</strong></div>)}</div>{stats.error&&<p>统计暂不可用：{String(stats.error)}</p>}</>;
}
