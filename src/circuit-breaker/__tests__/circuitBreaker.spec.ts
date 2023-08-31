import { circuitBreaker } from '../circuitBreaker';
import { Left, Maybe, Right } from 'fputils';
import { delay } from "../../utils/utils";
import {getLogger} from "../../logger/logger";

describe('circuitBreaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(() => {
    jest.clearAllMocks();
  });

  const okPromise = (): Promise<Maybe<string>> => new Promise((resolve) => resolve(Right('ok')));
  const failPromise = (message?: string): Promise<Maybe<string>> => new Promise((resolve) => resolve(Left(new Error(message ?? 'Failed'))));


  // const logger: ILogger = { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() }
  const logger = getLogger(console.log);

  it('should return init state', async () => {
    const breaker = circuitBreaker('request-1', { failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    breaker.clearCache();
    const status = await breaker.state();

    expect(status).toMatchObject(Right({ counters: { fail: 0, failRate: 0, success: 0, total: 0 }, state: { isRecovering: false, status: 'Closed' } }));
  });

  it('should fail a promise and circuit breaker in open state', async () => {
    const breaker = circuitBreaker('request-2', { failRate: 100, cacheLifetime: 3600, switchToHalfOpenIn: 50, logger });
    breaker.clearCache();
    await breaker.request(failPromise);

    await expect(breaker.request(failPromise)).resolves.toEqual(Left(Error('Circuit breaker is on, no more requests are passing for 50 milliseconds')));
    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: true, status: 'Open' } }));
  });

  xit('should fail a promise and circuit breaker in open state and recover after timeout', async () => {
    const breaker = circuitBreaker('request-2', { failRate: 100, cacheLifetime: 3600, switchToHalfOpenIn: 50, logger });
    breaker.clearCache();

    // first request - only increment fail counter and return resolved promise
    const a = await breaker.request(failPromise, 100, 1);
    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: false, status: 'Closed' } }));
    expect(a).toEqual(Left(Error('Failed')));

    // second request - Switch to open state when failRate threshold is reached and return error. Do not resolve a promise.
    const b = await breaker.request(() => failPromise('xxx'), 10, 1);
    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: true, status: 'Open' } }));
    expect(b).toEqual(Left(Error('Circuit breaker is on, no more requests are passing for 50 milliseconds')));

    // third request - Now we are in open state, and we are waiting for timeout to switch to half-open state
    const c = await breaker.request(() => failPromise('xxx'), 10, 1);
    expect(c).toEqual(Left(Error('Circuit breaker is on for function: "request-2".')));
    await delay(500);

    // TODO - solve issues with jest and timers (setTimeout)
    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 1, failRate: 100, success: 0, total: 1 }, state: { isRecovering: false, status: 'HalfOpen' } }));
  });

  xit('should fail a promise and circuit breaker in open state and recover after timeout', async () => {});

  it('should successfully return a promise without failing', async () => {
    const breaker = circuitBreaker('request-3', { failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    breaker.clearCache();

    await expect(breaker.request(okPromise)).resolves.toEqual(Right('ok'));
    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 0, failRate: 0, success: 1, total: 1 }, state: { isRecovering: false, status: 'Closed' } }));
  });

  it('should not open circuit breaker when fail rate is below 75%', async () => {
    const breaker = circuitBreaker('request-4', { failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    breaker.clearCache();
    await breaker.request(okPromise);
    await breaker.request(failPromise);
    await breaker.request(okPromise,);
    await breaker.request(failPromise);

    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 2, failRate: 50, success: 2, total: 4 }, state: { isRecovering: false, status: 'Closed' } }));
  });

  it('should open circuit breaker after 75% of requests failed', async () => {
    const breaker = circuitBreaker('request-5', { failRate: 75, cacheLifetime: 3600, switchToHalfOpenIn: 10, logger });
    breaker.clearCache();
    await breaker.request(() => okPromise());
    await breaker.request(() => okPromise());
    await breaker.request(() => failPromise());
    await breaker.request(() => failPromise());
    await breaker.request(() => failPromise());
    await breaker.request(() => failPromise());
    await breaker.request(() => failPromise());
    await breaker.request(() => failPromise());
    await breaker.request(() => failPromise());

    // these are rejected automatically, because circuit breaker is open. No need to wait for recovery timeout to pass more requests
    await breaker.request(() => okPromise());
    await breaker.request(() => okPromise());

    expect(breaker.state()).toMatchObject(Right({ counters: { fail: 6, failRate: 75, success: 2, total: 8 }, state: { isRecovering: true, status: 'Open' } }));
  });
});
