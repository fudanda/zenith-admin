/**
 * 应用版本管理种子数据。
 *
 * SEED_CLIENT_APPS 进 DB seed：桌面端 / 移动端是产品自带的客户端形态，预置应用记录，
 * 用户也可在「应用管理」中自由增删；版本与制品由管理员真实发布产生。
 * SEED_APP_RELEASES / SEED_APP_ARTIFACTS 仅供 Demo 模式（MSW mock）派生使用。
 */
import type { AppRelease, AppArtifact, ClientApp } from '../ops/contracts';
import { SEED_DATE } from './_base';

export const SEED_CLIENT_APPS: ClientApp[] = [
  {
    id: 1, appKey: 'arcbase-desktop', name: 'ArcBase 桌面端',
    description: 'Electron 桌面客户端（Windows / macOS / Linux）', kind: 'client', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, appKey: 'arcbase-mobile', name: 'ArcBase 移动端',
    description: '移动客户端（Android / iOS）', kind: 'client', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

/** Demo 数据：仅 MSW mock 派生，不进 DB seed */
export const SEED_APP_RELEASES: AppRelease[] = [
  {
    id: 1, appId: 1, appKey: 'arcbase-desktop', appName: 'ArcBase 桌面端',
    channel: 'stable', version: '1.84.0', notes: '## 1.84.0\n\n- 修复若干问题\n- 性能优化',
    status: 'published', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: '2025-06-01 10:00:00', artifactCount: 2,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, appId: 1, appKey: 'arcbase-desktop', appName: 'ArcBase 桌面端',
    channel: 'stable', version: '1.85.0', notes: '## 1.85.0\n\n- 新增应用版本管理\n- 支持在线升级',
    status: 'published', mandatory: false, minVersion: '1.80.0', rolloutPercent: 30,
    publishedAt: '2025-06-15 10:00:00', artifactCount: 3,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 3, appId: 1, appKey: 'arcbase-desktop', appName: 'ArcBase 桌面端',
    channel: 'beta', version: '1.86.0-beta.1', notes: '## 1.86.0-beta.1\n\n- 体验新特性',
    status: 'draft', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: null, artifactCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 4, appId: 2, appKey: 'arcbase-mobile', appName: 'ArcBase 移动端',
    channel: 'stable', version: '1.10.0', notes: '## 1.10.0\n\n- 移动审批体验优化',
    status: 'published', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: '2025-06-10 09:00:00', artifactCount: 2,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  // 服务端应用（Demo）：两版已发布的部署包，供「应用部署」演示部署 / 回滚
  {
    id: 5, appId: 3, appKey: 'order-svc', appName: '订单服务',
    channel: 'stable', version: '1.4.1', notes: '## 1.4.1\n\n- 修复退款状态回写',
    status: 'published', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: '2026-09-01 10:00:00', artifactCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 6, appId: 3, appKey: 'order-svc', appName: '订单服务',
    channel: 'stable', version: '1.4.2', notes: '## 1.4.2\n\n- 订单导出改为异步任务\n- 依赖升级',
    status: 'published', mandatory: false, minVersion: null, rolloutPercent: 100,
    publishedAt: '2026-09-12 10:00:00', artifactCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

/** Demo 数据：服务端应用（不进 DB seed——预置应用只有产品自带的客户端形态） */
export const SEED_DEMO_SERVICE_APPS: ClientApp[] = [
  {
    id: 3, appKey: 'order-svc', name: '订单服务',
    description: 'Spring Boot 服务端应用，部署包为 tar.gz', kind: 'service', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_APP_ARTIFACTS: AppArtifact[] = [
  { id: 1, releaseId: 1, platform: 'windows', arch: 'x64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'ArcBase-Admin-Setup-1.84.0.exe', size: 98_566_144, sha256: 'a'.repeat(64), downloadCount: 1286, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, releaseId: 1, platform: 'windows', arch: 'x64', kind: 'metadata', fileId: null, externalUrl: null, fileName: 'latest.yml', size: 512, sha256: null, downloadCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, releaseId: 2, platform: 'windows', arch: 'x64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'ArcBase-Admin-Setup-1.85.0.exe', size: 99_614_720, sha256: 'b'.repeat(64), downloadCount: 342, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, releaseId: 2, platform: 'windows', arch: 'x64', kind: 'hotupdate', fileId: null, externalUrl: null, fileName: 'web-1.85.0.zip', size: 18_874_368, sha256: 'c'.repeat(64), downloadCount: 923, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, releaseId: 2, platform: 'macos', arch: 'arm64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'ArcBase-Admin-1.85.0-arm64.dmg', size: 104_857_600, sha256: 'd'.repeat(64), downloadCount: 87, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, releaseId: 3, platform: 'windows', arch: 'x64', kind: 'installer', fileId: null, externalUrl: null, fileName: 'ArcBase-Admin-Setup-1.86.0-beta.1.exe', size: 99_614_720, sha256: 'e'.repeat(64), downloadCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, releaseId: 4, platform: 'android', arch: 'universal', kind: 'installer', fileId: null, externalUrl: null, fileName: 'arcbase-mobile-1.10.0.apk', size: 45_088_768, sha256: 'f'.repeat(64), downloadCount: 466, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, releaseId: 4, platform: 'ios', arch: 'universal', kind: 'external', fileId: null, externalUrl: 'https://apps.apple.com/app/id0000000000', fileName: 'App Store', size: 0, sha256: null, downloadCount: 208, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, releaseId: 5, platform: 'server', arch: 'x64', kind: 'archive', fileId: null, externalUrl: null, fileName: 'order-svc-1.4.1.tar.gz', size: 68_157_440, sha256: '1'.repeat(64), downloadCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, releaseId: 6, platform: 'server', arch: 'x64', kind: 'archive', fileId: null, externalUrl: null, fileName: 'order-svc-1.4.2.tar.gz', size: 69_206_016, sha256: '2'.repeat(64), downloadCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
