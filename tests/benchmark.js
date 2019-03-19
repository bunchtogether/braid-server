
const uuid = require('uuid');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
const Deepstream = require('deepstream.io');
const deepstream = require('deepstream.io-client-js');
const { CONSTANTS } = require('deepstream.io-client-js');

const runBraid = async () => {
  const peers = [];
  const startPort = 10000 + Math.round(Math.random() * 10000);
  const peerCount = 2;
  for (let i = 0; i < peerCount; i += 1) {
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
  peerPromises.push(peers[0].server.connectToPeer(`ws://localhost:${startPort + peerCount - 1}`, {}));
  if (peerCount > 2) {
    for (let i = 1; i < peerCount; i += 1) {
      peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[i].port - 1}`, {}));
    }
  }
  await Promise.all(peerPromises);
  const dataA = peers[0].data;
  const dataB = peers[Math.floor(peers.length / 2)].data;
  const key = uuid.v4();
  // let activeKeyB = uuid.v4();
  let activeValueA = { value: uuid.v4() };
  let activeValueB = { value: uuid.v4() };
  let responseCount = 0;
  const handleSetA = (k, value) => {
    if (value.value === activeValueB.value) {
      responseCount += 1;
      activeValueA = { value: uuid.v4() };
      activeValueB = { value: uuid.v4() };
      dataA.set(key, activeValueA);
    }
  };
  const handleSetB = (k, value) => {
    if (value.value === activeValueA.value) {
      responseCount += 1;
      activeValueA = { value: uuid.v4() };
      activeValueB = { value: uuid.v4() };
      dataB.set(key, activeValueB);
    }
  };
  dataA.on('set', handleSetA);
  dataB.on('set', handleSetB);
  dataA.set(key, activeValueA);
  await new Promise((resolve) => setTimeout(resolve, 10000));
  dataA.removeListener('set', handleSetA);
  dataB.removeListener('set', handleSetB);
  await Promise.all(peers.map(({ server }) => server.close()));
  await Promise.all(peers.map(({ stop }) => stop()));
  console.log(`${responseCount} responses in 10s`);
};

const runDeepstream = async () => {
  const server = new Deepstream({
    connectionEndpoints: {
      websocket: {
        options: {
          port: 5000,
        },
      },
      http: false,
    },
    showLogo: false,
    logLevel: 'INFO',
  });
  await new Promise((resolve) => {
    server.once('started', resolve);
    server.start();
  });
  let clientA;
  let clientB;
  await new Promise((resolve, reject) => {
    clientA = deepstream('ws://127.0.0.1:5000').login();
    clientA.on('connectionStateChanged', (connectionState) => {
      if (connectionState === deepstream.CONSTANTS.CONNECTION_STATE.OPEN) {
        clientA.off('connectionStateChanged');
        resolve();
      } else if (connectionState === deepstream.CONSTANTS.CONNECTION_STATE.ERROR) {
        reject(new Error('Connection error.'));
      }
    });
  });
  await new Promise((resolve, reject) => {
    clientB = deepstream('ws://127.0.0.1:5000').login();
    clientB.on('connectionStateChanged', (connectionState) => {
      if (connectionState === deepstream.CONSTANTS.CONNECTION_STATE.OPEN) {
        clientB.off('connectionStateChanged');
        resolve();
      } else if (connectionState === deepstream.CONSTANTS.CONNECTION_STATE.ERROR) {
        reject(new Error('Connection error.'));
      }
    });
  });
  const name = uuid.v4();
  let activeValueA = { value: uuid.v4() };
  let activeValueB = { value: uuid.v4() };
  let responseCount = 0;
  const recordA = clientA.record.getRecord(name);
  const recordB = clientB.record.getRecord(name);
  recordA.subscribe((value) => {
    if (value.value === activeValueB.value) {
      responseCount += 1;
      activeValueA = { value: uuid.v4() };
      recordA.set(activeValueA);
    }
  });
  recordB.subscribe((value) => {
    if (value.value === activeValueA.value) {
      responseCount += 1;
      activeValueB = { value: uuid.v4() };
      recordB.set(activeValueB);
    }
  });
  recordA.set(activeValueA);
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log(`${responseCount} responses in 10s`);
  await new Promise((resolve) => {
    const currentConnectionState = clientA.getConnectionState();
    if (currentConnectionState === CONSTANTS.CONNECTION_STATE.CLOSED || currentConnectionState === deepstream.CONSTANTS.CONNECTION_STATE.ERROR) {
      clientA.off('connectionStateChanged');
      resolve();
    }
    clientA.on('connectionStateChanged', (connectionState) => {
      if (connectionState === CONSTANTS.CONNECTION_STATE.CLOSED || connectionState === deepstream.CONSTANTS.CONNECTION_STATE.ERROR) {
        clientA.off('connectionStateChanged');
        resolve();
      }
    });
    clientA.close();
  });
  await new Promise((resolve) => {
    const currentConnectionState = clientB.getConnectionState();
    if (currentConnectionState === CONSTANTS.CONNECTION_STATE.CLOSED || currentConnectionState === deepstream.CONSTANTS.CONNECTION_STATE.ERROR) {
      clientB.off('connectionStateChanged');
      resolve();
    }
    clientB.on('connectionStateChanged', (connectionState) => {
      if (connectionState === CONSTANTS.CONNECTION_STATE.CLOSED || connectionState === deepstream.CONSTANTS.CONNECTION_STATE.ERROR) {
        clientB.off('connectionStateChanged');
        resolve();
      }
    });
    clientB.close();
  });
  await new Promise((resolve) => {
    server.once('stopped', resolve);
    server.stop();
  });
};

const run = async () => {
  await runBraid();
  await runDeepstream();
};

run();

