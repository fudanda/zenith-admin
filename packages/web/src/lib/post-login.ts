/**
 * 「登录后默认首页」一次性跳转标记。
 * 登录成功且落地目标为 '/' 时写入 sessionStorage；
 * 首页路由（HomeEntry）读取后按偏好 homePath 决定是否跳转，
 * 偏好就绪后清除标记，避免用户手动访问 '/' 时被劫持。
 */
const POST_LOGIN_HOME_KEY = 'arcbase_post_login_home';

export function markPostLoginHome() {
  try {
    sessionStorage.setItem(POST_LOGIN_HOME_KEY, '1');
  } catch { /* ignore */ }
}

export function hasPostLoginHome(): boolean {
  try {
    return sessionStorage.getItem(POST_LOGIN_HOME_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearPostLoginHome() {
  try {
    sessionStorage.removeItem(POST_LOGIN_HOME_KEY);
  } catch { /* ignore */ }
}
