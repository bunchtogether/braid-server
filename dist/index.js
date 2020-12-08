//      

                                                                   

const uuid = require('uuid');
const crypto = require('crypto');
const farmhash = require('farmhash');
const { hash32 } = require('@bunchtogether/hash-object');
const { ObservedRemoveMap, ObservedRemoveSet } = require('observed-remove');
const DirectedGraphMap = require('directed-graph-map');
const LruCache = require('lru-cache');
const { EventEmitter } = require('events');
const PeerConnection = require('./peer-connection');
const makeLogger = require('./lib/logger');
const requestIp = require('./lib/request-ip');
const {
  encode,
  decode,
  getArrayBuffer,
  Credentials,
  CredentialsResponse,
  DataDump,
  ProviderDump,
  ActiveProviderDump,
  ReceiverDump,
  PeerDump,
  PeerSubscriptionDump,
  PeerSync,
  PeerSyncResponse,
  PeerRequest,
  PeerResponse,
  SubscribeRequest,
  SubscribeResponse,
  Unsubscribe,
  EventSubscribeRequest,
  EventSubscribeResponse,
  EventUnsubscribe,
  BraidEvent,
  PublishRequest,
  PublishResponse,
  PublisherOpen,
  PublisherClose,
  PublisherMessage,
  PublisherPeerMessage,
  Unpublish,
//  PublisherMessage,
} = require('@bunchtogether/braid-messagepack');

function randomInteger() {
  return crypto.randomBytes(4).readUInt32BE(0, true);
}


/**
 * Class representing a Braid Server
 */
