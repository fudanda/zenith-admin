import { chatBotContract, chatContract, chatWebhookPublicContract } from '@arcbase/shared/chat';
import { defineRouteDomain } from '../_kit';
import chatBotsRoutes from './chat-bots';
import chatPublicRoutes from './chat-public';
import chatRoutes from './chat';

export default defineRouteDomain({
  name: 'chat',
  mounts: () => [
    [chatWebhookPublicContract.basePath, chatPublicRoutes],
    [chatContract.basePath, chatRoutes, { feature: 'chat' }],
    [chatBotContract.basePath, chatBotsRoutes, { feature: 'chat' }],
  ],
});
