
// See https://github.com/uNetworking/uWebSockets/issues/871

// See https://github.com/facebook/jest/blob/04e6a66d2ba8b18bee080bb28547db74a255d2c7/packages/jest-circus/src/__mocks__/testUtils.ts

const { fork } = require('child_process');
const path = require('path');

const child = fork(path.resolve(__dirname, 'malloc-example.js'), []);

child.on('exit', (code) => {
  process.exit(code);
});
