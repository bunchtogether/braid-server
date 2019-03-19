// @flow

const uuid = require('uuid');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(60000);

describe(`${count} peers in a ring with a subscriber client`, () => {
  let client;
  const peers = [];
  const keys = [];

  beforeAll(async () => {
    for (let i = 0; i < count; i += 1) {
      const port = startPort + i;
      const ws = await startWebsocketServer('0.0.0.0', port);
      const server = new Server(ws[0]);
      const stop = ws[1];
      peers.push({
        port,
        data: server.data,
        server,
        stop,
      });
    }
    const peerPromises = [];
    peerPromises.push(peers[0].server.connectToPeer(`ws://localhost:${startPort + count - 1}`, {}));
    for (let i = 1; i < count; i += 1) {
      peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[i].port - 1}`, {}));
    }
    await Promise.all(peerPromises);
    client = new Client(`ws://localhost:${startPort + Math.floor(Math.random() * count)}`, {});
    await client.open();
    for (const { server } of peers) {
      server.provide('.*', (key) => {
        server.data.set(key, key);
      });
    }
  });

  test('Should provide keys', async () => {
    for (let i = 0; i < 100; i += 1) {
      const key = uuid.v4();
      const handler = () => {};
      await client.subscribe(key, handler);
      keys.push(key);
      await expect(client.data).toReceiveProperty(key, key);
      await client.unsubscribe(key, handler);
    }
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});
