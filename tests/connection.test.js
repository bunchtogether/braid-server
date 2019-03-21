// @flow

const uuid = require('uuid');
const { isEqual } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
const {
  OPEN,
  ERROR,
} = require('../src/constants');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Connection', () => {
  let stopWebsocketServer;
  let server;
  let client;

  beforeAll(async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    server = new Server(ws[0]);
    stopWebsocketServer = ws[1];
    client = new Client();
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should open the connection', async () => {
    const openPromise = new Promise((resolve, reject) => {
      server.once(OPEN, resolve);
      server.once(ERROR, reject);
    });
    await client.open(`ws://localhost:${port}`);
    await openPromise;
  });

  test('Should send credentials', async () => {
    const value = {
      [uuid.v4()]: uuid.v4(),
      [uuid.v4()]: uuid.v4(),
    };
    const handleCredentialsPromise = new Promise((resolve, reject) => {
      server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
        if (isEqual({ client: value, ip: '127.0.0.1' }, credentials)) {
          resolve();
          return { success: true, code: 200, message: 'OK' };
        }
        console.log(credentials);
        reject('Incorrect credentials');
        return { success: false, code: 400, message: 'Incorrect credentials' };
      });
    });
    await client.sendCredentials(value);
    await handleCredentialsPromise;
  });
});
