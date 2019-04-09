// @flow

// See https://github.com/uNetworking/uWebSockets/issues/871

const expect = require('expect');
const uWS = require('uWebSockets.js');
const uuid = require('uuid');
const { shuffle } = require('lodash');
const Server = require('../dist');
require('./lib/map-utils');

const startPort = 10000 + Math.round(Math.random() * 10000);
const count = 100;

const startWebsocketServer = async function (host, port) {
  const uwsServer = uWS.App({});
  const listenSocket = await new Promise((resolve, reject) => {
    uwsServer.listen(port, (token) => {
      if (token) {
        resolve(token);
      } else {
        reject(new Error(`Unable to listen on port ${port}`));
      }
    });
  });
  const stopUwsServer = async function () {
    if (!listenSocket) {
      console.log('Listen socket does not exist');
      return;
    }
    uWS.us_listen_socket_close(listenSocket);
  };
  return [uwsServer, stopUwsServer];
};

const peers = [];

const getRandomDatas = (c) => shuffle(peers).slice(0, c).map((peer) => peer.data);

const run = async () => {
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
  const key = uuid.v4();
  const value = uuid.v4();
  const [dataA] = getRandomDatas(1);
  dataA.set(key, value);
  for (const { data } of peers) {
    await expect(data).toReceiveProperty(key, value);
  }
  await Promise.all(peers.map(({ server }) => server.close()));
  for (const { server } of peers) {
    const peerIds = server.peers.get(server.id);
    expect(peerIds).toBeUndefined();
  }
  await Promise.all(peers.map(({ stop }) => stop()));
  peers.map(({ server }) => server.throwOnLeakedReferences());
};

run();

