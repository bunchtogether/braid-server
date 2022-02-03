// @flow


import { v4 as uuidv4 } from 'uuid';

import Client from '@bunchtogether/braid-client';
import Server from '../src';
import startWebsocketServer from './lib/ws-server';

const port = 10000 + Math.round(Math.random() * 10000);

jest.setTimeout(30000);

describe('Client Reconnect', () => {
  const credentialsValue = {
    [uuidv4()]: uuidv4(),
  };

  test('Should call the reconnect handler and emit a reconnect event', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const server = new Server(ws[0]);
    const stopWebsocketServer = ws[1];
    const client = new Client();
    const openPromise = new Promise((resolve, reject) => {
      server.once('open', resolve);
      server.once('error', reject);
    });
    await client.open(`ws://localhost:${port}`, credentialsValue);
    await openPromise;
    const clientReconnectCredentialsPromise = new Promise((resolve, reject) => {
      client.setReconnectHandler((credentials) => {
        resolve(credentials);
        return true;
      });
      client.once('error', reject);
    });
    const clientReconnectEventPromise = new Promise((resolve, reject) => {
      client.once('reconnect', (isReconnecting: boolean) => {
        if (isReconnecting) {
          resolve();
        } else {
          reject(new Error('Client should reconnect when reconnect handler returns a value other than false'));
        }
      });
      client.once('error', reject);
    });
    await server.close();
    await expect(clientReconnectCredentialsPromise).resolves.toEqual(credentialsValue);
    await clientReconnectEventPromise;
    await client.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });

  test('Should not reconnect when the reconnect handler returns false', async () => {
    const ws = await startWebsocketServer('0.0.0.0', port);
    const server = new Server(ws[0]);
    const stopWebsocketServer = ws[1];
    const client = new Client();
    const openPromise = new Promise((resolve, reject) => {
      server.once('open', resolve);
      server.once('error', reject);
    });
    await client.open(`ws://localhost:${port}`, credentialsValue);
    await openPromise;
    const clientReconnectCredentialsPromise = new Promise((resolve, reject) => {
      client.setReconnectHandler((credentials) => {
        resolve(credentials);
        return false;
      });
      client.once('error', reject);
    });
    const clientReconnectEventPromise = new Promise((resolve, reject) => {
      client.once('reconnect', (isReconnecting: boolean) => {
        if (isReconnecting) {
          reject(new Error('Client should not reconnect when reconnect handler returns false'));
        } else {
          resolve();
        }
      });
      client.once('error', reject);
    });
    await server.close();
    await expect(clientReconnectCredentialsPromise).resolves.toEqual(credentialsValue);
    await clientReconnectEventPromise;
    await client.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
});
