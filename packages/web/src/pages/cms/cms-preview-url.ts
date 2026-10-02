/** 生成站点前台预览地址（无域名绑定时走 /__cms/{code} 预览前缀） */
export function cmsPreviewUrl(siteCode: string, path = ''): string {
  return `/__cms/${siteCode}/${path.replace(/^\/+/, '')}`;
}
