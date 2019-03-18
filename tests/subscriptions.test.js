// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const ConnectionHandler = require('../src/connection-handler');
const startWebsocketServer = require('../src/ws-server');
require('./lib/map-utils');

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(60000);

describe(`${count} peers in a ring with a subscriber client`, () => {
  let client;
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
    client = new Client(`ws://localhost:${startPort + Math.floor(Math.random() * count)}`, {});
    await client.open();
  });

  test('Should subscribe to values', async () => {
    const [data] = getRandomDatas(1);
    const key = uuid.v4();
    const value = uuid.v4();
    await client.subscribe(key, () => {});
    data.set(key, value);
    await expect(client.data).toReceiveProperty(key, value);
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ connectionHandler }) => connectionHandler.closePeerConnections()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ connectionHandler }) => connectionHandler.throwOnLeakedReferences());
  });
});
