// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const ConnectionHandler = require('../src/connection-handler');
const startWebsocketServer = require('../src/ws-server');
require('./lib/map-utils');


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
    for (let i = 10; i < count; i += 1) {
      peerPromises.push(peers[i].connectionHandler.connectToPeer(`ws://localhost:${startPort + i % 10}`, {}));
    }
    peerPromises.push(peers[0].connectionHandler.connectToPeer(`ws://localhost:${peers[1].port}`, {}));
    peerPromises.push(peers[1].connectionHandler.connectToPeer(`ws://localhost:${peers[2].port}`, {}));
    peerPromises.push(peers[2].connectionHandler.connectToPeer(`ws://localhost:${peers[3].port}`, {}));
    peerPromises.push(peers[3].connectionHandler.connectToPeer(`ws://localhost:${peers[4].port}`, {}));
    peerPromises.push(peers[4].connectionHandler.connectToPeer(`ws://localhost:${peers[5].port}`, {}));
    peerPromises.push(peers[5].connectionHandler.connectToPeer(`ws://localhost:${peers[6].port}`, {}));
    peerPromises.push(peers[6].connectionHandler.connectToPeer(`ws://localhost:${peers[7].port}`, {}));
    peerPromises.push(peers[7].connectionHandler.connectToPeer(`ws://localhost:${peers[8].port}`, {}));
    peerPromises.push(peers[8].connectionHandler.connectToPeer(`ws://localhost:${peers[9].port}`, {}));
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
    const peerIds0 = peers[0].connectionHandler.peers.get(peers[0].connectionHandler.id);
    expect(peerIds0).toBeInstanceOf(Array);
    expect(peerIds0.length).toEqual(count / 10);
    for (let i = 1; i < 9; i += 1) {
      const { connectionHandler } = peers[i];
      const peerIds = connectionHandler.peers.get(connectionHandler.id);
      expect(peerIds).toBeInstanceOf(Array);
      expect(peerIds.length).toEqual(count / 10 + 1);
    }
    const peerIds9 = peers[9].connectionHandler.peers.get(peers[9].connectionHandler.id);
    expect(peerIds9).toBeInstanceOf(Array);
    expect(peerIds9.length).toEqual(count / 10);
    for (let i = 10; i < count; i += 1) {
      const { connectionHandler } = peers[i];
      const peerIds = connectionHandler.peers.get(connectionHandler.id);
      expect(peerIds).toBeInstanceOf(Array);
      expect(peerIds.length).toEqual(1);
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

