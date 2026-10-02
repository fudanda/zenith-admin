import { appWebhookContract } from '@arcbase/shared/open-platform';
import { createAppWebhookRouter } from './app-webhooks-router';

export default createAppWebhookRouter(appWebhookContract, {
  domain: 'all',
});
