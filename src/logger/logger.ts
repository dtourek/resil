type ILogLevel = 'debug' | 'info' | 'warn' | 'error';

type ILoggerFunction = (level: ILogLevel, ...params: string[]) => void;

export interface ILogger {
  debug: (...params: string[]) => void;
  info: (...params: string[]) => void;
  warn: (...params: string[]) => void;
  error: (...params: string[]) => void;
}

interface ILoggerOptions {
  separator?: string;
}

const log = (logFunction: ILoggerFunction, options: ILoggerOptions | undefined, level: ILogLevel, ...params: string[]): void => {
  logFunction(level, params.join(options?.separator ?? '|'));
};

export const getLogger = (loggerFunction: ILoggerFunction, options?: ILoggerOptions): ILogger => {
  return {
    debug: (...params: string[]) => {
      log(loggerFunction, options, 'debug', ...params);
    },
    info: (...params: string[]) => {
      log(loggerFunction, options, 'debug', ...params);
    },
    warn: (...params: string[]) => {
      log(loggerFunction, options, 'debug', ...params);
    },
    error: (...params: string[]) => {
      log(loggerFunction, options, 'debug', ...params);
    },
  };
};
