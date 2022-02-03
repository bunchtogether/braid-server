"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _safe = _interopRequireDefault(require("colors/safe"));

var _colorize = _interopRequireDefault(require("logform/colorize"));

var _combine = _interopRequireDefault(require("logform/combine"));

var _printf = _interopRequireDefault(require("logform/printf"));

var _timestamp = _interopRequireDefault(require("logform/timestamp"));

var _winston = require("winston");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const loggers = {}; // Make Winston use stdout https://github.com/winstonjs/winston/blob/master/lib/winston/transports/console.js#L63-L66
// $FlowFixMe

console._stdout = process.stdout; // eslint-disable-line no-underscore-dangle,no-console
// $FlowFixMe

console._stderr = process.stderr; // eslint-disable-line no-underscore-dangle,no-console

var _default = name => {
  const cached = loggers[name];

  if (cached) {
    return cached;
  }

  _colorize.default.Colorizer.addColors({
    error: 'red',
    warn: 'yellow',
    help: 'cyan',
    data: 'grey',
    info: 'green',
    debug: 'blue',
    prompt: 'grey',
    verbose: 'cyan',
    input: 'grey',
    silly: 'magenta'
  });

  const logger = (0, _winston.createLogger)({
    transports: [new _winston.transports.Console({
      debugStdout: false,
      level: process.env.LOG_LEVEL || 'info',
      format: (0, _combine.default)((0, _colorize.default)(), (0, _timestamp.default)(), (0, _printf.default)(info => `${_safe.default.bold(name)} - ${info.level} - ${info.message}`))
    })]
  });
  loggers[name] = logger;
  return logger;
};

exports.default = _default;
//# sourceMappingURL=logger.js.map