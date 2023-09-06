import { circuitBreaker } from '../circuitBreaker';
import { Left, type Maybe, Right } from 'fputils';
import { delay } from '../../utils/utils';
import { getLogger } from '../../logger/logger';

describe('circuitBreaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(() => {
    jest.clearAllMocks();
  });

  const okPromise = async (): Promise<Maybe<string>> =>
    await new Promise((resolve) => {
      resolve(Right('ok'));
    });
  const failPromise = async (message?: string): Promise<Maybe<string>> =>
    await new Promise((resolve) => {
      resolve(Left(new Error(message ?? 'Failed')));
    });

  const logger = getLogger(console.log);

  it('should return init state', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    breaker.clearCache();
    const status = breaker.state('request-1');

    expect(status).toMatchObject(Right({ counters: { fail: 0, failRate: 0, success: 0, total: 0 }, state: { isRecovering: false, status: 'Closed' } }));
  });

  it('should fail a promise and circuit breaker in open state', async () => {
    const breaker = circuitBreaker({ failRate: 100, cacheLifetime: 3600, switchToHalfOpenIn: 50, logger });
    breaker.clearCache();
    await breaker.request('request-2', failPromise);

    await expect(breaker.request('request-2', failPromise)).resolves.toEqual(Left(Error('Circuit breaker has been opened')));
    expect(breaker.state('request-2')).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: true, status: 'Open' } }));
  });

  it('should successfully return a promise without failing', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    breaker.clearCache();

    await expect(breaker.request('request-3', okPromise)).resolves.toEqual(Right('ok'));
    expect(breaker.state('request-3')).toMatchObject(Right({ counters: { fail: 0, failRate: 0, success: 1, total: 1 }, state: { isRecovering: false, status: 'Closed' } }));
  });

  it('should not open circuit breaker when fail rate is below 75%', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    const key = 'request-4';
    breaker.clearCache();
    await breaker.request(key, okPromise);
    await breaker.request(key, failPromise);
    await breaker.request(key, okPromise);
    await breaker.request(key, failPromise);

    expect(breaker.state('request-4')).toMatchObject(Right({ counters: { fail: 2, failRate: 50, success: 2, total: 4 }, state: { isRecovering: false, status: 'Closed' } }));
  });

  it('should open circuit breaker after 75% of requests failed', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    const key = 'request-5';

    breaker.clearCache();
    await breaker.request(key, async () => await okPromise());
    await breaker.request(key, async () => await okPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());

    // these are rejected automatically, because circuit breaker is open. No need to wait for recovery timeout to pass more requests
    await breaker.request(key, async () => await okPromise());
    await breaker.request(key, async () => await okPromise());

    expect(breaker.state(key)).toMatchObject(Right({ counters: { fail: 6, failRate: 75, success: 2, total: 8 }, state: { isRecovering: false, status: 'Open' } }));
  });

  it('should switch circuit breaker from the fail state to half open after recovery threshold reached', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    const key = 'vcbzvcxz';
    breaker.clearCache();
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await delay(200);
    expect(breaker.state(key)).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: false, status: 'HalfOpen' } }));
  });

  it('should switch back to fail state even after recovery when request in HalOpen state fails', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    const key = 'vcbzvcxz';
    breaker.clearCache();
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await delay(200);
    const halfOpenState = breaker.state(key);
    const failedPromiseAfterRecovery = await breaker.request(key, async () => await failPromise('Oh no, I failed again'));
    const stateAfterRecovery = breaker.state(key);
    expect(halfOpenState).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: false, status: 'HalfOpen' } }));
    expect(stateAfterRecovery).toMatchObject(Right({ counters: { fail: 2, failRate: 100, success: 0, total: 2 }, state: { isRecovering: false, status: 'HalfOpen' } }));
    expect(failedPromiseAfterRecovery).toEqual(Left(Error('Oh no, I failed again')));
  });

  it('should repeatedly switch to halfopen when requests keep failing', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    const key = 'abcd';
    breaker.clearCache();
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());

    await delay(200);
    const halfOpenState = breaker.state(key);
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());

    await delay(200);
    const halfOpenState2 = breaker.state(key);

    expect(halfOpenState).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: false, status: 'HalfOpen' } }));
    expect(halfOpenState2).toMatchObject(Right({ counters: { fail: 3, failRate: 100, success: 0, total: 3 }, state: { isRecovering: false, status: 'HalfOpen' } }));
  });

  it('should recover back from failing state and reset statistics of a counter on success promise', async () => {
    const breaker = circuitBreaker({ failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    const key = 'qwerty';
    breaker.clearCache();
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await breaker.request(key, async () => await failPromise());
    await delay(200);
    const halfOpenState = breaker.state(key);
    const okPromiseAfterRecovery = await breaker.request(key, async () => await okPromise());
    const stateAfterRecovery = breaker.state(key);
    expect(halfOpenState).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: false, status: 'HalfOpen' } }));
    expect(stateAfterRecovery).toMatchObject(Right({ counters: { fail: 0, failRate: 0, success: 0, total: 0 }, state: { isRecovering: false, status: 'Closed' } }));
    expect(okPromiseAfterRecovery).toEqual(Right('ok'));
  });
});
