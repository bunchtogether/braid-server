// @flow

// const expect = require('expect');
const Server = require('../src');
const uuid = require('uuid');
const { default: Client } = require('@bunchtogether/braid-client');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');
const { connectAndSync } = require('./lib/connect');

jest.setTimeout(60000);

const MAX_PEERS = 10;


describe('Peer Connect', () => {
  const key = uuid.v4();
  let value = uuid.v4();

  const client = new Client();
  client.setReconnectHandler(() => false);
  client.subscribe(key);

  const items = [];

  afterAll(async () => {
    await client.close();
    for (const item of items) { // eslint-disable-line no-unused-vars
      const server = item[0];
      const stopWebsocketServer = item[2];
      await server.close();
      await stopWebsocketServer();
    }
  });

  test('Should connect to a different server', async () => {
    let port = 20000 + Math.round(Math.random() * 10000);
    const valueCallbacks = new Set();
    const checkValue = async () => {
      if (items.length === 0) {
        return;
      }
      value = uuid.v4();
      for (const valueCallback of valueCallbacks) {
        valueCallback();
      }
      if (!client.ws) {
        const nextPort = items[Math.floor(Math.random() * items.length)][1];
        client.open(`ws://localhost:${nextPort}`);
      }
      const handleClose = () => {
        const nextPort = items[Math.floor(Math.random() * items.length)][1];
        client.open(`ws://localhost:${nextPort}`);
      };
      client.on('close', handleClose);
      try {
        await expect(client.data).toReceiveProperty(key, value);
      } finally {
        client.removeListener('close', handleClose);
      }
    };
    const makeHandler = (server) => {
      const valueCallback = () => {
        server.data.set(key, value);
      };
      return (k, active) => {
        if (k !== key) {
          return;
        }
        if (active) {
          server.data.set(k, value);
          valueCallbacks.add(valueCallback);
        } else {
          valueCallbacks.delete(valueCallback);
        }
      };
    };
    for (let i = 0; i < 10; i += 1) {
      const itemCountToAdd = Math.ceil(Math.random() * MAX_PEERS);
      for (let j = 0; j < itemCountToAdd && items.length <= MAX_PEERS; j += 1) {
        const [wss, stopWebsocketServer] = await startWebsocketServer('0.0.0.0', port);
        const server = new Server(wss);
        server.provide(key, makeHandler(server));
        for (const item of items) {
          const otherServer = item[0];
          const otherServerPort = item[1];
          await connectAndSync(server, port, otherServer, otherServerPort);
        }
        items.push([server, port, stopWebsocketServer]);
        port += 1;
        await checkValue();
      }
      const itemCountToDisconnectFromPeers = Math.floor(Math.random() * items.length * 0.5);
      for (let j = 0; j < itemCountToDisconnectFromPeers; j += 1) {
        const indexToDisconnectFromPeers = Math.floor(Math.random() * items.length);
        const server = items[indexToDisconnectFromPeers][0];
        for (const peerConnection of server.peerConnections.values()) {
          const ws = peerConnection.ws;
          if (ws.readyState !== 1) {
            continue;
          }
          ws.terminate();
        }
        for (const socketId of server.peerSockets.sources) {
          const socket = server.sockets.get(socketId);
          if (!socket) {
            continue;
          }
          socket.close();
        }
        await checkValue();
      }
      const itemCountToRemove = Math.floor(Math.random() * items.length * 0.5);
      for (let j = 0; j < itemCountToRemove; j += 1) {
        await checkValue();
        const indexToRemove = Math.floor(Math.random() * items.length);
        const server = items[indexToRemove][0];
        const stopWebsocketServer = items[indexToRemove][2];
        items.splice(indexToRemove, 1);
        await server.close();
        await stopWebsocketServer();
      }
      await checkValue();
    }
  });
});
