// @flow

import { v4 as uuidv4 } from 'uuid';

import { shuffle } from 'lodash';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

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
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[j].port}`, {}));
      }
    }
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
    for (const { server } of peers) {
      const peerIds = server.peers.get(server.id);
      if (!peerIds) {
        throw new Error('Unable to load peers');
      }
      expect(peerIds).toBeInstanceOf(Array);
      expect(peerIds.length).toEqual(count - 1);
    }
  });

  test('Should remove a dropped peer', async () => {
    const { server } = peers[0];
    await server.close();
    await expect(peers[1].server.peers).toReceiveProperty(server.id, undefined);
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

