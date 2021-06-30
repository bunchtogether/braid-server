// @flow

// const expect = require('expect');
const Server = require('../src');
const uuid = require('uuid');
const { default: Client } = require('@bunchtogether/braid-client');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

jest.setTimeout(30000);

describe('Client Credentials', () => {
  test('Should not try to reconnect after providing invalid credentials', async () => {
    const port = 10000 + Math.round(Math.random() * 10000);
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    server.setCredentialsHandler(async () => // eslint-disable-line no-unused-vars
      ({ success: false, code: 403, message: 'Not allowed' }),
    );
    const client = new Client();
    const credentials = { [uuid.v4()]: uuid.v4() };
    await expect(client.open(`ws://localhost:${port}`, credentials)).rejects.toEqual(expect.objectContaining({
      name: 'CredentialsError',
      code: 403,
    }));
    expect(client.ws).toBeUndefined();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
  test('Should disconnect on invalid credentials', async () => {
    const port = 10000 + Math.round(Math.random() * 10000);
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    server.setCredentialsHandler(async () => // eslint-disable-line no-unused-vars
      ({ success: false, code: 403, message: 'Not allowed' }),
    );
    const client = new Client();
    await client.open(`ws://localhost:${port}`);
    const credentials = { [uuid.v4()]: uuid.v4() };
    await expect(client.sendCredentials(credentials)).rejects.toEqual(expect.objectContaining({
      name: 'CredentialsError',
      code: 403,
    }));
    expect(client.ws).toBeUndefined();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
});
