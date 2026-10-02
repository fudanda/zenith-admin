import { OpenAPIHono } from '@hono/zod-openapi';
import { aiSettingsContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMyAiSettings, saveMyAiSettings } from '../../services/ai/ai-user-settings.service';
import { getMemoryProfile, updateMemoryProfile, clearMemoryProfile } from '../../services/ai/ai-memory.service';
import { currentUser } from '../../lib/context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const get = defineContractRoute(aiSettingsContract.me, {
  handler: async (c) => c.json(okBody(await getMyAiSettings()), 200),
});

const save = defineContractRoute(aiSettingsContract.save, {
  handler: async (c) => c.json(okBody(await saveMyAiSettings(c.req.valid('json')), '保存成功'), 200),
});

const getProfile = defineContractRoute(aiSettingsContract.memoryProfile, {
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody({ content: await getMemoryProfile(user.userId) }), 200);
  },
});

const putProfile = defineContractRoute(aiSettingsContract.saveMemoryProfile, {
  handler: async (c) => {
    const user = currentUser();
    const { content } = c.req.valid('json');
    await updateMemoryProfile(user.userId, content);
    return c.json(okBody({ content: content || null }, '保存成功'), 200);
  },
});

const deleteProfile = defineContractRoute(aiSettingsContract.clearMemoryProfile, {
  handler: async (c) => {
    const user = currentUser();
    await clearMemoryProfile(user.userId);
    return c.json(okBody(null, '已清空'), 200);
  },
});

router.openapiRoutes([get, save, getProfile, putProfile, deleteProfile] as const);

export default router;
