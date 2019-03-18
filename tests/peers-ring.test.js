// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const ConnectionHandler = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 100;

jest.setTimeout(60000);

describe(`${count} Peers in a ring`, () => {
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
    peerPromises.push(peers[0].connectionHandler.connectToPeer(`ws://localhost:${startPort + count - 1}`, {}));
    for (let i = 1; i < count; i += 1) {
      peerPromises.push(peers[i].connectionHandler.connectToPeer(`ws://localhost:${peers[i].port - 1}`, {}));
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
      expect(peerIds.length).toEqual(2);
    }
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

