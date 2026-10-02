import { definePermissions } from '../core/permissions';

/**
 * ai 域权限码注册表：code → 按钮标题 / 所属页面（菜单 name）。
 * 种子 button 节点由此生成（@arcbase/shared/seed），契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const AI_PERMISSIONS = definePermissions({
  'ai:provider:list': { label: '查询', menu: 'AiProviders' },
  'ai:provider:create': { label: '新增', menu: 'AiProviders' },
  'ai:provider:edit': { label: '编辑', menu: 'AiProviders' },
  'ai:provider:delete': { label: '删除', menu: 'AiProviders' },
  'ai:feedback:view': { label: '查询', menu: 'AiFeedback' },
  'ai:feedback:handle': { label: '处理反馈', menu: 'AiFeedback' },
  'ai:prompt:list': { label: '查询', menu: 'AiPromptTemplates' },
  'ai:prompt:create': { label: '新增', menu: 'AiPromptTemplates' },
  'ai:prompt:edit': { label: '编辑', menu: 'AiPromptTemplates' },
  'ai:prompt:delete': { label: '删除', menu: 'AiPromptTemplates' },
  'ai:usage:view': { label: '查询', menu: 'AiUsage' },
  'ai:audit:view': { label: '查询', menu: 'AiAudit' },
  'ai:kb:list': { label: '查询', menu: 'AiKnowledge' },
  'ai:kb:create': { label: '新增', menu: 'AiKnowledge' },
  'ai:kb:edit': { label: '编辑', menu: 'AiKnowledge' },
  'ai:kb:delete': { label: '删除', menu: 'AiKnowledge' },
  'ai:studio:access': { label: 'Studio 接入', menu: 'AiAgents', sort: 1 },
  'ai:tool:list': { label: '查询', menu: 'AiTools' },
  'ai:tool:manage': { label: '管理', menu: 'AiTools' },
  'ai:eval:list': { label: '查询', menu: 'AiEval' },
  'ai:eval:manage': { label: '管理', menu: 'AiEval' },
});
