//      
const colors = require('colors/safe');
const { createLogger, transports } = require('winston');
const colorize = require('logform/colorize');
const combine = require('logform/combine');
const timestamp = require('logform/timestamp');
const printf = require('logform/printf');

const loggers = {};

// Make Winston use stdout https://github.com/winstonjs/winston/blob/master/lib/winston/transports/console.js#L63-L66
// $FlowFixMe
console._stdout = process.stdout; // eslint-disable-line no-underscore-dangle,no-console
// $FlowFixMe
console._stderr = process.stderr; // eslint-disable-line no-underscore-dangle,no-console

module.exports = (name        ) => {
  if (loggers[name]) {
    return loggers[name];
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
