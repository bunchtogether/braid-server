// @flow

// const expect = require('expect');
import { v4 as uuidv4 } from 'uuid';

import Client from '@bunchtogether/braid-client';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

jest.setTimeout(30000);

describe('Provider Connections', () => {
  const portA = 10000 + Math.round(Math.random() * 10000);
  const portB = portA + 1;
  let stopWebsocketServerA;
  let stopWebsocketServerB;
  let serverA;
  let serverB;
  let client;
  beforeAll(async () => {
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    serverA = new Server(wsA[0]);
    serverB = new Server(wsB[0]);
    stopWebsocketServerA = wsA[1];
    stopWebsocketServerB = wsB[1];
    client = new Client();
    await client.open(`ws://localhost:${portA}`, {});
  });

  afterAll(async () => {
    await client.close();
    await serverA.close();
    await serverB.close();
    await stopWebsocketServerA();
    await stopWebsocketServerB();
  });

  test('Should activate provider if subscriptions exist', async () => {
    const key = uuidv4();
    const value = uuidv4();
    const subscriptionPromise = new Promise((resolve, reject) => { // eslint-disable-line no-loop-func
      const timeout = setTimeout(() => {
        client.unsubscribe(key);
        client.data.removeListener('set', handler);
        reject(new Error('Timeout when waiting for key'));
      }, 1000);
      const handler = (k, v) => {
        if (k === key && v === value) {
          clearTimeout(timeout);
          client.unsubscribe(key);
          client.data.removeListener('set', handler);
          resolve();
        }
      };
      client.data.on('set', handler);
    });
    const providePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout when waiting for provide'));
      }, 1000);
      const handler = (k, active) => {
        clearTimeout(timeout);
        if (k === key && active) {
          serverB.set(key, value);
          serverB.unprovide('.*');
          resolve();
        } else {
          reject(`Unexpected provide state for key: ${key}, active: ${active ? 'TRUE' : 'FALSE'}`);
        }
      };
      serverB.provide('.*', handler);
    });
    await client.subscribe(key);
    serverB.connectToPeer(`ws://localhost:${portA}`, {});
    await providePromise;
    await subscriptionPromise;
  });
});
