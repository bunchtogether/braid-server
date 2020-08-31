// @flow

const uuid = require('uuid');
const expect = require('expect');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

jest.setTimeout(30000);

describe('Reproduce Errors', () => {
  test('Should not attempt to encode an undefined object with messagepack', async () => {
    const keyA = uuid.v4();
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
    serverA.data.set(keyA, undefined);
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should encode a null object with messagepack', async () => {
    const keyA = uuid.v4();
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
    serverA.data.set(keyA, null);
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });
});
