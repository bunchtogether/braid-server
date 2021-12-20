//      

const DirectedGraphMap = require('directed-graph-map');

class PublisherSessionManager {
                                                

  constructor() {
    this.map = new DirectedGraphMap();
  }

  get size() {
    return this.map.size;
  }

  add(key       , serverId       , socketId       , regexString       ) {
    const sessionKey = `${key}:${serverId}:${socketId}`;
    this.map.addEdge(sessionKey, regexString);
  }

  removePublisher(key       , serverId       , socketId       ) {
    const sessionKey = `${key}:${serverId}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  publishers(regexString       )                                 {
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

  regexes(key       , serverId       , socketId       )               {
    const sessionKey = `${key}:${serverId}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }
}

module.exports = PublisherSessionManager;
