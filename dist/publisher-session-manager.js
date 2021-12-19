//      

const DirectedGraphMap = require('directed-graph-map');

class PublisherSessionManager {
                                                

  constructor() {
    this.map = new DirectedGraphMap();
  }

  get size() {
    return this.map.size;
  }

  add(key       , socketId       , regexString       ) {
    const sessionKey = `${key}:${socketId}`;
    this.map.addEdge(sessionKey, regexString);
  }

  removePublisher(key       , socketId       ) {
    const sessionKey = `${key}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  publishers(regexString       )                         {
    const results = [];
    const sessionKeys = this.map.getSources(regexString);
    for (const sessionKey of sessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      results.push([key, socketId]);
    }
    return results;
  }

  regexes(key       , socketId       )               {
    const sessionKey = `${key}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }
}

module.exports = PublisherSessionManager;
