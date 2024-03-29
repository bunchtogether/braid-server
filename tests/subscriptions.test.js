// @flow

import { v4 as uuidv4 } from 'uuid';

import { shuffle } from 'lodash';
import Client from '@bunchtogether/braid-client';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(60000);

describe(`${count} peers in a ring with a subscriber client`, () => {
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
    client = new Client();
    await client.open(`ws://localhost:${startPort + Math.floor(Math.random() * count)}`, {});
  });

  test('Should provide keys', async () => {
    for (let i = 0; i < 10; i += 1) {
      const [serverA] = getRandomServers(1);
      const providePromise = new Promise((resolve, reject) => { // eslint-disable-line no-loop-func
        let stage = 1;
        const timeout = setTimeout(() => {
          serverA.unprovide('.*');
          reject(new Error('Timeout when waiting for key'));
        }, 1000);
        const provideHandler = (key, active) => {
          if (active && stage === 1) {
            serverA.set(key, key);
            stage = 2;
          } else if (!active && stage === 2) {
            stage = 3;
            serverA.unprovide('.*');
            clearTimeout(timeout);
            resolve();
          } else {
            clearTimeout(timeout);
            reject(`Unknown provide state for key: ${key}, active: ${active ? 'TRUE' : 'FALSE'}, stage: ${stage}`);
          }
        };
        serverA.provide('.*', provideHandler);
      });
      for (const { server } of peers) {
        await expect(server.providers).toReceiveProperty(serverA.id, ['.*']);
      }
      const key = uuidv4();
      await new Promise((resolve, reject) => { // eslint-disable-line no-loop-func
        const timeout = setTimeout(() => {
          client.unsubscribe(key);
          client.data.removeListener('set', handler);
          reject(new Error('Timeout when waiting for key'));
        }, 1000);
        const handler = (k, v) => {
          if (k === key && v === key) {
            clearTimeout(timeout);
            client.unsubscribe(key);
            client.data.removeListener('set', handler);
            resolve();
          }
        };
        client.data.on('set', handler);
        client.subscribe(key);
      });
      await providePromise;
      for (const { server } of peers) {
        await expect(server.providers).toReceiveProperty(serverA.id, undefined);
      }
    }
  });

  test('Should set a subscription value to undefined', async () => {
    const key = uuidv4();
    const initialValue = uuidv4();
    const [serverA] = getRandomServers(1);
    serverA.set(key, initialValue);
    for (const { server } of peers) {
      await expect(server.data).toReceiveProperty(key, initialValue);
    }
    const providePromise = new Promise((resolve, reject) => { // eslint-disable-line no-loop-func
      let stage = 1;
      const timeout = setTimeout(() => {
        serverA.unprovide('.*');
        reject(new Error('Timeout when waiting for key'));
      }, 1000);
      const provideHandler = (k, active) => {
        if (k !== key) {
          return;
        }
        if (active && stage === 1) {
          serverA.delete(k);
          stage = 2;
        } else if (!active && stage === 2) {
          stage = 3;
          serverA.unprovide('.*');
          clearTimeout(timeout);
          resolve();
        } else {
          clearTimeout(timeout);
          reject(`Unknown provide state for key: ${k}, active: ${active ? 'TRUE' : 'FALSE'}, stage: ${stage}`);
        }
      };
      serverA.provide('.*', provideHandler);
    });
    await new Promise((resolve, reject) => { // eslint-disable-line no-loop-func
      const timeout = setTimeout(() => {
        client.unsubscribe(key);
        client.data.removeListener('set', handler);
        reject(new Error('Timeout when waiting for key'));
      }, 1000);
      const handler = (k, v) => {
        if (k === key && typeof v === 'undefined') {
          clearTimeout(timeout);
          client.unsubscribe(key);
          client.data.removeListener('set', handler);
          resolve();
        }
      };
      client.data.on('set', handler);
      client.subscribe(key);
    });
    await providePromise;
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});
