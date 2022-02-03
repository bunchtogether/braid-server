// @flow

import { v4 as uuidv4 } from 'uuid';

import expect from 'expect';
import Client from '@bunchtogether/braid-client';
import Server from '../src';
import { connectAndSync } from './lib/connect';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

jest.setTimeout(30000);

describe('Provider Dropoff', () => {
  test('Should connect to a different server', async () => {
    const client = new Client();
    client.timeoutDuration = 3000;
    const key = uuidv4();
    const value = 'Y';
    const portA = 1001;
    const portB = 1002;
    const portC = 1003;
    const portD = 1004;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0], undefined, undefined, { id: 1 });
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0], undefined, undefined, { id: 2 });
    const stopWebsocketServerB = wsB[1];
    const wsC = await startWebsocketServer('0.0.0.0', portC);
    const serverC = new Server(wsC[0], undefined, undefined, { id: 3 });
    const stopWebsocketServerC = wsC[1];
    const wsD = await startWebsocketServer('0.0.0.0', portD);
    const serverD = new Server(wsD[0], undefined, undefined, { id: 4 });
    const stopWebsocketServerD = wsD[1];
    const handlerA = (k, active) => {
      if (k !== key) {
        return;
      }
      if (active) {
        serverA.set(k, value);
      } else {
        // serverA.set(k, uuidv4());
      }
    };
    const handlerB = (k, active) => {
      if (k !== key) {
        return;
      }
      if (active) {
        serverB.set(k, value);
      } else {
        // serverB.set(k, uuidv4());
      }
    };
    const handlerC = (k, active) => {
      if (k !== key) {
        return;
      }
      if (active) {
        serverC.set(k, value);
      } else {
        // serverC.set(k, uuidv4());
      }
    };
    const handlerD = (k, active) => {
      if (k !== key) {
        return;
      }
      if (active) {
        serverD.set(k, value);
      } else {
        // serverD.set(k, uuidv4());
      }
    };

    serverA.provide(key, handlerA);
    serverB.provide(key, handlerB);
    serverC.provide(key, handlerC);
    serverD.provide(key, handlerD);

    await Promise.all([
      connectAndSync(serverA, portA, serverB, portB),
      connectAndSync(serverA, portA, serverC, portC),
      connectAndSync(serverA, portA, serverD, portD),
      connectAndSync(serverB, portB, serverC, portC),
      connectAndSync(serverB, portB, serverD, portD),
      connectAndSync(serverC, portC, serverD, portD),
    ]);


    await client.open(`ws://localhost:${portA}`);
    await client.subscribe(key);
    await expect(client.data).toReceiveProperty(key, value);
    await client.close();

    await client.open(`ws://localhost:${portB}`);
    await client.subscribe(key);
    await expect(client.data).toReceiveProperty(key, value);
    await client.close();

    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
    await serverC.close();
    await stopWebsocketServerC();
    serverC.throwOnLeakedReferences();
    await serverD.close();
    await stopWebsocketServerD();
    serverD.throwOnLeakedReferences();
  });
});
