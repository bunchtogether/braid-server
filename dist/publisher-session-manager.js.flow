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

  add(key:string, socketId:number, regexString:string) {
    const sessionKey = `${key}:${socketId}`;
    this.map.addEdge(sessionKey, regexString);
  }

  removePublisher(key:string, socketId:number) {
    const sessionKey = `${key}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  publishers(regexString:string):Array<[string, number]> {
    const results = [];
    const sessionKeys = this.map.getSources(regexString);
    for (const sessionKey of sessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      results.push([key, socketId]);
    }
    return results;
  }

  regexes(key:string, socketId:number):Array<string> {
    const sessionKey = `${key}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }
}

module.exports = PublisherSessionManager;
