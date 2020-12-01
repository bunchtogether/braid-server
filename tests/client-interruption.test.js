// @flow

const expect = require('expect');
const uuid = require('uuid');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Client Interruption', () => {
  test('Should throw a ServerRequestError if the connection closes before the client receives a credentials response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    await client.open(`ws://localhost:${port}`);
    const credentialsReceivedPromise = new Promise((resolve) => {
      server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (client.ws) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientCredentialsPromise = client.sendCredentials({ [uuid.v4()]: uuid.v4() });
    await credentialsReceivedPromise;
    await client.close();
    await expect(clientCredentialsPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 502,
    }));
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
  test('Should throw a ServerRequestError if the client errors before the client receives a credentials response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    await client.open(`ws://localhost:${port}`);
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new Error('Example error'));
      errorWasEmitted = true;
    };
    const credentialsReceivedPromise = new Promise((resolve) => {
      server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (!errorWasEmitted) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientCredentialsPromise = client.sendCredentials({ [uuid.v4()]: uuid.v4() });
    await credentialsReceivedPromise;
    emitError();
    await expect(clientCredentialsPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should throw a ServerRequestError if the connection closes before the client receives a subscription response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const key = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    const subscriptionReceivedPromise = new Promise((resolve) => {
      server.setSubscribeRequestHandler(async (n:string, credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (client.ws) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientSubscriptionPromise = client.subscribe(key);
    await subscriptionReceivedPromise;
    await client.close();
    await expect(clientSubscriptionPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 502,
    }));
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should throw a ServerRequestError if the client errors before the client receives a subscription response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const key = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new Error('Example error'));
      errorWasEmitted = true;
    };
    const subscriptionReceivedPromise = new Promise((resolve) => {
      server.setSubscribeRequestHandler(async (n:string, credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (!errorWasEmitted) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientSubscriptionPromise = client.subscribe(key);
    await subscriptionReceivedPromise;
    emitError();
    await expect(clientSubscriptionPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should throw a ServerRequestError if the connection closes before the client receives  an event subscription response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    const eventSubscriptionReceivedPromise = new Promise((resolve) => {
      server.setEventSubscribeRequestHandler(async (k:string, credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (client.ws) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientEventSubscriptionPromise = client.addServerEventListener(name, () => {});
    await eventSubscriptionReceivedPromise;
    await client.close();
    await expect(clientEventSubscriptionPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 502,
    }));
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should throw a ServerRequestError if the client errors before the client receives an event subscription response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new Error('Example error'));
      errorWasEmitted = true;
    };
    const eventSubscriptionReceivedPromise = new Promise((resolve) => {
      server.setEventSubscribeRequestHandler(async (k:string, credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (!errorWasEmitted) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientEventSubscriptionPromise = client.addServerEventListener(name, () => {});
    await eventSubscriptionReceivedPromise;
    emitError();
    await expect(clientEventSubscriptionPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should throw a ServerRequestError if the connection closes before the client receives a publish response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    const publishReceivedPromise = new Promise((resolve) => {
      server.setPublishRequestHandler(async (n:string, credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (client.ws) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientPublishPromise = client.startPublishing(name);
    await publishReceivedPromise;
    await client.close();
    await expect(clientPublishPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 502,
    }));
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should throw a ServerRequestError if the client errors before the client receives a publish response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new Error('Example error'));
      errorWasEmitted = true;
    };
    const publishReceivedPromise = new Promise((resolve) => {
      server.setPublishRequestHandler(async (n:string, credentials: Object) => { // eslint-disable-line no-unused-vars
        resolve();
        while (!errorWasEmitted) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { success: true, code: 200, message: 'OK' };
      });
    });
    const clientPublishPromise = client.startPublishing(name);
    await publishReceivedPromise;
    emitError();
    await expect(clientPublishPromise).rejects.toEqual(expect.objectContaining({
      name: 'ServerRequestError',
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
});
