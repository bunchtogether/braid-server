// @flow

const startWebsocketServer = require('./lib/ws-server');

const port = 10000 + Math.round(Math.random() * 10000);

describe('Websocket Server', () => {
  test('Should start and stop', async () => {
    const stopWebsocketServer = (await startWebsocketServer('0.0.0.0', port))[1];
    await stopWebsocketServer();
  });
});
