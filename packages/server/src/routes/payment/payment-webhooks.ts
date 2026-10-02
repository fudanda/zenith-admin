import { paymentWebhookContract } from '@arcbase/shared/open-platform';
import { createAppWebhookRouter } from '../open-platform/app-webhooks-router';

export default createAppWebhookRouter(paymentWebhookContract, {
  domain: 'payment',
});
