//      

const DirectedGraphMap = require('directed-graph-map');

class PublisherServerManager {
                                                

  constructor() {
    this.map = new DirectedGraphMap();
  }

  get size() {
    return this.map.size;
  }

  add(key       , socketId       , serverId       ) {
    const sessionKey = `${key}:${socketId}`;
    this.map.addEdge(sessionKey, serverId);
  }

  removePublisher(key       , socketId       ) {
    const sessionKey = `${key}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  removeServer(serverId       ) {
    this.map.removeTarget(serverId);
  }

  hasPublisher(key       , socketId       ) {
    const sessionKey = `${key}:${socketId}`;
    return this.map.hasSource(sessionKey);
  }

  publishers(serverId       )                         {
    const results = [];
    const sessionKeys = this.map.getSources(serverId);
    for (const sessionKey of sessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      results.push([key, socketId]);
    }
    return results;
  }

  servers(key       , socketId       )               {
    const sessionKey = `${key}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }
}

module.exports = PublisherServerManager;
