
const uuid = require('uuid');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');

const run = async () => {
  const peers = [];
  const startPort = 10000 + Math.round(Math.random() * 10000);
  const peerCount = 4;
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
  for (let i = 1; i < peerCount; i += 1) {
    peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[i].port - 1}`, {}));
  }
  await Promise.all(peerPromises);
  const dataA = peers[0].data;
  const dataB = peers[Math.floor(peers.length / 2)].data;
  let activeKeyA = uuid.v4();
  let activeValueA = uuid.v4();
  let activeKeyB = uuid.v4();
  let activeValueB = uuid.v4();
  let responseCount = 0;
  const handleSetA = (key, value) => {
    if (key === activeKeyB && value === activeValueB) {
      responseCount += 1;
      activeKeyA = uuid.v4();
      activeValueA = uuid.v4();
      dataA.set(activeKeyA, activeValueA);
    }
  };
  const handleSetB = (key, value) => {
    if (key === activeKeyA && value === activeValueA) {
      responseCount += 1;
      activeKeyB = uuid.v4();
      activeValueB = uuid.v4();
      dataB.set(activeKeyB, activeValueB);
    }
  };
  dataA.on('set', handleSetA);
  dataB.on('set', handleSetB);
  dataA.set(activeKeyA, activeValueA);
  dataB.set(activeKeyB, activeValueB);
  await new Promise((resolve) => setTimeout(resolve, 10000));
  dataA.removeListener('set', handleSetA);
  dataB.removeListener('set', handleSetB);
  await Promise.all(peers.map(({ server }) => server.close()));
  await Promise.all(peers.map(({ stop }) => stop()));
  console.log(`${responseCount} responses in 10s`);
}

run();



 
