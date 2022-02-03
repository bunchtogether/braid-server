// @flow

import uWS from 'uWebSockets.js';

import loggerFactory from '../../src/lib/logger';

const logger = loggerFactory('Websocket Server');

export default async function (host:string, port:number) {
  logger.debug(`Starting listening on ws://${host}:${port}`);
  const server = uWS.App({});
  let listenSocket = await new Promise((resolve, reject) => {
    server.listen(port, (token) => {
      if (token) {
        resolve(token);
      } else {
        reject(new Error(`Unable to listen on port ${port}`));
      }
    });
  });
  const stopWsServer = async function () {
    if (!listenSocket) {
      logger.warn('Listen socket does not exist');
      return;
    }
    uWS.us_listen_socket_close(listenSocket);
    listenSocket = null;
    logger.info(`Stopped listening on ws://${host}:${port}`);
  };
  logger.info(`Started listening on ws://${host}:${port}`);
  return [server, stopWsServer];
}
