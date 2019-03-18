// @flow

const uuid = require('uuid');
const { isEqual } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const ConnectionHandler = require('../src/connection-handler');
const startWebsocketServer = require('../src/ws-server');
const {
  OPEN,
  ERROR,
} = require('../src/constants');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Connection Handler', () => {
  let stopWebsocketServer;
  let connectionHandler;
  let client;

  beforeAll(async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    connectionHandler = new ConnectionHandler(ws[0]);
    stopWebsocketServer = ws[1];
    client = new Client(`ws://localhost:${port}`);
  });

  afterAll(async () => {
    await client.close();
    await connectionHandler.close();
    await stopWebsocketServer();
    connectionHandler.throwOnLeakedReferences();
  });

  test('Should open the connection', async () => {
    const openPromise = new Promise((resolve, reject) => {
      connectionHandler.once(OPEN, resolve);
      connectionHandler.once(ERROR, reject);
    });
    await client.open();
    await openPromise;
  });

  test('Should send credentials', async () => {
    const value = {
      [uuid.v4()]: uuid.v4(),
      [uuid.v4()]: uuid.v4(),
    };
    const handleCredentialsPromise = new Promise((resolve, reject) => {
      connectionHandler.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
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
