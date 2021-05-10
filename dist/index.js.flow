// @flow

import type { UWSTemplatedApp, UWSWebSocket } from './uWebSockets';

const uuid = require('uuid');
const crypto = require('crypto');
const { merge } = require('lodash');
const { default: PQueue } = require('p-queue');
const farmhash = require('farmhash');
const { hash32 } = require('@bunchtogether/hash-object');
const { ObservedRemoveMap, ObservedRemoveSet } = require('observed-remove');
const DirectedGraphMap = require('directed-graph-map');
const LruCache = require('lru-cache');
const { EventEmitter } = require('events');
const PeerConnection = require('./peer-connection');
const makeLogger = require('./lib/logger');
const requestIp = require('./lib/request-ip');
const { MAX_PAYLOAD_LENGTH } = require('./lib/constants');
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
  MultipartContainer,
  MergeChunksPromise,
  Unpublish,
//  PublisherMessage,
} = require('@bunchtogether/braid-messagepack');

function randomInteger() {
  return crypto.randomBytes(4).readUInt32BE(0, true);
}

const MAX_BACKPRESSURE = MAX_PAYLOAD_LENGTH * 4;

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
  constructor(uwsServer:UWSTemplatedApp, websocketPattern?:string = '/*', websocketBehavior?: Object = { compression: 0, closeOnBackpressureLimit: false, maxPayloadLength: MAX_PAYLOAD_LENGTH, maxBackpressure: MAX_BACKPRESSURE, idleTimeout: 56 }) {
    super();

    this.messageHashes = new LruCache({ max: 500 });

    // Multipart message container merge promises
    //   Key: id
    //   Value: MergeChunksPromise
    this.mergeChunkPromises = new Map();

    // Socket drain callbacks
    //   Key: Socket ID
    //   Value: [Array of callbacks, Array of Errbacks]
    this.drainCallbacks = new Map();

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

    // Promise queue of incoming crendential authentication requests
    //   Key: Socket ID
    //   Value: Promise Queue
    this.socketCredentialQueues = new Map();

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

    this.setCredentialsHandler(async (credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setPeerRequestHandler(async (credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setSubscribeRequestHandler(async (key:string, credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setEventSubscribeRequestHandler(async (name:string, credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setPublishRequestHandler(async (key:string, credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.data.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishToPeers(new DataDump(queue, [this.id]));
      this.publishData(queue);
    });
    this.providers.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishToPeers(new ProviderDump(queue, [this.id]));
    });
    this.activeProviders.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishToPeers(new ActiveProviderDump(queue, [this.id]));
    });
    this.receivers.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishToPeers(new ReceiverDump(queue, [this.id]));
    });
    this.peers.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishToPeers(new PeerDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('publish', (queue:[Array<*>, Array<*>]) => {
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
    this.activeProviders.on('set', (key:string, [peerId:number, regexString:string], previousPeerIdAndRegexString?: [number, string]) => {
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
    this.activeProviders.on('delete', (key:string, [peerId:number, regexString:string]) => {
      if (this.id === peerId) {
        const callback = this.provideCallbacks.get(regexString);
        if (!callback) {
          this.unprovide(regexString);
          return;
        }
        callback(key, false);
      }
    });
    this.providers.on('set', (peerId:number, regexStrings:Array<string>) => {
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
    this.providers.on('delete', (peerId:number) => {
      this.providerRegexes.delete(peerId);
    });
    this.receivers.on('set', (peerId:number, regexStrings:Array<string>, previousRegexStrings:Array<string> | void) => {
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
    this.receivers.on('delete', (peerId:number) => {
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
      upgrade: (res, req, context) => { // eslint-disable-line no-unused-vars
        try {
          const socketId = randomInteger();
          const socketIp = requestIp(res, req);
          const socketOptions = {
            id: socketId,
            credentials: {
              ip: socketIp,
            },
          };
          res.upgrade(socketOptions, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
          this.logger.info(`Upgraded socket at ${socketIp || 'with unknown IP'}`);
        } catch (error) {
          if (error.stack) {
            this.logger.error('Error during socket upgrade:');
            error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error during socket upgrade: ${error.message}`);
          }
        }
      },
      drain: (ws) => {
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
            error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error in drain callback from socket ${socketId}: ${error.message}`);
          }
        }
      },
      open: (ws) => { // eslint-disable-line no-unused-vars
        const socketId = ws.id;
        const { ip } = ws.credentials || {};
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
            error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
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
          const message = decode(data);
          if (message instanceof DataDump || message instanceof PeerDump || message instanceof ProviderDump || message instanceof ActiveProviderDump || message instanceof ReceiverDump || message instanceof PeerSubscriptionDump || message instanceof PeerSync || message instanceof PeerSyncResponse || message instanceof BraidEvent || message instanceof PublisherOpen || message instanceof PublisherClose || message instanceof PublisherPeerMessage || message instanceof MultipartContainer) {
            if (!this.peerSockets.hasSource(socketId)) {
              this.logger.error(`Received dump from non-peer at ${ws.credentials.ip ? ws.credentials.ip : 'unknown IP'} (${socketId})`);
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
        } catch (error) {
          if (error.stack) {
            this.logger.error(`Error when receiving message from socket ${socketId}:`);
            error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error when receiving socket message from socket ${socketId}: ${error.message}`);
          }
        }
      },
      close: (ws, code, data) => { // eslint-disable-line no-unused-vars
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
            this.peerSockets.removeSource(socketId);
            this.updatePeers();
            this.prunePeers();
          }
          this.sockets.delete(socketId);
          this.logger.info(`Closed socket at ${ws.credentials.ip ? ws.credentials.ip : 'unknown IP'} (${socketId}), code ${code}`);
          const { credentials } = ws;
          if (credentials && credentials.client) {
            this.emit('presence', credentials, false, socketId, false);
          }
          this.emit('close', socketId);
          delete ws.id; // eslint-disable-line no-param-reassign
          delete ws.credentials; // eslint-disable-line no-param-reassign
        } catch (error) {
          if (error.stack) {
            this.logger.error(`Error when receiving close event from socket ${socketId}:`);
            error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
          } else {
            this.logger.error(`Error when receiving close event from socket ${socketId}: ${error.message}`);
          }
        }
      },
    });
    uwsServer.ws(websocketPattern, options);
    this.setMaxListeners(0);
  }

  async handleMultipartContainer(multipartContainer:MultipartContainer, peerId: number) {
    const existingMergeChunksPromise = this.mergeChunkPromises.get(multipartContainer.id);
    if (typeof existingMergeChunksPromise !== 'undefined') {
      existingMergeChunksPromise.push(multipartContainer);
      return;
    }
    const mergeChunksPromise = MultipartContainer.getMergeChunksPromise(60000);
    mergeChunksPromise.push(multipartContainer);
    this.mergeChunkPromises.set(multipartContainer.id, mergeChunksPromise);
    try {
      const buffer = await mergeChunksPromise;
      const message = decode(buffer);
      this.handleMessage(message, peerId);
    } catch (error) {
      if (error.stack) {
        this.logger.error('Unable to merge multipart message chunks:');
        error.stack.split('\n').forEach((line) => this.logger.error(`\t${line}`));
      } else {
        this.logger.error(`Unable to merge multipart message chunks: ${error.message}`);
      }
    } finally {
      this.mergeChunkPromises.delete(multipartContainer.id);
    }
  }

  async waitForDrain(socketId:number) {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      throw new Error(`Can wait for socket ${socketId} to drain, socket does not exist`);
    }
    if (socket.getBufferedAmount() > MAX_PAYLOAD_LENGTH * 2) {
      await new Promise((resolve, reject) => {
        const [callbacks, errbacks] = this.drainCallbacks.get(socketId) || [[], []];
        callbacks.push(resolve);
        errbacks.push(reject);
        this.drainCallbacks.set(socketId, [callbacks, errbacks]);
      });
    }
  }

  emitToClients(name: string, ...args:Array<any>) {
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
  publishToPeers(obj:ProviderDump|DataDump|ActiveProviderDump|ReceiverDump|PeerDump|PeerSubscriptionDump|BraidEvent) {
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
  sendToPeer(peerId:number, obj:PublisherOpen|PublisherClose|PublisherPeerMessage) {
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
  setCredentialsHandler(func: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.credentialsHandler = func;
  }

  /**
   * Set the peer request handler. Approves or denies peer request handlers.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Peer request handler.
   * @return {void}
   */
  setPeerRequestHandler(func: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.peerRequestHandler = func;
  }

  /**
   * Set the subscribe request handler. Approves or denies subscribe requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Subscription request handler.
   * @return {void}
   */
  setSubscribeRequestHandler(func: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.subscribeRequestHandler = func;
  }

  /**
   * Set the event subscribe request handler. Approves or denies event subscribe requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Event subscription request handler.
   * @return {void}
   */
  setEventSubscribeRequestHandler(func: (name:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.eventSubscribeRequestHandler = func;
  }

  /**
   * Set the publish request handler. Approves or denies publish requests.
   * @param {(credentials: Object) => Promise<{ success: boolean, code: number, message: string }>} func - Publish request handler.
   * @return {void}
   */
  setPublishRequestHandler(func: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.publishRequestHandler = func;
  }

  /**
   * Top level handler for incoming credentials messages. Uses the default/custom credentialsHandler method to validate.
   * @param {number} socketId Socket ID from which the credentials were received
   * @param {Object} credentials Credentials object
   * @param {Object} newClientCredentials Credentials object provided by the client
   * @return {void}
   */
  handleCredentialsRequest(socketId: number, credentials: Object, newClientCredentials: Object) {
    let queue = this.socketCredentialQueues.get(socketId);
    if (!queue) {
      const newQueue = new PQueue({ concurrency: 1 });
      this.socketCredentialQueues.set(socketId, newQueue);
      queue = newQueue;
      setImmediate(() => {
        newQueue.onIdle().then(() => {
          this.socketCredentialQueues.delete(socketId);
        });
      });
    }
    queue.add(() => this._handleCredentialsRequest(socketId, credentials, newClientCredentials)); // eslint-disable-line no-underscore-dangle
  }

  async _handleCredentialsRequest(socketId: number, credentials: Object, newClientCredentials: Object) {
    const credentialsDidUpdate = !!credentials.client;
    if (credentialsDidUpdate) {
      this.emit('presence', credentials, false, socketId, credentialsDidUpdate);
      // Wait a tick for presence events
      await new Promise((resolve) => setImmediate(resolve));
    }
    const clientCredentials = credentials.client;
    if (typeof clientCredentials === 'undefined') {
      credentials.client = newClientCredentials; // eslint-disable-line  no-param-reassign
    } else {
      for (const key of Object.getOwnPropertyNames(clientCredentials)) {
        delete clientCredentials[key];
      }
      merge(clientCredentials, newClientCredentials);
    }
    let response;
    try {
      response = await this.credentialsHandler(credentials);
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
      this.emit('presence', credentials, true, socketId, credentialsDidUpdate);
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
  async handlePeerRequest(socketId: number, credentials: Object, peerId:number) {
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
    await this.waitForSocketCredentialQueue(socketId);
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
      this.addPeer(socketId, peerId);
      ws.send(getArrayBuffer(encode(unencoded)), true, false);
      this.syncPeerSocket(socketId, peerId);
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
  async handleSubscribeRequest(socketId:number, credentials:Object, key:string) {
    await this.waitForSocketCredentialQueue(socketId);
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
  async handleEventSubscribeRequest(socketId:number, credentials:Object, name:string) {
    await this.waitForSocketCredentialQueue(socketId);
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
  async handlePublishRequest(socketId:number, credentials:Object, key:string) {
    await this.waitForSocketCredentialQueue(socketId);
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
  handleMessage(message:DataDump|ProviderDump|ActiveProviderDump|ReceiverDump|PeerDump|PeerSubscriptionDump|PeerSync|PeerSyncResponse|BraidEvent|PublisherOpen|PublisherClose|PublisherPeerMessage|MultipartContainer, peerId:number) {
    if (message instanceof MultipartContainer) {
      this.handleMultipartContainer(message, peerId);
      return;
    } else if (message instanceof PeerSync) {
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
  publishEvent(name:string, args:Array<any>, id:string) {
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
  publishData(queue:[Array<*>, Array<*>]) {
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
  addEventSubscription(socketId:number, name:string) {
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
  removeEventSubscription(socketId:number, name:string) {
    this.eventSubscriptions.removeEdge(socketId, name);
  }

  /**
   * Remove all subscriptions from a socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the subscriber
   * @return {void}
   */
  removeEventSubscriptions(socketId:number) {
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
  addPublisher(socketId:number, key:string) {
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
  removePublisher(socketId:number, key:string) {
    this.publishers.removeEdge(socketId, key);
    this.unassignReceiver(key, socketId);
  }

  /**
   * Remove all receivers from a publisher socket, for example after the socket disconnects
   * @param {number} socketId Socket ID of the publisher
   * @return {void}
   */
  removePublishers(socketId:number) {
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
  addSubscription(socketId:number, key:string) {
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
  removeSubscription(socketId:number, key:string) {
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
  removeSubscriptions(socketId:number) {
    for (const key of this.subscriptions.getTargets(socketId)) {
      this.removeSubscription(socketId, key);
    }
  }

  /**
   * Assign a provider to a key.
   * @param {string} key Key to provide peers with updates, which peers will then disseminate to subscribers
   * @return {void}
   */
  assignProvider(key:string) {
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
  provide(regexString:string, callback: (key:string, active:boolean) => void|Promise<void>, options?: {debounce?: number} = {}) {
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
  unprovide(regexString:string) {
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
  assignReceiver(key:string, socketId: number) {
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
  unassignReceiver(key:string, socketId: number) {
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
  handlePublisherOpen(peerId:number, regexString:string, key:string, socketId:number, credentials:Object) {
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
  handlePublisherClose(key:string, socketId:number) {
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

  handlePublisherMessage(key:string, socketId:number, message:any) {
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

  handlePublisherPeerMessage(key:string, socketId:number, message:any) {
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
  receive(regexString:string, messageCallback?: (key:string, socketId: number, message: any,) => void|Promise<void>, openCallback?: (key:string, socketId: number, credentials:Object) => void|Promise<void>, closeCallback?: (key:string, socketId: number) => void|Promise<void>) {
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
  unreceive(regexString:string) {
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
  connectedPeers(id:number, peerIds:Set<number>) {
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
  removePeer(peerId: number) {
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
  addPeer(socketId:number, peerId:number) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not add peer with socket ID ${socketId}, socket does not exist`);
    }
    this.logger.info(`Adding peer ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) with ID ${peerId}`);
    this.peerSockets.addEdge(socketId, peerId);
    this.updatePeers();
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
    for (const [peerId, reconnectTimeout] of this.peerReconnectTimeouts) {
      this.logger.warn(`Clearing peer ${peerId} reconnect timeout during server close`);
      clearTimeout(reconnectTimeout);
    }
    this.peerReconnectTimeouts.clear();
    for (const [socketId, socket] of this.sockets) {
      this.logger.info(`Sending close event with code 1001 to socket ${socketId} during server close`);
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
  async connectToPeer(address:string, credentials?: Object, attempt?: number = 0) {
    this.logger.info(`Connecting to peer ${address}`);
    const peerConnection = new PeerConnection(this.id, address, credentials);
    const messageQueue = [];
    const queueMessages = (message:any) => {
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
    peerConnection.on('close', (code:number) => {
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
    peerConnection.on('message', (message:any) => {
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
  async disconnectFromPeer(peerId: number) {
    const peerConnection = this.peerConnections.get(peerId);
    this.peerConnections.delete(peerId);
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
        const handleClose = (sId:number) => {
          if (sId !== socketId) {
            return;
          }
          this.removeListener('error', handleError);
          this.removeListener('close', handleClose);
          resolve();
        };
        const handleError = (error:Error) => {
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
  reconnectToPeer(peerId:number, attempt: number, address:string, credentials?: Object) {
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
  handlePeerSync(peerSync: PeerSync) {
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
  async syncPeerConnection(peerId: number) {
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
      }, 60000);
      const handlePeerSyncReponse = (pId:number) => {
        if (pId !== peerId) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        resolve();
      };
      this.on('peerSyncResponse', handlePeerSyncReponse);
    });
    const message = encode(peerSync);
    if (message.length > MAX_PAYLOAD_LENGTH) {
      const chunkSize = Math.round(MAX_PAYLOAD_LENGTH / 2);
      const chunks = MultipartContainer.chunk(message, chunkSize);
      this.logger.info(`Sending ${message.length} byte peer sync response to peer ${peerId} connection in ${chunks.length} chunks`);
      for (const chunk of chunks) {
        peerConnection.ws.send(chunk);
      }
    } else {
      this.logger.info(`Sending ${message.length} byte peer sync response to peer ${peerId} connection`);
      peerConnection.ws.send(message);
    }
    try {
      await peerSyncResponsePromise;
      this.logger.info(`Received peer sync response from peer ${peerId}`);
      this.emit('peerSync', peerId);
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
  async syncPeerSocket(socketId: number, peerId: number) {
    const socket = this.sockets.get(socketId);
    if (!socket) {
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
      }, 60000);
      const handlePeerSyncReponse = (pId:number) => {
        if (pId !== peerId) {
          return;
        }
        clearTimeout(timeout);
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        resolve();
      };
      this.on('peerSyncResponse', handlePeerSyncReponse);
    });
    const message = encode(peerSync);
    if (message.length > MAX_PAYLOAD_LENGTH) {
      const chunkSize = Math.round(MAX_PAYLOAD_LENGTH / 2);
      const chunks = MultipartContainer.chunk(message, chunkSize);
      this.logger.info(`Sending ${message.length} byte peer sync response to peer ${peerId} at socket ${socketId} in ${chunks.length} chunks`);
      for (const chunk of chunks) {
        if (socket.getBufferedAmount() > MAX_BACKPRESSURE) {
          await this.waitForDrain(socketId);
        }
        socket.send(getArrayBuffer(chunk), true, false);
      }
    } else {
      this.logger.info(`Sending ${message.length} byte peer sync response to peer ${peerId} at socket ${socketId}`);
      socket.send(getArrayBuffer(message), true, false);
    }
    try {
      await peerSyncResponsePromise;
      this.logger.info(`Received peer sync response from peer ${peerId} at socket ${socketId}`);
      this.emit('peerSync', peerId);
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
  hasPeer(peerId: number) {
    return this.peerSockets.hasTarget(peerId) || this.peerConnections.has(peerId);
  }

  /**
   * Wait for any queued auth requests associated with the socket to complete
   * @param {number} socketId Socket ID
   * @return {void}
   */
  async waitForSocketCredentialQueue(socketId:number) {
    // Wait for any credential handler operations to complete
    const queue = this.socketCredentialQueues.get(socketId);
    if (queue) {
      this.logger.info(`Waiting for socket ${socketId} credential queue with size ${queue.size} and ${queue.pending} pending`);
      await queue.onIdle();
    }
  }

  declare isClosing: boolean;
  declare id: number;
  declare flushInterval: IntervalID;
  declare keyFlushInterval: IntervalID;
  declare mergeChunkPromises: Map<number, MergeChunksPromise>;
  declare messageHashes: LruCache<string, boolean>;
  declare eventSubscriptions: DirectedGraphMap<number, string>;
  declare subscriptions: DirectedGraphMap<number, string>;
  declare publishers: DirectedGraphMap<number, string>;
  declare peerSockets:DirectedGraphMap<number, number>;
  declare peerConnections:Map<number, PeerConnection>;
  declare sockets:Map<number, UWSWebSocket>;
  declare drainCallbacks:Map<number, [Array<() => void>, Array<(Error) => void>]>;
  declare socketCredentialQueues:Map<number, PQueue>;
  declare data:ObservedRemoveMap<string, any>;
  declare peers:ObservedRemoveMap<number, Array<number>>;
  declare providers:ObservedRemoveMap<number, Array<string>>;
  declare provideCallbacks:Map<string, (string, boolean) => void|Promise<void>>;
  declare provideOptions:Map<string, {debounce?: number}>;
  declare provideDebounceTimeouts:Map<string, TimeoutID>;
  declare activeProviders:ObservedRemoveMap<string, [number, string]>;
  declare receivers:ObservedRemoveMap<number, Array<string>>;
  declare receiveCallbacks:Map<string, [((string, number, any) => void|Promise<void>) | void, ((string, number, Object) => void|Promise<void>) | void, ((string, number) => void|Promise<void>) | void]>;
  declare receiveSessions: DirectedGraphMap<string, string>;
  declare publishSessions: DirectedGraphMap<string, string>;
  declare publisherPeers: DirectedGraphMap<string, number>;
  declare receiverPeers: DirectedGraphMap<string, number>;
  declare peerSubscriptions:ObservedRemoveSet<[number, string]>;
  declare peerSubscriptionMap:Map<string, Set<number>>;
  declare providerRegexes: Map<number, Array<[string, RegExp]>>;
  declare receiverRegexes: Map<number, Map<string, RegExp>>;
  declare peerRequestHandler: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  declare credentialsHandler: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  declare subscribeRequestHandler: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  declare publishRequestHandler: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  declare eventSubscribeRequestHandler: (name:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  declare keysForDeletion:Map<string, number>;
  declare peerReconnectTimeouts:Map<number, TimeoutID>;
  declare logger: {
    debug: (string) => void,
    info: (string) => void,
    warn: (string) => void,
    error: (string) => void
  };
}

module.exports = Server;
