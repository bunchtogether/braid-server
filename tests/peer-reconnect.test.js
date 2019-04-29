// @flow

const expect = require('expect');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

jest.setTimeout(30000);

describe('Peer Reconnect', () => {
  test('Should reconnect after one second if the source peer disconnects', async () => {
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
    for (const socketId of serverB.peerSockets.getSources(peerIdA)) {
      const ws = serverB.sockets.get(socketId);
      if (ws) {
        ws.close();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should reconnect after one second if the target peer disconnects', async () => {
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
    const peerConnection = serverA.peerConnections.get(peerIdB);
    if (peerConnection) {
      await peerConnection.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(serverB.hasPeer(peerIdA)).toEqual(false);
    expect(serverA.hasPeer(peerIdB)).toEqual(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
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
