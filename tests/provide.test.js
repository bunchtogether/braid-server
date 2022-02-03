// @flow

import { v4 as uuidv4 } from 'uuid';

import { shuffle } from 'lodash';
import Client from '@bunchtogether/braid-client';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

const startPort = 20000 + Math.round(Math.random() * 10000);
const count = 3;

jest.setTimeout(30000);

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
    await client.open(`ws://localhost:${startPort + 2}`, {});
  });

  test('Should provide values', async () => {
    const key = uuidv4();
    const value = uuidv4();
    const [serverA, serverB] = getRandomServers(2);
    const provideStartPromise = new Promise((resolve) => {
      const handle = (k, active) => {
        if (k === key && active) {
          serverA.set(key, value);
          resolve();
        }
      };
      serverA.provide(key, handle);
    });
    for (const { server } of peers) {
      await expect(server.providers).toReceiveProperty(serverA.id, [key]);
    }
    const providerRegexPairA = serverA.providerRegexes.get(serverA.id);
    const providerRegexPairB = serverB.providerRegexes.get(serverA.id);
    if (!providerRegexPairA || !providerRegexPairB) {
      throw new Error('Provider regexes do not exist');
    }
    const [[regexStringA, regexA]] = providerRegexPairA;
    const [[regexStringB, regexB]] = providerRegexPairB;
    expect(regexStringA).toEqual(key);
    expect(regexStringB).toEqual(key);
    expect(regexA).toBeInstanceOf(RegExp);
    expect(regexB).toBeInstanceOf(RegExp);
    expect(regexA.test(key)).toEqual(true);
    expect(regexB.test(key)).toEqual(true);
    expect(regexA.test(uuidv4())).toEqual(false);
    expect(regexB.test(uuidv4())).toEqual(false);
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
    const key = uuidv4();
    const valueA = uuidv4();
    const valueB = uuidv4();
    const serverA = peers[0].server;
    const serverB = peers[1].server;
    const providePromiseA = new Promise((resolve, reject) => {
      const handler = (k, active) => {
        if (k !== key) {
          return;
        }
        if (active) {
          serverA.set(key, valueA);
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
    const callbackPromiseA = new Promise((resolve) => {
      const handler = (k, v) => {
        if (k === key && v === valueA) {
          client.unsubscribe(key);
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
    const callbackPromiseB = new Promise((resolve) => {
      const handler = (k, v) => {
        if (k === key && v === valueB) {
          client.unsubscribe(key);
          client.data.removeListener('set', handler);
          resolve();
        }
      };
      client.data.on('set', handler);
      client.subscribe(key);
    });
    const providePromiseB = new Promise((resolve, reject) => {
      const handler = (k, active) => {
        if (k !== key) {
          return;
        }
        if (active) {
          serverB.set(key, valueB);
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

