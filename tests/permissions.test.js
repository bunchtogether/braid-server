// @flow

const uuid = require('uuid');
const expect = require('expect');
const { default: Client } = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
require('./lib/map-utils');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Permissions', () => {
  let stopWebsocketServer;
  let server;

  beforeAll(async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    server = new Server(ws[0]);
    stopWebsocketServer = ws[1];
  });

  afterAll(async () => {
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should handle failing subscription requests made before the connection is opened', async () => {
    const client = new Client();
    const key = uuid.v4();
    server.provide('.*', (k, active) => {
      if (active) {
        server.data.set(k, true);
      }
    });
    server.setSubscribeRequestHandler(async (k:string, credentials: Object) => ({ success: false, code: 400, message: 'Not allowed' })); // eslint-disable-line no-unused-vars
    // Add error handler to avoid throwing in test
    client.on('error', () => {});
    const subscribePromise = client.subscribe(key);
    client.open(`ws://localhost:${port}`);
    await expect(subscribePromise).rejects.toEqual(expect.objectContaining({
      itemKey: key,
      name: 'SubscribeError',
      code: 400,
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.data.get(key)).toBeUndefined();
    await client.close();
    server.unprovide('.*');
  });

  test('Should handle subscription requests made before the connection is opened', async () => {
    const clientA = new Client();
    const clientB = new Client();
    const clientIdA = uuid.v4();
    const clientIdB = uuid.v4();
    const key = uuid.v4();
    server.provide('.*', (k, active) => {
      if (active) {
        server.data.set(k, true);
      }
    });
    server.setSubscribeRequestHandler(async (k:string, credentials: Object) => {
      if (credentials.client.id === clientIdA) {
        return { success: true, code: 200, message: 'OK' };
      }
      return { success: false, code: 400, message: 'Not allowed' };
    });
    // Add error handler to avoid throwing in test
    clientB.on('error', () => {});
    const subscribePromiseA = clientA.subscribe(key);
    const subscribePromiseB = clientB.subscribe(key);
    clientA.open(`ws://localhost:${port}`, { id: clientIdA });
    clientB.open(`ws://localhost:${port}`, { id: clientIdB });
    await expect(subscribePromiseA).resolves.toBeUndefined();
    await expect(subscribePromiseB).rejects.toEqual(expect.objectContaining({
      itemKey: key,
      name: 'SubscribeError',
      code: 400,
    }));
    await expect(clientA.data).toReceiveProperty(key, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientB.data.get(key)).toBeUndefined();
    await clientA.close();
    await clientB.close();
    server.unprovide('.*');
  });

  test('Should handle subscription requests made after the connection is opened', async () => {
    const clientA = new Client();
    const clientB = new Client();
    const clientIdA = uuid.v4();
    const clientIdB = uuid.v4();
    const key = uuid.v4();
    server.provide('.*', (k, active) => {
      if (active) {
        server.data.set(k, true);
      }
    });
    server.setSubscribeRequestHandler(async (k:string, credentials: Object) => {
      if (credentials.client.id === clientIdA) {
        return { success: true, code: 200, message: 'OK' };
      }
      return { success: false, code: 400, message: 'Not allowed' };
    });
    await clientA.open(`ws://localhost:${port}`, { id: clientIdA });
    await clientB.open(`ws://localhost:${port}`, { id: clientIdB });
    const subscribePromiseA = clientA.subscribe(key);
    const subscribePromiseB = clientB.subscribe(key);
    await expect(subscribePromiseA).resolves.toBeUndefined();
    await expect(subscribePromiseB).rejects.toEqual(expect.objectContaining({
      itemKey: key,
      name: 'SubscribeError',
      code: 400,
    }));
    await expect(clientA.data).toReceiveProperty(key, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientB.data.get(key)).toBeUndefined();
    await clientA.close();
    await clientB.close();
    server.unprovide('.*');
  });

  test('Should handle event subscription requests made before the connection is opened', async () => {
    const clientA = new Client();
    const clientB = new Client();
    const clientIdA = uuid.v4();
    const clientIdB = uuid.v4();
    const name = uuid.v4();
    let clientAReceivedEvent = false;
    let clientBReceivedEvent = false;
    const callbackA = () => {
      clientAReceivedEvent = true;
    };
    const callbackB = () => {
      clientBReceivedEvent = true;
    };
    server.setEventSubscribeRequestHandler(async (n:string, credentials: Object) => {
      if (credentials.client.id === clientIdA) {
        return { success: true, code: 200, message: 'OK' };
      }
      return { success: false, code: 400, message: 'Not allowed' };
    });
    const eventSubscribePromiseA = clientA.addServerEventListener(name, callbackA);
    const eventSubscribePromiseB = clientB.addServerEventListener(name, callbackB);
    clientA.open(`ws://localhost:${port}`, { id: clientIdA });
    clientB.open(`ws://localhost:${port}`, { id: clientIdB });
    await expect(eventSubscribePromiseA).resolves.toBeUndefined();
    await expect(eventSubscribePromiseB).rejects.toEqual(expect.objectContaining({
      itemName: name,
      name: 'EventSubscribeError',
      code: 400,
    }));
    server.emitToClients(name, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientAReceivedEvent).toEqual(true);
    expect(clientBReceivedEvent).toEqual(false);
    await clientA.close();
    await clientB.close();
  });

  test('Should handle event subscription requests made after the connection is opened', async () => {
    const clientA = new Client();
    const clientB = new Client();
    const clientIdA = uuid.v4();
    const clientIdB = uuid.v4();
    const name = uuid.v4();
    let clientAReceivedEvent = false;
    let clientBReceivedEvent = false;
    const callbackA = () => {
      clientAReceivedEvent = true;
    };
    const callbackB = () => {
      clientBReceivedEvent = true;
    };
    server.setEventSubscribeRequestHandler(async (n:string, credentials: Object) => {
      if (credentials.client.id === clientIdA) {
        return { success: true, code: 200, message: 'OK' };
      }
      return { success: false, code: 400, message: 'Not allowed' };
    });
    await clientA.open(`ws://localhost:${port}`, { id: clientIdA });
    await clientB.open(`ws://localhost:${port}`, { id: clientIdB });
    const eventSubscribePromiseA = clientA.addServerEventListener(name, callbackA);
    const eventSubscribePromiseB = clientB.addServerEventListener(name, callbackB);
    await expect(eventSubscribePromiseA).resolves.toBeUndefined();
    await expect(eventSubscribePromiseB).rejects.toEqual(expect.objectContaining({
      itemName: name,
      name: 'EventSubscribeError',
      code: 400,
    }));
    server.emitToClients(name, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientAReceivedEvent).toEqual(true);
    expect(clientBReceivedEvent).toEqual(false);
    await clientA.close();
    await clientB.close();
  });

  test('Should handle publish requests made before the connection is opened', async () => {
    const clientA = new Client();
    const clientB = new Client();
    const clientIdA = uuid.v4();
    const clientIdB = uuid.v4();
    const name = uuid.v4();
    const valueA = uuid.v4();
    const valueB = uuid.v4();
    const clientAPublishPromise = new Promise((resolve, reject) => {
      server.receive(name, (n:string, socketId:number, message:any) => {
        if (n !== name) {
          return;
        }
        if (message === valueA) {
          resolve();
        } else {
          reject(`Invalid message: ${JSON.stringify(message)}`);
        }
      });
    });
    server.setPublishRequestHandler(async (n:string, credentials: Object) => {
      if (credentials.client.id === clientIdA) {
        return { success: true, code: 200, message: 'OK' };
      }
      return { success: false, code: 400, message: 'Not allowed' };
    });
    const publishPromiseA = clientA.startPublishing(name);
    const publishPromiseB = clientB.startPublishing(name);
    clientA.open(`ws://localhost:${port}`, { id: clientIdA });
    clientB.open(`ws://localhost:${port}`, { id: clientIdB });
    await expect(publishPromiseA).resolves.toBeUndefined();
    await expect(publishPromiseB).rejects.toEqual(expect.objectContaining({
      itemName: name,
      name: 'PublishError',
      code: 400,
    }));
    await clientA.publish(name, valueA);
    await clientAPublishPromise;
    expect(() => clientB.publish(name, valueB)).toThrow('Receiver does not exist');
    await clientA.close();
    await clientB.close();
  });

  test('Should handle publish requests made after the connection is opened', async () => {
    const clientA = new Client();
    const clientB = new Client();
    const clientIdA = uuid.v4();
    const clientIdB = uuid.v4();
    const name = uuid.v4();
    const valueA = uuid.v4();
    const valueB = uuid.v4();
    const clientAPublishPromise = new Promise((resolve, reject) => {
      server.receive(name, (n:string, socketId:number, message:any) => {
        if (n !== name) {
          return;
        }
        if (message === valueA) {
          resolve();
        } else {
          reject(`Invalid message: ${JSON.stringify(message)}`);
        }
      });
    });
    server.setPublishRequestHandler(async (n:string, credentials: Object) => {
      if (credentials.client.id === clientIdA) {
        return { success: true, code: 200, message: 'OK' };
      }
      return { success: false, code: 400, message: 'Not allowed' };
    });
    await clientA.open(`ws://localhost:${port}`, { id: clientIdA });
    await clientB.open(`ws://localhost:${port}`, { id: clientIdB });
    const publishPromiseA = clientA.startPublishing(name);
    const publishPromiseB = clientB.startPublishing(name);
    await expect(publishPromiseA).resolves.toBeUndefined();
    await expect(publishPromiseB).rejects.toEqual(expect.objectContaining({
      itemName: name,
      name: 'PublishError',
      code: 400,
    }));
    await clientA.publish(name, valueA);
    await clientAPublishPromise;
    expect(() => clientB.publish(name, valueB)).toThrow('Receiver does not exist');
    await clientA.close();
    await clientB.close();
  });
});
