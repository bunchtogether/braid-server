// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const ConnectionHandler = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 20000 + Math.round(Math.random() * 10000);
const count = 100;

jest.setTimeout(20000);

describe(`${count} peers in a ring with a provider`, () => {
  let client;
  const peers = [];
  const getRandomConnectionHandlers = (c:number) => shuffle(peers).slice(0, c).map((peer) => peer.connectionHandler);
  beforeAll(async () => {
    for (let i = 0; i < count; i += 1) {
      const port = startPort + i;
      const ws = await startWebsocketServer('0.0.0.0', port);
      const connectionHandler = new ConnectionHandler(ws[0]);
      const stop = ws[1];
      peers.push({
        port,
        providers: connectionHandler.providers,
        data: connectionHandler.data,
        connectionHandler,
        stop,
      });
    }
    const peerPromises = [];
    peerPromises.push(peers[0].connectionHandler.connectToPeer(`ws://localhost:${startPort + count - 1}`, {}));
    for (let i = 1; i < count; i += 1) {
      peerPromises.push(peers[i].connectionHandler.connectToPeer(`ws://localhost:${peers[i].port - 1}`, {}));
    }
    await Promise.all(peerPromises);
    client = new Client(`ws://localhost:${startPort + Math.floor(Math.random() * count)}`, {});
    await client.open();
  });

  test('Should provide values', async () => {
    const key = uuid.v4();
    const value = uuid.v4();
    const [connectionHandlerA, connectionHandlerB] = getRandomConnectionHandlers(2);
    const provideStartPromise = new Promise((resolve) => {
      const handle = (k, active) => {
        if (k === key && active) {
          connectionHandlerA.data.set(key, value);
          resolve();
        }
      };
      connectionHandlerA.provide(key, handle);
    });
    for (const { connectionHandler } of peers) {
      await expect(connectionHandler.providers).toReceiveProperty(connectionHandlerA.id, [key]);
    }
    const [[globA, matcherA]] = connectionHandlerA.providerMatchers.get(connectionHandlerA.id);
    const [[globB, matcherB]] = connectionHandlerB.providerMatchers.get(connectionHandlerA.id);
    expect(globA).toEqual(key);
    expect(globB).toEqual(key);
    expect(matcherA).toBeInstanceOf(Function);
    expect(matcherB).toBeInstanceOf(Function);
    expect(matcherA(key)).toEqual(true);
    expect(matcherB(key)).toEqual(true);
    expect(matcherA(uuid.v4())).toEqual(false);
    expect(matcherB(uuid.v4())).toEqual(false);
    await client.subscribe(key, () => {});
    for (const { connectionHandler } of peers) {
      await expect(connectionHandler.activeProviders).toReceiveProperty(key, [connectionHandlerA.id, key]);
    }
    await provideStartPromise;
    await expect(client.data).toReceiveProperty(key, value);
    connectionHandlerA.unprovide(key);
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ connectionHandler }) => connectionHandler.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ connectionHandler }) => connectionHandler.throwOnLeakedReferences());
  });
});

