// @flow

import { v4 as uuidv4 } from 'uuid';

import expect from 'expect';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

jest.setTimeout(30000);

describe('Reproduce Errors', () => {
  test('Should not attempt to encode an undefined object with messagepack', async () => {
    const keyA = uuidv4();
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    const peerIdA = serverA.id;
    const peerIdB = serverB.id;
    serverA.provide(keyA, () => undefined);
    serverA.delete(keyA);
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await serverB.waitForPeerConnect(peerIdA);
    await serverA.waitForPeerConnect(peerIdB);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should encode a null object with messagepack', async () => {
    const keyA = uuidv4();
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    const peerIdA = serverA.id;
    const peerIdB = serverB.id;
    serverA.provide(keyA, () => undefined);
    serverA.set(keyA, null);
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await serverB.waitForPeerConnect(peerIdA);
    await serverA.waitForPeerConnect(peerIdB);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });
});
