// @flow

const uuid = require('uuid');
const { isEqual } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Connection', () => {
  let stopWebsocketServer;
  let server;
  let client;
  const credentialsValue = {
    [uuid.v4()]: uuid.v4(),
    [uuid.v4()]: uuid.v4(),
  };

  beforeAll(async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    server = new Server(ws[0]);
    stopWebsocketServer = ws[1];
    client = new Client();
  });

  afterAll(async () => {
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should open the connection', async () => {
    const openPromise = new Promise((resolve, reject) => {
      server.once('open', resolve);
      server.once('error', reject);
    });
    await client.open(`ws://localhost:${port}`);
    await openPromise;
  });

  test('Should handle credentials and emit an presence online event', async () => {
    const emitPresencePromise = new Promise((resolve) => {
      const handlePresence = (credentials, online) => {
        if (online) {
          expect(credentials).toEqual({ client: credentialsValue, ip: '127.0.0.1' });
          server.removeListener('presence', handlePresence);
          resolve();
        }
      };
      server.on('presence', handlePresence);
    });
    const handleCredentialsPromise = new Promise((resolve, reject) => {
      server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
        if (isEqual({ client: credentialsValue, ip: '127.0.0.1' }, credentials)) {
          resolve();
          return { success: true, code: 200, message: 'OK' };
        }
        reject('Incorrect credentials');
        return { success: false, code: 400, message: 'Incorrect credentials' };
      });
    });
    await client.sendCredentials(credentialsValue);
    await handleCredentialsPromise;
    await emitPresencePromise;
  });

  test('Should emit an presence offline event', async () => {
    const emitPresencePromise = new Promise((resolve) => {
      const handlePresence = (credentials, online) => {
        if (!online) {
          expect(credentials).toEqual({ client: credentialsValue, ip: '127.0.0.1' });
          server.removeListener('presence', handlePresence);
          resolve();
        }
      };
      server.on('presence', handlePresence);
    });
    await client.close();
    await emitPresencePromise;
  });
});
