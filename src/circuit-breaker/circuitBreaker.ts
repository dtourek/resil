import {Either, isLeft, isRight, Left, Maybe} from 'fputils';
import { ICache, ICacheRecord, localCache } from '../cache/localCache';
import { incrementFail, incrementSuccess, setEmptyCache } from '../utils/utils';
import { promiseMaybe } from "../promise/promise";
import { ILogger } from "../logger/logger";

// TODO - apply rules after a treshold has been reached. e.g. 100 hits. Or evaluate after warmup time period
// TODO - half open state retry count
// TODO - redo state to semaphore (reg, orange, green) to better understanding of devs

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
  logger: ILogger
}

export interface ICircuitBreakerState {
  isRecovering: boolean;
  status: CircuitBreakerState;
}

const shouldOpenAndRecover = (cacheValue: ICacheRecord, failRate: ICircuitBreakerConfig['failRate']) => cacheValue.counters.failRate >= failRate;

const getOrCreateEmptyCacheRecord = (cache: ICache, key: string, config: ICircuitBreakerConfig): Either<string, ICacheRecord> => {
  const rawCacheValue = cache.get(key);
  if (isLeft(rawCacheValue)) {
    return setEmptyCache(cache, key, config.cacheLifetime);
  }
  return rawCacheValue;
};

const setOpenAndRecover = (cache: ICache, key: string, cacheValue: ICacheRecord) => cache.set(key, { ...cacheValue, state: { isRecovering: true, status: CircuitBreakerState.open } });

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
 * @param {string} key
 * @param {ICircuitBreakerConfig} config
 */
export const circuitBreaker = (key: string, config: ICircuitBreakerConfig) => {
  const cache = localCache();

  return {
    clearCache: cache.clear,
    state: () => getOrCreateEmptyCacheRecord(cache, key, config),
    request: async <T>(promiseFn: () => Promise<Maybe<T>>, timeout?: number, retryCount?: number): Promise<Maybe<T>> => {
      const cacheValue = getOrCreateEmptyCacheRecord(cache, key, config);
      if (isLeft(cacheValue)) {
        // Fallback if cache is not available
        return promiseMaybe(promiseFn(), config.logger, timeout, retryCount);
      }

      if (cacheValue.value.state.status === CircuitBreakerState.open) {
        if (cacheValue.value.state.isRecovering) {
          cache.set(key, { ...cacheValue.value, state: { ...cacheValue.value.state, isRecovering: false } });
          setTimeout(() => {
            cache.set(key, { ...cacheValue.value, state: { isRecovering: false, status: CircuitBreakerState.halfOpen } });
          }, config.switchToHalfOpenIn);
        }

        return Left(new Error(`Circuit breaker is on for function: "${key}".`));
      }

      if (cacheValue.value.state.status === CircuitBreakerState.closed) {
        if (shouldOpenAndRecover(cacheValue.value, config.failRate)) {
          setOpenAndRecover(cache, key, cacheValue.value);
          return Left(new Error(`Circuit breaker has been opened`));
        }

        const result = await promiseMaybe(promiseFn(), config.logger, timeout, retryCount);
        if (isLeft(result)) {
          incrementFail(cache, key, config.cacheLifetime);
          return result;
        }

        incrementSuccess(cache, key, config.cacheLifetime);
        return result;
      }

      if (cacheValue.value.state.status === CircuitBreakerState.halfOpen) {
        const result = await promiseMaybe(promiseFn(), config.logger, timeout, retryCount);
        if (isLeft(result)) {
          const incremented = incrementFail(cache, key, config.cacheLifetime)
          setOpenAndRecover(cache, key, isRight(incremented) ? incremented.value : cacheValue.value);
          return result;
        }

        setEmptyCache(cache, key, config.cacheLifetime);
        return result;
      }

      return Left(new Error(`No action taken for key="${key}"`));
    },
  };
};