// @flow

const uuid = require('uuid');
const { shuffle } = require('lodash');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const startPort = 20000 + Math.round(Math.random() * 10000);
const count = 10;

jest.setTimeout(20000);

describe(`${count} peers in a ring with a receiver`, () => {
  let client;
  const peers = [];
  const getRandomServers = (c:number) => shuffle(peers).slice(0, c).map((peer) => peer.server);
  beforeAll(async () => {
    for (let i = 0; i < count; i += 1) {
      const port = startPort + i;
      const ws = await startWebsocketServer('0.0.0.0', port);
      const server = new Server(ws[0]);
      const stop = ws[1];
      peers.push({
        port,
        providers: server.providers,
        data: server.data,
        server,
        stop,
      });
    }
    const peerPromises = [];
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        peerPromises.push(peers[i].server.connectToPeer(`ws://localhost:${peers[j].port}`, {}));
      }
    }
    await Promise.all(peerPromises);
    client = new Client();
    await client.open(`ws://localhost:${startPort + 2 + Math.floor(Math.random() * count - 2)}`, {});
  });

  test('Should start and stop publishing', async () => {
    const name = uuid.v4();
    await client.startPublishing(name);
    await client.stopPublishing(name);
  });

  test('Should receive values', async () => {
    const key = uuid.v4();
    const [serverA, serverB] = getRandomServers(2);
    serverA.receive(key);
    for (const { server } of peers) {
      await expect(server.receivers).toReceiveProperty(serverA.id, [key]);
    }
    const [[regexStringA, regexA]] = serverA.receiverRegexes.get(serverA.id);
    const [[regexStringB, regexB]] = serverB.receiverRegexes.get(serverA.id);
    expect(regexStringA).toEqual(key);
    expect(regexStringB).toEqual(key);
    expect(regexA).toBeInstanceOf(RegExp);
    expect(regexB).toBeInstanceOf(RegExp);
    expect(regexA.test(key)).toEqual(true);
    expect(regexB.test(key)).toEqual(true);
    expect(regexA.test(uuid.v4())).toEqual(false);
    expect(regexB.test(uuid.v4())).toEqual(false);
    serverA.unreceive(key);
  });

  test('Receives strings and objects', async () => {
    const key = uuid.v4();
    const messageA = uuid.v4();
    const messageB = {
      [uuid.v4()]: uuid.v4(),
    };
    const { server: serverA, port } = peers[0];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});
    const handleMessage = jest.fn();
    serverA.receive(key, handleMessage);
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    clientA.publish(key, messageA);
    await new Promise((resolve) => setTimeout(resolve, 100));
    clientA.publish(key, messageB);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessage.mock.calls.length).toEqual(2);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][2]).toEqual(messageA);
    expect(handleMessage.mock.calls[1][0]).toEqual(key);
    expect(handleMessage.mock.calls[1][2]).toEqual(messageB);
    await clientA.stopPublishing(key);
    await clientA.close();
    serverA.unreceive(key);
  });


  test('Triggers open and close events from a local client', async () => {
    const key = uuid.v4();
    const message = uuid.v4();
    const { server: serverA, port } = peers[0];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});
    const handleMessage = jest.fn();
    const handleOpen = jest.fn();
    const handleClose = jest.fn();
    serverA.receive(key, handleMessage, handleOpen, handleClose);
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleOpen.mock.calls.length).toEqual(1);
    expect(handleOpen.mock.calls[0][0]).toEqual(key);
    expect(handleOpen.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpen.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessage.mock.calls.length).toEqual(1);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    expect(handleMessage.mock.calls[0][2]).toEqual(message);
    await clientA.stopPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleClose.mock.calls.length).toEqual(1);
    expect(handleClose.mock.calls[0][0]).toEqual(key);
    expect(handleClose.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    await clientA.close();
    serverA.unreceive(key);
  });

  test('Triggers close events when a local client disconnects', async () => {
    const key = uuid.v4();
    const message = uuid.v4();
    const { server: serverA, port } = peers[0];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});
    const handleMessage = jest.fn();
    const handleOpen = jest.fn();
    const handleClose = jest.fn();
    serverA.receive(key, handleMessage, handleOpen, handleClose);
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleOpen.mock.calls.length).toEqual(1);
    expect(handleOpen.mock.calls[0][0]).toEqual(key);
    expect(handleOpen.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpen.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessage.mock.calls.length).toEqual(1);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    expect(handleMessage.mock.calls[0][2]).toEqual(message);
    await clientA.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleClose.mock.calls.length).toEqual(1);
    expect(handleClose.mock.calls[0][0]).toEqual(key);
    expect(handleClose.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    serverA.unreceive(key);
  });

  test('Triggers open and close events from a remote client', async () => {
    const key = uuid.v4();
    const message = uuid.v4();
    const { server: serverA } = peers[0];
    const { port } = peers[1];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});
    const handleMessage = jest.fn();
    const handleOpen = jest.fn();
    const handleClose = jest.fn();
    serverA.receive(key, handleMessage, handleOpen, handleClose);
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleOpen.mock.calls.length).toEqual(1);
    expect(handleOpen.mock.calls[0][0]).toEqual(key);
    expect(handleOpen.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpen.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessage.mock.calls.length).toEqual(1);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    expect(handleMessage.mock.calls[0][2]).toEqual(message);
    await clientA.stopPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleClose.mock.calls.length).toEqual(1);
    expect(handleClose.mock.calls[0][0]).toEqual(key);
    expect(handleClose.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    await clientA.close();
    serverA.unreceive(key);
  });

  test('Triggers close events when a remote client disconnects', async () => {
    const key = uuid.v4();
    const message = uuid.v4();
    const { server: serverA } = peers[0];
    const { port } = peers[1];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});
    const handleMessage = jest.fn();
    const handleOpen = jest.fn();
    const handleClose = jest.fn();
    serverA.receive(key, handleMessage, handleOpen, handleClose);
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleOpen.mock.calls.length).toEqual(1);
    expect(handleOpen.mock.calls[0][0]).toEqual(key);
    expect(handleOpen.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpen.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessage.mock.calls.length).toEqual(1);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    expect(handleMessage.mock.calls[0][2]).toEqual(message);
    await clientA.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleClose.mock.calls.length).toEqual(1);
    expect(handleClose.mock.calls[0][0]).toEqual(key);
    expect(handleClose.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    serverA.unreceive(key);
  });

  test('Triggers close events when a peer disconnects', async () => {
    const port = 30000 + Math.round(Math.random() * 10000);
    const ws = await startWebsocketServer('0.0.0.0', port);
    const server = new Server(ws[0]);
    const peerPromises = [];
    for (const peer of peers) {
      peerPromises.push(peer.server.connectToPeer(`ws://localhost:${port}`, {}));
    }
    await peerPromises;
    const stop = ws[1];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});

    const key = uuid.v4();
    const message = uuid.v4();
    const [serverA] = getRandomServers(1);
    const handleMessage = jest.fn();
    const handleOpen = jest.fn();
    const handleClose = jest.fn();
    serverA.receive(key, handleMessage, handleOpen, handleClose);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleOpen.mock.calls.length).toEqual(1);
    expect(handleOpen.mock.calls[0][0]).toEqual(key);
    expect(handleOpen.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpen.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessage.mock.calls.length).toEqual(1);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    expect(handleMessage.mock.calls[0][2]).toEqual(message);
    await server.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleClose.mock.calls.length).toEqual(1);
    expect(handleClose.mock.calls[0][0]).toEqual(key);
    expect(handleClose.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    await clientA.close();
    await stop();
    serverA.unreceive(key);
    server.throwOnLeakedReferences();
  });

  test('Triggers open events when a peer connects', async () => {
    const port = 30000 + Math.round(Math.random() * 10000);
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stop = ws[1];
    const server = new Server(ws[0]);
    const key = uuid.v4();
    const message = uuid.v4();
    const handleMessage = jest.fn();
    const handleOpen = jest.fn();
    const handleClose = jest.fn();
    server.receive(key, handleMessage, handleOpen, handleClose);
    const { port: portA } = peers[0];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${portA}`, {});
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const peerPromises = [];
    for (const peer of peers) {
      peerPromises.push(peer.server.connectToPeer(`ws://localhost:${port}`, {}));
    }
    await peerPromises;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handleOpen.mock.calls.length).toEqual(1);
    expect(handleOpen.mock.calls[0][0]).toEqual(key);
    expect(handleOpen.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpen.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handleMessage.mock.calls.length).toEqual(1);
    expect(handleMessage.mock.calls[0][0]).toEqual(key);
    expect(handleMessage.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    expect(handleMessage.mock.calls[0][2]).toEqual(message);
    await clientA.stopPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handleClose.mock.calls.length).toEqual(1);
    expect(handleClose.mock.calls[0][0]).toEqual(key);
    expect(handleClose.mock.calls[0][1]).toEqual(handleOpen.mock.calls[0][1]);
    await clientA.close();
    await server.close();
    await stop();
    server.throwOnLeakedReferences();
  });

  test('Reassigns when a peer unreceives', async () => {
    const key = uuid.v4();
    const message = uuid.v4();
    const { server: serverA, port } = peers[0];
    const { server: serverB } = peers[1];
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`, {});
    const handleMessageA = jest.fn();
    const handleOpenA = jest.fn();
    const handleCloseA = jest.fn();
    const handleMessageB = jest.fn();
    const handleOpenB = jest.fn();
    const handleCloseB = jest.fn();
    serverA.receive(key, handleMessageA, handleOpenA, handleCloseA);
    serverB.receive(key, handleMessageB, handleOpenB, handleCloseB);
    await expect(serverA.receivers).toReceiveProperty(serverA.id, [key]);
    await expect(serverA.receivers).toReceiveProperty(serverB.id, [key]);
    await expect(serverB.receivers).toReceiveProperty(serverA.id, [key]);
    await expect(serverB.receivers).toReceiveProperty(serverB.id, [key]);
    await clientA.startPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleOpenA.mock.calls.length).toEqual(1);
    expect(handleOpenA.mock.calls[0][0]).toEqual(key);
    expect(handleOpenA.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpenA.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessageA.mock.calls.length).toEqual(1);
    expect(handleMessageA.mock.calls[0][0]).toEqual(key);
    expect(handleMessageA.mock.calls[0][1]).toEqual(handleOpenA.mock.calls[0][1]);
    expect(handleMessageA.mock.calls[0][2]).toEqual(message);
    serverA.unreceive(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleCloseA.mock.calls.length).toEqual(1);
    expect(handleCloseA.mock.calls[0][0]).toEqual(key);
    expect(handleCloseA.mock.calls[0][1]).toEqual(handleOpenA.mock.calls[0][1]);

    expect(handleOpenB.mock.calls.length).toEqual(1);
    expect(handleOpenB.mock.calls[0][0]).toEqual(key);
    expect(handleOpenB.mock.calls[0][1]).toEqual(expect.any(Number));
    expect(handleOpenB.mock.calls[0][2]).toEqual(expect.objectContaining({
      client: {},
      ip: expect.any(String),
    }));
    clientA.publish(key, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleMessageB.mock.calls.length).toEqual(1);
    expect(handleMessageB.mock.calls[0][0]).toEqual(key);
    expect(handleMessageB.mock.calls[0][1]).toEqual(handleOpenB.mock.calls[0][1]);
    expect(handleMessageB.mock.calls[0][2]).toEqual(message);
    await clientA.stopPublishing(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handleCloseB.mock.calls.length).toEqual(1);
    expect(handleCloseB.mock.calls[0][0]).toEqual(key);
    expect(handleCloseB.mock.calls[0][1]).toEqual(handleOpenB.mock.calls[0][1]);
    await clientA.close();
    serverB.unreceive(key);
  });

  test('Should close gracefully', async () => {
    await client.close();
    await Promise.all(peers.map(({ server }) => server.close()));
    await Promise.all(peers.map(({ stop }) => stop()));
    peers.map(({ server }) => server.throwOnLeakedReferences());
  });
});