class Server extends EventEmitter {
  /**
   * Create a Braid Server.
   * @param {UWSTemplatedApp} uwsServer uWebSockets.js server
   * @param {UWSRecognizedString} websocketPattern uWebSockets.js websocket pattern
   * @param {UWSWebSocketBehavior} websocketBehavior uWebSockets.js websocket behavior and options
   */
  constructor(uwsServer                , websocketPattern         = '/*', websocketBehavior          = { compression: 0, maxPayloadLength: 8 * 1024 * 1024, idleTimeout: 10 }) {
    super();

    this.messageHashes = new LruCache({ max: 500 });

    // Primary data object, used by all peers and partially shared with subscribers
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Peer connections map, each peer stores the peers it is connected to
    //   Key: Peer ID
    //   Value: Array of peer IDs
    this.peers = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Provider map, each peer stores regex strings it can provide data for
    //   Key: Peer ID
    //   Value: Array of regex strings
    this.providers = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Active provider map for each key
    //   Key: key
    //   Value: [Peer ID, regex string]
    this.activeProviders = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Receiver map, each peer stores regex strings it can receive messages from publishers for
    //   Key: key
    //   Value: [Peer ID, regex string]
    this.receivers = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Peers which are currently subscribed to a key
    //   Values: [peerId, key]
    this.peerSubscriptions = new ObservedRemoveSet([], { bufferPublishing: 0 });

    // Peer subscriber map for each key
    //   Key: key
    //   Value: Array of Peer IDs
    this.peerSubscriptionMap = new Map();

    // Matcher functions for each provider
    //   Key: Peer ID
    //   Value: Array of regex strings, regex objects pairs
    this.providerRegexes = new Map();

    // Callbacks for providing / unproviding
    //   Key: regex strings
    //   Value: Callback function
    this.provideCallbacks = new Map();

    // Options for providing / unproviding
    //   Key: regex strings
    //   Value: Object
    this.provideOptions = new Map();

    // Debounce timeouts for providers
    //   Key: key
    //   Value: TimeoutId
    this.provideDebounceTimeouts = new Map();

    // Matcher functions for each receiver
    //   Key: Peer ID
    //   Value: Array of regex strings, regex objects pairs
    this.receiverRegexes = new Map();

    // Callbacks for receiving / unreceiving
    //   Key: regex strings
    //   Value: [Message callback function, Open callback function, Close callback function]
    this.receiveCallbacks = new Map();

    // Map of outgoing publishers to Peer IDs
    //   Source: {Key}:{socketId}
    //   Target: Peer ID
    this.receiverPeers = new DirectedGraphMap();

    // Map of Keys to callbaks
    //   Source: {Key}:{socketId}
    //   Target: Matching regex string
    this.receiveSessions = new DirectedGraphMap();

    // Map of Keys to callbaks
    //   Source: {Key}:{socketId}
    //   Target: Matching regex string
    this.publishSessions = new DirectedGraphMap();

    // Map of incoming publishers to Peer IDs
    //   Source: {Key}:{socketId}
    //   Target: Peer ID
    this.publisherPeers = new DirectedGraphMap();

    // Active (incoming) sockets
    //   Key: Socket ID
    //   Value: Socket object
    this.sockets = new Map();

    // Map of Peer IDs to Socket IDs
    //   Source: Socket ID
    //   Target: Peer ID
    this.peerSockets = new DirectedGraphMap();

    // Active (outgoing) peer connections
    //   Key: Peer ID
    //   Value: Connection Object
    this.peerConnections = new Map();

    // Active subscriptions
    //   Source: Socket ID
    //   Target: Key
    this.subscriptions = new DirectedGraphMap();

    // Active publishers
    //   Source: Socket ID
    //   Target: Key
    this.publishers = new DirectedGraphMap();

    // Active event subscriptions
    //   Source: Socket ID
    //   Target: Event Name
    this.eventSubscriptions = new DirectedGraphMap();

    // Active credential handler promises
    //   Key: Socket ID
    //   Value: Promise<void>
    this.credentialsHandlerPromises = new Map();

    // Keys without subscribers that should be flushed from data
    //   Key: key
    //   Value: Timestamp when the key should be deleted
    this.keysForDeletion = new Map();

    // Peer reconnection timeouts
    //   Key: Peer ID
    //   Value: TimeoutID
    this.peerReconnectTimeouts = new Map();

    this.id = randomInteger();

    this.logger = makeLogger(`Braid Server ${this.id}`);

    this.isClosing = false;

    this.flushInterval = setInterval(() => {
      this.data.flush();
      this.peers.flush();
      this.providers.flush();
      this.receivers.flush();
      this.activeProviders.flush();
      this.peerSubscriptions.flush();
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

    this.setCredentialsHandler(async (credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setPeerRequestHandler(async (credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setSubscribeRequestHandler(async (key       , credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setEventSubscribeRequestHandler(async (name       , credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setPublishRequestHandler(async (key       , credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.data.on('publish', (queue                     ) => {
      this.publishToPeers(new DataDump(queue, [this.id]));
      this.publishData(queue);
    });
    this.providers.on('publish', (queue                     ) => {
      this.publishToPeers(new ProviderDump(queue, [this.id]));
    });
    this.activeProviders.on('publish', (queue                     ) => {
      this.publishToPeers(new ActiveProviderDump(queue, [this.id]));
    });
    this.receivers.on('publish', (queue                     ) => {
      this.publishToPeers(new ReceiverDump(queue, [this.id]));
    });
    this.peers.on('publish', (queue                     ) => {
      this.publishToPeers(new PeerDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('publish', (queue                     ) => {
      this.publishToPeers(new PeerSubscriptionDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('add', ([peerId, key]) => {
      let peerIds = this.peerSubscriptionMap.get(key);
      this.keysForDeletion.delete(key);
      if (!peerIds) {
        peerIds = new Set();
        this.peerSubscriptionMap.set(key, peerIds);
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
    this.activeProviders.on('set', (key       , [peerId       , regexString       ], previousPeerIdAndRegexString                   ) => {
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
        if (previousPeerId !== peerId) {
          return;
        }
        const callback = this.provideCallbacks.get(previousRegexString);
        if (!callback) {
          this.unprovide(previousRegexString);
          return;
        }
        callback(key, false);
      }
    });
    this.activeProviders.on('delete', (key       , [peerId       , regexString       ]) => {
      if (this.id === peerId) {
        const callback = this.provideCallbacks.get(regexString);
        if (!callback) {
          this.unprovide(regexString);
          return;
        }
        callback(key, false);
      }
    });
    this.providers.on('set', (peerId       , regexStrings              ) => {
      const regexPairs = regexStrings.map((regexString) => [regexString, new RegExp(regexString)]);
      this.providerRegexes.set(peerId, regexPairs);
      const keysWithoutProviders = [...this.peerSubscriptionMap.keys()].filter((key) => !this.activeProviders.has(key));
      for (const regexPair of regexPairs) {
        const regex = regexPair[1];
        for (const key of keysWithoutProviders) {
          if (regex.test(key)) {
            this.assignProvider(key);
          }
        }
      }
    });
    this.providers.on('delete', (peerId       ) => {
      this.providerRegexes.delete(peerId);
    });
    this.receivers.on('set', (peerId       , regexStrings              , previousRegexStrings                     ) => {
      const regexMap = new Map(regexStrings.map((regexString) => [regexString, new RegExp(regexString)]));
      this.receiverRegexes.set(peerId, regexMap);
      if (Array.isArray(previousRegexStrings)) {
        for (const previousRegexString of previousRegexStrings) {
          if (regexStrings.includes(previousRegexString)) {
            continue;
          }
          const sessionKeys = this.publishSessions.getSources(previousRegexString);
          for (const sessionKey of sessionKeys) {
            const [key, socketIdString] = sessionKey.split(':');
            const socketId = parseInt(socketIdString, 10);
            this.unassignReceiver(key, socketId);
          }
        }
      }
      for (const [socketId, key] of this.publishers) {
        const sessionKey = `${key}:${socketId}`;
        if (this.receiverPeers.hasSource(sessionKey)) {
          continue;
        }
        this.assignReceiver(key, socketId);
      }
    });
    this.receivers.on('delete', (peerId       ) => {
      this.receiverRegexes.delete(peerId);
      const sessionKeys = new Set(this.receiverPeers.getSources(peerId));
      for (const sessionKey of sessionKeys) {
        const [key, socketIdString] = sessionKey.split(':');
        const socketId = parseInt(socketIdString, 10);
        this.unassignReceiver(key, socketId);
      }
      for (const [socketId, key] of this.publishers) {
        const sessionKey = `${key}:${socketId}`;
        if (this.receiverPeers.hasSource(sessionKey)) {
          continue;
        }
        this.assignReceiver(key, socketId);
      }
    });
    const options = Object.assign({}, websocketBehavior, {
      open: (ws, req) => { // eslint-disable-line no-unused-vars
        const socketId = randomInteger();
        ws.id = socketId; // eslint-disable-line no-param-reassign
        ws.credentials = { // eslint-disable-line no-param-reassign
          ip: requestIp(ws, req),
        };
        this.sockets.set(socketId, ws);
        this.emit('open', socketId);
        this.logger.info(`Opened socket with ${ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId})`);
      },
      message: (ws, data, isBinary) => {
        if (this.isClosing) {
          return;
        }
        const socketId = ws.id;
        if (!socketId) {
          this.logger.error('Received message without socket ID');
          return;
        }
        if (!isBinary) {
          this.logger.error(`Received non-binary message from ${ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}): ${data.toString()}`);
          return;
        }
        const message = decode(data);
        if (message instanceof DataDump || message instanceof PeerDump || message instanceof ProviderDump || message instanceof ActiveProviderDump || message instanceof ReceiverDump || message instanceof PeerSubscriptionDump || message instanceof PeerSync || message instanceof PeerSyncResponse || message instanceof BraidEvent || message instanceof PublisherOpen || message instanceof PublisherClose || message instanceof PublisherPeerMessage) {
          if (!this.peerSockets.hasSource(socketId)) {
            this.logger.error(`Received dump from non-peer ${ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId})`);
            return;
          }
          for (const peerId of this.peerSockets.getTargets(socketId)) {
            this.handleMessage(message, peerId);
          }
        }
        if (message instanceof Credentials) {
          this.handleCredentialsRequest(socketId, ws.credentials, message.value);
        } else if (message instanceof PeerRequest) {
          this.handlePeerRequest(socketId, ws.credentials, message.value);
        } else if (message instanceof SubscribeRequest) {
          this.handleSubscribeRequest(socketId, ws.credentials, message.value);
        } else if (message instanceof Unsubscribe) {
          this.removeSubscription(socketId, message.value);
        } else if (message instanceof EventSubscribeRequest) {
          this.handleEventSubscribeRequest(socketId, ws.credentials, message.value);
        } else if (message instanceof EventUnsubscribe) {
          this.removeEventSubscription(socketId, message.value);
        } else if (message instanceof PublishRequest) {
          this.handlePublishRequest(socketId, ws.credentials, message.value);
        } else if (message instanceof Unpublish) {
          this.removePublisher(socketId, message.value);
        } else if (message instanceof PublisherMessage) {
          this.handlePublisherMessage(message.key, socketId, message.message);
        }
      },
      close: (ws, code, data) => { // eslint-disable-line no-unused-vars
        const socketId = ws.id;
        if (!socketId) {
          this.logger.error('Received close without socket ID');
          return;
        }
        this.removeSubscriptions(socketId);
        this.removePublishers(socketId);
        this.removeEventSubscriptions(socketId);
        if (this.peerSockets.hasSource(socketId)) {
          this.peerSockets.removeSource(socketId);
          this.updatePeers();
          this.prunePeers();
        }
        this.sockets.delete(socketId);
        this.logger.info(`Closed socket with ${ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}), code ${code}`);
        const { credentials } = ws;
        if (credentials && credentials.client) {
          this.emit('presence', credentials, false);
        }
        this.emit('close', socketId);
        delete ws.id; // eslint-disable-line no-param-reassign
        delete ws.credentials; // eslint-disable-line no-param-reassign
      },
    });
    uwsServer.ws(websocketPattern, options);
    this.setMaxListeners(0);
  }

  emitToClients(name        , ...args           ) {
    const id = uuid.v4();
    this.publishEvent(name, args, id);
    this.publishToPeers(new BraidEvent(name, args, id, [this.id]));
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
    if (this.receiverPeers.size > 0) {
      throw new Error(`${this.id}: ${this.receiverPeers.size} referenced active receivers`);
    }
    if (this.receiveSessions.size > 0) {
      throw new Error(`${this.id}: ${this.receiveSessions.size} referenced receive sessions`);
    }
    if (this.publisherPeers.size > 0) {
      throw new Error(`${this.id}: ${this.publisherPeers.size} referenced publisher peers`);
    }
    if (this.publishSessions.size > 0) {
      throw new Error(`${this.id}: ${this.publisherPeers.size} referenced publisher sessions`);
    }
  }

  /**
   * Publish objects to peers.
   * @param {ProviderDump|DataDump|ActiveProviderDump|ReceiverDump|PeerDump|PeerSubscriptionDump} obj - Object to send, should have "ids" property
   * @return {void}
   */
  publishToPeers(obj                                                                                               ) {
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
    for (const [peerId, { ws }] of this.peerConnections) {
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
    const encoded = encode(obj);
    for (const ws of peerConnections) {
      ws.send(encoded);
    }
    if (peerUWSSockets.length === 0) {
      return;
    }
    const arrayBufferEncoded = getArrayBuffer(encoded);
    for (const ws of peerUWSSockets) {
      ws.send(arrayBufferEncoded, true, false);
    }
  }

  /**
   * Send objects to a peer.
   * @param {string} peerId - Peer ID to send to
   * @param {PublisherOpen|PublisherClose|PublisherPeerMessage} obj - Object to send
   * @return {void}
   */
  sendToPeer(peerId       , obj                                                  ) {
    const encoded = encode(obj);
    const peerConnection = this.peerConnections.get(peerId);
    if (peerConnection) {
      const { ws } = peerConnection;
      ws.send(encoded);
      return;
    }
    const arrayBufferEncoded = getArrayBuffer(encoded);
    for (const socketId of this.peerSockets.getSources(peerId)) {
      const ws = this.sockets.get(socketId);
      if (ws) {
        ws.send(arrayBufferEncoded, true, false);
      }
    }
  }

  /**
   * Set the credentials handler. The handler evaluates and modifies credentials provided by peers and clients when they are initially provided.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Credentials handler.
   * @return {void}
   */
  setCredentialsHandler(func                                                                                       ) { // eslint-disable-line no-unused-vars
    this.credentialsHandler = func;
  }

  /**
   * Set the peer request handler. Approves or denies peer request handlers.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Peer request handler.
   * @return {void}
   */
  setPeerRequestHandler(func                                                                                       ) { // eslint-disable-line no-unused-vars
    this.peerRequestHandler = func;
  }

  /**
   * Set the subscribe request handler. Approves or denies subscribe requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Subscription request handler.
   * @return {void}
   */
  setSubscribeRequestHandler(func                                                                                                   ) { // eslint-disable-line no-unused-vars
    this.subscribeRequestHandler = func;
  }

  /**
   * Set the event subscribe request handler. Approves or denies event subscribe requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Event subscription request handler.
   * @return {void}
   */
  setEventSubscribeRequestHandler(func                                                                                                    ) { // eslint-disable-line no-unused-vars
    this.eventSubscribeRequestHandler = func;
  }

  /**
   * Set the publish request handler. Approves or denies publish requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Publish request handler.
   * @return {void}
   */
  setPublishRequestHandler(func                                                                                                   ) { // eslint-disable-line no-unused-vars
    this.publishRequestHandler = func;
  }

  /**
   * Top level handler for incoming credentials messages. Uses the default/custom credentialsHandler method to validate.
   * @param {number} socketId Socket ID from which the credentials were received
   * @param {Object} existingCredentials Existing credentials object
   * @param {Object} clientCredentials Credentials object provided by the client
   * @return {void}
   */
  async handleCredentialsRequest(socketId        , existingCredentials        , clientCredentials        ) {
    if (existingCredentials && existingCredentials.client) {
      this.emit('presence', existingCredentials, false);
    }
    const credentials = Object.assign({}, existingCredentials, { client: clientCredentials });
    let response;
    try {
      const credentialsHandlerPromise = this.credentialsHandler(credentials);
      this.credentialsHandlerPromises.set(socketId, credentialsHandlerPromise.then(() => {
        this.credentialsHandlerPromises.delete(socketId);
      }).catch(() => {
        this.credentialsHandlerPromises.delete(socketId);
      }));
      response = await credentialsHandlerPromise;
    } catch (error) {
      if (error.stack) {
        this.logger.error('Credentials request handler error:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Credentials request handler error: ${error.message}`);
      }
      response = { success: false, code: 500, message: 'Credentials request handler error' };
    }
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot respond to credentials request from socket ID ${socketId}, socket does not exist`);
      return;
    }
    if (response.success) {
      this.logger.info(`Credentials from ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) accepted`);
      ws.credentials = credentials; // eslint-disable-line no-param-reassign
      this.emit('presence', credentials, true);
    } else {
      this.logger.info(`Credentials from ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) rejected`);
    }
    const unencoded = new CredentialsResponse({ success: response.success, code: response.code, message: response.message });
    ws.send(getArrayBuffer(encode(unencoded)), true, false);
  }

  /**
   * Top level handler for incoming peer request messages. Uses the default/custom peerRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {Object} peerId Peer ID provided by the client
   * @return {void}
   */
  async handlePeerRequest(socketId        , credentials        , peerId       ) {
    if (this.peerConnections.has(peerId)) {
      const wsA = this.sockets.get(socketId);
      if (!wsA) {
        this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
        return;
      }
      this.logger.warn(`Peer request from ${wsA.credentials && wsA.credentials.ip ? wsA.credentials.ip : 'with unknown IP'} (${socketId}) rejected, connection to peer ${peerId} already exists`);
      const unencoded = new PeerResponse({ id: this.id, success: false, code: 801, message: `Connection to peer ${peerId} already exists` });
      wsA.send(getArrayBuffer(encode(unencoded)), true, false);
      return;
    }
    if (this.peerSockets.hasTarget(peerId)) {
      const wsA = this.sockets.get(socketId);
      if (!wsA) {
        this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
        return;
      }
      this.logger.warn(`Peer request from ${wsA.credentials && wsA.credentials.ip ? wsA.credentials.ip : 'with unknown IP'} (${socketId}) rejected, connection to peer ${peerId} already exists`);
      const unencoded = new PeerResponse({ id: this.id, success: false, code: 802, message: `Socket to peer ${peerId} already exists` });
      wsA.send(getArrayBuffer(encode(unencoded)), true, false);
      return;
    }
    // Wait for any credential handler operations to complete
    await this.credentialsHandlerPromises.get(socketId);
    let response;
    try {
      response = await this.peerRequestHandler(credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Peer request handler error:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Peer request handler error: ${error.message}`);
      }
      response = { success: false, code: 500, message: 'Peer request handler error' };
    }
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
      return;
    }
    if (response.success) {
      const unencoded = new PeerResponse({ id: this.id, success: true, code: response.code, message: response.message });
      ws.send(getArrayBuffer(encode(unencoded)), true, false);
      this.addPeer(socketId, peerId);
    } else {
      const unencoded = new PeerResponse({ success: false, code: response.code, message: response.message });
      ws.send(getArrayBuffer(encode(unencoded)), true, false);
    }
  }

  /**
   * Top level handler for incoming subscribe request messages. Uses the default/custom subscribeRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {string} key Key the subscriber is requesting updates on
   * @return {void}
   */
  async handleSubscribeRequest(socketId       , credentials       , key       ) {
    // Wait for any credential handler operations to complete
    await this.credentialsHandlerPromises.get(socketId);
    let response;
    try {
      response = await this.subscribeRequestHandler(key, credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Subscribe request handler error:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Subscribe request handler error: ${error.message}`);
      }
      response = { success: false, code: 500, message: 'Subscribe request handler error' };
    }
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot respond to subscribe request from socket ID ${socketId}, socket does not exist`);
      return;
    }
    if (response.success) {
      this.addSubscription(socketId, key);
    }
    const unencoded = new SubscribeResponse({ key, success: response.success, code: response.code, message: response.message });
    ws.send(getArrayBuffer(encode(unencoded)), true, false);
  }

  /**
   * Top level handler for incoming event subscribe request messages. Uses the default/custom eventSubscribeRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {string} name Event name the subscriber is requesting updates on
   * @return {void}
   */
  async handleEventSubscribeRequest(socketId       , credentials       , name       ) {
    // Wait for any credential handler operations to complete
    await this.credentialsHandlerPromises.get(socketId);
    let response;
    try {
      response = await this.eventSubscribeRequestHandler(name, credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Event subscribe request handler error:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Event subscribe request handler error: ${error.message}`);
      }
      response = { success: false, code: 500, message: 'Event subscribe request handler error' };
    }
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot respond to event subscribe request from socket ID ${socketId}, socket does not exist`);
      return;
    }
    if (response.success) {
      this.addEventSubscription(socketId, name);
    }
    const unencoded = new EventSubscribeResponse({ name, success: response.success, code: response.code, message: response.message });
    ws.send(getArrayBuffer(encode(unencoded)), true, false);
  }

  /**
   * Top level handler for incoming publish request messages. Uses the default/custom publishRequestHandler method to validate.
   * @param {number} socketId Socket ID from which the request was received
   * @param {Object} credentials Credentials object
   * @param {string} key Key the publisher is requesting to publish to
   * @return {void}
   */
  async handlePublishRequest(socketId       , credentials       , key       ) {
    // Wait for any credential handler operations to complete
    await this.credentialsHandlerPromises.get(socketId);
    let response;
    try {
      response = await this.publishRequestHandler(key, credentials);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Publish request handler error:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Publish request handler error: ${error.message}`);
      }
      response = { success: false, code: 500, message: 'Publish request handler error' };
    }
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot respond to publish request from socket ID ${socketId}, socket does not exist`);
      return;
    }
    if (response.success) {
      this.addPublisher(socketId, key);
    }
    const unencoded = new PublishResponse({ key, success: response.success, code: response.code, message: response.message });
    ws.send(getArrayBuffer(encode(unencoded)), true, false);
  }

  /**
   * Top level message handler, used by both sockets and connections.
   * @param {DataDump|ProviderDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump|PeerSync|PeerSyncResponse|BraidEvent} message Message to handle
   * @return {void}
   */
  handleMessage(message                                                                                                                                                                           , peerId       ) {
    if (message instanceof PeerSync) {
      this.handlePeerSync(message);
      return;
    } else if (message instanceof PeerSyncResponse) {
      this.emit('peerSyncResponse', message.value);
      return;
    } else if (message instanceof BraidEvent) {
      if (this.messageHashes.has(message.id)) {
        return;
      }
      this.messageHashes.set(message.id, true);
      this.publishEvent(message.name, message.args, message.id);
      this.publishToPeers(message);
      return;
    } else if (message instanceof PublisherOpen) {
      this.handlePublisherOpen(peerId, message.regexString, message.key, message.socketId, message.credentials);
      return;
    } else if (message instanceof PublisherClose) {
      this.handlePublisherClose(message.key, message.socketId);
      return;
    } else if (message instanceof PublisherPeerMessage) {
      this.handlePublisherPeerMessage(message.key, message.socketId, message.message);
      return;
    }
    const hash = hash32(message.queue);
    if (this.messageHashes.has(hash)) {
      return;
    }
    this.messageHashes.set(hash, true);
    if (message instanceof DataDump) {
      this.data.process(message.queue, true);
      this.publishData(message.queue);
    } else if (message instanceof PeerSubscriptionDump) {
      this.peerSubscriptions.process(message.queue, true);
    } else if (message instanceof ProviderDump) {
      this.providers.process(message.queue, true);
    } else if (message instanceof ActiveProviderDump) {
      this.activeProviders.process(message.queue, true);
    } else if (message instanceof ReceiverDump) {
      this.receivers.process(message.queue, true);
    } else if (message instanceof PeerDump) {
      this.peers.process(message.queue, true);
    }
    this.publishToPeers(message);
  }

  /**
   * Publish event to subscribers.
   * @param {BraidEvent} Event object
   * @return {void}
   */
  publishEvent(name       , args           , id       ) {
    let encoded;
    for (const socketId of this.eventSubscriptions.getSources(name)) {
      const ws = this.sockets.get(socketId);
      if (!ws) {
        throw new Error(`Can not publish data to event subscriber ${socketId}, socket does not exist`);
      }
      if (!encoded) {
        const subscriberEvent = new BraidEvent(name, args, id, []);
        encoded = getArrayBuffer(encode(subscriberEvent));
      }
      ws.send(encoded, true, false);
    }
  }

  /**
   * Publish data to subscribers.
   * @param {[Array<*>, Array<*>]} Data dump queue.
   * @return {void}
   */
  publishData(queue                     ) {
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
      ws.send(getArrayBuffer(encode(new DataDump([insertionQueue, deletionQueue]))), true, false);
    }
  }

  /**
   * Add an event subscription to a socket.
   * @param {number} socketId Socket ID of the subscriber
   * @param {string} name Name of the event to send
   * @return {void}
   */
  addEventSubscription(socketId       , name       ) {
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
  removeEventSubscription(socketId       , name       ) {
    this.eventSubscriptions.removeEdge(socketId, name);
  }

  /**
   * Remove all subscriptions from a socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the subscriber
   * @return {void}
   */
  removeEventSubscriptions(socketId       ) {
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
  addPublisher(socketId       , key       ) {
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
  removePublisher(socketId       , key       ) {
    this.publishers.removeEdge(socketId, key);
    this.unassignReceiver(key, socketId);
  }

  /**
   * Remove all receivers from a publisher socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the publisher
   * @return {void}
   */
  removePublishers(socketId       ) {
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
  addSubscription(socketId       , key       ) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not add subscriber with socket ID ${socketId} for key ${key}, socket does not exist`);
    }
    this.subscriptions.addEdge(socketId, key);
    this.peerSubscriptions.add([this.id, key]);
    const pair = this.data.pairs.get(key);
    if (pair) {
      const insertionQueue = typeof pair[1] === 'undefined' ? [[key, [pair[0]]]] : [[key, pair]];
      ws.send(getArrayBuffer(encode(new DataDump([insertionQueue, []]))), true, false);
    }
    this.assignProvider(key);
  }

  /**
   * Remove a subscription from a socket.
   * @param {number} socketId Socket ID of the subscriber
   * @param {string} key Key on which the subscriber should stop receiving updates
   * @return {void}
   */
  removeSubscription(socketId       , key       ) {
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
  removeSubscriptions(socketId       ) {
    for (const key of this.subscriptions.getTargets(socketId)) {
      this.removeSubscription(socketId, key);
    }
  }

  /**
   * Assign a provider to a key.
   * @param {string} key Key to provide peers with updates, which peers will then disseminate to subscribers
   * @return {void}
   */
  assignProvider(key       ) {
    if (this.activeProviders.has(key)) {
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
    peerIdAndRegexStrings.sort((x, y) => (x[0] === y[0] ? (x[1] > y[1] ? 1 : -1) : (x[0] > y[0] ? 1 : -1)));
    const peerIdAndRegexString = peerIdAndRegexStrings[farmhash.hash32(key) % peerIdAndRegexStrings.length];
    this.activeProviders.set(key, peerIdAndRegexString);
  }

  /**
   * Indicate this server instance is providing for keys matching the regex string.
   * @param {string} regexString Regex to match keys with
   * @param {(key:string, active:boolean) => void} callback Callback function, called when a provider should start or stop providing values
   * @return {void}
   */
  provide(regexString       , callback                                                    , options                       = {}) {
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
  unprovide(regexString       ) {
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
  assignReceiver(key       , socketId        ) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot assign "${key}" receiver for ${socketId}, socket does not exist`);
      return;
    }
    const { credentials } = ws;
    const peerIdWithRegexes = [];
    const sessionKey = `${key}:${socketId}`;
    for (const [peerId, regexMap] of this.receiverRegexes) {
      for (const [regexString, regex] of regexMap) { // eslint-disable-line no-unused-vars
        if (regex.test(key)) {
          this.publishSessions.addEdge(sessionKey, regexString);
          if (this.id === peerId) {
            this.receiverPeers.addEdge(sessionKey, peerId);
            this.handlePublisherOpen(this.id, regexString, key, socketId, credentials);
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
    this.receiverPeers.addEdge(`${key}:${socketId}`, activePeerId);
    this.sendToPeer(activePeerId, new PublisherOpen(regexString, key, socketId, credentials));
  }

  /**
   * Unassign a receiver to a key.
   * @param {string} key Key that the socket was publishing to

   * @return {void}
   */
  unassignReceiver(key       , socketId        ) {
    const sessionKey = `${key}:${socketId}`;
    const peerIds = new Set(this.receiverPeers.getTargets(sessionKey));
    this.receiverPeers.removeSource(sessionKey);
    this.publishSessions.removeSource(sessionKey);
    for (const peerId of peerIds) {
      if (this.id === peerId) {
        this.handlePublisherClose(key, socketId);
      } else {
        this.sendToPeer(peerId, new PublisherClose(key, socketId));
      }
    }
    if (peerIds.size === 0) {
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
  handlePublisherOpen(peerId       , regexString       , key       , socketId       , credentials       ) {
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
    const sessionKey = `${key}:${socketId}`;
    this.publisherPeers.addEdge(sessionKey, peerId);
    this.receiveSessions.addEdge(sessionKey, regexString);
    const openCallback = callbacks[1];
    if (typeof openCallback === 'function') {
      openCallback(key, socketId, credentials);
    }
  }

  /**
   * Top level publisher close handler
   * @param {string} key Key the socket is publishing to
   * @param {number} socketId Socket ID of the peer
   * @return {void}
   */
  handlePublisherClose(key       , socketId       ) {
    const sessionKey = `${key}:${socketId}`;
    const regexStrings = new Set(this.receiveSessions.getTargets(sessionKey));
    this.publisherPeers.removeSource(sessionKey);
    this.receiveSessions.removeSource(sessionKey);
    for (const regexString of regexStrings) {
      const callbacks = this.receiveCallbacks.get(regexString);
      if (!callbacks) {
        continue;
      }
      const closeCallback = callbacks[2];
      if (typeof closeCallback === 'function') {
        closeCallback(key, socketId);
        return;
      }
    }
    this.logger.warn(`Unable to find receive session callbacks for "${key}" and socket ${socketId}`);
  }

  handlePublisherMessage(key       , socketId       , message    ) {
    const sessionKey = `${key}:${socketId}`;
    for (const peerId of this.receiverPeers.getTargets(sessionKey)) {
      if (this.id === peerId) {
        this.handlePublisherPeerMessage(key, socketId, message);
        return;
      }
      this.sendToPeer(peerId, new PublisherPeerMessage(key, socketId, message));
      return;
    }
    this.logger.warn(`Unable to find receive session callbacks for "${key}" and socket ${socketId}`);
  }

  handlePublisherPeerMessage(key       , socketId       , message    ) {
    const sessionKey = `${key}:${socketId}`;
    const regexStrings = this.receiveSessions.getTargets(sessionKey);
    for (const regexString of regexStrings) {
      const callbacks = this.receiveCallbacks.get(regexString);
      if (!callbacks) {
        continue;
      }
      const messageCallback = callbacks[0];
      if (typeof messageCallback === 'function') {
        messageCallback(key, socketId, message);
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
  receive(regexString       , messageCallback                                                                      , openCallback                                                                           , closeCallback                                                       ) {
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
  unreceive(regexString       ) {
    for (const sessionKey of this.receiveSessions.getSources(regexString)) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      this.handlePublisherClose(key, socketId);
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
    this.peers.set(this.id, peerIds);
  }

  /**
   * Traverse through the peers Observed remove map to find all peers through which the specified peer is connected to
   * @param {number} id Peer ID of the root peer
   * @param {Set<number>} peerIds Set to add connected peers to. (Passed by reference.)
   * @return {void}
   */
  connectedPeers(id       , peerIds            ) {
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
    disconnectedPeerIds.forEach((peerId) => this.removePeer(peerId));
  }

  /**
   * Removes a peer, reassigning any active providers.
   * @param {number} peerId Peer ID of the peer
   * @return {void}
   */
  removePeer(peerId        ) {
    this.logger.info(`Removing peer ${peerId}`);
    this.peers.delete(peerId);
    this.providers.delete(peerId);
    this.providerRegexes.delete(peerId);
    this.receivers.delete(peerId);
    this.receiverRegexes.delete(peerId);
    //
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
    const receiverPeerSessionKeys = new Set(this.receiverPeers.getSources(peerId));
    this.receiverPeers.removeTarget(peerId);
    for (const sessionKey of receiverPeerSessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      this.assignReceiver(key, socketId);
    }
    const publisherPeerSessionKeys = this.publisherPeers.getSources(peerId);
    for (const sessionKey of publisherPeerSessionKeys) {
      const [key, socketIdString] = sessionKey.split(':');
      const socketId = parseInt(socketIdString, 10);
      this.handlePublisherClose(key, socketId);
    }
    this.publisherPeers.removeTarget(peerId);
    if (this.id === peerId) {
      this.receiveCallbacks.clear();
    }
  }


  /**
   * Adds a peer.
   * @param {number} socketId Socket ID of the peer
   * @param {number} peerId Peer ID of the peer
   * @return {void}
   */
  addPeer(socketId       , peerId       ) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not add peer with socket ID ${socketId}, socket does not exist`);
    }
    this.logger.info(`Adding peer ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) with ID ${peerId}`);
    this.peerSockets.addEdge(socketId, peerId);
    this.updatePeers();
    this.syncPeerSocket(socketId, peerId);
  }

  /**
   * Stops the server by gracefully closing all sockets and outgoing connections
   * @return {Promise<void>}
   */
  async close() {
    this.logger.info('Closing');
    this.isClosing = true;
    const peerDisconnectPromises = [];
    for (const peerId of this.peerConnections.keys()) {
      peerDisconnectPromises.push(this.disconnectFromPeer(peerId));
    }
    for (const [key, timeout] of this.provideDebounceTimeouts) {
      clearTimeout(timeout);
      this.provideDebounceTimeouts.delete(key);
    }
    await Promise.all(peerDisconnectPromises);
    // await this.closePeerConnections();
    for (const reconnectTimeout of this.peerReconnectTimeouts.values()) {
      clearTimeout(reconnectTimeout);
    }
    for (const socket of this.sockets.values()) {
      socket.end(1001, 'Shutting down');
    }
    const timeout = Date.now() + 10000;
    while (this.sockets.size > 0 && Date.now() < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.removePeer(this.id);
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
    this.isClosing = false;
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
  async connectToPeer(address       , credentials         , attempt          = 0) {
    this.logger.info(`Connecting to peer ${address}`);
    const peerConnection = new PeerConnection(this.id, address, credentials);
    const messageQueue = [];
    const queueMessages = (message    ) => {
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
    const start = Date.now();
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
    peerConnection.on('close', (code       ) => {
      const shouldReconnect = this.peerConnections.has(peerId);
      this.logger.info(`Connection to ${address} with peer ID ${peerId} closed with code ${code}`);
      this.peerConnections.delete(peerId);
      this.updatePeers();
      this.prunePeers();
      if (!shouldReconnect) {
        return;
      }
      if (code !== 1001) {
        if (Date.now() < start + 120000) {
          this.reconnectToPeer(peerId, attempt + 1, address, credentials);
        } else {
          this.reconnectToPeer(peerId, 1, address, credentials);
        }
      }
    });
    this.peerConnections.set(peerId, peerConnection);
    peerConnection.removeListener('message', queueMessages);
    peerConnection.on('message', (message    ) => {
      this.handleMessage(message, peerId);
    });
    for (const message of messageQueue) {
      this.handleMessage(message, peerId);
    }
    this.updatePeers();
    this.logger.info(`Connected to ${address} with peer ID ${peerId}`);
    await this.syncPeerConnection(peerId);
    return peerId;
  }

  /**
   * Disconnect from a peer
   * @param {number} peerId Peer ID
   * @return {Promise<void>}
   */
  async disconnectFromPeer(peerId        ) {
    const peerConnection = this.peerConnections.get(peerId);
    this.peerConnections.delete(peerId);
    const peerReconnectTimeout = this.peerReconnectTimeouts.get(peerId);
    clearTimeout(peerReconnectTimeout);
    if (peerConnection) {
      await peerConnection.close(1001);
    }
    for (const socketId of this.peerSockets.getSources(peerId)) {
      const ws = this.sockets.get(socketId);
      if (!ws) {
        continue;
      }
      await new Promise((resolve, reject) => {
        const handleClose = (sId       ) => {
          if (sId !== socketId) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('close', handleClose);
          resolve();
        };
        const handleError = (error      ) => {
          this.removeListener('error', handleError);
          this.removeListener('close', handleClose);
          reject(error);
        };
        this.on('error', handleError);
        this.on('close', handleClose);
        ws.end(1001, 'Peer disconncting');
      });
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
  reconnectToPeer(peerId       , attempt        , address       , credentials         ) {
    if (this.isClosing) {
      return;
    }
    let peerReconnectTimeout = this.peerReconnectTimeouts.get(peerId);
    clearTimeout(peerReconnectTimeout);
    const duration = attempt > 8 ? 60000 + Math.round(Math.random() * 10000) : attempt * attempt * 1000;
    this.logger.warn(`Reconnect attempt ${attempt} in ${Math.round(duration / 100) / 10} seconds`);
    peerReconnectTimeout = setTimeout(async () => {
      this.peerReconnectTimeouts.delete(peerId);
      try {
        await this.connectToPeer(address, credentials, attempt + 1);
      } catch (error) {
        if (error.name === 'PeerError' && error.code === 801) {
          this.logger.warn(`Socket to peer ${peerId} at ${address} already exists`);
          return;
        }
        if (error.name === 'PeerError' && error.code === 802) {
          this.logger.warn(`Connection to peer ${peerId} at ${address} already exists`);
          return;
        }
        if (error.stack) {
          this.logger.error(`Error reconnecting to peer ${peerId} at ${address}:`);
          error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
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
  handlePeerSync(peerSync          ) {
    this.data.process(peerSync.data.queue, true);
    this.peers.process(peerSync.peers.queue, true);
    this.providers.process(peerSync.providers.queue, true);
    this.receivers.process(peerSync.receivers.queue, true);
    this.activeProviders.process(peerSync.activeProviders.queue, true);
    this.peerSubscriptions.process(peerSync.peerSubscriptions.queue, true);
    const peerConnection = this.peerConnections.get(peerSync.id);
    if (peerConnection && peerConnection.ws.readyState === 1) {
      peerConnection.ws.send(encode(new PeerSyncResponse(this.id)));
      return;
    }
    for (const socketId of this.peerSockets.getSources(peerSync.id)) {
      const ws = this.sockets.get(socketId);
      if (ws) {
        ws.send(getArrayBuffer(encode(new PeerSyncResponse(this.id))), true, false);
        return;
      }
    }
    this.logger.error(`Unable to handle sync from peer ID ${peerSync.id}, socket or connection does not exist`);
  }

  /**
   * Send a peer sync message to an (outgoing) peer connection
   * @param {number} peerId Peer ID to send sync message to
   * @return {Promise<void>}
   */
  async syncPeerConnection(peerId        ) {
    const peerConnection = this.peerConnections.get(peerId);
    if (!peerConnection) {
      this.logger.error(`Unable to sync peer ${peerId}, connection does not exist`);
      return;
    }
    if (peerConnection.ws.readyState !== 1) {
      this.logger.error(`Unable to sync peer ${peerId}, readystate ${peerConnection.ws.readyState}`);
      return;
    }
    const peerSync = new PeerSync(
      this.id,
      new DataDump(this.data.dump()),
      new PeerDump(this.peers.dump()),
      new ProviderDump(this.providers.dump()),
      new ReceiverDump(this.receivers.dump()),
      new ActiveProviderDump(this.activeProviders.dump()),
      new PeerSubscriptionDump(this.peerSubscriptions.dump()),
    );
    const peerSyncResponsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        reject(new Error(`Timeout waiting for sync response from peer ${peerId}`));
      }, 5000);
      const handlePeerSyncReponse = (pId       ) => {
        if (pId !== peerId) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        resolve();
      };
      this.on('peerSyncResponse', handlePeerSyncReponse);
    });
    peerConnection.ws.send(encode(peerSync));
    try {
      await peerSyncResponsePromise;
    } catch (error) {
      if (error.stack) {
        this.logger.error('Error in peer connection sync response:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Error in peer connection sync response: ${error.message}`);
      }
    }
  }

  /**
   * Send a peer sync message to an (incoming) peer socket
   * @param {number} socketID Socket ID of peer to send sync message to
   * @param {number} peerId Peer ID to send sync message to
   * @return {Promise<void>}
   */
  async syncPeerSocket(socketId        , peerId        ) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not publish data to peer ${peerId} (${socketId}), socket does not exist`);
    }
    const peerSync = new PeerSync(
      this.id,
      new DataDump(this.data.dump()),
      new PeerDump(this.peers.dump()),
      new ProviderDump(this.providers.dump()),
      new ReceiverDump(this.receivers.dump()),
      new ActiveProviderDump(this.activeProviders.dump()),
      new PeerSubscriptionDump(this.peerSubscriptions.dump()),
    );
    const peerSyncResponsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        reject(new Error(`Timeout waiting for sync response from peer ${peerId}`));
      }, 5000);
      const handlePeerSyncReponse = (pId       ) => {
        if (pId !== peerId) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        resolve();
      };
      this.on('peerSyncResponse', handlePeerSyncReponse);
    });
    ws.send(getArrayBuffer(encode(peerSync)), true, false);
    try {
      await peerSyncResponsePromise;
    } catch (error) {
      if (error.stack) {
        this.logger.error('Error in peer socket sync response:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Error in peer socket sync response: ${error.message}`);
      }
    }
  }

  /**
   * Check if peer exists
   * @param {number} peerId Peer ID
   * @return {boolean}
   */
  hasPeer(peerId        ) {
    return this.peerSockets.hasTarget(peerId) || this.peerConnections.has(peerId);
  }

                             
                     
                                    
                                       
                                                   
                                                               
                                                          
                                                       
                                                       
                                                      
                                            
                                              
                                                         
                                                             
                                                                                
                                                          
                                                         
                                                                      
                                                             
                                                                                                                                                                                                         
                                                            
                                                            
                                                           
                                                          
                                                                
                                                       
                                                                
                                                            
                                                                 
                                                                                                                    
                                                                                                                    
                                                                                                                                     
                                                                                                                                   
                                                                                                                                           
                                              
                                                       
                   
                            
                           
                           
                           
    
}

module.exports = Server;
