/**
 * 渲染 / 打开用户可控 URL 前的最后一道闸门。
 *
 * 服务端 schema 已把链接字段限定为 http(s) / 站内路径，但历史数据、Demo Mock、
 * 第三方回传（链接预览、卡片）仍可能带来 `javascript:` / `file:` / `data:`；
 * 所有 href / src / window.open 目标统一经这里过滤，未通过则不渲染或不打开。
 */
import { isHttpUrl, isSafeExternalUrl, isSafeLinkUrl, isSameOriginUrl } from '@arcbase/shared/core';

/** 可作为 <a href> / <img src> / <video src> 的地址；不安全时返回 undefined（React 会省略该属性） */
export function safeLinkUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return isSafeLinkUrl(trimmed) ? trimmed : undefined;
}

/** 仅接受绝对 http(s) URL（iframe src、外链下钻等） */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return isHttpUrl(trimmed) ? trimmed : undefined;
}

/**
 * 在新标签页打开外部地址：只放行 http(s) / mailto / tel，并强制 noopener,noreferrer
 * （切断 window.opener，`javascript:` 也无法借新窗口回到本源）。返回是否已打开。
 */
export function openExternalUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!isSafeExternalUrl(trimmed)) return false;
  window.open(trimmed, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * 嵌入第三方页面时的 sandbox：跨源页面需要 allow-same-origin 才能用自己的 cookie / storage，
 * 而同源（含站内路径）页面必须去掉它，否则被嵌入的同源文档可直接读取本应用的 token。
 */
export function iframeSandboxFor(src: string): string {
  const base = 'allow-scripts allow-popups allow-forms';
  return isSameOriginUrl(src, window.location.origin) ? base : `${base} allow-same-origin`;
}
