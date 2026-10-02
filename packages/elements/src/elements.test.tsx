import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@arcbase/client';
import { goSessionSchema } from '@arcbase/shared/identity';
import { ArcBaseProvider } from './provider';
import { PermissionGuard, SessionBoundary } from './permissions';
import { LoginForm } from './LoginForm';
import { FilePicker, FileUploader, type UploadItem } from './files';
import type { ArcBaseSessionValue } from './session';

const sessionData = goSessionSchema.parse({ user: { id: 1, username: 'admin', nickname: '管理员', status: 'enabled', email: null, roles: [], passwordUpdatedAt: '2026-09-30T00:00:00Z', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' }, permissions: ['system:user:list'], csrfToken: 'test-csrf', superAdmin: false });
const controlled: ArcBaseSessionValue = { status: 'authenticated', session: sessionData, error: null, refreshing: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(), resolveSessionConflict: vi.fn(), updateUser: vi.fn() };
afterEach(cleanup);
describe('independent elements', () => {
  it('uses a controlled session without additional auth requests and fails closed for anonymous permissions', () => {
    const send = vi.fn<typeof fetch>(); const client = new Client({ transport: send });
    const content = <SessionBoundary unauthenticated="sign-in"><PermissionGuard permission="system:user:list"><span>allowed</span></PermissionGuard><PermissionGuard permission="system:user:delete" fallback={<span>denied</span>}>secret</PermissionGuard></SessionBoundary>;
    const view = render(<ArcBaseProvider client={client} session={controlled}>{content}</ArcBaseProvider>);
    expect(screen.getByText('allowed')).toBeTruthy(); expect(screen.getByText('denied')).toBeTruthy(); expect(send).not.toHaveBeenCalled();
    view.rerender(<ArcBaseProvider client={client} session={{ ...controlled, status: 'anonymous' }}>{content}</ArcBaseProvider>);
    expect(screen.queryByText('allowed')).toBeNull(); expect(screen.getByText('sign-in')).toBeTruthy();
  });
  it('keeps the login form in its own locale and shows server failures instead of false success', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ code: 0, message: 'ok', data: { enabled: false, captchaId: '', image: '' } })));
    const login = vi.fn().mockResolvedValue({ code: 401, message: 'Incorrect password', data: null, retryAfterSeconds: 30 });
    const success = vi.fn();
    render(<ArcBaseProvider client={new Client({ transport: send })} session={{ ...controlled, status: 'anonymous', session: null, login }} locale="en-US"><LoginForm onSuccess={success} /></ArcBaseProvider>);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect password')).toBeTruthy(); expect(success).not.toHaveBeenCalled();
    expect((await screen.findByRole('button', { name: '30s' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('validates size/type/count before uploading and allows selecting the same file again', () => {
    const changed = vi.fn(); const error = vi.fn();
    render(<FilePicker onChange={changed} onError={error} accept=".txt" maxSize={4} maxCount={1} />);
    const input = screen.getByLabelText('选择文件');
    fireEvent.change(input, { target: { files: [new File(['12345'], 'big.txt')] } });
    fireEvent.change(input, { target: { files: [new File(['a'], 'image.png')] } });
    expect(changed).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(2);
    const file = new File(['a'], 'ok.txt');
    fireEvent.change(input, { target: { files: [file] } }); fireEvent.change(input, { target: { files: [file] } });
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('preserves entered credentials when the host changes the locale', async () => {
    const client = new Client({ transport: async () => new Response(JSON.stringify({ code: 0, message: 'ok', data: { enabled: false, captchaId: '', image: '' } })) });
    const anonymous = { ...controlled, status: 'anonymous' as const, session: null };
    const view = render(<ArcBaseProvider client={client} session={anonymous} locale="en-US"><LoginForm /></ArcBaseProvider>);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'retained-user' } });
    view.rerender(<ArcBaseProvider client={client} session={anonymous} locale="zh-CN"><LoginForm /></ArcBaseProvider>);
    expect((screen.getByLabelText('用户名') as HTMLInputElement).value).toBe('retained-user');
    await waitFor(() => expect((screen.getByRole('button', { name: '登录' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText('用户名') as HTMLInputElement).value).toBe('retained-user');
  });
  it('cancels uploads, ignores an old result after retry and aborts on unmount under StrictMode', async () => {
    const attempts: Array<{ signal: AbortSignal; finish: (value: never) => void }> = [];
    const upload = vi.fn((_file: File, options: { signal: AbortSignal }) => new Promise<never>(finish => attempts.push({ signal: options.signal, finish })));
    let items: readonly UploadItem[] = [];
    const success = vi.fn();
    const host = render(<StrictMode><ArcBaseProvider client={new Client()} session={controlled}><FileUploader upload={upload} onItemsChange={value => { items = value; }} onUploaded={success} /></ArcBaseProvider></StrictMode>);
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [new File(['a'], 'cancel.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(attempts[0].signal.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await act(async () => { attempts[0].finish({ id: 'stale-file' } as never); });
    expect(items[0].status).toBe('uploading'); expect(success).not.toHaveBeenCalled();
    host.unmount(); expect(attempts[1].signal.aborted).toBe(true);
  });
});
