// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const ConnectionHandler = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

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
      const connectionHandler = new ConnectionHandler(ws[0]);
      const stop = ws[1];
      peers.push({
        port,
        data: connectionHandler.data,
        connectionHandler,
        stop,
      });
    }
    const peerPromises = [];
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        peerPromises.push(peers[i].connectionHandler.connectToPeer(`ws://localhost:${peers[j].port}`, {}));
      }
    }
    await Promise.all(peerPromises);
  });

  test('Should peer', async () => {
    const key = uuid.v4();
    const value = uuid.v4();
    const [dataA] = getRandomDatas(1);
    dataA.set(key, value);
    for (const { data } of peers) {
      await expect(data).toReceiveProperty(key, value);
    }
  });

  test('Should track peer connections', async () => {
    for (const { connectionHandler } of peers) {
      const peerIds = connectionHandler.peers.get(connectionHandler.id);
      expect(peerIds).toBeInstanceOf(Array);
      expect(peerIds.length).toEqual(count - 1);
    }
  });

  test('Should remove a dropped peer', async () => {
    const { connectionHandler } = peers[0];
    await connectionHandler.close();
    await expect(peers[1].connectionHandler.peers).toReceiveProperty(connectionHandler.id, undefined);
  });

  test('Should close gracefully', async () => {
    await Promise.all(peers.map(({ connectionHandler }) => connectionHandler.close()));
    for (const { connectionHandler } of peers) {
      const peerIds = connectionHandler.peers.get(connectionHandler.id);
      expect(peerIds).toBeUndefined();
    }
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ connectionHandler }) => connectionHandler.throwOnLeakedReferences());
  });
});

