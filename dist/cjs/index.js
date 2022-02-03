"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _uuid = require("uuid");

var _lodash = require("lodash");

var _crypto = _interopRequireDefault(require("crypto"));

var _directedGraphMap = _interopRequireDefault(require("directed-graph-map"));

var _events = _interopRequireDefault(require("events"));

var _farmhash = _interopRequireDefault(require("farmhash"));

var _lruCache = _interopRequireDefault(require("lru-cache"));

var _set = _interopRequireDefault(require("observed-remove/set"));

var _map = _interopRequireDefault(require("observed-remove/map"));

var _pQueue = _interopRequireDefault(require("p-queue"));

var _braidMessagepack = require("@bunchtogether/braid-messagepack");

var _hashObject = require("@bunchtogether/hash-object");

var _logger = _interopRequireDefault(require("./lib/logger"));

var _requestIp = _interopRequireDefault(require("./lib/request-ip"));

var _peerConnection = _interopRequireDefault(require("./peer-connection"));

var _publisherServerManager = _interopRequireDefault(require("./publisher-server-manager"));

var _publisherSessionManager = _interopRequireDefault(require("./publisher-session-manager"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function randomInteger() {
  return _crypto.default.randomBytes(4).readUInt32BE(0, true);
}

const MAX_PAYLOAD_LENGTH = 100 * 1024 * 1024;
const MAX_BACKPRESSURE = MAX_PAYLOAD_LENGTH * 4;
const previousGenerationCredentialsResponse = Buffer.from('x0gCg6dzdWNjZXNzw6Rjb2RlzMinbWVzc2FnZdktSW52YWxpZCBtc2dwYWNrIGltcGxlbWVudGF0aW9uLCBwbGVhc2UgcmVsb2Fk', 'base64');
const previousGenerationReloadResponse = Buffer.from('xwsmlKZyZWxvYWSQAJA=', 'base64');
/**
 * Class representing a Braid Server
 */

class Server extends _events.default {
  /**
   * Create a Braid Server.
   * @param {UWSTemplatedApp} uwsServer uWebSockets.js server
   * @param {UWSRecognizedString} websocketPattern uWebSockets.js websocket pattern
   * @param {UWSWebSocketBehavior} websocketBehavior uWebSockets.js websocket behavior and options
   */
  constructor(uwsServer, websocketPattern = '/*', websocketBehavior = {
    compression: 0,
    closeOnBackpressureLimit: false,
    maxPayloadLength: MAX_PAYLOAD_LENGTH,
    maxBackpressure: MAX_BACKPRESSURE,
    idleTimeout: 56
  }, options = {}) {
    super();
    this.messageHashes = new _lruCache.default({
      max: 500
    });

    if (typeof websocketBehavior.maxPayloadLength !== 'number') {
      websocketBehavior.maxPayloadLength = MAX_PAYLOAD_LENGTH; // eslint-disable-line no-param-reassign
    }

    if (typeof websocketBehavior.maxBackpressure !== 'number') {
      websocketBehavior.maxBackpressure = MAX_BACKPRESSURE; // eslint-disable-line no-param-reassign
    }

    this.maxPayloadLength = websocketBehavior.maxPayloadLength;
    this.maxBackpressure = websocketBehavior.maxBackpressure; // Values set using setData and deleteData are compared against hashes to prevent
    // redundant writes

    this.shouldDeduplicate = false;
    this.recordHashes = new Map();
    this.recordHashObjects = new Set(); // Added as a data set handler when deduplication is active
    // A reference to the original object is temporarily added to a
    // set to distinguish between local objects and clones of remote objects
    // This prevents having to calculate the object hash twice

    this.updateHashOnSet = (name, data) => {
      if (this.recordHashObjects.has(data)) {
        this.recordHashObjects.delete(data);
      } else {
        const hash = (0, _hashObject.hash64)(data);
        this.recordHashes.set(name, hash);
      }
    }; // Added as a data delete handler when deduplication is active


    this.updateHashOnDelete = name => {
      this.recordHashes.delete(name);
    }; // Multipart message container merge promises
    //   Key: id
    //   Value: MergeChunksPromise


    this.mergeChunkPromises = new Map(); // Socket drain callbacks
    //   Key: Socket ID
    //   Value: [Array of callbacks, Array of Errbacks]

    this.drainCallbacks = new Map(); // Primary data object, used by all peers and partially shared with subscribers

    this.data = new _map.default([], {
      bufferPublishing: 0
    }); // Peer connections map, each peer stores the peers it is connected to
    //   Key: Peer ID
    //   Value: Array of peer IDs

    this.peers = new _map.default([], {
      bufferPublishing: 0
    }); // Provider map, each peer stores regex strings it can provide data for
    //   Key: Peer ID
    //   Value: Array of regex strings

    this.providers = new _map.default([], {
      bufferPublishing: 0
    }); // Active provider map for each key
    //   Key: key
    //   Value: [Peer ID, regex string]

    this.activeProviders = new _map.default([], {
      bufferPublishing: 0
    }); // Receiver map, each peer stores regex strings it can receive messages from publishers for
    //   Key: key
    //   Value: [Peer ID, regex string]

    this.receivers = new _map.default([], {
      bufferPublishing: 0
    }); // Peers which are currently subscribed to a key
    //   Values: [peerId, key]

    this.peerSubscriptions = new _set.default([], {
      bufferPublishing: 0
    }); // Peer subscriber map for each key
    //   Key: key
    //   Value: Array of Peer IDs

    this.peerSubscriptionMap = new Map(); // Matcher functions for each provider
    //   Key: Peer ID
    //   Value: Array of regex strings, regex objects pairs

    this.providerRegexes = new Map(); // Callbacks for providing / unproviding
    //   Key: regex strings
    //   Value: Callback function

    this.provideCallbacks = new Map(); // Options for providing / unproviding
    //   Key: regex strings
    //   Value: Object

    this.provideOptions = new Map(); // Debounce timeouts for providers
    //   Key: key
    //   Value: TimeoutId

    this.provideDebounceTimeouts = new Map(); // Matcher functions for each receiver
    //   Key: Peer ID
    //   Value: Array of regex strings, regex objects pairs

    this.receiverRegexes = new Map(); // Callbacks for receiving / unreceiving
    //   Key: regex strings
    //   Value: [Message callback function, Open callback function, Close callback function]

    this.receiveCallbacks = new Map(); // Tracks relationships of publishing socket / key pairs to publishing servers

    this.receiverServers = new _publisherServerManager.default(); // Tracks relationships of publishing socket / key pairs to publishing regexes

    this.receiverSessions = new _publisherSessionManager.default(); // Tracks relationships of publishing socket / key pairs to receiving regexes

    this.publisherSessions = new _publisherSessionManager.default(); // Tracks relationships of publishing socket / key pairs to receiving servers

    this.publisherServers = new _publisherServerManager.default(); // Active (incoming) sockets
    //   Key: Socket ID
    //   Value: Socket object

    this.sockets = new Map(); // Promise queue of incoming crendential authentication requests
    //   Key: Socket ID
    //   Value: Promise Queue

    this.socketCredentialQueues = new Map(); // Map of Peer IDs to Socket IDs
    //   Source: Socket ID
    //   Target: Peer ID

    this.peerSockets = new _directedGraphMap.default(); // Active (outgoing) peer connections
    //   Key: Peer ID
    //   Value: Connection Object

    this.peerConnections = new Map(); // Active subscriptions
    //   Source: Socket ID
    //   Target: Key

    this.subscriptions = new _directedGraphMap.default(); // Active publishers
    //   Source: Socket ID
    //   Target: Key

    this.publishers = new _directedGraphMap.default(); // Active event subscriptions
    //   Source: Socket ID
    //   Target: Event Name

    this.eventSubscriptions = new _directedGraphMap.default(); // Keys without subscribers that should be flushed from data
    //   Key: key
    //   Value: Timestamp when the key should be deleted

    this.keysForDeletion = new Map(); // Peer reconnection timeouts
    //   Key: Peer ID
    //   Value: TimeoutID

    this.peerReconnectTimeouts = new Map(); // User defined observed remove maps
    //   Key: string
    //   Value: ObservedRemoveMap

    this._customMaps = new Map(); // eslint-disable-line no-underscore-dangle
    // User defined observed remove sets
    //   Key: string
    //   Value: ObservedRemoveSet

    this._customSets = new Map(); // eslint-disable-line no-underscore-dangle

    const mapsGetter = (target, name) => {
      const existing = this._customMaps.get(name); // eslint-disable-line no-underscore-dangle


      if (typeof existing !== 'undefined') {
        return existing;
      }

      const map = new _map.default([], {
        bufferPublishing: 0
      });
      map.on('publish', queue => {
        this.publishToPeers(new _braidMessagepack.CustomMapDump(name, queue, [this.id]));
      });

      this._customMaps.set(name, map); // eslint-disable-line no-underscore-dangle


      return map;
    };

    this.maps = new Proxy({}, {
      get: mapsGetter,

      set() {
        throw new TypeError('Can not set Server.maps values');
      }

    });

    const setsGetter = (target, name) => {
      const existing = this._customSets.get(name); // eslint-disable-line no-underscore-dangle


      if (typeof existing !== 'undefined') {
        return existing;
      }

      const set = new _set.default([], {
        bufferPublishing: 0
      });
      set.on('publish', queue => {
        this.publishToPeers(new _braidMessagepack.CustomSetDump(name, queue, [this.id]));
      });

      this._customSets.set(name, set); // eslint-disable-line no-underscore-dangle


      return set;
    };

    this.sets = new Proxy({}, {
      get: setsGetter,

      set() {
        throw new TypeError('Can not set Server.sets values');
      }

    });
    this.id = typeof options.id === 'number' ? options.id : randomInteger();
    this.logger = (0, _logger.default)(`Braid Server ${this.id}`);
    this.isClosing = false;
    this.flushInterval = setInterval(() => {
      this.data.flush();
      this.peers.flush();
      this.providers.flush();
      this.receivers.flush();
      this.activeProviders.flush();
      this.peerSubscriptions.flush();

      for (const customMap of this._customMaps.values()) {
        // eslint-disable-line no-underscore-dangle
        customMap.flush();
      }
    }, 10000);
    this.keyFlushInterval = setInterval(() => {
      const now = Date.now();

      for (const [key, timestamp] of this.keysForDeletion) {
        if (timestamp < now) {
          this.keysForDeletion.delete(key);
          this.data.delete(key);
        }
      }
    }, 3600000);
    this.setCredentialsHandler(async credentials => ( // eslint-disable-line no-unused-vars
    {
      success: true,
      code: 200,
      message: 'OK'
    }));
    this.setPeerRequestHandler(async credentials => ( // eslint-disable-line no-unused-vars
    {
      success: true,
      code: 200,
      message: 'OK'
    }));
    this.setSubscribeRequestHandler(async (key, credentials) => ( // eslint-disable-line no-unused-vars
    {
      success: true,
      code: 200,
      message: 'OK'
    }));
    this.setEventSubscribeRequestHandler(async (name, credentials) => ( // eslint-disable-line no-unused-vars
    {
      success: true,
      code: 200,
      message: 'OK'
    }));
    this.setPublishRequestHandler(async (key, credentials) => ( // eslint-disable-line no-unused-vars
    {
      success: true,
      code: 200,
      message: 'OK'
    }));
    this.data.on('publish', queue => {
      this.publishToPeers(new _braidMessagepack.DataDump(queue, [this.id]));
      this.publishData(queue);
    });
    this.providers.on('publish', queue => {
      this.publishToPeers(new _braidMessagepack.ProviderDump(queue, [this.id]));
    });
    this.activeProviders.on('publish', queue => {
      this.publishToPeers(new _braidMessagepack.ActiveProviderDump(queue, [this.id]));
    });
    this.receivers.on('publish', queue => {
      this.publishToPeers(new _braidMessagepack.ReceiverDump(queue, [this.id]));
    });
    this.peers.on('publish', queue => {
      this.publishToPeers(new _braidMessagepack.PeerDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('publish', queue => {
      this.publishToPeers(new _braidMessagepack.PeerSubscriptionDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('add', ([peerId, key]) => {
      let peerIds = this.peerSubscriptionMap.get(key);
      this.keysForDeletion.delete(key);

      if (!peerIds) {
        peerIds = new Set();
        this.peerSubscriptionMap.set(key, peerIds);

        if (!this.activeProviders.has(key)) {
          this.assignProvider(key);
        }
      }

      peerIds.add(peerId);
      clearTimeout(this.provideDebounceTimeouts.get(key));
      this.provideDebounceTimeouts.delete(key);
    });
    this.peerSubscriptions.on('delete', ([peerId, key]) => {
      const removeActiveProvider = () => {
        clearTimeout(this.provideDebounceTimeouts.get(key));
        this.provideDebounceTimeouts.delete(key);
        const peerIds = this.peerSubscriptionMap.get(key);

        if (!peerIds) {
          return;
        }

        peerIds.delete(peerId);

        if (peerIds.size === 0) {
          this.peerSubscriptionMap.delete(key);
          this.activeProviders.delete(key);
          this.keysForDeletion.set(key, Date.now() + 86400000);
        }
      };

      clearTimeout(this.provideDebounceTimeouts.get(key));
      this.provideDebounceTimeouts.delete(key);
      const peerIdAndRegexString = this.activeProviders.get(key);

      if (!peerIdAndRegexString) {
        removeActiveProvider();
        return;
      }

      const regexString = peerIdAndRegexString[1];
      const provideOptions = this.provideOptions.get(regexString);

      if (provideOptions && typeof provideOptions.debounce === 'number') {
        this.provideDebounceTimeouts.set(key, setTimeout(removeActiveProvider, provideOptions.debounce));
      } else {
        removeActiveProvider();
      }
    });
    this.peers.on('set', (peerId, peerIds, previousPeerIds) => {
      if (this.id !== peerId && peerIds && previousPeerIds && peerIds.length < previousPeerIds.length) {
        this.prunePeers();
      }
    });
    this.activeProviders.on('set', (key, [peerId, regexString], previousPeerIdAndRegexString) => {
      if (this.id === peerId) {
        const callback = this.provideCallbacks.get(regexString);

        if (!callback) {
          this.unprovide(regexString);
          return;
        }

        if (!previousPeerIdAndRegexString || previousPeerIdAndRegexString[0] !== this.id) {
          callback(key, true);
        }
      } else if (previousPeerIdAndRegexString) {
        const [previousPeerId, previousRegexString] = previousPeerIdAndRegexString;

        if (previousPeerId === peerId) {
          return;
        }

        if (previousPeerId === this.id) {
          const callback = this.provideCallbacks.get(previousRegexString);

          if (callback) {
            callback(key, false);
          } else {
            this.unprovide(previousRegexString);
          }
        }
      }
    });
    this.activeProviders.on('delete', (key, [peerId, regexString]) => {
      if (this.id === peerId) {
        const callback = this.provideCallbacks.get(regexString);

        if (callback) {
          callback(key, false);
        } else {
          this.unprovide(regexString);
        }
      }
    });
    this.providers.on('set', (peerId, regexStrings) => {
      const regexPairs = regexStrings.map(regexString => [regexString, new RegExp(regexString)]);
      this.providerRegexes.set(peerId, regexPairs);

      if (this.id !== peerId) {
        return;
      }

      const keysWithoutProviders = [...this.peerSubscriptionMap.keys()].filter(key => !this.activeProviders.has(key));

      for (const regexPair of regexPairs) {
        const regex = regexPair[1];

        for (const key of keysWithoutProviders) {
          if (regex.test(key)) {
            this.assignProvider(key);
          }
        }
      }
    });
    this.providers.on('delete', peerId => {
      this.providerRegexes.delete(peerId);
    });
    this.receivers.on('set', (peerId, regexStrings, previousRegexStrings) => {
      const regexMap = new Map(regexStrings.map(regexString => [regexString, new RegExp(regexString)]));
      this.receiverRegexes.set(peerId, regexMap);

      if (Array.isArray(previousRegexStrings)) {
        for (const previousRegexString of previousRegexStrings) {
          if (regexStrings.includes(previousRegexString)) {
            continue;
          }

          for (const [key, serverId, socketId] of this.publisherSessions.publishers(previousRegexString)) {
            // eslint-disable-line no-unused-vars
            this.unassignReceiver(key, socketId);
          }
        }
      }

      for (const [socketId, key] of this.publishers) {
        if (this.receiverServers.hasPublisher(key, socketId)) {
          continue;
        }

        this.assignReceiver(key, socketId);
      }
    });
    this.receivers.on('delete', peerId => {
      this.receiverRegexes.delete(peerId);
      const publishers = this.receiverServers.publishers(peerId);

      for (const [key, socketId] of publishers) {
        this.unassignReceiver(key, socketId);
      }

      for (const [socketId, key] of this.publishers) {
        if (this.receiverServers.hasPublisher(key, socketId)) {
          continue;
        }

        this.assignReceiver(key, socketId);
      }
    });
    const websocketOptions = Object.assign({}, websocketBehavior, {
      upgrade: (res, req, context) => {
        // eslint-disable-line no-unused-vars
        if (this.isClosing) {
          res.writeStatus('410');
          res.end('Closing');
          return;
        }

        try {
          const socketId = randomInteger();
          const socketIp = (0, _requestIp.default)(res, req);
          const socketOptions = {
            id: socketId,
            credentials: {
              ip: socketIp
            }
          };
          res.upgrade(socketOptions, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
          this.logger.info(`Upgraded socket at ${socketIp || 'with unknown IP'}`);
        } catch (error) {
          if (error.stack) {
            this.logger.error('Error during socket upgrade:');
            error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error during socket upgrade: ${error.message}`);
          }
        }
      },
      drain: ws => {
        const socketId = ws.id;

        try {
          if (!socketId) {
            this.logger.error('Received socket drain without socket ID');
            return;
          }

          const values = this.drainCallbacks.get(socketId);

          if (typeof values === 'undefined') {
            return;
          }

          const [callbacks] = values;

          for (const callback of callbacks) {
            callback();
          }

          this.drainCallbacks.delete(socketId);
        } catch (error) {
          if (error.stack) {
            this.logger.error(`Error in drain callback from socket ${socketId}:`);
            error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error in drain callback from socket ${socketId}: ${error.message}`);
          }
        }
      },
      open: ws => {
        // eslint-disable-line no-unused-vars
        const socketId = ws.id;
        const {
          ip
        } = ws.credentials || {};

        try {
          if (!socketId) {
            this.logger.error('Received socket open without socket ID');
            return;
          }

          this.sockets.set(socketId, ws);
          this.emit('open', socketId);
          this.logger.info(`Opened socket at ${ip || 'unknown IP'} (${socketId})`);
        } catch (error) {
          if (error.stack) {
            this.logger.error('Error during socket open:');
            error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error during socket open: ${error.message}`);
          }
        }
      },
      message: (ws, data, isBinary) => {
        const socketId = ws.id;

        try {
          if (this.isClosing) {
            return;
          }

          if (!socketId) {
            this.logger.error('Received message without socket ID');
            return;
          }

          if (!isBinary) {
            this.logger.error(`Received non-binary message from ${ws.credentials.ip ? ws.credentials.ip : 'unknown IP'} (${socketId}): ${data.toString()}`);
            return;
          }

          const message = (0, _braidMessagepack.decode)(Buffer.from(data));

          if (message instanceof _braidMessagepack.DataDump || message instanceof _braidMessagepack.PeerDump || message instanceof _braidMessagepack.ProviderDump || message instanceof _braidMessagepack.ActiveProviderDump || message instanceof _braidMessagepack.ReceiverDump || message instanceof _braidMessagepack.PeerSubscriptionDump || message instanceof _braidMessagepack.PeerSync || message instanceof _braidMessagepack.PeerSyncResponse || message instanceof _braidMessagepack.BraidEvent || message instanceof _braidMessagepack.BraidSocketEvent || message instanceof _braidMessagepack.PublisherOpen || message instanceof _braidMessagepack.PublisherClose || message instanceof _braidMessagepack.PublisherPeerMessage || message instanceof _braidMessagepack.MultipartContainer || message instanceof _braidMessagepack.DataSyncInsertions || message instanceof _braidMessagepack.DataSyncDeletions || message instanceof _braidMessagepack.CustomMapDump || message instanceof _braidMessagepack.CustomSetDump) {
            if (!this.peerSockets.hasSource(socketId)) {
              this.logger.error(`Received dump from non-peer at ${ws.credentials.ip ? ws.credentials.ip : 'unknown IP'} (${socketId})`);
              return;
            }

            for (const peerId of this.peerSockets.getTargets(socketId)) {
              this.handleMessage(message, peerId);
            }
          }

          if (message instanceof _braidMessagepack.Credentials) {
            this.handleCredentialsRequest(socketId, ws.credentials, message.value);
          } else if (message instanceof _braidMessagepack.PeerRequest) {
            this.handlePeerRequest(socketId, ws.credentials, message.value);
          } else if (message instanceof _braidMessagepack.SubscribeRequest) {
            this.handleSubscribeRequest(socketId, ws.credentials, message.value);
          } else if (message instanceof _braidMessagepack.Unsubscribe) {
            this.removeSubscription(socketId, message.value);
          } else if (message instanceof _braidMessagepack.EventSubscribeRequest) {
            this.handleEventSubscribeRequest(socketId, ws.credentials, message.value);
          } else if (message instanceof _braidMessagepack.EventUnsubscribe) {
            this.removeEventSubscription(socketId, message.value);
          } else if (message instanceof _braidMessagepack.PublishRequest) {
            this.handlePublishRequest(socketId, ws.credentials, message.value);
          } else if (message instanceof _braidMessagepack.Unpublish) {
            this.removePublisher(socketId, message.value);
          } else if (message instanceof _braidMessagepack.PublisherMessage) {
            this.handlePublisherMessage(message.key, socketId, message.message);
          }
        } catch (error) {
          if (error.stack) {
            this.logger.error(`Error when receiving message from socket ${socketId}:`);
            error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error when receiving socket message from socket ${socketId}: ${error.message}`);
          }

          if (error instanceof TypeError && error.message.indexOf('currentExtensions') !== -1) {
            if (!ws.sentPrevousGeneration) {
              ws.sentPrevousGeneration = true; // eslint-disable-line no-param-reassign

              ws.send(previousGenerationCredentialsResponse, true, false);
              this.logger.info(`Sending reload event to socket ${socketId} using old messagepack version`);
              setTimeout(() => {
                if (this.sockets.has(socketId)) {
                  ws.send(previousGenerationReloadResponse, true, false);
                }
              }, 5000);
            }
          }
        }
      },
      close: (ws, code, data) => {
        // eslint-disable-line no-unused-vars
        const socketId = ws.id;

        try {
          if (!socketId) {
            this.logger.error('Received close without socket ID');
            return;
          }

          this.removeSubscriptions(socketId);
          this.removePublishers(socketId);
          this.removeEventSubscriptions(socketId);

          if (this.peerSockets.hasSource(socketId)) {
            const peerIds = this.peerSockets.getTargets(socketId);
            this.peerSockets.removeSource(socketId);

            for (const peerId of peerIds) {
              this.emit('removePeer', peerId);
            }

            this.updatePeers();
            this.prunePeers();
          }

          this.sockets.delete(socketId);
          this.logger.info(`Closed socket at ${ws.credentials.ip ? ws.credentials.ip : 'unknown IP'} (${socketId}), code ${code}`);
          const {
            credentials
          } = ws;

          if (credentials && credentials.client) {
            this.emit('presence', credentials, false, socketId, false);
          }

          this.emit('close', socketId);
          delete ws.id; // eslint-disable-line no-param-reassign

          delete ws.credentials; // eslint-disable-line no-param-reassign
        } catch (error) {
          if (error.stack) {
            this.logger.error(`Error when receiving close event from socket ${socketId}:`);
            error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error when receiving close event from socket ${socketId}: ${error.message}`);
          }
        }
      }
    });
    uwsServer.ws(websocketPattern, websocketOptions);
    this.setMaxListeners(0);
    this.logger.info(`Native acceleration is ${_braidMessagepack.isNativeAccelerationEnabled ? 'enabled' : 'not enabled'}`);
  }

  encode(value) {
    try {
      return (0, _braidMessagepack.encode)(value);
    } catch (error) {
      this.logger.error(`Unable to encode ${JSON.stringify(value)}`);
      throw error;
    }
  }

  async handleMultipartContainer(multipartContainer, peerId) {
    const existingMergeChunksPromise = this.mergeChunkPromises.get(multipartContainer.id);

    if (typeof existingMergeChunksPromise !== 'undefined') {
      existingMergeChunksPromise.push(multipartContainer);
      return;
    }

    const mergeChunksPromise = _braidMessagepack.MultipartContainer.getMergeChunksPromise(60000);

    mergeChunksPromise.push(multipartContainer);
    this.mergeChunkPromises.set(multipartContainer.id, mergeChunksPromise);

    try {
      const buffer = await mergeChunksPromise;
      const message = (0, _braidMessagepack.decode)(buffer);
      this.handleMessage(message, peerId);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Unable to merge multipart message chunks:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Unable to merge multipart message chunks: ${error.message}`);
      }
    } finally {
      this.mergeChunkPromises.delete(multipartContainer.id);
    }
  }

  async waitForDrain(socketId) {
    const socket = this.sockets.get(socketId);

    if (!socket) {
      throw new Error(`Can wait for socket ${socketId} to drain, socket does not exist`);
    }

    if (socket.getBufferedAmount() > this.maxBackpressure) {
      await new Promise((resolve, reject) => {
        const [callbacks, errbacks] = this.drainCallbacks.get(socketId) || [[], []];
        callbacks.push(resolve);
        errbacks.push(reject);
        this.drainCallbacks.set(socketId, [callbacks, errbacks]);
      });
    }
  }

  set(name, data) {
    if (this.shouldDeduplicate) {
      const hash = (0, _hashObject.hash64)(data);

      if (this.recordHashes.get(name) !== hash) {
        this.recordHashObjects.add(data);
        this.data.set(name, data);
        this.recordHashes.set(name, hash);
      }
    } else {
      this.data.set(name, data);
    }
  }

  delete(name) {
    this.data.set(name, undefined);
  }

  get deduplicate() {
    return this.shouldDeduplicate;
  }

  set deduplicate(active) {
    if (typeof active !== 'boolean') {
      throw new TypeError(`Unable to set deduplicate to type ${typeof active}`);
    }

    if (active === this.shouldDeduplicate) {
      return;
    }

    if (active) {
      this.data.on('set', this.updateHashOnSet);
      this.data.on('delete', this.updateHashOnDelete);
    } else {
      this.data.off('set', this.updateHashOnSet);
      this.data.off('delete', this.updateHashOnDelete);
    }

    this.shouldDeduplicate = active;
  }

  emitToClients(name, ...args) {
    const id = (0, _uuid.v4)();
    this.publishEvent(name, args, id);
    this.publishToPeers(new _braidMessagepack.BraidEvent(name, args, id, [this.id]));
  }

  emitToSocket(name, peerId, socketId, ...args) {
    const id = (0, _uuid.v4)();

    if (this.id === peerId) {
      this.publishSocketEvent(name, args, socketId, id);
    } else {
      this.publishToPeers(new _braidMessagepack.BraidSocketEvent(name, args, peerId, socketId, id, [this.id]));
    }
  }
  /**
   * Throw an error if any internal data exists. Intended for tests and debugging.
   * @return {void}
   */


  throwOnLeakedReferences() {
    if (this.sockets.size > 0) {
      throw new Error(`${this.id}: ${this.sockets.size} referenced sockets`);
    }

    if (this.peerSockets.size > 0) {
      throw new Error(`${this.id}: ${this.peerSockets.size} referenced peer sockets`);
    }

    if (this.peerConnections.size > 0) {
      throw new Error(`${this.id}: ${this.peerConnections.size} referenced peer connections`);
    }

    if (this.peers.size > 0) {
      throw new Error(`${this.id}: ${this.peers.size} referenced peers`);
    }

    if (this.providers.size > 0) {
      throw new Error(`${this.id}: ${this.providers.size} referenced providers`);
    }

    if (this.providerRegexes.size > 0) {
      throw new Error(`${this.id}: ${this.providerRegexes.size} referenced provider regexes`);
    }

    if (this.subscriptions.size > 0) {
      throw new Error(`${this.id}: ${this.subscriptions.size} referenced subscribers`);
    }

    if (this.eventSubscriptions.size > 0) {
      throw new Error(`${this.id}: ${this.eventSubscriptions.size} referenced event subscribers`);
    }

    if (this.peerSubscriptions.size > 0) {
      throw new Error(`${this.id}: ${this.peerSubscriptions.size} referenced peer subscription`);
    }

    if (this.activeProviders.size > 0) {
      throw new Error(`${this.id}: ${this.activeProviders.size} referenced active providers`);
    }

    if (this.provideCallbacks.size > 0) {
      throw new Error(`${this.id}: ${this.provideCallbacks.size} referenced provide callbacks`);
    }

    if (this.provideOptions.size > 0) {
      throw new Error(`${this.id}: ${this.provideOptions.size} referenced provide options`);
    }

    if (this.provideDebounceTimeouts.size > 0) {
      throw new Error(`${this.id}: ${this.provideDebounceTimeouts.size} referenced provide debounce timeouts`);
    }

    if (this.publishers.size > 0) {
      throw new Error(`${this.id}: ${this.publishers.size} referenced publishers`);
    }

    if (this.receivers.size > 0) {
      throw new Error(`${this.id}: ${this.receivers.size} referenced receivers`);
    }

    if (this.receiverRegexes.size > 0) {
      throw new Error(`${this.id}: ${this.receiverRegexes.size} referenced receiver regexes`);
    }

    if (this.receiveCallbacks.size > 0) {
      throw new Error(`${this.id}: ${this.receiveCallbacks.size} referenced receiver callbacks`);
    }

    if (this.receiverServers.size > 0) {
      throw new Error(`${this.id}: ${this.receiverServers.size} referenced active receivers`);
    }

    if (this.receiverSessions.size > 0) {
      throw new Error(`${this.id}: ${this.receiverSessions.size} referenced receive sessions`);
    }

    if (this.publisherServers.size > 0) {
      throw new Error(`${this.id}: ${this.publisherServers.size} referenced publisher servers`);
    }

    if (this.publisherSessions.size > 0) {
      throw new Error(`${this.id}: ${this.publisherSessions.size} referenced publisher sessions`);
    }
  }
  /**
   * Publish objects to peers.
   * @param {ProviderDump|DataDump|ActiveProviderDump|ReceiverDump|PeerDump|PeerSubscriptionDump} obj - Object to send, should have "ids" property
   * @return {void}
   */


  publishToPeers(obj) {
    const peerIds = obj.ids;
    const peerConnections = [];
    const peerUWSSockets = [];

    for (const [socketId, peerId] of this.peerSockets.edges) {
      if (peerIds.includes(peerId)) {
        continue;
      }

      const ws = this.sockets.get(socketId);

      if (!ws) {
        continue;
      }

      peerIds.push(peerId);
      peerUWSSockets.push(ws);
    }

    for (const [peerId, {
      ws
    }] of this.peerConnections) {
      if (peerIds.includes(peerId)) {
        continue;
      }

      if (ws.readyState === 1) {
        peerIds.push(peerId);
        peerConnections.push(ws);
      }
    }

    if (peerConnections.length === 0 && peerUWSSockets.length === 0) {
      return;
    }

    const encoded = this.encode(obj);

    for (const ws of peerConnections) {
      ws.send(encoded);
    }

    for (const ws of peerUWSSockets) {
      ws.send(encoded, true, false);
    }
  }
  /**
   * Send objects to a peer.
   * @param {string} peerId - Peer ID to send to
   * @param {PublisherOpen|PublisherClose|PublisherPeerMessage} obj - Object to send
   * @return {void}
   */


  sendToPeer(peerId, obj) {
    const encoded = this.encode(obj);
    const peerConnection = this.peerConnections.get(peerId);

    if (peerConnection) {
      const {
        ws
      } = peerConnection;
      ws.send(encoded);
      return;
    }

    for (const socketId of this.peerSockets.getSources(peerId)) {
      const ws = this.sockets.get(socketId);

      if (ws) {
        ws.send(encoded, true, false);
      }
    }
  }
  /**
   * Set the credentials handler. The handler evaluates and modifies credentials provided by peers and clients when they are initially provided.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Credentials handler.
   * @return {void}
   */


  setCredentialsHandler(func) {
    // eslint-disable-line no-unused-vars
    this.credentialsHandler = func;
  }
  /**
   * Set the peer request handler. Approves or denies peer request handlers.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Peer request handler.
   * @return {void}
   */


  setPeerRequestHandler(func) {
    // eslint-disable-line no-unused-vars
    this.peerRequestHandler = func;
  }
  /**
   * Set the subscribe request handler. Approves or denies subscribe requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Subscription request handler.
   * @return {void}
   */


  setSubscribeRequestHandler(func) {
    // eslint-disable-line no-unused-vars
    this.subscribeRequestHandler = func;
  }
  /**
   * Set the event subscribe request handler. Approves or denies event subscribe requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Event subscription request handler.
   * @return {void}
   */


  setEventSubscribeRequestHandler(func) {
    // eslint-disable-line no-unused-vars
    this.eventSubscribeRequestHandler = func;
  }
  /**
   * Set the publish request handler. Approves or denies publish requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Publish request handler.
   * @return {void}
   */


  setPublishRequestHandler(func) {
    // eslint-disable-line no-unused-vars
    this.publishRequestHandler = func;
  }
  /**
   * Top level handler for incoming credentials messages. Uses the default/custom credentialsHandler method to validate.
   * @param {number} socketId Socket ID from which the credentials were received
   * @param {Object} credentials Credentials object
   * @param {Object} newClientCredentials Credentials object provided by the client
   * @return {void}
   */


  handleCredentialsRequest(socketId, credentials, newClientCredentials) {
    const queue = this.socketCredentialQueues.get(socketId);

    if (typeof queue !== 'undefined') {
      queue.add(() => this._handleCredentialsRequest(socketId, credentials, newClientCredentials)); // eslint-disable-line no-underscore-dangle

      return;
    }

    const newQueue = new _pQueue.default({
      concurrency: 1
    });
    newQueue.add(() => this._handleCredentialsRequest(socketId, credentials, newClientCredentials)); // eslint-disable-line no-underscore-dangle

    this.socketCredentialQueues.set(socketId, newQueue);
    newQueue.onIdle().then(() => {
      this.socketCredentialQueues.delete(socketId);
    });
  }

  async _handleCredentialsRequest(socketId, credentials, newClientCredentials) {
    const credentialsDidUpdate = !!credentials.client;

    if (credentialsDidUpdate) {
      this.emit('presence', credentials, false, socketId, credentialsDidUpdate); // Wait a tick for presence events

      await new Promise(resolve => setImmediate(resolve));
    }

    const clientCredentials = credentials.client;

    if (typeof clientCredentials === 'undefined') {
      credentials.client = newClientCredentials; // eslint-disable-line  no-param-reassign
    } else {
      for (const key of Object.getOwnPropertyNames(clientCredentials)) {
        delete clientCredentials[key];
      }

      (0, _lodash.merge)(clientCredentials, newClientCredentials);
    }

    let response;

    try {
      response = await this.credentialsHandler(credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Credentials request handler error:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Credentials request handler error: ${error.message}`);
      }

      response = {
        success: false,
        code: 500,
        message: 'Credentials request handler error'
      };
    }

    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot respond to credentials request from socket ID ${socketId}, socket does not exist`);
      return;
    }

    if (response.success) {
      this.logger.info(`Credentials from ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) accepted`);
      this.emit('presence', credentials, true, socketId, credentialsDidUpdate);
    } else {
      this.logger.info(`Credentials from ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) rejected`);
    }

    const unencoded = new _braidMessagepack.CredentialsResponse({
      success: response.success,
      code: response.code,
      message: response.message
    });
    ws.send(this.encode(unencoded), true, false);
  }
  /**
   * Top level handler for incoming peer request messages. Uses the default/custom peerRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {Object} peerId Peer ID provided by the client
   * @return {void}
   */


  async handlePeerRequest(socketId, credentials, peerId) {
    if (this.peerConnections.has(peerId)) {
      const wsA = this.sockets.get(socketId);

      if (!wsA) {
        this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
        return;
      }

      this.logger.warn(`Peer request from ${wsA.credentials && wsA.credentials.ip ? wsA.credentials.ip : 'with unknown IP'} (${socketId}) rejected, connection to peer ${peerId} already exists`);
      const unencoded = new _braidMessagepack.PeerResponse({
        id: this.id,
        success: false,
        code: 801,
        message: `Connection to peer ${peerId} already exists`
      });
      wsA.send(this.encode(unencoded), true, false);
      return;
    }

    if (this.peerSockets.hasTarget(peerId)) {
      const wsA = this.sockets.get(socketId);

      if (!wsA) {
        this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
        return;
      }

      this.logger.warn(`Peer request from ${wsA.credentials && wsA.credentials.ip ? wsA.credentials.ip : 'with unknown IP'} (${socketId}) rejected, connection to peer ${peerId} already exists`);
      const unencoded = new _braidMessagepack.PeerResponse({
        id: this.id,
        success: false,
        code: 802,
        message: `Socket to peer ${peerId} already exists`
      });
      wsA.send(this.encode(unencoded), true, false);
      return;
    }

    await this.waitForSocketCredentialQueue(socketId);
    let response;

    try {
      response = await this.peerRequestHandler(credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Peer request handler error:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Peer request handler error: ${error.message}`);
      }

      response = {
        success: false,
        code: 500,
        message: 'Peer request handler error'
      };
    }

    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
      return;
    }

    if (response.success) {
      const unencoded = new _braidMessagepack.PeerResponse({
        id: this.id,
        success: true,
        code: response.code,
        message: response.message
      });
      this.addPeer(socketId, peerId);
      ws.send(this.encode(unencoded), true, false); // Reset local values so they don't get overwritten on OR map sync

      this.providers.set(this.id, [...this.provideCallbacks.keys()]);
      this.receivers.set(this.id, [...this.receiveCallbacks.keys()]);

      for (const key of this.subscriptions.targets) {
        this.peerSubscriptions.add([this.id, key]);
      }

      this.syncPeerSocket(socketId, peerId);
    } else {
      const unencoded = new _braidMessagepack.PeerResponse({
        success: false,
        code: response.code,
        message: response.message
      });
      ws.send(this.encode(unencoded), true, false);
    }
  }
  /**
   * Top level handler for incoming subscribe request messages. Uses the default/custom subscribeRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {string} key Key the subscriber is requesting updates on
   * @return {void}
   */


  async handleSubscribeRequest(socketId, credentials, key) {
    await this.waitForSocketCredentialQueue(socketId);
    let response;

    try {
      response = await this.subscribeRequestHandler(key, credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Subscribe request handler error:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Subscribe request handler error: ${error.message}`);
      }

      response = {
        success: false,
        code: 500,
        message: 'Subscribe request handler error'
      };
    }

    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot respond to subscribe request from socket ID ${socketId}, socket does not exist`);
      return;
    }

    if (response.success) {
      this.addSubscription(socketId, key);
    }

    const unencoded = new _braidMessagepack.SubscribeResponse({
      key,
      success: response.success,
      code: response.code,
      message: response.message
    });
    ws.send(this.encode(unencoded), true, false);
  }
  /**
   * Top level handler for incoming event subscribe request messages. Uses the default/custom eventSubscribeRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {string} name Event name the subscriber is requesting updates on
   * @return {void}
   */


  async handleEventSubscribeRequest(socketId, credentials, name) {
    await this.waitForSocketCredentialQueue(socketId);
    let response;

    try {
      response = await this.eventSubscribeRequestHandler(name, credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Event subscribe request handler error:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Event subscribe request handler error: ${error.message}`);
      }

      response = {
        success: false,
        code: 500,
        message: 'Event subscribe request handler error'
      };
    }

    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot respond to event subscribe request from socket ID ${socketId}, socket does not exist`);
      return;
    }

    if (response.success) {
      this.addEventSubscription(socketId, name);
    }

    const unencoded = new _braidMessagepack.EventSubscribeResponse({
      name,
      success: response.success,
      code: response.code,
      message: response.message
    });
    ws.send(this.encode(unencoded), true, false);
  }
  /**
   * Top level handler for incoming publish request messages. Uses the default/custom publishRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {string} key Key the publisher is requesting to publish to
   * @return {void}
   */


  async handlePublishRequest(socketId, credentials, key) {
    await this.waitForSocketCredentialQueue(socketId);
    let response;

    try {
      response = await this.publishRequestHandler(key, credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Publish request handler error:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Publish request handler error: ${error.message}`);
      }

      response = {
        success: false,
        code: 500,
        message: 'Publish request handler error'
      };
    }

    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot respond to publish request from socket ID ${socketId}, socket does not exist`);
      return;
    }

    if (response.success) {
      this.addPublisher(socketId, key);
    }

    const unencoded = new _braidMessagepack.PublishResponse({
      key,
      success: response.success,
      code: response.code,
      message: response.message
    });
    ws.send(this.encode(unencoded), true, false);
  }
  /**
   * Top level message handler, used by both sockets and connections.
   * @param {DataDump|ProviderDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump|PeerSync|PeerSyncResponse|BraidEvent} message Message to handle
   * @return {void}
   */


  handleMessage(message, peerId) {
    if (message instanceof _braidMessagepack.DataSyncInsertions) {
      this.data.process([message.insertions, []], true);
      return;
    } else if (message instanceof _braidMessagepack.DataSyncDeletions) {
      this.data.process([[], message.deletions], true);
      return;
    } else if (message instanceof _braidMessagepack.MultipartContainer) {
      this.handleMultipartContainer(message, peerId);
      return;
    } else if (message instanceof _braidMessagepack.PeerSync) {
      this.handlePeerSync(message);
      return;
    } else if (message instanceof _braidMessagepack.PeerSyncResponse) {
      this.emit('peerSyncResponse', message.value);
      return;
    } else if (message instanceof _braidMessagepack.BraidSocketEvent) {
      if (this.messageHashes.has(message.id)) {
        return;
      }

      this.messageHashes.set(message.id, true);

      if (this.id === message.peerId) {
        this.publishSocketEvent(message.name, message.args, message.socketId, message.id);
      } else {
        this.publishToPeers(message);
      }

      return;
    } else if (message instanceof _braidMessagepack.BraidEvent) {
      if (this.messageHashes.has(message.id)) {
        return;
      }

      this.messageHashes.set(message.id, true);
      this.publishEvent(message.name, message.args, message.id);
      this.publishToPeers(message);
      return;
    } else if (message instanceof _braidMessagepack.PublisherOpen) {
      this.handlePublisherOpen(message.regexString, message.key, message.serverId, message.socketId, message.credentials);
      return;
    } else if (message instanceof _braidMessagepack.PublisherClose) {
      this.handlePublisherClose(message.key, message.serverId, message.socketId);
      return;
    } else if (message instanceof _braidMessagepack.PublisherPeerMessage) {
      this.handlePublisherPeerMessage(message.key, message.serverId, message.socketId, message.message);
      return;
    }

    const hash = (0, _hashObject.hash32)(message.queue);

    if (this.messageHashes.has(hash)) {
      return;
    }

    this.messageHashes.set(hash, true);

    if (message instanceof _braidMessagepack.DataDump) {
      this.data.process(message.queue, true);
      this.publishData(message.queue);
    } else if (message instanceof _braidMessagepack.PeerSubscriptionDump) {
      this.peerSubscriptions.process(message.queue, true);
    } else if (message instanceof _braidMessagepack.ProviderDump) {
      this.providers.process(message.queue, true);
    } else if (message instanceof _braidMessagepack.ActiveProviderDump) {
      this.activeProviders.process(message.queue, true);
    } else if (message instanceof _braidMessagepack.ReceiverDump) {
      this.receivers.process(message.queue, true);
    } else if (message instanceof _braidMessagepack.PeerDump) {
      this.peers.process(message.queue, true);
    } else if (message instanceof _braidMessagepack.CustomMapDump) {
      const customMap = this.maps[message.name]; // eslint-disable-line no-underscore-dangle

      if (typeof customMap !== 'undefined') {
        customMap.process(message.queue, true);
      }
    } else if (message instanceof _braidMessagepack.CustomSetDump) {
      const customSet = this.sets[message.name]; // eslint-disable-line no-underscore-dangle

      if (typeof customSet !== 'undefined') {
        customSet.process(message.queue, true);
      }
    }

    this.publishToPeers(message);
  }
  /**
   * Publish event to subscribers.
   * @param {BraidEvent} Event object
   * @return {void}
   */


  publishEvent(name, args, id) {
    let encoded;

    for (const socketId of this.eventSubscriptions.getSources(name)) {
      const ws = this.sockets.get(socketId);

      if (!ws) {
        throw new Error(`Can not publish data to event subscriber ${socketId}, socket does not exist`);
      }

      if (!encoded) {
        const subscriberEvent = new _braidMessagepack.BraidEvent(name, args, id, []);
        encoded = this.encode(subscriberEvent);
      }

      ws.send(encoded, true, false);
    }
  }
  /**
   * Publish event to subscribers.
   * @param {BraidEvent} Event object
   * @return {void}
   */


  publishSocketEvent(name, args, socketId, id) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      throw new Error(`Can not publish data to event subscriber ${socketId}, socket does not exist`);
    }

    const subscriberEvent = new _braidMessagepack.BraidEvent(name, args, id, []);
    ws.send(this.encode(subscriberEvent), true, false);
  }
  /**
   * Publish data to subscribers.
   * @param {[Array<*>, Array<*>]} Data dump queue.
   * @return {void}
   */


  publishData(queue) {
    const insertions = new Map();
    const deletions = new Map();
    const subscriptionMap = new Map();

    for (const [key, valuePair] of queue[0]) {
      insertions.set(key, valuePair);

      for (const socketId of this.subscriptions.getSources(key)) {
        let subscriptions = subscriptionMap.get(socketId);

        if (!subscriptions) {
          subscriptions = new Set();
          subscriptionMap.set(socketId, subscriptions);
        }

        subscriptions.add(key);
      }
    }

    for (const [valueId, key] of queue[1]) {
      deletions.set(key, valueId);

      for (const socketId of this.subscriptions.getSources(key)) {
        let subscriptions = subscriptionMap.get(socketId);

        if (!subscriptions) {
          subscriptions = new Set();
          subscriptionMap.set(socketId, subscriptions);
        }

        subscriptions.add(key);
      }
    }

    for (const [socketId, keys] of subscriptionMap) {
      const ws = this.sockets.get(socketId);

      if (!ws) {
        throw new Error(`Can not publish data to subscriber ${socketId}, socket does not exist`);
      }

      const insertionQueue = [];
      const deletionQueue = [];

      for (const key of keys) {
        const valuePair = insertions.get(key);

        if (valuePair) {
          insertionQueue.push([key, valuePair]);
        }

        const valueId = deletions.get(key);

        if (valueId) {
          deletionQueue.push([valueId, key]);
        }
      }

      ws.send(this.encode(new _braidMessagepack.DataDump([insertionQueue, deletionQueue])), true, false);
    }
  }
  /**
   * Add an event subscription to a socket.
   * @param {number} socketId Socket ID of the subscriber
   * @param {string} name Name of the event to send
   * @return {void}
   */


  addEventSubscription(socketId, name) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      throw new Error(`Can not add event subscriber with socket ID ${socketId} for name ${name}, socket does not exist`);
    }

    this.eventSubscriptions.addEdge(socketId, name);
  }
  /**
   * Remove a subscription from a socket.
   * @param {number} socketId Socket ID of the subscriber
   * @param {string} name Name on which the subscriber should stop receiving events
   * @return {void}
   */


  removeEventSubscription(socketId, name) {
    this.eventSubscriptions.removeEdge(socketId, name);
  }
  /**
   * Remove all subscriptions from a socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the subscriber
   * @return {void}
   */


  removeEventSubscriptions(socketId) {
    for (const name of this.eventSubscriptions.getTargets(socketId)) {
      this.removeEventSubscription(socketId, name);
    }
  }
  /**
   * Add a publisher socket to a receiver.
   * @param {number} socketId Socket ID of the publisher
   * @param {string} key Key to receive publisher messages
   * @return {void}
   */


  addPublisher(socketId, key) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      throw new Error(`Can not add publisher with socket ID ${socketId} for key ${key}, socket does not exist`);
    }

    this.publishers.addEdge(socketId, key);
    this.assignReceiver(key, socketId);
  }
  /**
   * Remove a publisher socket from a receiver.
   * @param {number} socketId Socket ID of the publisher
   * @param {string} key Key on which the publisher should stop sending updates
   * @return {void}
   */


  removePublisher(socketId, key) {
    this.publishers.removeEdge(socketId, key);
    this.unassignReceiver(key, socketId);
  }
  /**
   * Remove all receivers from a publisher socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the publisher
   * @return {void}
   */


  removePublishers(socketId) {
    for (const key of this.publishers.getTargets(socketId)) {
      this.removePublisher(socketId, key);
    }
  }
  /**
   * Add a subscription to a socket.
   * @param {number} socketId Socket ID of the subscriber
   * @param {string} key Key to provide the subscriber with updates
   * @return {void}
   */


  addSubscription(socketId, key) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      throw new Error(`Can not add subscriber with socket ID ${socketId} for key ${key}, socket does not exist`);
    }

    this.subscriptions.addEdge(socketId, key);
    this.peerSubscriptions.add([this.id, key]);
    const pair = this.data.pairs.get(key);

    if (pair) {
      const insertionQueue = typeof pair[1] === 'undefined' ? [[key, [pair[0]]]] : [[key, pair]];
      ws.send(this.encode(new _braidMessagepack.DataDump([insertionQueue, []])), true, false);
    }
  }
  /**
   * Remove a subscription from a socket.
   * @param {number} socketId Socket ID of the subscriber
   * @param {string} key Key on which the subscriber should stop receiving updates
   * @return {void}
   */


  removeSubscription(socketId, key) {
    this.subscriptions.removeEdge(socketId, key);

    if (this.subscriptions.getSources(key).size === 0) {
      this.peerSubscriptions.delete([this.id, key]);
    }
  }
  /**
   * Remove all subscriptions from a socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the subscriber
   * @return {void}
   */


  removeSubscriptions(socketId) {
    for (const key of this.subscriptions.getTargets(socketId)) {
      this.removeSubscription(socketId, key);
    }
  }
  /**
   * Assign a provider to a key.
   * @param {string} key Key to provide peers with updates, which peers will then disseminate to subscribers
   * @return {void}
   */


  assignProvider(key) {
    if (this.activeProviders.has(key)) {
      return;
    }

    if (!this.peerSubscriptionMap.has(key)) {
      return;
    }

    const peerIdAndRegexStrings = [];

    for (const [peerId, regexes] of this.providerRegexes) {
      for (const [regexString, regex] of regexes) {
        if (regex.test(key)) {
          peerIdAndRegexStrings.push([peerId, regexString]);
          break;
        }
      }
    }

    if (peerIdAndRegexStrings.length === 0) {
      this.logger.warn(`Unable to find provider for "${key}"`);
      return;
    }

    peerIdAndRegexStrings.sort((x, y) => x[0] === y[0] ? x[1] > y[1] ? 1 : -1 : x[0] > y[0] ? 1 : -1);
    const peerIdAndRegexString = peerIdAndRegexStrings[_farmhash.default.hash32(key) % peerIdAndRegexStrings.length];
    this.activeProviders.set(key, peerIdAndRegexString);
  }
  /**
   * Indicate this server instance is providing for keys matching the regex string.
   * @param {string} regexString Regex to match keys with
   * @param {(key:string, active:boolean) => void} callback Callback function, called when a provider should start or stop providing values
   * @return {void}
   */


  provide(regexString, callback, options = {}) {
    const regexStrings = new Set(this.providers.get(this.id));
    regexStrings.add(regexString);
    this.provideCallbacks.set(regexString, callback);
    this.provideOptions.set(regexString, options);
    this.providers.set(this.id, [...regexStrings]);
  }
  /**
   * Indicate this server instance is no longer providing for keys matching the regex string.
   * @param {string} regexString Regex to match keys with
   * @param {(key:string, active:boolean) => void} callback Callback function, called when a provider should start or stop providing values
   * @return {void}
   */


  unprovide(regexString) {
    const regexStrings = new Set(this.providers.get(this.id));
    regexStrings.delete(regexString);
    this.provideCallbacks.delete(regexString);
    this.provideOptions.delete(regexString);

    if (regexStrings.size > 0) {
      this.providers.set(this.id, [...regexStrings]);
    } else {
      this.providers.delete(this.id);
    }

    for (const [key, [peerId, activeRegexString]] of this.activeProviders) {
      if (regexString === activeRegexString && peerId === this.id) {
        this.activeProviders.delete(key);
        this.assignProvider(key);
      }
    }
  }
  /**
   * Assign a receiver to a key.
   * @param {string} key Key to for a socket to publish to, which peers will then disseminate to recivers
    * @return {void}
   */


  assignReceiver(key, socketId) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot assign "${key}" receiver for ${socketId}, socket does not exist`);
      return;
    }

    const {
      credentials
    } = ws;
    const peerIdWithRegexes = [];

    for (const [peerId, regexMap] of this.receiverRegexes) {
      for (const [regexString, regex] of regexMap) {
        // eslint-disable-line no-unused-vars
        if (regex.test(key)) {
          if (this.id === peerId) {
            this.publisherSessions.add(key, this.id, socketId, regexString);
            this.receiverServers.add(key, socketId, this.id);
            this.handlePublisherOpen(regexString, key, this.id, socketId, credentials);
            return;
          }

          peerIdWithRegexes.push([peerId, regexString]);
          break;
        }
      }
    }

    if (peerIdWithRegexes.length === 0) {
      this.logger.warn(`Unable to find receiver for "${key}"`);
      return;
    }

    const [activePeerId, regexString] = peerIdWithRegexes[Math.floor(Math.random() * peerIdWithRegexes.length)];
    this.publisherSessions.add(key, activePeerId, socketId, regexString);
    this.receiverServers.add(key, socketId, activePeerId);
    this.sendToPeer(activePeerId, new _braidMessagepack.PublisherOpen(regexString, key, this.id, socketId, credentials));
  }
  /**
   * Unassign a receiver to a key.
   * @param {string} key Key that the socket was publishing to
    * @return {void}
   */


  unassignReceiver(key, socketId) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      this.logger.error(`Cannot unassign "${key}" receiver for ${socketId}, socket does not exist`);
      return;
    }

    const serverIds = this.receiverServers.servers(key, socketId);
    this.receiverServers.removePublisher(key, socketId);

    for (const serverId of serverIds) {
      this.publisherSessions.removePublisher(key, serverId, socketId);

      if (this.id === serverId) {
        this.handlePublisherClose(key, this.id, socketId);
      } else {
        this.sendToPeer(serverId, new _braidMessagepack.PublisherClose(key, this.id, socketId));
      }
    }

    if (serverIds.length === 0) {
      this.logger.warn(`Unable to unassign receiver for socket ${socketId} with key "${key}"`);
    }
  }
  /**
   * Top level publisher open handler
   * @param {string} key Key the socket is publishing to
   * @param {number} socketId Socket ID of the peer
   * @param {Object} credentials Credentials object
   * @return {void}
   */


  handlePublisherOpen(regexString, key, serverId, socketId, credentials) {
    const regexMap = this.receiverRegexes.get(this.id);

    if (!regexMap) {
      this.logger.warn(`Unable to find matching receiver regexes for "${key}"`);
      return;
    }

    if (!regexMap.has(regexString)) {
      this.logger.warn(`Unable to find matching receiver regex "${regexString}" for "${key}"`);
      return;
    }

    const callbacks = this.receiveCallbacks.get(regexString);

    if (!callbacks) {
      this.logger.warn(`Unable to find matching receiver callbacks for "${regexString}"`);
      return;
    }

    this.publisherServers.add(key, socketId, serverId);
    this.receiverSessions.add(key, serverId, socketId, regexString);
    const openCallback = callbacks[1];

    if (typeof openCallback === 'function') {
      openCallback(key, serverId, socketId, credentials);
    }
  }
  /**
   * Top level publisher close handler
   * @param {string} key Key the socket is publishing to
   * @param {number} socketId Socket ID of the peer
   * @return {void}
   */


  handlePublisherClose(key, serverId, socketId) {
    const regexStrings = this.receiverSessions.regexes(key, serverId, socketId);
    this.publisherServers.removePublisher(key, socketId);
    this.receiverSessions.removePublisher(key, serverId, socketId);

    for (const regexString of regexStrings) {
      const callbacks = this.receiveCallbacks.get(regexString);

      if (!callbacks) {
        continue;
      }

      const closeCallback = callbacks[2];

      if (typeof closeCallback === 'function') {
        closeCallback(key, serverId, socketId);
        return;
      }
    }

    this.logger.warn(`Unable to find receive session callbacks for "${key}" and server ${serverId}, socket ${socketId}`);
  }

  handlePublisherMessage(key, socketId, message) {
    for (const peerId of this.receiverServers.servers(key, socketId)) {
      if (this.id === peerId) {
        this.handlePublisherPeerMessage(key, this.id, socketId, message);
        return;
      }

      this.sendToPeer(peerId, new _braidMessagepack.PublisherPeerMessage(key, this.id, socketId, message));
      return;
    }

    this.logger.warn(`Unable to find receive session callbacks for "${key}" and socket ${socketId}`);
  }

  handlePublisherPeerMessage(key, serverId, socketId, message) {
    const regexStrings = this.receiverSessions.regexes(key, serverId, socketId);

    for (const regexString of regexStrings) {
      const callbacks = this.receiveCallbacks.get(regexString);

      if (!callbacks) {
        continue;
      }

      const messageCallback = callbacks[0];

      if (typeof messageCallback === 'function') {
        messageCallback(key, serverId, socketId, message);
        return;
      }
    }
  }
  /**
   * Indicate this server instance is receiving messages from publishers for keys matching the regex string.
   * @param {string} regexString Regex to match keys with
   * @param {(key:string, active:boolean) => void} callback Callback function, called when a receiver should start or stop receiving values
   * @return {void}
   */


  receive(regexString, messageCallback, openCallback, closeCallback) {
    const regexStrings = new Set(this.receivers.get(this.id));
    regexStrings.add(regexString);
    this.receiveCallbacks.set(regexString, [messageCallback, openCallback, closeCallback]);
    this.receivers.set(this.id, [...regexStrings]);
  }
  /**
   * Indicate this server instance is no longer receiving from publishers for keys matching the regex string.
   * @param {string} regexString Regex to match keys with
   * @param {(key:string, active:boolean) => void} callback Callback function, called when a receiver should start or stop receiving values
   * @return {void}
   */


  unreceive(regexString) {
    for (const [key, serverId, socketId] of this.receiverSessions.publishers(regexString)) {
      if (this.id === serverId) {
        this.handlePublisherClose(key, this.id, socketId);
      }
    }

    const regexStrings = new Set(this.receivers.get(this.id));
    regexStrings.delete(regexString);
    this.receiveCallbacks.delete(regexString);

    if (regexStrings.size > 0) {
      this.receivers.set(this.id, [...regexStrings]);
    } else {
      this.receivers.delete(this.id);
    }
  }
  /**
   * Update the peers Observed remove map with local peer IDs
   * @return {void}
   */


  updatePeers() {
    const peerIds = [...this.peerConnections.keys(), ...this.peerSockets.targets];

    if (peerIds.length === 0) {
      this.peers.delete(this.id);
    } else {
      this.peers.set(this.id, peerIds);
    }
  }
  /**
   * Traverse through the peers Observed remove map to find all peers through which the specified peer is connected to
   * @param {number} id Peer ID of the root peer
   * @param {Set<number>} peerIds Set to add connected peers to. (Passed by reference.)
   * @return {void}
   */


  connectedPeers(id, peerIds) {
    const values = this.peers.get(id);

    if (!values) {
      return;
    }

    for (const peerId of values) {
      if (peerIds.has(peerId)) {
        continue;
      }

      peerIds.add(peerId);
      this.connectedPeers(peerId, peerIds);
    }
  }
  /**
   * Traverse through connected peers and remove any peers without a direct path. Used after a peer disconnects.
   * @return {void}
   */


  prunePeers() {
    const connectedPeerIds = new Set();
    const disconnectedPeerIds = new Set();
    this.connectedPeers(this.id, connectedPeerIds);

    for (const peerId of this.peers.keys()) {
      if (this.id === peerId) {
        continue;
      }

      if (!connectedPeerIds.has(peerId)) {
        disconnectedPeerIds.add(peerId);
      }
    }

    disconnectedPeerIds.forEach(peerId => this.removePeer(peerId));
  }
  /**
   * Removes a peer, reassigning any active providers.
   * @param {number} peerId Peer ID of the peer
   * @return {void}
   */


  removePeer(peerId) {
    this.logger.info(`Removing peer ${peerId}`);
    this.peers.delete(peerId);
    this.providers.delete(peerId);
    this.providerRegexes.delete(peerId);
    this.receivers.delete(peerId);
    this.receiverRegexes.delete(peerId);

    for (const [pId, key] of this.peerSubscriptions) {
      if (pId === peerId) {
        this.peerSubscriptions.delete([pId, key]);
      }
    }

    for (const [key, [pId]] of this.activeProviders) {
      if (pId === peerId) {
        this.activeProviders.delete(key);
        this.assignProvider(key);
      }
    }

    const publishers = this.receiverServers.publishers(peerId);
    this.receiverServers.removeServer(peerId);

    for (const [key, socketId] of publishers) {
      this.assignReceiver(key, socketId);
    }

    for (const [key, socketId] of this.publisherServers.publishers(peerId)) {
      this.handlePublisherClose(key, peerId, socketId);
    }

    this.publisherServers.removeServer(peerId);
  }
  /**
   * Adds a peer.
   * @param {number} socketId Socket ID of the peer
   * @param {number} peerId Peer ID of the peer
   * @return {void}
   */


  addPeer(socketId, peerId) {
    const ws = this.sockets.get(socketId);

    if (!ws) {
      throw new Error(`Can not add peer with socket ID ${socketId}, socket does not exist`);
    }

    this.logger.info(`Adding peer ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) with ID ${peerId}`);
    this.peerSockets.addEdge(socketId, peerId);
    this.emit('addPeer', peerId);
    this.updatePeers();
  }
  /**
   * Stops the server by gracefully closing all sockets and outgoing connections
   * @return {Promise<void>}
   */


  async close() {
    this.logger.info('Closing');
    this.isClosing = true;

    for (const [socketId, socket] of this.sockets) {
      this.logger.info(`Sending close event with code 1001 to socket ${socketId} during server close`);
      socket.end(1001, 'Shutting down');
    }

    const peerDisconnectPromises = [];

    for (const peerId of this.peerConnections.keys()) {
      peerDisconnectPromises.push(this.disconnectFromPeer(peerId));
    }

    for (const [key, timeout] of this.provideDebounceTimeouts) {
      clearTimeout(timeout);
      this.provideDebounceTimeouts.delete(key);
    }

    await Promise.all(peerDisconnectPromises);

    for (const [peerId, reconnectTimeout] of this.peerReconnectTimeouts) {
      this.logger.warn(`Clearing peer ${peerId} reconnect timeout during server close`);
      clearTimeout(reconnectTimeout);
    }

    this.peerReconnectTimeouts.clear();
    const timeout = Date.now() + 10000;

    while (this.sockets.size > 0 && Date.now() < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.peers.delete(this.id);
    this.providers.delete(this.id);
    this.providerRegexes.delete(this.id);
    this.receivers.delete(this.id);
    this.receiverRegexes.delete(this.id);

    for (const [peerId, key] of this.peerSubscriptions) {
      if (peerId === this.id) {
        this.peerSubscriptions.delete([peerId, key]);
      }
    }

    for (const [key, [peerId]] of this.activeProviders) {
      if (peerId === this.id) {
        this.activeProviders.delete(key);
      }
    }

    this.receiverServers.removeServer(this.id);

    for (const [key, socketId] of this.publisherServers.publishers(this.id)) {
      this.handlePublisherClose(key, this.id, socketId);
    }

    this.publisherServers.removeServer(this.id);
    this.receiveCallbacks.clear();

    if (Date.now() > timeout) {
      this.logger.warn('Closed after timeout');
    } else {
      this.logger.info('Closed');
    }

    this.provideCallbacks.clear();
    this.provideOptions.clear();

    for (const provideDebounceTimeout of this.provideDebounceTimeouts.values()) {
      clearTimeout(provideDebounceTimeout);
    }

    this.provideDebounceTimeouts.clear();
    clearInterval(this.flushInterval);
    clearInterval(this.keyFlushInterval);
  }
  /**
   * Connects to a peer
   * @param {string} address Websocket URL of the peer
   * @param {Object} [credentials] Credentials to send during the peer request
   * @param {number} [attempt] Number of previous reconnect attempts
   * @return {Promise<number>}
   */


  async connectToPeer(address, credentials) {
    if (this.isClosing) {
      throw new Error(`Unable to connect to ${address}, closing`);
    }

    this.logger.info(`Connecting to peer ${address}`);
    const peerConnection = new _peerConnection.default(this.id, address, this.maxPayloadLength, credentials);
    const messageQueue = [];

    const queueMessages = message => {
      messageQueue.push(message);
    };

    peerConnection.on('message', queueMessages);
    let peerId;

    try {
      peerId = await peerConnection.open();
    } catch (error) {
      if (error.name === 'PeerError' && error.code === 801) {
        const pId = error.peerId;

        if (pId) {
          this.logger.warn(`Socket to peer ${pId} at ${address} already exists`);
          return pId;
        }
      }

      if (error.name === 'PeerError' && error.code === 802) {
        const pId = error.peerId;

        if (pId) {
          this.logger.warn(`Connection to peer ${pId} at ${address} already exists`);
          return pId;
        }
      }

      throw error;
    }

    if (!peerId) {
      throw new Error(`Did not receive peer ID when connecting to ${address}`);
    }

    if (this.peerConnections.has(peerId)) {
      await peerConnection.close(1000);
      this.logger.warn(`Closing connection to ${address}, connection to peer ${peerId} already exists`);
      return peerId;
    }

    if (this.peerSockets.hasTarget(peerId)) {
      await peerConnection.close(1000);
      this.logger.warn(`Closing connection to ${address}, socket with peer ${peerId} already exists`);
      return peerId;
    }

    peerConnection.on('close', code => {
      const shouldReconnect = this.peerConnections.has(peerId);
      this.logger.info(`Connection to ${address} with peer ID ${peerId} closed with code ${code}`);
      this.peerConnections.delete(peerId);
      this.emit('removePeer', peerId);
      this.updatePeers();
      this.prunePeers();

      if (!shouldReconnect) {
        return;
      }

      if (this.isClosing) {
        return;
      }

      if (code !== 1001) {
        this.reconnectToPeer(peerId, 1, address, credentials);
      }
    });
    this.peerConnections.set(peerId, peerConnection);
    this.emit('addPeer', peerId);
    peerConnection.removeListener('message', queueMessages);
    peerConnection.on('message', message => {
      this.handleMessage(message, peerId);
    });

    for (const message of messageQueue) {
      this.handleMessage(message, peerId);
    }

    this.updatePeers();
    this.logger.info(`Connected to ${address} with peer ID ${peerId}`); // Reset local values so they don't get overwritten on OR map sync

    this.providers.set(this.id, [...this.provideCallbacks.keys()]);
    this.receivers.set(this.id, [...this.receiveCallbacks.keys()]);

    for (const key of this.subscriptions.targets) {
      this.peerSubscriptions.add([this.id, key]);
    }

    await this.syncPeerConnection(peerId);
    return peerId;
  }
  /**
   * Disconnect from a peer
   * @param {number} peerId Peer ID
   * @return {Promise<void>}
   */


  async disconnectFromPeer(peerId) {
    const peerConnection = this.peerConnections.get(peerId);
    this.peerConnections.delete(peerId);
    this.emit('removePeer', peerId);
    const peerReconnectTimeout = this.peerReconnectTimeouts.get(peerId);

    if (typeof peerReconnectTimeout !== 'undefined') {
      this.peerReconnectTimeouts.delete(peerId);
      this.logger.info(`Clearing peer ${peerId} reconnect timeout during disconnect`);
      clearTimeout(peerReconnectTimeout);
    }

    if (peerConnection) {
      await peerConnection.close(1001, 'Disconnect requested');
    }

    for (const socketId of this.peerSockets.getSources(peerId)) {
      const socket = this.sockets.get(socketId);

      if (!socket) {
        this.logger.warn(`Unable to find socket ${socketId} for peer ${peerId} during disconnect`);
        continue;
      }

      await new Promise((resolve, reject) => {
        const handleClose = sId => {
          if (sId !== socketId) {
            return;
          }

          this.removeListener('error', handleError);
          this.removeListener('close', handleClose);
          resolve();
        };

        const handleError = error => {
          this.removeListener('error', handleError);
          this.removeListener('close', handleClose);
          reject(error);
        };

        this.on('error', handleError);
        this.on('close', handleClose);
        this.logger.info(`Sending close event with code 1001 to socket ${socketId} during peer disconnect`);
        socket.end(1001, 'Peer disconnecting');
      });
      this.logger.info(`Closed socket ${socketId} for peer ${peerId} during disconnect`);
    }
  }
  /**
   * Send a peer sync message to an (outgoing) peer connection
   * @param {number} peerId Peer ID to reconnect to
   * @param {number} [attempt] Number of previous reconnect attempts
   * @param {string} address Websocket URL of the peer
   * @param {Object} [credentials] Credentials to send during the peer reconnect request
   * @return {void}
   */


  reconnectToPeer(peerId, attempt, address, credentials) {
    if (this.isClosing) {
      return;
    }

    let peerReconnectTimeout = this.peerReconnectTimeouts.get(peerId);

    if (typeof peerReconnectTimeout !== 'undefined') {
      this.peerReconnectTimeouts.delete(peerId);
      this.logger.info(`Clearing peer ${peerId} reconnect timeout during subsequent reconnect`);
      clearTimeout(peerReconnectTimeout);
    }

    const duration = attempt > 8 ? 60000 + Math.round(Math.random() * 10000) : attempt * attempt * 1000;
    this.logger.warn(`Reconnect to peer ${peerId} attempt ${attempt} scheduled in ${Math.round(duration / 100) / 10} seconds`);
    peerReconnectTimeout = setTimeout(async () => {
      this.logger.info(`Reconnecting to peer ${peerId}, attempt ${attempt}`);
      this.peerReconnectTimeouts.delete(peerId);

      try {
        await this.connectToPeer(address, credentials);
      } catch (error) {
        if (error.name === 'PeerError' && error.code === 801) {
          this.logger.warn(`Socket to peer ${peerId} at ${address} already exists`);
          return;
        }

        if (error.name === 'PeerError' && error.code === 802) {
          this.logger.warn(`Connection to peer ${peerId} at ${address} already exists`);
          return;
        }

        if (error.name === 'CloseError' && error.code === 502) {
          this.logger.warn(`Connection closed before response from peer ${peerId} at ${address} was received`);
          return;
        }

        if (error.stack) {
          this.logger.error(`Error reconnecting to peer ${peerId} at ${address}:`);
          error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
        } else {
          this.logger.error(`Error reconnecting to peer ${peerId} at ${address}`);
        }

        this.reconnectToPeer(peerId, attempt + 1, address, credentials);
      }
    }, duration);
    this.peerReconnectTimeouts.set(peerId, peerReconnectTimeout);
  }
  /**
   * Handle a peer sync message, updating all shared maps with the provided data
   * @param {PeerSync} peerSync Peer sync object
   * @return {void}
   */


  handlePeerSync(peerSync) {
    this.peers.process(peerSync.peers.queue, true);
    this.providers.process(peerSync.providers.queue, true);
    this.receivers.process(peerSync.receivers.queue, true);
    this.activeProviders.process(peerSync.activeProviders.queue, true);
    this.peerSubscriptions.process(peerSync.peerSubscriptions.queue, true);

    for (const customMapDump of peerSync.customMapDumps) {
      const customMap = this.maps[customMapDump.name]; // eslint-disable-line no-underscore-dangle

      if (typeof customMap !== 'undefined') {
        customMap.process(customMapDump.queue, true);
      }
    }

    const peerConnection = this.peerConnections.get(peerSync.id);
    this.logger.info(`Sending peer sync response to peer ${peerSync.id}`);

    if (peerConnection) {
      if (peerConnection.ws.readyState !== 1) {
        this.logger.error(`Unable to handle sync from peer ${peerSync.id}, connection is in ready state is ${peerConnection.ws.readyState}`);
        return;
      }

      peerConnection.ws.send(this.encode(new _braidMessagepack.PeerSyncResponse(this.id)));
      return;
    }

    for (const socketId of this.peerSockets.getSources(peerSync.id)) {
      const ws = this.sockets.get(socketId);

      if (ws) {
        ws.send(this.encode(new _braidMessagepack.PeerSyncResponse(this.id)), true, false);
        return;
      }
    }

    this.logger.error(`Unable to handle sync from peer ${peerSync.id}, socket or connection does not exist`);
  }
  /**
   * Send a peer sync message to an (outgoing) peer connection
   * @param {number} peerId Peer ID to send sync message to
   * @return {Promise<void>}
   */


  async syncPeerConnection(peerId) {
    const peerConnection = this.peerConnections.get(peerId);

    if (!peerConnection) {
      this.logger.error(`Unable to sync peer ${peerId}, connection does not exist`);
      return;
    }

    if (peerConnection.ws.readyState !== 1) {
      this.logger.error(`Unable to sync peer ${peerId}, readystate ${peerConnection.ws.readyState}`);
      return;
    }

    const customMapDumps = [];

    for (const [name, customMap] of this._customMaps) {
      // eslint-disable-line no-underscore-dangle
      const customMapDump = new _braidMessagepack.CustomMapDump(name, customMap.dump());
      customMapDumps.push(customMapDump);
    }

    const customSetDumps = [];

    for (const [name, customSet] of this._customSets) {
      // eslint-disable-line no-underscore-dangle
      const customSetDump = new _braidMessagepack.CustomSetDump(name, customSet.dump());
      customSetDumps.push(customSetDump);
    }

    const peerSync = new _braidMessagepack.PeerSync(this.id, new _braidMessagepack.PeerDump(this.peers.dump()), new _braidMessagepack.ProviderDump(this.providers.dump()), new _braidMessagepack.ReceiverDump(this.receivers.dump()), new _braidMessagepack.ActiveProviderDump(this.activeProviders.dump()), new _braidMessagepack.PeerSubscriptionDump(this.peerSubscriptions.dump()), customMapDumps, customSetDumps);
    const peerSyncResponsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        peerConnection.removeListener('close', handleClose);
        reject(new Error(`Timeout waiting for sync response from peer ${peerId}`));
      }, 60000);

      const handlePeerSyncReponse = pId => {
        if (pId !== peerId) {
          return;
        }

        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        peerConnection.removeListener('close', handleClose);
        resolve();
      };

      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        peerConnection.removeListener('close', handleClose);
        reject(new Error(`Connection closed before sync response from peer ${peerId} was received`));
      };

      this.on('peerSyncResponse', handlePeerSyncReponse);
      peerConnection.on('close', handleClose);
    });
    const message = this.encode(peerSync);
    this.logger.info(`Sending ${message.length} byte peer sync message to peer ${peerId} connection`);
    await this.sendLargeMessageToPeer(message, peerId);

    try {
      await peerSyncResponsePromise;
      this.logger.info(`Received peer sync response from peer ${peerId}`);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Error in peer connection sync response:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Error in peer connection sync response: ${error.message}`);
      }
    }

    try {
      await this.streamDataToPeer(peerId);
      this.emit('peerSync', peerId);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Error in peer connection data stream:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Error in peer connection data stream: ${error.message}`);
      }
    }
  }
  /**
   * Send a peer sync message to an (incoming) peer socket
   * @param {number} socketID Socket ID of peer to send sync message to
   * @param {number} peerId Peer ID to send sync message to
   * @return {Promise<void>}
   */


  async syncPeerSocket(socketId, peerId) {
    const socket = this.sockets.get(socketId);

    if (!socket) {
      throw new Error(`Can not publish data to peer ${peerId} (${socketId}), socket does not exist`);
    }

    const customMapDumps = [];

    for (const [name, customMap] of this._customMaps) {
      // eslint-disable-line no-underscore-dangle
      const customMapDump = new _braidMessagepack.CustomMapDump(name, customMap.dump());
      customMapDumps.push(customMapDump);
    }

    const customSetDumps = [];

    for (const [name, customSet] of this._customSets) {
      // eslint-disable-line no-underscore-dangle
      const customSetDump = new _braidMessagepack.CustomSetDump(name, customSet.dump());
      customSetDumps.push(customSetDump);
    }

    const peerSync = new _braidMessagepack.PeerSync(this.id, new _braidMessagepack.PeerDump(this.peers.dump()), new _braidMessagepack.ProviderDump(this.providers.dump()), new _braidMessagepack.ReceiverDump(this.receivers.dump()), new _braidMessagepack.ActiveProviderDump(this.activeProviders.dump()), new _braidMessagepack.PeerSubscriptionDump(this.peerSubscriptions.dump()), customMapDumps, customSetDumps);
    const peerSyncResponsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        this.removeListener('close', handleClose);
        reject(new Error(`Timeout waiting for sync response from peer ${peerId}`));
      }, 60000);

      const handleClose = sId => {
        if (sId !== socketId) {
          return;
        }

        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        this.removeListener('close', handleClose);
        reject(new Error(`Socket ${socketId} closed before sync response from peer ${peerId} was received`));
      };

      const handlePeerSyncReponse = pId => {
        if (pId !== peerId) {
          return;
        }

        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        this.removeListener('close', handleClose);
        resolve();
      };

      this.on('peerSyncResponse', handlePeerSyncReponse);
      this.on('close', handleClose);
    });
    const message = this.encode(peerSync);
    this.logger.info(`Sending ${message.length} byte peer sync message to peer ${peerId} at socket ${socketId}`);
    await this.sendLargeMessageToSocket(message, peerId, socketId);

    try {
      await peerSyncResponsePromise;
      this.logger.info(`Received peer sync response from peer ${peerId} at socket ${socketId}`);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Error in peer socket sync response:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Error in peer socket sync response: ${error.message}`);
      }
    }

    try {
      await this.streamDataToPeer(peerId);
      this.emit('peerSync', peerId);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Error in peer socket data stream:');
        error.stack.split('\n').forEach(line => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Error in peer socket data stream: ${error.message}`);
      }
    }
  }
  /**
   * Check if peer exists
   * @param {number} peerId Peer ID
   * @return {boolean}
   */


  hasPeer(peerId) {
    return this.peerSockets.hasTarget(peerId) || this.peerConnections.has(peerId);
  }
  /**
   * Wait for a specific peer to connect
   * @param {number} peerId Peer ID
   * @param {number} duration Number of milliseconds to wait before throwing an error
   * @return {Promise<void>}
   */


  async waitForPeerConnect(peerId, duration = 5000) {
    if (this.hasPeer(peerId)) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('addPeer', handleAddPeer);
        reject(new Error(`Peer did not connect within ${duration}ms`));
      }, duration);

      const handleAddPeer = pId => {
        if (pId !== peerId) {
          return;
        }

        clearTimeout(timeout);
        this.removeListener('addPeer', handleAddPeer);
        resolve();
      };

      this.addListener('addPeer', handleAddPeer);
    });
  }
  /**
   * Wait for a specific peer to disconnect
   * @param {number} peerId Peer ID
   * @param {number} duration Number of milliseconds to wait before throwing an error
   * @return {Promise<void>}
   */


  async waitForPeerDisconnect(peerId, duration = 5000) {
    if (!this.hasPeer(peerId)) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('removePeer', handleRemovePeer);
        reject(new Error(`Peer did not disconnect within ${duration}ms`));
      }, duration);

      const handleRemovePeer = pId => {
        if (pId !== peerId) {
          return;
        }

        clearTimeout(timeout);
        this.removeListener('removePeer', handleRemovePeer);
        resolve();
      };

      this.addListener('removePeer', handleRemovePeer);
    });
  }
  /**
   * Wait for any queued auth requests associated with the socket to complete
   * @param {number} socketId Socket ID
   * @return {void}
   */


  async waitForSocketCredentialQueue(socketId) {
    // Wait for any credential handler operations to complete
    const queue = this.socketCredentialQueues.get(socketId);

    if (queue) {
      this.logger.info(`Waiting for socket ${socketId} credential queue with size ${queue.size} and ${queue.pending} pending`);
      await queue.onIdle();
    }
  }

  async sendLargeMessageToPeer(message, peerId) {
    const peerConnection = this.peerConnections.get(peerId);

    if (!peerConnection) {
      this.logger.error(`Unable to send message to peer ${peerId}, connection does not exist`);
      return false;
    }

    if (message.length > this.maxPayloadLength) {
      const chunkSize = Math.round(this.maxPayloadLength / 2);

      const chunks = _braidMessagepack.MultipartContainer.chunk(message, chunkSize);

      this.logger.info(`Sending ${message.length} byte message to peer ${peerId} connection in ${chunks.length} chunks`);

      for (const chunk of chunks) {
        if (peerConnection.ws.readyState !== 1) {
          this.logger.error(`Unable to send message to peer ${peerId}, ready state is ${peerConnection.ws.readyState}`);
          return false;
        }

        await new Promise((resolve, reject) => {
          peerConnection.ws.send(chunk, error => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }

      return true;
    } else if (peerConnection.ws.readyState !== 1) {
      this.logger.error(`Unable to send message to peer ${peerId}, ready state is ${peerConnection.ws.readyState}`);
      return false;
    }

    await new Promise((resolve, reject) => {
      peerConnection.ws.send(message, error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    return true;
  }

  async sendLargeMessageToSocket(message, peerId, socketId) {
    const socket = this.sockets.get(socketId);

    if (!socket) {
      this.logger.error(`Can not send message to socket ${socketId}, socket does not exist`);
      return false;
    }

    if (message.length > this.maxPayloadLength) {
      const chunkSize = Math.round(this.maxPayloadLength / 2);

      const chunks = _braidMessagepack.MultipartContainer.chunk(message, chunkSize);

      this.logger.info(`Sending ${message.length} byte message to to peer ${peerId} socket ${socketId} in ${chunks.length} chunks`);

      for (const chunk of chunks) {
        if (socket.getBufferedAmount() > this.maxBackpressure) {
          await this.waitForDrain(socketId);
        }

        socket.send(chunk, true, false);
      }
    } else {
      socket.send(message, true, false);
    }

    await this.waitForDrain(socketId);
    return true;
  }

  async streamDataToPeerSocket(peerId, socketId) {
    const insertions = [];

    for (const item of this.data.pairs) {
      insertions.push(item);

      if (insertions.length >= 100) {
        const message = this.encode(new _braidMessagepack.DataSyncInsertions(insertions));
        const sent = await this.sendLargeMessageToSocket(message, peerId, socketId);

        if (!sent) {
          this.logger.error(`Can not stream data to peer ${peerId} (${socketId}), socket does not exist`);
          return;
        }

        insertions.length = 0;
      }
    }

    const deletionsMessage = this.encode(new _braidMessagepack.DataSyncDeletions([...this.data.deletions]));
    await this.sendLargeMessageToSocket(deletionsMessage, peerId, socketId);
  }

  async streamDataToPeerConnection(peerId) {
    const insertions = [];

    for (const item of this.data.pairs) {
      insertions.push(item);

      if (insertions.length >= 100) {
        const message = this.encode(new _braidMessagepack.DataSyncInsertions(insertions));
        const sent = await this.sendLargeMessageToPeer(message, peerId);

        if (!sent) {
          this.logger.error(`Can not stream data to peer ${peerId}, connection does not exist`);
          return;
        }

        insertions.length = 0;
      }
    }

    const deletionsMessage = this.encode(new _braidMessagepack.DataSyncDeletions([...this.data.deletions]));
    await this.sendLargeMessageToPeer(deletionsMessage, peerId);
  }

  streamDataToPeer(peerId) {
    // eslint-disable-line consistent-return
    if (this.peerConnections.has(peerId)) {
      return this.streamDataToPeerConnection(peerId);
    }

    const socketId = [...this.peerSockets.getSources(peerId)][0];

    if (this.sockets.has(socketId)) {
      return this.streamDataToPeerSocket(peerId, socketId);
    }

    this.logger.error(`Unable to stream data to peer ${peerId}, no socket or connection exists`);
  }

}

var _default = Server;
exports.default = _default;
//# sourceMappingURL=index.js.map