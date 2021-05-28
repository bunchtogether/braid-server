// @flow

const uuid = require('uuid');
const { default: Client } = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Simultaneous Subscriptions', () => {
  let stopWebsocketServer;
  let server;

  beforeAll(async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    server = new Server(ws[0]);
    stopWebsocketServer = ws[1];
  });

  afterAll(async () => {
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should open the connection', async () => {
    const key = uuid.v4();
    server.provide('.*', (k, active) => {
      expect(k).toEqual(key);
      expect(active).toEqual(true);
    });
    const value1 = uuid.v4();
    const value2 = uuid.v4();
    const value3 = uuid.v4();
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`);
    await clientA.subscribe(key);
    const clientAPromise1 = expect(clientA.data).toReceiveProperty(key, value1);
    server.data.set(key, value1);
    await clientAPromise1;
    const clientB = new Client();
    await clientB.open(`ws://localhost:${port}`);
    await clientB.subscribe(key);
    const clientAPromise2 = expect(clientA.data).toReceiveProperty(key, value2);
    const clientBPromise2 = expect(clientB.data).toReceiveProperty(key, value2);
    server.data.set(key, value2);
    await clientAPromise2;
    await clientBPromise2;
    const clientC = new Client();
    await clientC.open(`ws://localhost:${port}`);
    await clientC.subscribe(key);
    const clientAPromise3 = expect(clientA.data).toReceiveProperty(key, value3);
    const clientBPromise3 = expect(clientB.data).toReceiveProperty(key, value3);
    const clientCPromise3 = expect(clientC.data).toReceiveProperty(key, value3);
    server.data.set(key, value3);
    await clientAPromise3;
    await clientBPromise3;
    await clientCPromise3;
    server.unprovide('.*');
    await clientA.close();
    await clientB.close();
    await clientC.close();
  });
});
