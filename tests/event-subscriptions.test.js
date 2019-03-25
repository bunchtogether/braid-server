// @flow

const uuid = require('uuid');
const Client = require('@bunchtogether/braid-client');
const { isEqual } = require('lodash');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(5000);

describe(`${count} peers in a ring with an event subscriber client`, () => {
  let client;
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
    client = new Client();
    await client.open(`ws://localhost:${startPort + Math.floor(Math.random() * count)}`, {});
  });

  test('Should add and remove event listeners', async () => {
    const name = uuid.v4();
    const callback = () => {};
    await client.addServerEventListener(name, callback);
    await client.removeServerEventListener(name, callback);
  });

  test('Should listen for events', async () => {
    for (const { server } of peers) {
      const name = uuid.v4();
      const emittedArgs = [uuid.v4(), uuid.v4(), uuid.v4()];
      await new Promise(async (resolve) => { // eslint-disable-line no-loop-func
        const callback = (...args) => {
          if (isEqual(emittedArgs, args)) {
            resolve();
          }
        };
        await client.addServerEventListener(name, callback);
        server.emitToClients(name, ...emittedArgs);
      });
      client.removeServerEventListener(name);
    }
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});
