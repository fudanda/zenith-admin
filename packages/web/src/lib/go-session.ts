import { goAuthContract } from '@arcbase/shared/identity';
import { contractKey } from '@/lib/contract-query';

export const goSessionKey = contractKey(goAuthContract.me);
