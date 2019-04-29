// @flow

const expect = require('expect');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

jest.setTimeout(30000);

describe('Peer Connection Redundancy', () => {
  test('Should not error when a peer connects multiple times', async () => {
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
    const responseA1 = await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(responseA1).toEqual(peerIdB);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    const responseA2 = await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(responseA2).toEqual(peerIdB);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    const responseB1 = await serverB.connectToPeer(`ws://localhost:${portA}`, {});
    expect(responseB1).toEqual(peerIdA);
    expect(serverA.hasPeer(peerIdB)).toEqual(true);
    expect(serverB.hasPeer(peerIdA)).toEqual(true);
    await serverA.close();
    await serverB.close();
    await stopWebsocketServerA();
    await stopWebsocketServerB();
  });
});
