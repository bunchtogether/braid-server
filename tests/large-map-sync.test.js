// @flow

// const expect = require('expect');
import { v4 as uuidv4 } from 'uuid';

import crypto from 'crypto';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

jest.setTimeout(60000);

const getRandomBase64 = (size: number) => crypto.randomBytes(size).toString('base64');

describe('Large Map Sync', () => {
  test('Should handle large data sent during reconnect', async () => {
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    const peerSyncPromiseA1 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverA.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverB.id) {
          return;
        }
        clearTimeout(timeout);
        serverA.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverA.addListener('peerSync', handlePeerSync);
    });
    const peerSyncPromiseB1 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverB.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverA.id) {
          return;
        }
        clearTimeout(timeout);
        serverB.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverB.addListener('peerSync', handlePeerSync);
    });
    for (let i = 0; i < 50; i += 1) {
      const randomString = getRandomBase64(1024 * 1024);
      serverB.set(uuidv4(), randomString);
    }
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await peerSyncPromiseA1;
    await peerSyncPromiseB1;
    const peerSyncPromiseA2 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverA.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverB.id) {
          return;
        }
        clearTimeout(timeout);
        serverA.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverA.addListener('peerSync', handlePeerSync);
    });
    const peerSyncPromiseB2 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverB.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverA.id) {
          return;
        }
        clearTimeout(timeout);
        serverB.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverB.addListener('peerSync', handlePeerSync);
    });
    for (const socketId of serverB.peerSockets.getSources(serverA.id)) {
      const ws = serverB.sockets.get(socketId);
      if (!ws) {
        throw new Error('Websocket does not exist');
      }
      ws.end(1006, 'Peer Disconnect Test (Socket)');
    }
    for (let i = 0; i < 50; i += 1) {
      const randomString = getRandomBase64(1024 * 1024);
      serverB.set(uuidv4(), randomString);
    }
    await peerSyncPromiseA2;
    await peerSyncPromiseB2;
    for (const [key, value] of serverB.data) {
      await expect(serverA.data).toReceiveProperty(key, value);
    }
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should handle large data sent during reconnect', async () => {
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    const peerSyncPromiseA1 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverA.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverB.id) {
          return;
        }
        clearTimeout(timeout);
        serverA.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverA.addListener('peerSync', handlePeerSync);
    });
    const peerSyncPromiseB1 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverB.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverA.id) {
          return;
        }
        clearTimeout(timeout);
        serverB.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverB.addListener('peerSync', handlePeerSync);
    });
    for (let i = 0; i < 50; i += 1) {
      const randomString = getRandomBase64(1024 * 1024);
      serverA.set(uuidv4(), randomString);
    }
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await peerSyncPromiseA1;
    await peerSyncPromiseB1;
    const peerSyncPromiseA2 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverA.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverB.id) {
          return;
        }
        clearTimeout(timeout);
        serverA.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverA.addListener('peerSync', handlePeerSync);
    });
    const peerSyncPromiseB2 = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverB.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverA.id) {
          return;
        }
        clearTimeout(timeout);
        serverB.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverB.addListener('peerSync', handlePeerSync);
    });

    const peerConnection = serverA.peerConnections.get(serverB.id);
    if (!peerConnection) {
      throw new Error('Peer connection does not exist');
    }
    peerConnection.close(1000, 'Peer Disconnect Test (Connection)');
    for (let i = 0; i < 50; i += 1) {
      const randomString = getRandomBase64(1024 * 1024);
      serverA.set(uuidv4(), randomString);
    }
    await peerSyncPromiseA2;
    await peerSyncPromiseB2;
    for (const [key, value] of serverA.data) {
      await expect(serverB.data).toReceiveProperty(key, value);
    }
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should handle large data sent from socket host', async () => {
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    const peerSyncPromiseA = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverA.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverB.id) {
          return;
        }
        clearTimeout(timeout);
        serverA.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverA.addListener('peerSync', handlePeerSync);
    });
    const peerSyncPromiseB = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverB.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverA.id) {
          return;
        }
        clearTimeout(timeout);
        serverB.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverB.addListener('peerSync', handlePeerSync);
    });
    for (let i = 0; i < 100; i += 1) {
      const randomString = getRandomBase64(1024 * 1024);
      serverA.set(i.toString(), randomString);
    }
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await peerSyncPromiseA;
    await peerSyncPromiseB;
    for (const [key, value] of serverA.data) {
      await expect(serverB.data).toReceiveProperty(key, value);
    }
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });

  test('Should handle large data sent from socket host', async () => {
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    const peerSyncPromiseA = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverA.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverB.id) {
          return;
        }
        clearTimeout(timeout);
        serverA.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverA.addListener('peerSync', handlePeerSync);
    });
    const peerSyncPromiseB = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverB.removeListener('peerSync', handlePeerSync);
        reject(new Error('Did not receive peer sync'));
      }, 60000);
      const handlePeerSync = (peerId:number) => {
        if (peerId !== serverA.id) {
          return;
        }
        clearTimeout(timeout);
        serverB.removeListener('peerSync', handlePeerSync);
        resolve();
      };
      serverB.addListener('peerSync', handlePeerSync);
    });
    for (let i = 0; i < 100; i += 1) {
      const randomString = getRandomBase64(1024 * 1024);
      serverB.set(i.toString(), randomString);
    }
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    await peerSyncPromiseA;
    await peerSyncPromiseB;
    for (const [key, value] of serverB.data) {
      await expect(serverA.data).toReceiveProperty(key, value);
    }
    await serverA.close();
    await stopWebsocketServerA();
    serverA.throwOnLeakedReferences();
    await serverB.close();
    await stopWebsocketServerB();
    serverB.throwOnLeakedReferences();
  });
});
