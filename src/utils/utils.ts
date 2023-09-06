import { type ICache, type ICacheRecord } from '../cache/localCache';
import { type Either, isRight } from 'fputils';
import { CircuitBreakerState, type ICircuitBreakerConfig } from '../circuit-breaker/circuitBreaker';

export const delay = async (ms: number): Promise<void> => {
  let timer: NodeJS.Timeout | null;
  await new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
    return timer;
  }).then(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
};

const secondsFromNow = (seconds: number): Date => {
  const now = new Date();
  return new Date(now.setSeconds(now.getSeconds() + seconds));
};

export const setEmptyCache = (cache: ICache, key: string, cacheLifetime: ICircuitBreakerConfig['cacheLifetime']): Either<string, ICacheRecord> =>
  cache.set(key, {
    state: { isRecovering: false, status: CircuitBreakerState.closed },
    expiresAt: secondsFromNow(cacheLifetime),
    counters: { total: 0, success: 0, fail: 0, failRate: 0 },
  });

const toDecimal = (value: number, decimals: number): number => Number(value.toFixed(decimals));

export const incrementFail = (cache: ICache, key: string, cacheLifetime: ICircuitBreakerConfig['cacheLifetime']): Either<string, ICacheRecord> => {
  const cacheValue = cache.getOne(key);
  if (isRight(cacheValue)) {
    const fail = cacheValue.value.counters.fail + 1;
    const total = cacheValue.value.counters.total + 1;

    cache.set(key, {
      ...cacheValue.value,
      expiresAt: secondsFromNow(cacheLifetime),
      counters: { total, success: cacheValue.value.counters.success, fail, failRate: toDecimal((fail / total) * 100, 2) },
    });
  }
  return cache.getOne(key);
};

export const incrementSuccess = (cache: ICache, key: string, cacheLifetime: ICircuitBreakerConfig['cacheLifetime']): Either<string, ICacheRecord> => {
  const cacheValue = cache.getOne(key);
  if (isRight(cacheValue)) {
    cache.set(key, {
      ...cacheValue.value,
      expiresAt: secondsFromNow(cacheLifetime),
      counters: {
        total: cacheValue.value.counters.total + 1,
        success: cacheValue.value.counters.success + 1,
        fail: cacheValue.value.counters.fail,
        failRate: cacheValue.value.counters.failRate,
      },
    });
  }

  return cache.getOne(key);
};
