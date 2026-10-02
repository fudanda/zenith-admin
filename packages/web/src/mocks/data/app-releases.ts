/**
 * 应用版本管理 Mock 数据（Demo 模式）。
 * 初始数据从 @arcbase/shared/seed 派生；制品/版本关系在 handlers 中按 releaseId 组装。
 */
import { SEED_APP_ARTIFACTS, SEED_APP_RELEASES, SEED_CLIENT_APPS, SEED_DEMO_SERVICE_APPS } from '@arcbase/shared/seed';
import type { AppArtifact, AppRelease, ClientApp } from '@arcbase/shared/ops';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockClientApps: ClientApp[] = [...SEED_CLIENT_APPS, ...SEED_DEMO_SERVICE_APPS].map((a) => ({ ...a }));
export const mockAppReleases: AppRelease[] = SEED_APP_RELEASES.map((r) => ({ ...r }));
export const mockAppArtifacts: AppArtifact[] = SEED_APP_ARTIFACTS.map((a) => ({ ...a }));

let nextClientAppId = nextIdFrom(mockClientApps);
export function getNextClientAppId(): number {
  return nextClientAppId++;
}

let nextAppReleaseId = nextIdFrom(mockAppReleases);
export function getNextAppReleaseId(): number {
  return nextAppReleaseId++;
}

let nextAppArtifactId = nextIdFrom(mockAppArtifacts);
export function getNextAppArtifactId(): number {
  return nextAppArtifactId++;
}
