// @flow

const DirectedGraphMap = require('directed-graph-map');

class PublisherSessionManager {
  declare map: DirectedGraphMap<string, string>;

  constructor() {
    this.map = new DirectedGraphMap();
  }

  get size() {
    return this.map.size;
  }

  add(key:string, serverId:number, socketId:number, regexString:string) {
    const sessionKey = `${key}:${serverId}:${socketId}`;
    this.map.addEdge(sessionKey, regexString);
  }

  removePublisher(key:string, serverId:number, socketId:number) {
    const sessionKey = `${key}:${serverId}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  publishers(regexString:string):Array<[string, number, number]> {
    const results = [];
    const sessionKeys = this.map.getSources(regexString);
    for (const sessionKey of sessionKeys) {
      const [key, serverIdString, socketIdString] = sessionKey.split(':');
      const serverId = parseInt(serverIdString, 10);
      const socketId = parseInt(socketIdString, 10);
      results.push([key, serverId, socketId]);
    }
    return results;
  }

  regexes(key:string, serverId:number, socketId:number):Array<string> {
    const sessionKey = `${key}:${serverId}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }
}

module.exports = PublisherSessionManager;
