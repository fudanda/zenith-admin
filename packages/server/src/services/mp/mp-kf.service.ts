import { and, eq } from 'drizzle-orm';
import { mpKfAccountContract, mpKfAccountSchema } from '@arcbase/shared/mp';
import { db } from '../../db';
import { mpKfAccounts } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { currentCreateTenantId } from '../../lib/tenant';
import { keywordCondition } from '../../lib/where-helpers';
import { ensureMpAccountExists } from './mp-account.service';
import { getWechatKfList, addWechatKfAccount, updateWechatKfAccount, delWechatKfAccount } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';

export const mapMpKfAccount = entityMapper(mpKfAccountSchema);

const mpKfAccountCrud = defineCrudService(mpKfAccountContract, {
  table: mpKfAccounts,
  map: mapMpKfAccount,
  notFound: '客服账号不存在',
  unique: '该客服账号已存在',
  tenant: true,
  list: (q) => ({
    where: [
      eq(mpKfAccounts.accountId, q.accountId),
      keywordCondition(q.keyword, [mpKfAccounts.nickname], 'ilike'),
    ],
    orderBy: [mpKfAccounts.id],
  }),
  create: {
    before: async (data) => {
      const account = await ensureMpAccountExists(data.accountId);
      try {
        await addWechatKfAccount(account, data.kfAccount, data.nickname);
      } catch (err) {
        return mapWechatError(err);
      }
    },
    toRow: (data) => ({
      accountId: data.accountId,
      kfAccount: data.kfAccount,
      nickname: data.nickname,
    }),
  },
  update: {
    before: async (data, existing) => {
      const account = await ensureMpAccountExists(existing.accountId);
      try {
        await updateWechatKfAccount(account, existing.kfAccount, data.nickname);
      } catch (err) {
        return mapWechatError(err);
      }
    },
    toRow: (data) => ({ nickname: data.nickname }),
  },
  remove: {
    before: async (existing) => {
      const account = await ensureMpAccountExists(existing.accountId);
      try {
        await delWechatKfAccount(account, existing.kfAccount);
      } catch (err) {
        return mapWechatError(err);
      }
    },
  },
});

export async function listMpKfAccounts(q: Parameters<typeof mpKfAccountCrud.list>[0]) {
  await ensureMpAccountExists(q.accountId);
  return mpKfAccountCrud.list(q);
}

export const mpKfAccountService = { ...mpKfAccountCrud, list: listMpKfAccounts };

export const {
  ensure: ensureMpKfAccountExists,
  create: createMpKfAccount,
  update: updateMpKfAccount,
  remove: deleteMpKfAccount,
} = mpKfAccountCrud;

export const getMpKfAccountBeforeAudit = mpKfAccountCrud.get;

/** 从微信同步客服账号（按 kf_account upsert）。 */
export async function syncMpKfAccounts(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  let kfList;
  try {
    kfList = await getWechatKfList(account);
  } catch (err) {
    return mapWechatError(err);
  }
  const tenantId = currentCreateTenantId();
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const kf of kfList) {
      const [existing] = await tx.select({ id: mpKfAccounts.id }).from(mpKfAccounts)
        .where(and(eq(mpKfAccounts.accountId, accountId), eq(mpKfAccounts.kfAccount, kf.kf_account))).limit(1);
      const patch = { nickname: kf.kf_nick, avatar: kf.kf_headimgurl ?? null, kfId: kf.kf_id ?? null, inviteStatus: kf.invite_status ?? 'none', inviteWx: kf.invite_wx ?? null };
      if (existing) {
        await tx.update(mpKfAccounts).set(patch).where(eq(mpKfAccounts.id, existing.id));
        updated += 1;
      } else {
        await tx.insert(mpKfAccounts).values({ accountId, kfAccount: kf.kf_account, ...patch, tenantId });
        created += 1;
      }
    }
  });
  return { success: true, created, updated, total: kfList.length };
}
