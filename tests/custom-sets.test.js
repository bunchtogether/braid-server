// @flow

const uuid = require('uuid');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(60000);

describe('Custom sets', () => {
  const peers = [];

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
    peerPromises.push(peers[0].server.connectToPeer(`ws://localhost:${startPort + count - 1}`, {}));
    for (let i = 1; i < count; i += 1) {
      peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[i].port - 1}`, {}));
    }
    await Promise.all(peerPromises);
  });

  afterAll(async () => {
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });

  test('Should share custom sets', async () => {
    const name = uuid.v4();
    for (const peer of peers) {
      const set = peer.server.sets[name];
      set.add(`${peer.server.id}`);
    }
    for (const peer of peers) {
      for (const { server: { id } } of peers) {
        const set = peer.server.sets[name];
        await expect(set).toReceiveMember(`${id}`);
      }
    }
  });
});

