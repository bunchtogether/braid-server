// @flow

import { v4 as uuidv4 } from 'uuid';

import { isEqual } from 'lodash';
import Client from '@bunchtogether/braid-client';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(5000);

describe(`${count} peers in a ring with an event subscriber client`, () => {
  let client;
  const peers = [];
  let clientPeerIdAndSocketId;
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
    for (const { server } of peers) {
      for (const socketId of [...server.sockets.keys()]) {
        if (server.peerSockets.hasSource(socketId)) {
          continue;
        }
        clientPeerIdAndSocketId = [server.id, socketId];
      }
    }
  });

  test('Should add and remove event listeners', async () => {
    const name = uuidv4();
    const callback = () => {};
    await client.addServerEventListener(name, callback);
    await client.removeServerEventListener(name, callback);
  });

  test('Should listen for events', async () => {
    for (const { server } of peers) {
      const name = uuidv4();
      const emittedArgs = [uuidv4(), uuidv4(), uuidv4()];
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

  test('Should listen for socket events', async () => {
    const clientB = new Client();
    await clientB.open(`ws://localhost:${startPort}`, {});
    if (typeof clientPeerIdAndSocketId === 'undefined') {
      throw new Error('Client peer ID / socket ID pair does not exist');
    }
    const [peerId, socketId] = clientPeerIdAndSocketId;
    let didReceiveCallbackB = false;
    const callbackB = () => {
      didReceiveCallbackB = true;
    };
    for (const { server } of peers) {
      const name = uuidv4();
      const emittedArgs = [uuidv4(), uuidv4(), uuidv4()];
      await clientB.addServerEventListener(name, callbackB);
      await new Promise(async (resolve) => { // eslint-disable-line no-loop-func
        const callback = (...args) => {
          if (isEqual(emittedArgs, args)) {
            resolve();
          }
        };
        await client.addServerEventListener(name, callback);
        server.emitToSocket(name, peerId, socketId, ...emittedArgs);
      });
      client.removeServerEventListener(name);
      clientB.removeServerEventListener(name);
    }
    await clientB.close();
    if (didReceiveCallbackB) {
      throw new Error('Client received message intended for a different socket');
    }
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});
