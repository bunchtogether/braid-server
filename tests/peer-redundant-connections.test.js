// @flow

import expect from 'expect';

import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

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
    await serverA.waitForPeerDisconnect(peerIdB);
    await serverB.waitForPeerDisconnect(peerIdA);
    const responseA1 = await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(responseA1).toEqual(peerIdB);
    await serverA.waitForPeerConnect(peerIdB);
    await serverB.waitForPeerConnect(peerIdA);
    const responseA2 = await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    expect(responseA2).toEqual(peerIdB);
    await serverA.waitForPeerConnect(peerIdB);
    await serverB.waitForPeerConnect(peerIdA);
    const responseB1 = await serverB.connectToPeer(`ws://localhost:${portA}`, {});
    expect(responseB1).toEqual(peerIdA);
    await serverA.waitForPeerConnect(peerIdB);
    await serverB.waitForPeerConnect(peerIdA);
    await serverA.close();
    await serverB.close();
    await stopWebsocketServerA();
    await stopWebsocketServerB();
  });
});
