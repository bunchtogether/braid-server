// @flow

const uuid = require('uuid');
const expect = require('expect');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

jest.setTimeout(30000);

describe('Peer Reconnect', () => {
  test('Should reconnect after one second if the source peer disconnects', async () => {
    const keyA = uuid.v4();
    const keyB = uuid.v4();
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
    serverA.provide(keyA, () => {});
    serverB.provide(keyB, () => {});
    serverA.receive(keyA);
    serverB.receive(keyB);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverA.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.receivers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.receivers).toReceiveProperty(serverB.id, [keyB]);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    for (const socketId of serverB.peerSockets.getSources(peerIdA)) {
      const ws = serverB.sockets.get(socketId);
      if (ws) {
        ws.end(1006, 'Peer Disconnect Test (Socket)');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverA.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.receivers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.receivers).toReceiveProperty(serverB.id, [keyB]);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should reconnect after one second if the target peer disconnects', async () => {
    const keyA = uuid.v4();
    const keyB = uuid.v4();
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
    serverA.provide(keyA, () => {});
    serverB.provide(keyB, () => {});
    serverA.receive(keyA);
    serverB.receive(keyB);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverA.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.receivers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.receivers).toReceiveProperty(serverB.id, [keyB]);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    const peerConnection = serverA.peerConnections.get(peerIdB);
    if (!peerConnection) {
      throw new Error('Peer connection does not exist');
    }
    await peerConnection.close(1000, 'Peer Disconnect Test (Connection)');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    await expect(serverA.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.providers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.providers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverA.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverA.receivers).toReceiveProperty(serverB.id, [keyB]);
    await expect(serverB.receivers).toReceiveProperty(serverA.id, [keyA]);
    await expect(serverB.receivers).toReceiveProperty(serverB.id, [keyB]);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should not reconnect if disconnect was requested by source peer', async () => {
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
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    await serverA.disconnectFromPeer(peerIdB);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });
});
