// @flow
import colors from 'colors/safe';

import colorize from 'logform/colorize';
import combine from 'logform/combine';
import printf from 'logform/printf';
import timestamp from 'logform/timestamp';
import {
  createLogger,
  transports,
} from 'winston';

const loggers = {};

// Make Winston use stdout https://github.com/winstonjs/winston/blob/master/lib/winston/transports/console.js#L63-L66
// $FlowFixMe
console._stdout = process.stdout; // eslint-disable-line no-underscore-dangle,no-console
// $FlowFixMe
console._stderr = process.stderr; // eslint-disable-line no-underscore-dangle,no-console

export default (name: string) => {
  const cached = loggers[name];
  if (cached) {
    return cached;
  }
  colorize.Colorizer.addColors({
    error: 'red',
    warn: 'yellow',
    help: 'cyan',
    data: 'grey',
    info: 'green',
    debug: 'blue',
    prompt: 'grey',
    verbose: 'cyan',
    input: 'grey',
    silly: 'magenta',
  });
  const logger = createLogger({
    transports: [
      new transports.Console({
        debugStdout: false,
        level: process.env.LOG_LEVEL || 'info',
        format: combine(
          colorize(),
          timestamp(),
          printf((info) => `${colors.bold(name)} - ${info.level} - ${info.message}`),
        ),
      }),
    ],
  });
  loggers[name] = logger;
  return logger;
};
