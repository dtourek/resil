import { type Either, isLeft, isRight, Left, type Maybe } from 'fputils';
import { type ICache, type ICacheRecord, localCache } from '../cache/localCache';
import { incrementFail, incrementSuccess, setEmptyCache } from '../utils/utils';
import { promiseMaybe } from '../promise/promise';
import { type ILogger } from '../logger/logger';

// TODO - warmup - apply rules after a treshold has been reached. e.g. 100 hits. Or evaluate after a time period
// TODO - half open state retry count
// TODO - redo state to semaphore (reg, orange, green) to better understanding of devs
// TODO - unite Maybe and Either to 1 type everywhere

export enum CircuitBreakerState {
  /**
   * If state is closed, all traffic is allowed and passed through
   */
  closed = 'Closed',
  /**
   * If state is Open, all traffic fails fast
   */
  open = 'Open',
  /**
   * If state is HalfOpen, only traffic is being passed through after amount of time to test if endpoint is back online after failing state
   */
  halfOpen = 'HalfOpen',
}

interface IPromiseOptions {
  timeout?: number;
  retryCount?: number;
}

export interface ICircuitBreakerConfig {
  /**
   * When Circuit breaker enters Open state, retry availability after amount of seconds. After this time, status is changed from Open to HalfOpen to retest if resource is available.
   */
  switchToHalfOpenIn: number;
  /**
   * Lifetime of cache value in seconds
   */
  cacheLifetime: number;
  /**
   * On how many percents switch from Closed(ok) to Open(failing) circuit breaker state.
   */
  failRate: number;
  logger: ILogger;
  promiseOptions?: IPromiseOptions;
}

export interface ICircuitBreakerState {
  isRecovering: boolean;
  status: CircuitBreakerState;
}

export interface ICircuitBreaker {
  clearCache: () => void;
  state: () => Either<string, ICacheRecord>;
  stateAll: () => any;
  request: <T>(promiseFn: () => Promise<Maybe<T>>, options?: IPromiseOptions) => Promise<Maybe<T>>;
}

const shouldOpenAndRecover = (cacheValue: ICacheRecord, failRate: ICircuitBreakerConfig['failRate']): boolean => cacheValue.counters.failRate >= failRate;

const getOrCreateEmptyCacheRecord = (cache: ICache, key: string, options: ICircuitBreakerConfig): Either<string, ICacheRecord> => {
  const rawCacheValue = cache.getOne(key);
  if (isLeft(rawCacheValue)) {
    return setEmptyCache(cache, key, options.cacheLifetime);
  }
  return rawCacheValue;
};

const setOpenAndRecover = (cache: ICache, key: string, cacheValue: ICacheRecord): Either<string, ICacheRecord> =>
  cache.set(key, { ...cacheValue, state: { isRecovering: true, status: CircuitBreakerState.open } });

const toHalfOpenIn = (cache: ICache, key: string, cacheValue: ICacheRecord, switchToHalfOpenIn: ICircuitBreakerConfig['switchToHalfOpenIn']): void => {
  cache.set(key, { ...cacheValue, state: { ...cacheValue.state, isRecovering: false } });
  setTimeout(() => {
    cache.set(key, { ...cacheValue, state: { isRecovering: false, status: CircuitBreakerState.halfOpen } });
  }, switchToHalfOpenIn);
};

/**
 * Circuit breaker wrapper for resilient async fetching.
 *
 * When threshold of failed requests is reached, circuit breaker is set to state Open and every request fails immediately.
 * Auto recovery from Open(failing) state is automatically done after a period of time represented by "switchToHalfOpenIn" variable.
 *
 * When on HalfOpen state, it tries a request and depending on response, it will switch to either Open - if request fails or Closed - if request succeeds
 * When on closed state, all requests are passed through
 *
 * Retry pattern and timeouts are implemented internally. Configurable via "request" method's parameters.
 * @return {ICircuitBreaker}
 * @param key
 */
export const circuitBreaker = (key: string, config: ICircuitBreakerConfig): ICircuitBreaker => {
  const cache = localCache();

  return {
    clearCache: cache.clear,
    state: () => getOrCreateEmptyCacheRecord(cache, key, config),
    stateAll: cache.getAll,
    request: async (promiseFn, options) => {
      const cacheValue = getOrCreateEmptyCacheRecord(cache, key, config);
      if (isLeft(cacheValue)) {
        // Fallback if cache is not available
        return await promiseMaybe(promiseFn(), config.logger, options?.timeout ?? config.promiseOptions?.timeout, options?.retryCount ?? config.promiseOptions?.retryCount);
      }

      if (cacheValue.value.state.status === CircuitBreakerState.open) {
        if (cacheValue.value.state.isRecovering) {
          toHalfOpenIn(cache, key, cacheValue.value, config.switchToHalfOpenIn);
        }

        return Left(new Error(`Circuit breaker is on for function: "${key}".`));
      }

      if (cacheValue.value.state.status === CircuitBreakerState.closed) {
        if (shouldOpenAndRecover(cacheValue.value, config.failRate)) {
          setOpenAndRecover(cache, key, cacheValue.value);
          return Left(new Error(`Circuit breaker has been opened`));
        }

        const result = await promiseMaybe(promiseFn(), config.logger, options?.timeout ?? config.promiseOptions?.timeout, options?.retryCount ?? config.promiseOptions?.retryCount);
        if (isLeft(result)) {
          incrementFail(cache, key, config.cacheLifetime);
          return result;
        }

        incrementSuccess(cache, key, config.cacheLifetime);
        return result;
      }

      if (cacheValue.value.state.status === CircuitBreakerState.halfOpen) {
        const result = await promiseMaybe(promiseFn(), config.logger, options?.timeout ?? config.promiseOptions?.timeout, options?.retryCount ?? config.promiseOptions?.retryCount);
        if (isLeft(result)) {
          const incremented = incrementFail(cache, key, config.cacheLifetime);
          isRight(incremented) && toHalfOpenIn(cache, key, incremented.value, config.switchToHalfOpenIn);
          return result;
        }

        setEmptyCache(cache, key, config.cacheLifetime);
        return result;
      }

      return Left(new Error(`No action taken for key="${key}"`));
    },
  };
};
