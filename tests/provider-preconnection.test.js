// @flow

// const expect = require('expect');
import { v4 as uuidv4 } from 'uuid';

import Client from '@bunchtogether/braid-client';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

jest.setTimeout(30000);

describe('Provider Pre-Connection', () => {
  const portA = 10000 + Math.round(Math.random() * 10000);
  const portB = portA + 1;
  let clientA;
  let clientB;
  let stopWebsocketServerA;
  let stopWebsocketServerB;
  let serverA;
  let serverB;

  beforeAll(async () => {
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    serverA = new Server(wsA[0]);
    serverB = new Server(wsB[0]);
    stopWebsocketServerA = wsA[1];
    stopWebsocketServerB = wsB[1];
    clientA = new Client();
    await clientA.open(`ws://localhost:${portA}`, {});
    clientB = new Client();
    await clientB.open(`ws://localhost:${portB}`, {});
  });

  afterAll(async () => {
    await clientA.close();
    await clientB.close();
    await serverA.close();
    await serverB.close();
    await stopWebsocketServerA();
    await stopWebsocketServerB();
  });

  test('Should deactivate if two providers exists', async () => {
    const key = uuidv4();
    const deactivatePromise = new Promise((resolve) => {
      const handleA = (k, active) => {
        if (k !== key) {
          return;
        }
        if (!active) {
          resolve();
        }
      };
      const handleB = (k, active) => {
        if (k !== key) {
          return;
        }
        if (!active) {
          resolve();
        }
      };
      serverA.provide(key, handleA);
      serverB.provide(key, handleB);
    });
    clientA.subscribe(key);
    clientB.subscribe(key);
    await expect(serverA.activeProviders).toReceiveProperty(key, [serverA.id, key]);
    await expect(serverB.activeProviders).toReceiveProperty(key, [serverB.id, key]);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await deactivatePromise;
  });
});
