// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 20000 + Math.round(Math.random() * 10000);
const count = 10;

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
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[j].port}`, {}));
      }
    }
    await Promise.all(peerPromises);
    client = new Client();
    await client.open(`ws://localhost:${startPort + 2 + Math.floor(Math.random() * count - 2)}`, {});
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
    await client.subscribe(key);
    for (const { server } of peers) {
      await expect(server.activeProviders).toReceiveProperty(key, [serverA.id, key]);
    }
    await provideStartPromise;
    await expect(client.data).toReceiveProperty(key, value);
    serverA.unprovide(key);
    await client.unsubscribe(key);
  });

  test('Should automatically update after a provider closes', async () => {
    const key = uuid.v4();
    const valueA = uuid.v4();
    const valueB = uuid.v4();
    const serverA = peers[0].server;
    const serverB = peers[1].server;
    const providePromiseA = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout when waiting for provide'));
      }, 10000);
      const handler = (k, active) => {
        if (k !== key) {
          return;
        }
        clearTimeout(timeout);
        if (active) {
          serverA.data.set(key, valueA);
          resolve();
        } else {
          reject(`Unexpected provide state for key: ${key}, active: ${active ? 'TRUE' : 'FALSE'}`);
        }
      };
      serverA.provide('.*', handler);
    });
    for (const { server } of peers) {
      await expect(server.providers).toReceiveProperty(serverA.id, ['.*']);
    }
    const callbackPromiseA = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.unsubscribe(key);
        client.data.removeListener('set', handler);
        reject(new Error('Timeout when waiting for subscribe'));
      }, 10000);
      const handler = (k, v) => {
        if (k === key && v === valueA) {
          client.unsubscribe(key);
          clearTimeout(timeout);
          client.data.removeListener('set', handler);
          resolve();
        }
      };
      client.data.on('set', handler);
      client.subscribe(key);
    });
    await providePromiseA;
    await callbackPromiseA;
    for (const { server } of peers) {
      await expect(server.activeProviders).toReceiveProperty(key, [serverA.id, '.*']);
    }
    const callbackPromiseB = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.unsubscribe(key);
        client.data.removeListener('set', handler);
        reject(new Error('Timeout when waiting for subscribe'));
      }, 10000);
      const handler = (k, v) => {
        if (k === key && v === valueB) {
          client.unsubscribe(key);
          clearTimeout(timeout);
          client.data.removeListener('set', handler);
          resolve();
        }
      };
      client.data.on('set', handler);
      client.subscribe(key);
    });
    const providePromiseB = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout when waiting for provide'));
      }, 10000);
      const handler = (k, active) => {
        if (k !== key) {
          return;
        }
        clearTimeout(timeout);
        if (active) {
          serverB.data.set(key, valueB);
          resolve();
        } else {
          reject(`Unexpected provide state for key: ${key}, active: ${active ? 'TRUE' : 'FALSE'}`);
        }
      };
      serverB.provide('.*', handler);
    });
    for (const { server } of peers) {
      await expect(server.providers).toReceiveProperty(serverB.id, ['.*']);
    }
    await serverA.close();
    await providePromiseB;
    await callbackPromiseB;
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});

