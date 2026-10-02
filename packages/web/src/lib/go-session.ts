import { goAuthContract } from '@zenith/shared/identity';
import { contractKey } from '@/lib/contract-query';

export const goSessionKey = contractKey(goAuthContract.me);
