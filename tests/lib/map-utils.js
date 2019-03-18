// @flow

const expect = require('expect');
const diff = require('jest-diff');

expect.extend({
  async toReceiveProperty(received, key, value) {
    if (this.equals(received.get(key), value)) {
      return {
        message: () => `${this.utils.matcherHint('toReceiveProperty', undefined, undefined, {})
        }\n\n` +
            `Expected: ${this.utils.printExpected(received.get(key))}\n` +
            `Received: ${this.utils.printReceived(value)}`,
        pass: true,
      };
    }
    const pass = await new Promise((resolve) => {
      const handleSet = (k, v) => {
        if (k !== key) {
          return;
        }
        if (this.equals(v, value)) {
          clearTimeout(timeout);
          received.removeListener('set', handleSet);
          received.removeListener('delete', handleDelete);
          resolve(true);
        }
      };
      const handleDelete = (k) => {
        if (k !== key) {
          return;
        }
        if (typeof value === 'undefined') {
          clearTimeout(timeout);
          received.removeListener('set', handleSet);
          received.removeListener('delete', handleDelete);
          resolve(true);
        }
      };
      const timeout = setTimeout(() => {
        received.removeListener('set', handleSet);
        received.removeListener('delete', handleDelete);
        resolve(false);
      }, 3000);
      received.on('set', handleSet);
      received.on('delete', handleDelete);
    });
    if (pass) {
      return {
        message: () => `${this.utils.matcherHint('toReceiveProperty', undefined, undefined, {})
        }\n\n` +
            `Expected: ${this.utils.printExpected(received.get(key))}\n` +
            `Received: ${this.utils.printReceived(value)}`,
        pass: true,
      };
    }
    return {
      message: () => {
        const diffString = diff(value, received.get(key), {
          expand: this.expand,
        });
        return (
          `${this.utils.matcherHint('toReceiveProperty', undefined, undefined, {})
          }\n\n${
            diffString && diffString.includes('- Expect')
              ? `Difference:\n\n${diffString}`
              : `Expected: ${this.utils.printExpected(value)}\n` +
              `Received: ${this.utils.printReceived(received.get(key))}`}`
        );
      },
      pass: false,
    };
  },
});
