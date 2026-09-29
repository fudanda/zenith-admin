import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Toast } from '@douyinfe/semi-ui';
import { authApi } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

export function ProfilePage() {
  const { session, refresh, invalidate } = useAuth(); const queryClient = useQueryClient();
  const [nickname, setNickname] = useState(session?.user.nickname ?? ''); const [email, setEmail] = useState(session?.user.email ?? '');
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const sessions = useQuery({ queryKey: ['my-sessions'], queryFn: authApi.sessions });
  const saveProfile = async () => { setBusy(true); try { await authApi.profile(nickname,email); await refresh(); Toast.success('资料已保存'); } catch (error) { Toast.error(String(error)); } finally { setBusy(false); } };
  const saveTheme = async (theme: string) => { try { await authApi.preferences({ ...session?.user.preferences, theme }); await refresh(); Toast.success('偏好已保存'); } catch (error) { Toast.error(String(error)); } };
  const changePassword = async () => { setBusy(true); try { await authApi.changePassword(currentPassword,newPassword); invalidate(); Toast.success('密码已修改，请重新登录'); } catch (error) { Toast.error(String(error)); } finally { setBusy(false); } };
  const revoke = async (id: number) => { try { await authApi.revokeSession(id); void queryClient.invalidateQueries({ queryKey: ['my-sessions'] }); Toast.success('会话已下线'); if (sessions.data?.some(item => item.id===id && item.current)) invalidate(); } catch (error) { Toast.error(String(error)); } };
  return <><PageHeader title="个人中心" description="管理个人资料、偏好和在线会话"/>
    <div style={{ display:'grid', gap:16, maxWidth:800 }}>
      <section className="zenith-card"><h3>个人资料</h3><div style={{ display:'grid', gap:12 }}><div className="zenith-form-row"><label>昵称</label><Input value={nickname} onChange={setNickname}/></div><div className="zenith-form-row"><label>邮箱</label><Input value={email} onChange={setEmail}/></div><Button theme="solid" loading={busy} onClick={saveProfile}>保存资料</Button></div></section>
      <section className="zenith-card"><h3>个人偏好</h3><div className="zenith-form-row"><label>主题</label><Select value={String(session?.user.preferences?.theme ?? 'light')} onChange={value => void saveTheme(String(value))} optionList={[{ label:'浅色', value:'light' },{ label:'深色', value:'dark' }]}/></div></section>
      <section className="zenith-card"><h3>修改密码</h3><div style={{ display:'grid', gap:12 }}><div className="zenith-form-row"><label>当前密码</label><Input mode="password" value={currentPassword} onChange={setCurrentPassword}/></div><div className="zenith-form-row"><label>新密码（至少 12 位）</label><Input mode="password" value={newPassword} onChange={setNewPassword}/></div><Button loading={busy} onClick={changePassword}>修改密码</Button></div></section>
      <section className="zenith-card"><h3>在线会话</h3>{sessions.data?.map(item => <div key={item.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid var(--semi-color-border)', padding:'10px 0' }}><span>{new Date(item.createdAt).toLocaleString()} {item.current ? '（当前）':''}</span><Button type="danger" theme="borderless" onClick={() => void revoke(item.id)}>强制下线</Button></div>)}</section>
    </div>
  </>;
}
