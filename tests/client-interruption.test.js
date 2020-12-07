// @flow

const expect = require('expect');
const uuid = require('uuid');
const Client = require('@bunchtogether/braid-client');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');

const { ConnectionError } = Client;

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

  test('Should emit a SubscribeError if the connection closes before the client receives a subscription response', async () => {
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
    const prematureClosePromise = new Promise((resolve, reject) => {
      client.on('error', reject);
    });
    const subscriptionPromise = client.subscribe(key);
    await subscriptionReceivedPromise;
    await client.close();
    await expect(prematureClosePromise).rejects.toEqual(expect.objectContaining({
      name: 'SubscribeError',
      itemKey: key,
      code: 502,
    }));
    server.setSubscribeRequestHandler(async () => ({ success: true, code: 200, message: 'OK' }));
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    await subscriptionPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit and throw a SubscribeError if the client errors before the client receives a subscription response', async () => {
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
    const genericErrorPromise = new Promise((resolve, reject) => {
      client.on('error', (error) => {
        if (error.message === 'Example error') {
          return;
        }
        reject(error);
      });
    });
    const subscriptionPromise = client.subscribe(key);
    await subscriptionReceivedPromise;
    emitError();
    await expect(genericErrorPromise).rejects.toEqual(expect.objectContaining({
      name: 'SubscribeError',
      itemKey: key,
      code: 500,
    }));
    await expect(subscriptionPromise).rejects.toEqual(expect.objectContaining({
      name: 'SubscribeError',
      itemKey: key,
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit a SubscribeError if the client has a connection error before the client receives a subscription response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const key = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new ConnectionError('Example error'));
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
    const genericErrorPromise = new Promise((resolve, reject) => {
      client.on('error', (error) => {
        if (error.message === 'Example error') {
          return;
        }
        reject(error);
      });
    });
    const subscriptionPromise = client.subscribe(key);
    await subscriptionReceivedPromise;
    emitError();
    await expect(genericErrorPromise).rejects.toEqual(expect.objectContaining({
      name: 'SubscribeError',
      itemKey: key,
      code: 502,
    }));
    await client.close();
    server.setSubscribeRequestHandler(async () => ({ success: true, code: 200, message: 'OK' }));
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    await subscriptionPromise;
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });


  test('Should wait for a pending credentials response before sending a subscription request', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const key = uuid.v4();
    await client.open(`ws://localhost:${port}`);
    const subscribeRequestCredentialsCheckPromise = new Promise((resolve) => {
      client.on('subscribeRequestCredentialsCheck', (k:string) => {
        if (k === key) {
          resolve();
        }
      });
    });
    server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
      while (!client.subscriptions.has(key)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { success: true, code: 200, message: 'OK' };
    });
    client.sendCredentials({ [uuid.v4()]: uuid.v4() });
    await client.subscribe(key);
    await subscribeRequestCredentialsCheckPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit an EventSubscribeError if the connection closes before the client receives an event subscription response', async () => {
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
    const prematureClosePromise = new Promise((resolve, reject) => {
      client.on('error', reject);
    });
    const eventSubscriptionPromise = client.addServerEventListener(name, () => {});
    await eventSubscriptionReceivedPromise;
    await client.close();
    await expect(prematureClosePromise).rejects.toEqual(expect.objectContaining({
      name: 'EventSubscribeError',
      itemName: name,
      code: 502,
    }));
    server.setEventSubscribeRequestHandler(async () => ({ success: true, code: 200, message: 'OK' }));
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    await eventSubscriptionPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit and throw an EventSubscribeError if the client errors before the client receives an event subscription response', async () => {
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
    const genericErrorPromise = new Promise((resolve, reject) => {
      client.on('error', (error) => {
        if (error.message === 'Example error') {
          return;
        }
        reject(error);
      });
    });
    const eventSubscriptionPromise = client.addServerEventListener(name, () => {});
    await eventSubscriptionReceivedPromise;
    emitError();
    await expect(genericErrorPromise).rejects.toEqual(expect.objectContaining({
      name: 'EventSubscribeError',
      itemName: name,
      code: 500,
    }));
    await expect(eventSubscriptionPromise).rejects.toEqual(expect.objectContaining({
      name: 'EventSubscribeError',
      itemName: name,
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit an EventSubscribeError if the client receives a connection error before the client receives an event subscription response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new ConnectionError('Example error'));
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
    const genericErrorPromise = new Promise((resolve, reject) => {
      client.on('error', (error) => {
        if (error.message === 'Example error') {
          return;
        }
        reject(error);
      });
    });
    const eventSubscriptionPromise = client.addServerEventListener(name, () => {});
    await eventSubscriptionReceivedPromise;
    emitError();
    await expect(genericErrorPromise).rejects.toEqual(expect.objectContaining({
      name: 'EventSubscribeError',
      itemName: name,
      code: 502,
    }));
    await client.close();
    server.setEventSubscribeRequestHandler(async () => ({ success: true, code: 200, message: 'OK' }));
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    await eventSubscriptionPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should wait for a pending credentials response before sending an event subscription request', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`);
    const eventSubscribeRequestCredentialsCheckPromise = new Promise((resolve) => {
      client.on('eventSubscribeRequestCredentialsCheck', (n:string) => {
        if (n === name) {
          resolve();
        }
      });
    });
    server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
      while (!client.eventSubscriptions.has(name)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { success: true, code: 200, message: 'OK' };
    });
    client.sendCredentials({ [uuid.v4()]: uuid.v4() });
    await client.addServerEventListener(name, () => {});
    await eventSubscribeRequestCredentialsCheckPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit a PublishError if the connection closes before the client receives a publish response', async () => {
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
    const prematureClosePromise = new Promise((resolve, reject) => {
      client.on('error', reject);
    });
    const publishPromise = client.startPublishing(name);
    await publishReceivedPromise;
    await client.close();
    await expect(prematureClosePromise).rejects.toEqual(expect.objectContaining({
      name: 'PublishError',
      itemName: name,
      code: 502,
    }));
    server.setPublishRequestHandler(async () => ({ success: true, code: 200, message: 'OK' }));
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    await publishPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit and throw a PublishError if the client errors before the client receives a publish response', async () => {
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
    const genericErrorPromise = new Promise((resolve, reject) => {
      client.on('error', (error) => {
        if (error.message === 'Example error') {
          return;
        }
        reject(error);
      });
    });
    const publishPromise = client.startPublishing(name);
    await publishReceivedPromise;
    emitError();
    await expect(genericErrorPromise).rejects.toEqual(expect.objectContaining({
      name: 'PublishError',
      itemName: name,
      code: 500,
    }));
    await expect(publishPromise).rejects.toEqual(expect.objectContaining({
      name: 'PublishError',
      itemName: name,
      code: 500,
    }));
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should emit a PublishError if the client receives a connection error before the client receives a publish response', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    let errorWasEmitted = false;
    const emitError = () => {
      client.emit('error', new ConnectionError('Example error'));
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
    const genericErrorPromise = new Promise((resolve, reject) => {
      client.on('error', (error) => {
        if (error.message === 'Example error') {
          return;
        }
        reject(error);
      });
    });
    const publishPromise = client.startPublishing(name);
    await publishReceivedPromise;
    emitError();
    await expect(genericErrorPromise).rejects.toEqual(expect.objectContaining({
      name: 'PublishError',
      itemName: name,
      code: 502,
    }));
    await client.close();
    server.setPublishRequestHandler(async () => ({ success: true, code: 200, message: 'OK' }));
    await client.open(`ws://localhost:${port}`, { [uuid.v4()]: uuid.v4() });
    await publishPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should wait for a pending credentials response before sending a publish request', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    const client = new Client();
    const name = uuid.v4();
    await client.open(`ws://localhost:${port}`);
    const publishRequestCredentialsCheckPromise = new Promise((resolve) => {
      client.on('publishRequestCredentialsCheck', (n:string) => {
        if (n === name) {
          resolve();
        }
      });
    });
    server.setCredentialsHandler(async (credentials: Object) => { // eslint-disable-line no-unused-vars
      while (!client.receivers.has(name)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { success: true, code: 200, message: 'OK' };
    });
    client.sendCredentials({ [uuid.v4()]: uuid.v4() });
    await client.startPublishing(name);
    await publishRequestCredentialsCheckPromise;
    await client.close();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
});
