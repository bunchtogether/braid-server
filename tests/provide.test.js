// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 20000 + Math.round(Math.random() * 10000);
const count = 100;

jest.setTimeout(20000);

describe(`${count} peers in a ring with a provider`, () => {
  let client;
  const peers = [];
  const getRandomServers = (c:number) => shuffle(peers).slice(0, c).map((peer) => peer.server);
  beforeAll(async () => {
    for (let i = 0; i < count; i += 1) {
      const port = startPort + i;
      const ws = await startWebsocketServer('0.0.0.0', port);
      const server = new Server(ws[0]);
      const stop = ws[1];
      peers.push({
        port,
        providers: server.providers,
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
  });

  test('Should provide values', async () => {
    const key = uuid.v4();
    const value = uuid.v4();
    const [serverA, serverB] = getRandomServers(2);
    const provideStartPromise = new Promise((resolve) => {
      const handle = (k, active) => {
        if (k === key && active) {
          serverA.data.set(key, value);
          resolve();
        }
      };
      serverA.provide(key, handle);
    });
    for (const { server } of peers) {
      await expect(server.providers).toReceiveProperty(serverA.id, [key]);
    }
    const [[regexStringA, regexA]] = serverA.providerRegexes.get(serverA.id);
    const [[regexStringB, regexB]] = serverB.providerRegexes.get(serverA.id);
    expect(regexStringA).toEqual(key);
    expect(regexStringB).toEqual(key);
    expect(regexA).toBeInstanceOf(RegExp);
    expect(regexB).toBeInstanceOf(RegExp);
    expect(regexA.test(key)).toEqual(true);
    expect(regexB.test(key)).toEqual(true);
    expect(regexA.test(uuid.v4())).toEqual(false);
    expect(regexB.test(uuid.v4())).toEqual(false);
    await client.subscribe(key, () => {});
    for (const { server } of peers) {
      await expect(server.activeProviders).toReceiveProperty(key, [serverA.id, key]);
    }
    await provideStartPromise;
    await expect(client.data).toReceiveProperty(key, value);
    serverA.unprovide(key);
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});

