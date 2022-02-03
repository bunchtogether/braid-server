// @flow

// const expect = require('expect');
import { v4 as uuidv4 } from 'uuid';

import Client from '@bunchtogether/braid-client';
import Server from '../src';
import './lib/map-utils';
import startWebsocketServer from './lib/ws-server';

jest.setTimeout(30000);

describe('Client Credentials', () => {
  test('Should not try to reconnect after providing invalid credentials', async () => {
    const port = 10000 + Math.round(Math.random() * 10000);
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    server.setCredentialsHandler(async () => // eslint-disable-line no-unused-vars
      ({ success: false, code: 403, message: 'Not allowed' }),
    );
    const client = new Client();
    const credentials = { [uuidv4()]: uuidv4() };
    await expect(client.open(`ws://localhost:${port}`, credentials)).rejects.toEqual(expect.objectContaining({
      name: 'CredentialsError',
      code: 403,
    }));
    expect(client.ws).toBeUndefined();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
  test('Should disconnect on invalid credentials', async () => {
    const port = 10000 + Math.round(Math.random() * 10000);
    const ws = await startWebsocketServer('0.0.0.0', port);
    const stopWebsocketServer = ws[1];
    const server = new Server(ws[0]);
    server.setCredentialsHandler(async () => // eslint-disable-line no-unused-vars
      ({ success: false, code: 403, message: 'Not allowed' }),
    );
    const client = new Client();
    await client.open(`ws://localhost:${port}`);
    const credentials = { [uuidv4()]: uuidv4() };
    await expect(client.sendCredentials(credentials)).rejects.toEqual(expect.objectContaining({
      name: 'CredentialsError',
      code: 403,
    }));
    expect(client.ws).toBeUndefined();
    await server.close();
    await stopWebsocketServer();
    server.throwOnLeakedReferences();
  });
});
