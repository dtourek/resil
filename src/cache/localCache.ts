import { type Either, Left, Right } from 'fputils';
import { type ICircuitBreakerState } from '../circuit-breaker/circuitBreaker';

export interface ICache {
  clear: () => void;
  set: (key: string, value: ICacheRecord) => Either<string, ICacheRecord>;
  get: (key: string) => Either<string, ICacheRecord>;
}

export interface ICacheRecord {
  state: ICircuitBreakerState;
  counters: { total: number; failRate: number; success: number; fail: number };
  expiresAt: Date;
}

const cache = new Map<string, ICacheRecord>();
const isExpired = (value: ICacheRecord): boolean => value.expiresAt.valueOf() <= Date.now();

export const localCache = (): ICache => {
  return {
    clear: () => {
      cache.clear();
    },
    set: (key, value) => {
      if (isExpired(value)) {
        return Left('Cannot set value which already expired');
      }

      const result = cache.set(key, value).get(key);
      if (!result) {
        return Left('Cannot set value');
      }
      return Right(result);
    },
    get: (key) => {
      const value = cache.get(key);
      if (!value) {
        return Left('No value in the cache found');
      }
      if (isExpired(value)) {
        cache.delete(key);
        return Left('Value from the cache expired');
      }

      return Right(value);
    },
  };
};
