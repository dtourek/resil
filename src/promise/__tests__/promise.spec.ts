import { promise, promiseMaybe, promiseWithMaybe } from '../promise';
import { ILeft, IRight, Left, Right, tryCatch } from 'fputils';
import { delay } from '../../utils/utils';
import {getLogger, ILogger} from "../../logger/logger";

describe('promises', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(() => {
    jest.clearAllMocks();
  });

   const logger: ILogger = { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() }
  // const logger = getLogger(console.log);
  describe('promise', () => {
    it('should resolve promise', async () => {
      const okPromise = new Promise((resolve) => resolve('ok'));
      expect(await promise(okPromise, logger, 1000)).toEqual('ok');
    });

    it('should reject promise immediately after 5 attempts', async () => {
      const errorPromise = new Promise((_resolve, reject) => reject('error'));
      await expect(promise(errorPromise, logger, 1000)).rejects.toEqual('error');
    });

    it('should reject promise when timeout is reached and it should took about 500ms', async () => {
      // const errorLog = jest.spyOn(logger, 'error');
      try {
        await promise(delay(1000), logger, 100);
        expect(true).toEqual(false);
      } catch (error) {
        expect(logger.info).toBeCalledTimes(5)
        expect(logger.error).toBeCalledTimes(1);
        expect(error).toEqual(Error('Request took too long and timeout after 100ms'));
      }
    });
  });

  describe('promiseWithMaybe', () => {
    it('should return Left', async () => {
      const error = new Error('error occurred');
      const rejectPromise = new Promise((_resolve, reject) => reject(error));
      await expect(promiseWithMaybe(rejectPromise, logger, 100)).resolves.toEqual(Left(error));
    });
    it('should return Right', async () => {
      const okPromise = new Promise((resolve) => resolve('ok'));
      await expect(promiseWithMaybe(okPromise, logger, 100)).resolves.toEqual(Right('ok'));
    });
  });

  describe('promiseMay', () => {
    const leftPromise: Promise<ILeft<Error>> = new Promise((resolve) => resolve(Left(new Error('Failed to resolve'))));
    const rightPromise: Promise<IRight<string>> = new Promise((resolve) => resolve(Right('ok')));

    it('should return Left', async () => {
      await expect(promiseMaybe(leftPromise, logger, 100)).resolves.toEqual(Left(Error('Failed to resolve')));
    });

    it('should timeout and return Left', async () => {
      await expect(
        promiseMaybe(
          tryCatch(() => delay(500)),
          logger,
          100,
          3,
        ),
      ).resolves.toEqual(Left(Error('Request took too long and timeout after 100ms')));
      expect(logger.error).toBeCalledTimes(4);
      expect(logger.info).toBeCalledTimes(3);
    });

    it('should return Right', async () => {
      await expect(promiseMaybe(rightPromise, logger, 100)).resolves.toEqual(Right('ok'));
    });
  });
});
