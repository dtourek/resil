import { localCache } from '../localCache';
import { Left, Right } from 'fputils';
import { CircuitBreakerState } from '../../circuit-breaker/circuitBreaker';

describe('localCache', () => {
  beforeEach(() => {
    Date.now = () => new Date().valueOf();
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('cannot get a value if cache is empty', () => {
      expect(localCache().get('a')).toEqual(Left('No value in the cache found'));
    });

    it('should return error when requesting another key', () => {
      const now = new Date();
      const tomorrow = new Date(now.setDate(now.getDate() + 1));
      localCache().set('note-1', {
        expiresAt: tomorrow,
        counters: { total: 123, fail: 0, failRate: 30, success: 20 },
        state: { isRecovering: true, status: CircuitBreakerState.open },
      });
      expect(localCache().get('note-55')).toEqual(Left('No value in the cache found'));
    });

    it('should not return value if is expired and it should be removed from the cache', () => {
      const now = new Date();
      const now2 = new Date();
      const dayAfterTomorrow = new Date(now.setDate(now.getDate() + 2));
      const tomorrow = new Date(now2.setDate(now2.getDate() + 1));
      const key = 'note-5';
      localCache().set(key, { expiresAt: tomorrow, counters: { total: 1, fail: 0, failRate: 30, success: 20 }, state: { isRecovering: true, status: CircuitBreakerState.open } });

      // Sets current date to day after tomorrow value
      Date.now = jest.fn(() => dayAfterTomorrow.valueOf());
      expect(localCache().get(key)).toEqual(Left('Value from the cache expired'));
      expect(localCache().get(key)).toEqual(Left('No value in the cache found'));
    });

    it('should return a cache value correctly', () => {
      const now = new Date();
      const tomorrow = new Date(now.setDate(now.getDate() + 1));
      const updatedKey = 'note-2';
      localCache().set('note-1', {
        expiresAt: tomorrow,
        counters: { total: 123, fail: 0, failRate: 30, success: 20 },
        state: { isRecovering: true, status: CircuitBreakerState.open },
      });
      localCache().set(updatedKey, {
        expiresAt: tomorrow,
        counters: { total: 345, fail: 0, failRate: 30, success: 20 },
        state: { isRecovering: true, status: CircuitBreakerState.open },
      });
      localCache().set(updatedKey, {
        expiresAt: tomorrow,
        counters: { total: 999, fail: 0, failRate: 30, success: 20 },
        state: { isRecovering: true, status: CircuitBreakerState.open },
      });
      expect(localCache().get(updatedKey)).toMatchObject(
        Right({ counters: { total: 999, fail: 0, failRate: 30, success: 20 }, state: { isRecovering: true, status: CircuitBreakerState.open } }),
      );
    });
  });

  describe('set', () => {
    it('should not set a value in the cache when expiresAt is in the past', () => {
      const now = new Date();
      const yesterday = new Date(now.setDate(now.getDate() - 1));
      expect(
        localCache().set('abc', {
          expiresAt: yesterday,
          counters: { total: 11, fail: 0, failRate: 30, success: 20 },
          state: { isRecovering: true, status: CircuitBreakerState.open },
        }),
      ).toEqual(Left('Cannot set value which already expired'));
    });

    it('should set a value correctly', () => {
      const now = new Date();
      const tomorrow = new Date(now.setDate(now.getDate() + 1));
      expect(
        localCache().set('key', {
          expiresAt: tomorrow,
          counters: { total: 5, fail: 0, failRate: 30, success: 20 },
          state: { isRecovering: true, status: CircuitBreakerState.open },
        }),
      ).toMatchObject(Right({ counters: { fail: 0, failRate: 30, success: 20, total: 5 }, state: { isRecovering: true, status: CircuitBreakerState.open } }));
    });
  });
});
