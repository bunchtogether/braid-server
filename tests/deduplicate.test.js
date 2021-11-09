// @flow

// const expect = require('expect');
const uuid = require('uuid');
const Server = require('../src');
const startWebsocketServer = require('./lib/ws-server');
const isEqual = require('lodash/isEqual');
require('./lib/map-utils');

jest.setTimeout(30000);

describe('Deduplication', () => {
  test('Should not set values if they are (deep) equal', async () => {
    const portA = 10000 + Math.round(Math.random() * 10000);
    const portB = portA + 1;
    const wsA = await startWebsocketServer('0.0.0.0', portA);
    const serverA = new Server(wsA[0]);
    const stopWebsocketServerA = wsA[1];
    const wsB = await startWebsocketServer('0.0.0.0', portB);
    const serverB = new Server(wsB[0]);
    const stopWebsocketServerB = wsB[1];
    await serverA.connectToPeer(`ws://localhost:${portB}`, {});
    const nameA = uuid.v4();
    const nameB = uuid.v4();
    const intermediateValue = { [uuid.v4()]: uuid.v4() };
    const finalValue = { [uuid.v4()]: uuid.v4() };
    serverA.deduplicate = true;
    serverB.deduplicate = false;
    let aCountA = 0;
    let aCountB = 0;
    let bCountA = 0;
    let bCountB = 0;
    const promise = Promise.all([
      new Promise((resolve) => {
        const handleSet = (_name, data) => {
          if (_name !== nameA) {
            aCountB += 1;
            return;
          }
          aCountA += 1;
          if (isEqual(data, finalValue)) {
            setTimeout(() => {
              serverA.data.off('set', handleSet);
              resolve();
            }, 100);
          }
        };
        serverA.data.on('set', handleSet);
      }),
      new Promise((resolve) => {
        const handleSet = (_name, data) => {
          if (_name !== nameB) {
            bCountA += 1;
            return;
          }
          bCountB += 1;
          if (isEqual(data, finalValue)) {
            setTimeout(() => {
              serverB.data.off('set', handleSet);
              resolve();
            }, 100);
          }
        };
        serverB.data.on('set', handleSet);
      }),
    ]);
    serverA.set(nameA, intermediateValue);
    serverB.set(nameB, intermediateValue);
    await new Promise((resolve) => setTimeout(resolve, 100));
    serverA.set(nameA, intermediateValue);
    serverB.set(nameB, intermediateValue);
    await new Promise((resolve) => setTimeout(resolve, 100));
    serverA.set(nameA, finalValue);
    serverB.set(nameB, finalValue);
    await promise;
    expect(aCountA).toEqual(2);
    expect(aCountB).toEqual(3);
    expect(bCountA).toEqual(2);
    expect(bCountB).toEqual(3);
    await serverA.close();
    await serverB.close();
    await stopWebsocketServerA();
    await stopWebsocketServerB();
    expect(serverA.recordHashObjects.size).toEqual(0);
    expect(serverB.recordHashObjects.size).toEqual(0);
  });
});
