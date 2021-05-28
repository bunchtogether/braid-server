// @flow

const uuid = require('uuid');
const { default: Client } = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Connection', () => {
  let stopWebsocketServer;
  let server;
  let client;
  const credentialsValueA = {
    [uuid.v4()]: uuid.v4(),
    [uuid.v4()]: uuid.v4(),
  };
  const credentialsValueB = {
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

  test('Should emit an open event when a new connection is opened, and a close event when the connection is closed', async () => {
    const openPromise = new Promise((resolve, reject) => {
      server.once('open', resolve);
      server.once('error', reject);
    });
    const closePromise = new Promise((resolve, reject) => {
      server.once('close', resolve);
      server.once('error', reject);
    });
    await client.open(`ws://localhost:${port}`);
    await openPromise;
    await client.close();
    await closePromise;
  });

  test('Should emit an online event when opening a connection with credentials', async () => {
    const openPromise = new Promise((resolve, reject) => {
      server.once('open', resolve);
      server.once('error', reject);
    });
    await new Promise((resolve) => {
      const handlePresence = (credentials, online, socketId, credentialsDidUpdate) => {
        if (online) {
          expect(socketId).toEqual(expect.any(Number));
          expect(credentialsDidUpdate).toEqual(false);
          expect(credentials).toEqual({ client: credentialsValueA, ip: '127.0.0.1' });
          server.removeListener('presence', handlePresence);
          resolve();
        }
      };
      server.on('presence', handlePresence);
      client.open(`ws://localhost:${port}`, credentialsValueA);
    });
    await openPromise;
  });

  test('Should emit online and offline event, indicating credentials were updated when credentials are updated', async () => {
    const offlinePromise = new Promise((resolve) => {
      const handlePresence = (credentials, online, socketId, credentialsDidUpdate) => {
        if (!online) {
          expect(socketId).toEqual(expect.any(Number));
          expect(credentialsDidUpdate).toEqual(true);
          expect(credentials).toEqual({ client: credentialsValueA, ip: '127.0.0.1' });
          server.removeListener('presence', handlePresence);
          resolve();
        }
      };
      server.on('presence', handlePresence);
    });
    const onlinePromise = new Promise((resolve) => {
      const handlePresence = (credentials, online, socketId, credentialsDidUpdate) => {
        if (online) {
          expect(socketId).toEqual(expect.any(Number));
          expect(credentialsDidUpdate).toEqual(true);
          expect(credentials).toEqual({ client: credentialsValueB, ip: '127.0.0.1' });
          server.removeListener('presence', handlePresence);
          resolve();
        }
      };
      server.on('presence', handlePresence);
    });
    client.sendCredentials(credentialsValueB);
    await offlinePromise;
    await onlinePromise;
  });

  test('Should emit an offline event when closing a connection with credentials', async () => {
    const closePromise = new Promise((resolve, reject) => {
      server.once('close', resolve);
      server.once('error', reject);
    });

    await new Promise((resolve) => {
      const handlePresence = (credentials, online, socketId, credentialsDidUpdate) => {
        if (!online) {
          expect(socketId).toEqual(expect.any(Number));
          expect(credentialsDidUpdate).toEqual(false);
          expect(credentials).toEqual({ client: credentialsValueB, ip: '127.0.0.1' });
          server.removeListener('presence', handlePresence);
          clientClose.then(resolve);
        }
      };
      server.on('presence', handlePresence);
      const clientClose = client.close();
    });
    await client.close();
    await closePromise;
  });
});
