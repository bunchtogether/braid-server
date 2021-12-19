// @flow

const DirectedGraphMap = require('directed-graph-map');

class PublisherServerManager {
  declare map: DirectedGraphMap<string, number>;

  constructor() {
    this.map = new DirectedGraphMap();
  }

  get size() {
    return this.map.size;
  }

  add(key:string, socketId:number, serverId:number) {
    const sessionKey = `${key}:${socketId}`;
    this.map.addEdge(sessionKey, serverId);
  }

  removePublisher(key:string, socketId:number) {
    const sessionKey = `${key}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  removeServer(serverId:number) {
    this.map.removeTarget(serverId);
  }

  hasPublisher(key:string, socketId:number) {
    const sessionKey = `${key}:${socketId}`;
    this.map.hasSource(sessionKey);
  }

  publishers(serverId:number):Array<[string, number]> {
    const results = [];
    const sessionKeys = this.map.getSources(serverId);
    for (const sessionKey of sessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      results.push([key, socketId]);
    }
    return results;
  }

  servers(key:string, socketId:number):Array<number> {
    const sessionKey = `${key}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }
}

module.exports = PublisherServerManager;
