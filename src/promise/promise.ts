import { isLeft, Maybe, tryCatch } from 'fputils';
import { delay } from '../utils/utils';
import { ILogger } from "../logger/logger";

const defaultRetryCount = 5;
const defaultTimeout = 5000;

export const promise = async <T>(promiseFn: Promise<T>, logger: ILogger, timeout = defaultTimeout, retryCount = defaultRetryCount): Promise<T> => {
  try {
    const result = await Promise.race([timeoutPromise<T>(timeout), promiseFn]);
    logger.info('Promise resolved successfully');
    return result;
  } catch (error) {
    if (retryCount > 0) {
      logger.info('Promise timeout, retrying count=' + retryCount);
      return promise<T>(promiseFn, logger, timeout, retryCount - 1);
    }

    logger.error('Promise rejected', (error as Error).message);
    throw error;
  }
};

export const promiseWithMaybe = async <T>(promiseFn: Promise<T>, logger: ILogger, timeout = defaultTimeout, retryCount = defaultRetryCount): Promise<Maybe<T>> =>
  tryCatch(async () => promise(promiseFn, logger, timeout, retryCount));

const timeoutPromise = <T>(timeout: number): Promise<T> =>
  new Promise(async (_resolve, reject) => {
    const error = new Error(`Request took too long and timeout after ${timeout}ms`);
    await delay(timeout);
    return reject(error);
  });

const timeoutPromiseMaybe = <T>(timeout: number): Promise<Maybe<T>> => tryCatch(async () => timeoutPromise<T>(timeout))

export const promiseMaybe = async <T>(
  maybePromiseFn: Promise<Maybe<T>>,
  logger: ILogger,
  timeout = defaultTimeout,
  retryCount = defaultRetryCount,
): Promise<Maybe<T>> => {
  const result = await Promise.race([timeoutPromiseMaybe<T>(timeout), maybePromiseFn]);
  if (isLeft(result)) {
    logger.error('Promise rejected', result.value.message);

    if (retryCount > 0) {
      logger.info('Promise timeout, retrying count=' + retryCount);
      return promiseMaybe<T>(maybePromiseFn, logger, timeout, retryCount - 1);
    }

    return result;
  }
  logger.info('Promise resolved successfully');
  return result;
};
