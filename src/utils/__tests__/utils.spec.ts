import { localCache } from '../../cache/localCache';
import { Left } from 'fputils';
import { incrementFail, incrementSuccess, setEmptyCache } from '../utils';

describe('circuit breaker utils', () => {
  describe('incrementSuccess', () => {
    it('should not increment success when cache is empty', () => {
      const cache = localCache();
      expect(incrementSuccess(cache, 'abc', 55)).toEqual(Left('No value in the cache found'));
    });

    it('should not increment success when cache is expired', () => {
      const cache = localCache();
      const key = 'xyz';
      setEmptyCache(cache, key, 0);
      const result = incrementSuccess(cache, key, 555);
      expect(result).toEqual(Left('No value in the cache found'));
    });

    it('should not increment when trying to update non existing key', () => {
      const cache = localCache();
      const key = '123456';
      setEmptyCache(cache, key, 555);
      const result = incrementSuccess(cache, 'other-key', 555);
      expect(result).toEqual(Left('No value in the cache found'));
    });

    it('should increment success', () => {
      const cacheKey = 'key';
      const cacheLifetime = 4312;
      const cache = localCache();
      setEmptyCache(cache, cacheKey, cacheLifetime);
      const cacheValue = incrementSuccess(cache, cacheKey, cacheLifetime);
      expect(cacheValue.value).toMatchObject({ counters: { fail: 0, failRate: 0, success: 1, total: 1 } });
    });

    it('should increment success few times', () => {
      const cacheKey = 'key-544';
      const cacheLifetime = 1000;
      const cache = localCache();
      setEmptyCache(cache, cacheKey, cacheLifetime);
      incrementSuccess(cache, cacheKey, cacheLifetime);
      incrementSuccess(cache, cacheKey, cacheLifetime);
      incrementSuccess(cache, cacheKey, cacheLifetime);
      const cacheValue = incrementSuccess(cache, cacheKey, cacheLifetime);

      expect(cacheValue.value).toMatchObject({ counters: { fail: 0, failRate: 0, success: 4, total: 4 } });
    });
  });

  describe('incrementFail', () => {
    it('should not increment fail when cache is empty', () => {
      const cache = localCache();
      expect(incrementFail(cache, 'abc', 55)).toEqual(Left('No value in the cache found'));
    });

    it('should not increment fail when cache is expired', () => {
      const cache = localCache();
      const key = 'xyz';
      setEmptyCache(cache, key, 0);
      const result = incrementFail(cache, key, 51);
      expect(result).toEqual(Left('No value in the cache found'));
    });

    it('should not increment when trying to update non existing key', () => {
      const cache = localCache();
      const key = '123456';
      setEmptyCache(cache, key, 555);
      const result = incrementFail(cache, 'other-key', 555);
      expect(result).toEqual(Left('No value in the cache found'));
    });

    it('should increment fail state', () => {
      const cacheKey = 'key';
      const cacheLifetime = 4312;
      const cache = localCache();
      setEmptyCache(cache, cacheKey, cacheLifetime);
      const cacheValue = incrementFail(cache, cacheKey, cacheLifetime);
      expect(cacheValue.value).toMatchObject({ counters: { fail: 1, failRate: 100, success: 0, total: 1 } });
    });

    it('should increment fail few times', () => {
      const cacheKey = 'key';
      const cacheLifetime = 4312;
      const cache = localCache();
      setEmptyCache(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);
      const cacheValue = incrementFail(cache, cacheKey, cacheLifetime);
      expect(cacheValue.value).toMatchObject({ counters: { fail: 5, failRate: 100, success: 0, total: 5 } });
    });

    it('should increment fail and success', () => {
      const cacheKey = 'key';
      const cacheLifetime = 4312;
      const cache = localCache();
      setEmptyCache(cache, cacheKey, cacheLifetime);

      incrementFail(cache, cacheKey, cacheLifetime);
      incrementSuccess(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);
      incrementSuccess(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);
      incrementFail(cache, cacheKey, cacheLifetime);

      const result = cache.getOne(cacheKey);
      expect(result.value).toMatchObject({ counters: { fail: 4, failRate: 66.67, success: 2, total: 6 } });
    });
  });
});
