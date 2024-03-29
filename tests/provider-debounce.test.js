// @flow

import { v4 as uuidv4 } from 'uuid';

// const { isEqual } = require('lodash');
import Client from '@bunchtogether/braid-client';

import Server from '../src';
import startWebsocketServer from './lib/ws-server';

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Provider debounce', () => {
  test('Receives inactive events', async () => {
    const [ws, stopWebsocketServer] = await startWebsocketServer('0.0.0.0', port);
    const server = new Server(ws);
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`);
    const clientB = new Client();
    await clientB.open(`ws://localhost:${port}`);
    const key = uuidv4();
    let isActive;
    const handle = (k, active) => {
      if (k === key) {
        isActive = active;
      }
    };
    server.provide(key, handle);
    await clientA.subscribe(key);
    expect(isActive).toEqual(true);
    await clientA.close();
    expect(isActive).toEqual(false);
    await clientB.subscribe(key);
    expect(isActive).toEqual(true);
    await clientB.close();
    expect(isActive).toEqual(false);
    server.unprovide(key);
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Debounces inactive events', async () => {
    const [ws, stopWebsocketServer] = await startWebsocketServer('0.0.0.0', port);
    const server = new Server(ws);
    const clientA = new Client();
    await clientA.open(`ws://localhost:${port}`);
    const clientB = new Client();
    await clientB.open(`ws://localhost:${port}`);
    const key = uuidv4();
    let isActive;
    const handle = (k, active) => {
      if (k === key) {
        isActive = active;
      }
    };
    server.provide(key, handle, { debounce: 50 });
    await clientA.subscribe(key);
    expect(isActive).toEqual(true);
    await clientA.close();
    expect(isActive).toEqual(true);
    await clientB.subscribe(key);
    expect(isActive).toEqual(true);
    await clientB.close();
    expect(isActive).toEqual(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isActive).toEqual(false);
    server.unprovide(key);
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Cleans up debounced events on close', async () => {
    const [ws, stopWebsocketServer] = await startWebsocketServer('0.0.0.0', port);
    const server = new Server(ws);
    const client = new Client();
    await client.open(`ws://localhost:${port}`);
    const key = uuidv4();
    let isActive;
    const handle = (k, active) => {
      if (k === key) {
        isActive = active;
      }
    };
    server.provide(key, handle, { debounce: 60000 });
    await client.subscribe(key);
    expect(isActive).toEqual(true);
    const clientClosePromise = new Promise((resolve) => client.once('close', resolve));
    await server.close();
    await stopWebsocketServer();
    await clientClosePromise;
    expect(isActive).toEqual(false);
    await client.close();
    server.throwOnLeakedReferences();
  });
});
