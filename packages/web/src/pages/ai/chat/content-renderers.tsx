import { MemoryUpdateCard, ToolCallCard, KbReferencesBlock } from './content-cards';
import type { DialogueContentItemRendererMap } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import type { KbRefDisplay } from './message-adapters';

export interface ContentRendererOptions {
  /** 「管理记忆」入口回调（打开 AI 个性化设置的记忆 Tab）；只读回放场景不传 */
  onManageMemory?: () => void;
}

/** 构建 AIChatDialogue 的 renderDialogueContentItem 渲染 map */
export function buildContentItemRenderers(options: ContentRendererOptions = {}): DialogueContentItemRendererMap {
  return {
    kb_references: (item: Record<string, unknown>) => (
      <KbReferencesBlock refs={(item.refs as KbRefDisplay[] | undefined) ?? []} />
    ),
    function_call: (item: Record<string, unknown>) => {
      const name = (item.name as string) ?? '';
      const args = (item.arguments as string) ?? '';
      if (name === 'updateWorkingMemory') {
        return <MemoryUpdateCard args={args} onManageMemory={options.onManageMemory} />;
      }
      return <ToolCallCard name={name} args={args} output={(item.output as string) ?? ''} />;
    },
  };
}
