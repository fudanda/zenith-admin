import { goAuthContract } from '@arcbase/shared/identity';
import { api, apiRaw } from '@/lib/contract-query';
import { goApiClient } from './go-api-client';
export { createGoApiClient, goApiClient } from './go-api-client';

export function getGoCaptcha() {
  return api(goAuthContract.captcha, { client: goApiClient, silent: true });
}

export function loginGo(input: {
  username: string;
  password: string;
  captchaId: string;
  captchaAnswer: string;
}) {
  return apiRaw(goAuthContract.login, { body: input }, { client: goApiClient, silent: true });
}

export function restoreGoSession() {
  return apiRaw(goAuthContract.me, { client: goApiClient, silent: true });
}

export function logoutGo() {
  return apiRaw(goAuthContract.logout, { client: goApiClient, silent: true });
}
