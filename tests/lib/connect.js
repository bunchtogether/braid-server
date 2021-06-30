// @flow

import type Server from '../../src';

module.exports.connectAndSync = async (serverX:Server, portX:number, serverY:Server, portY:number) => {
  const serverXSyncPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      serverX.removeListener('peerSync', handlePeerSync);
      serverX.removeListener('error', handleError);
      reject(new Error('Timed out after 2s while waiting for peer Y sync response'));
    }, 5000);
    const handlePeerSync = (peerId:string) => {
      if (peerId !== serverY.id) {
        return;
      }
      clearTimeout(timeout);
      serverX.removeListener('peerSync', handlePeerSync);
      serverX.removeListener('error', handleError);
      resolve();
    };
    const handleError = (error:Error) => {
      clearTimeout(timeout);
      serverX.removeListener('peerSync', handlePeerSync);
      serverX.removeListener('error', handleError);
      reject(error);
    };
    serverX.addListener('peerSync', handlePeerSync);
    serverX.addListener('error', handleError);
  });
  const serverYSyncPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      serverY.removeListener('peerSync', handlePeerSync);
      serverY.removeListener('error', handleError);
      reject(new Error('Timed out after 2s while waiting for peer X sync response'));
    }, 5000);
    const handlePeerSync = (peerId:string) => {
      if (peerId !== serverX.id) {
        return;
      }
      clearTimeout(timeout);
      serverY.removeListener('peerSync', handlePeerSync);
      serverY.removeListener('error', handleError);
      resolve();
    };
    const handleError = (error:Error) => {
      clearTimeout(timeout);
      serverY.removeListener('peerSync', handlePeerSync);
      serverY.removeListener('error', handleError);
      reject(error);
    };
    serverY.addListener('peerSync', handlePeerSync);
    serverY.addListener('error', handleError);
  });
  if (Math.random() > 0.5) {
    await serverX.connectToPeer(`ws://localhost:${portY}`, {});
  } else {
    await serverY.connectToPeer(`ws://localhost:${portX}`, {});
  }
  await Promise.all([serverXSyncPromise, serverYSyncPromise]);
};
