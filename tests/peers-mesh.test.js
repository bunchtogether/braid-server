// @flow

import { v4 as uuidv4 } from 'uuid';

import { shuffle } from 'lodash';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';


const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 100;

jest.setTimeout(60000);

describe(`${count} Peers in a mesh`, () => {
  const peers = [];
  const getRandomDatas = (c:number) => shuffle(peers).slice(0, c).map((peer) => peer.data);
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
    for (let i = 10; i < count; i += 1) {
      peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${startPort + i % 10}`, {}));
    }
    peerPromises.push(peers[0].server.connectToPeer(`ws://localhost:${peers[1].port}`, {}));
    peerPromises.push(peers[1].server.connectToPeer(`ws://localhost:${peers[2].port}`, {}));
    peerPromises.push(peers[2].server.connectToPeer(`ws://localhost:${peers[3].port}`, {}));
    peerPromises.push(peers[3].server.connectToPeer(`ws://localhost:${peers[4].port}`, {}));
    peerPromises.push(peers[4].server.connectToPeer(`ws://localhost:${peers[5].port}`, {}));
    peerPromises.push(peers[5].server.connectToPeer(`ws://localhost:${peers[6].port}`, {}));
    peerPromises.push(peers[6].server.connectToPeer(`ws://localhost:${peers[7].port}`, {}));
    peerPromises.push(peers[7].server.connectToPeer(`ws://localhost:${peers[8].port}`, {}));
    peerPromises.push(peers[8].server.connectToPeer(`ws://localhost:${peers[9].port}`, {}));
    await Promise.all(peerPromises);
  });

  test('Should peer', async () => {
    const key = uuidv4();
    const value = uuidv4();
    const [dataA] = getRandomDatas(1);
    dataA.set(key, value);
    for (const { data } of peers) {
      await expect(data).toReceiveProperty(key, value);
    }
  });

  test('Should track peer connections', async () => {
    const peerIds0 = peers[0].server.peers.get(peers[0].server.id);
    if (!peerIds0) {
      throw new Error('Unable to load peers');
    }
    expect(peerIds0).toBeInstanceOf(Array);
    expect(peerIds0.length).toEqual(count / 10);
    for (let i = 1; i < 9; i += 1) {
      const { server } = peers[i];
      const peerIds = server.peers.get(server.id);
      if (!peerIds) {
        throw new Error('Unable to load peers');
      }
      expect(peerIds).toBeInstanceOf(Array);
      expect(peerIds.length).toEqual(count / 10 + 1);
    }
    const peerIds9 = peers[9].server.peers.get(peers[9].server.id);
    if (!peerIds9) {
      throw new Error('Unable to load peers');
    }
    expect(peerIds9).toBeInstanceOf(Array);
    expect(peerIds9.length).toEqual(count / 10);
    for (let i = 10; i < count; i += 1) {
      const { server } = peers[i];
      const peerIds = server.peers.get(server.id);
      if (!peerIds) {
        throw new Error('Unable to load peers');
      }
      expect(peerIds).toBeInstanceOf(Array);
      expect(peerIds.length).toEqual(1);
    }
  });

  test('Should close gracefully', async () => {
    await Promise.all(peers.map(({ server }) => server.close()));
    for (const { server } of peers) {
      const peerIds = server.peers.get(server.id);
      expect(peerIds).toBeUndefined();
    }
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});

