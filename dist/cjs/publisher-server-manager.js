"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _directedGraphMap = _interopRequireDefault(require("directed-graph-map"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PublisherServerManager {
  constructor() {
    this.map = new _directedGraphMap.default();
  }

  get size() {
    return this.map.size;
  }

  add(key, socketId, serverId) {
    const sessionKey = `${key}:${socketId}`;
    this.map.addEdge(sessionKey, serverId);
  }

  removePublisher(key, socketId) {
    const sessionKey = `${key}:${socketId}`;
    this.map.removeSource(sessionKey);
  }

  removeServer(serverId) {
    this.map.removeTarget(serverId);
  }

  hasPublisher(key, socketId) {
    const sessionKey = `${key}:${socketId}`;
    return this.map.hasSource(sessionKey);
  }

  publishers(serverId) {
    const results = [];
    const sessionKeys = this.map.getSources(serverId);

    for (const sessionKey of sessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      results.push([key, socketId]);
    }

    return results;
  }

  servers(key, socketId) {
    const sessionKey = `${key}:${socketId}`;
    return [...this.map.getTargets(sessionKey)];
  }

}

var _default = PublisherServerManager;
exports.default = _default;
//# sourceMappingURL=publisher-server-manager.js.map