/**
 * 文件管理器写操作的「目标已存在」判定契约。
 *
 * 此前用 existsSync 先查后建：目标落在断连的网络映射盘时同步探测会卡住整个事件循环。
 * 现在新建 / 复制由原子操作（非递归 mkdir、wx 独占写、cp errorOnExist）保证，改名 / 移动用异步探测；
 * 这里在真实临时目录上锁定对外语义不变：同名即 400，不覆盖已有内容。
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../lib/settings', () => ({ getSettings: vi.fn(async () => ({ uploadMaxSizeMb: 10 })) }));

import { copyEntry, createEntry, moveEntry, renameEntry } from './terminal-files.service';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcbase-terminal-files-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function expect400(promise: Promise<unknown>, message: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HTTPException);
  expect((err as HTTPException).status).toBe(400);
  expect((err as HTTPException).message).toBe(message);
}

describe('createEntry', () => {
  it('新建文件 / 目录会补齐父目录；同名再建返回 400 且不覆盖内容', async () => {
    const file = path.join(root, 'a', 'b', 'note.txt');
    const entry = await createEntry(file, 'file');
    expect(entry).toMatchObject({ type: 'file', size: 0, name: 'note.txt' });
    await fs.writeFile(file, 'keep me');

    await expect400(createEntry(file, 'file'), '同名文件或目录已存在');
    await expect400(createEntry(file, 'dir'), '同名文件或目录已存在');
    expect(await fs.readFile(file, 'utf8')).toBe('keep me');

    const dir = path.join(root, 'x', 'y');
    expect(await createEntry(dir, 'dir')).toMatchObject({ type: 'dir', name: 'y' });
    await expect400(createEntry(dir, 'dir'), '同名文件或目录已存在');
  });
});

describe('copyEntry / renameEntry / moveEntry', () => {
  it('目标已存在时均返回 400，成功路径保持原语义', async () => {
    const src = path.join(root, 'src.txt');
    const occupied = path.join(root, 'occupied.txt');
    await fs.writeFile(src, 'source');
    await fs.writeFile(occupied, 'occupied');

    await expect400(copyEntry(src, occupied), '目标路径已存在');
    await expect400(renameEntry(src, occupied), '目标已存在');
    await expect400(moveEntry(src, occupied), '目标路径已存在');
    expect(await fs.readFile(occupied, 'utf8')).toBe('occupied');

    const copied = path.join(root, 'nested', 'copy.txt');
    expect(await copyEntry(src, copied)).toMatchObject({ type: 'file', name: 'copy.txt' });
    expect(await fs.readFile(copied, 'utf8')).toBe('source');

    const moved = path.join(root, 'moved', 'src.txt');
    expect(await moveEntry(src, moved)).toMatchObject({ type: 'file', name: 'src.txt' });
    await expect(fs.stat(src)).rejects.toThrow();
    expect(await fs.readFile(moved, 'utf8')).toBe('source');

    const renamed = path.join(root, 'renamed.txt');
    expect(await renameEntry(moved, renamed)).toMatchObject({ type: 'file', name: 'renamed.txt' });
  });

  it('复制目录树时目标目录已存在同样拒绝', async () => {
    const srcDir = path.join(root, 'tree');
    await fs.mkdir(path.join(srcDir, 'inner'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'inner', 'f.txt'), '1');
    const dstDir = path.join(root, 'tree-copy');
    await fs.mkdir(dstDir);

    await expect400(copyEntry(srcDir, dstDir), '目标路径已存在');
    expect(await copyEntry(srcDir, path.join(root, 'tree-copy-2'))).toMatchObject({ type: 'dir' });
    expect(await fs.readFile(path.join(root, 'tree-copy-2', 'inner', 'f.txt'), 'utf8')).toBe('1');
  });
});
