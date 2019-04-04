// @flow

import type { UWSTemplatedApp, UWSWebSocket } from './uWebSockets';

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
} = require('@bunchtogether/braid-messagepack');

const {
  OPEN,
} = require('./constants');

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
  constructor(uwsServer:UWSTemplatedApp, websocketPattern?:string = '/*', websocketBehavior?: Object = { compression: 0, maxPayloadLength: 8 * 1024 * 1024, idleTimeout: 10 }) {
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

    this.id = randomInteger();

    this.logger = makeLogger(`Braid Server ${this.id}`);

    this.isClosing = false;

    this.flushInterval = setInterval(() => {
      this.data.flush();
      this.peers.flush();
      this.providers.flush();
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
    });
    this.peerSubscriptions.on('delete', ([peerId, key]) => {
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
        callback(key, true);
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
      this.providerRegexes.set(peerId, regexStrings.map((regexString) => [regexString, new RegExp(regexString)]));
    });
    this.providers.on('delete', (peerId:number) => {
      this.providerRegexes.delete(peerId);
    });
    const options = Object.assign({}, websocketBehavior, {
      open: (ws, req) => { // eslint-disable-line no-unused-vars
        const socketId = randomInteger();
        ws.id = socketId; // eslint-disable-line no-param-reassign
        ws.credentials = { // eslint-disable-line no-param-reassign
          ip: requestIp(ws, req),
        };
        this.sockets.set(socketId, ws);
        this.emit(OPEN, socketId);
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
        if (message instanceof DataDump || message instanceof PeerDump || message instanceof ProviderDump || message instanceof ActiveProviderDump || message instanceof PeerSubscriptionDump || message instanceof PeerSync || message instanceof PeerSyncResponse || message instanceof BraidEvent) {
          if (!this.peerSockets.hasSource(socketId)) {
            this.logger.error(`Received dump from non-peer ${ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId})`);
            return;
          }
          this.handleMessage(message);
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
        }
      },
      close: (ws, code, data) => { // eslint-disable-line no-unused-vars
        const socketId = ws.id;
        if (!socketId) {
          this.logger.error('Received close without socket ID');
          return;
        }
        this.removeSubscriptions(socketId);
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
        delete ws.id; // eslint-disable-line no-param-reassign
        delete ws.credentials; // eslint-disable-line no-param-reassign
      },
    });
    uwsServer.ws(websocketPattern, options);
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
      console.log(this.id, [...this.peers]);
      throw new Error(`${this.id}: ${this.peers.size} referenced peers`);
    }
    if (this.providers.size > 0) {
      console.log(this.id, [...this.providers]);
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
      throw new Error(`${this.id}: ${this.activeProviders.size} referenced activeProviders`);
    }
  }

  /**
   * Publish objects to peers.
   * @param {ProviderDump|DataDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump} obj - Object to send, should have "ids" property
   * @return {void}
   */
  publishToPeers(obj:ProviderDump|DataDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump|BraidEvent) {
    const peerIds = obj.ids;
    const peerConnections = [];
    const peerUWSSockets = [];
    for (const [socketId, peerId] of this.peerSockets.edges) {
      if (this.peerConnections.has(peerId)) {
        continue;
      }
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
    for (const [peerId, peerConnection] of this.peerConnections) {
      if (peerIds.includes(peerId)) {
        continue;
      }
      if (peerConnection.ws.readyState === 1) {
        peerIds.push(peerId);
        peerConnections.push(peerConnection.ws);
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
   * Top level handler for incoming credentials messages. Uses the default/custom credentialsHandler method to validate.
   * @param {number} socketId Socket ID from which the credentials were received
   * @param {Object} existingCredentials Existing credentials object
   * @param {Object} clientCredentials Credentials object provided by the client
   * @return {void}
   */
  async handleCredentialsRequest(socketId: number, existingCredentials: Object, clientCredentials: Object) {
    const credentials = Object.assign({}, existingCredentials, { client: clientCredentials });
    await this.credentialsHandlerPromises.get(socketId);
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
  async handlePeerRequest(socketId: number, credentials: Object, peerId:number) {
    if (this.peerConnections.has(peerId)) {
      const wsA = this.sockets.get(socketId);
      if (!wsA) {
        this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
        return;
      }
      this.logger.error(`Peer request from ${wsA.credentials && wsA.credentials.ip ? wsA.credentials.ip : 'with unknown IP'} (${socketId}) rejected, connection to peer ${peerId} already exists`);
      const unencoded = new PeerResponse({ success: false, code: 400, message: `Connection to peer ${peerId} already exists` });
      wsA.send(getArrayBuffer(encode(unencoded)), true, false);
      return;
    }
    if (this.peerSockets.hasTarget(peerId)) {
      const wsA = this.sockets.get(socketId);
      if (!wsA) {
        this.logger.error(`Cannot respond to peer request from socket ID ${socketId}, socket does not exist`);
        return;
      }
      this.logger.error(`Peer request from ${wsA.credentials && wsA.credentials.ip ? wsA.credentials.ip : 'with unknown IP'} (${socketId}) rejected, connection to peer ${peerId} already exists`);
      const unencoded = new PeerResponse({ success: false, code: 400, message: `Socket to peer ${peerId} already exists` });
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
  async handleSubscribeRequest(socketId:number, credentials:Object, key:string) {
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
  async handleEventSubscribeRequest(socketId:number, credentials:Object, name:string) {
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
   * Top level message handler, used by both sockets and connections.
   * @param {DataDump|ProviderDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump|PeerSync|PeerSyncResponse|BraidEvent} message Message to handle
   * @return {void}
   */
  handleMessage(message:DataDump|ProviderDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump|PeerSync|PeerSyncResponse|BraidEvent) {
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
      const insertionQueue = [[key, pair]];
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
    if (this.subscriptions.getTargets(key).size === 0) {
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
      this.logger.error(`Unable to find provider for "${key}"`);
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
  provide(regexString:string, callback: (key:string, active:boolean) => void|Promise<void>) {
    const regexStrings = new Set(this.providers.get(this.id));
    regexStrings.add(regexString);
    this.providers.set(this.id, [...regexStrings]);
    this.provideCallbacks.set(regexString, callback);
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
   * Close all outgoing peer connections.
   * @return {Promise<void>}
   */
  async closePeerConnections() {
    await Promise.all([...this.peerConnections.values()].map((peerConnection) => peerConnection.close()));
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
    this.syncPeerSocket(socketId, peerId);
  }

  /**
   * Stops the server by gracefully closing all sockets and outgoing connections
   * @return {Promise<void>}
   */
  async close() {
    this.logger.info('Closing');
    this.isClosing = true;
    await this.closePeerConnections();
    for (const socket of this.sockets.values()) {
      socket.end(1000, 'Shutting down');
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
    this.isClosing = false;
    clearInterval(this.flushInterval);
    clearInterval(this.keyFlushInterval);
  }

  /**
   * Connects to a peer
   * @param {string} address Websocket URL of the peer
   * @param {Object} [credentials] Credentials to send during the peer request
   * @return {Promise<void>}
   */
  async connectToPeer(address:string, credentials?: Object) {
    this.logger.info(`Connecting to peer ${address}`);
    const peerConnection = new PeerConnection(this.id, address, credentials);
    peerConnection.on('close', () => {
      this.logger.info(`Connection to ${address} with peer ID ${peerId} closed`);
      this.peerConnections.delete(peerId);
      this.updatePeers();
      this.prunePeers();
    });
    const messageQueue = [];
    const queueMessages = (message:any) => {
      messageQueue.push(message);
    };
    peerConnection.on('message', queueMessages);
    const peerId = await peerConnection.open();
    if (this.peerConnections.has(peerId)) {
      await peerConnection.close();
      this.logger.error(`Closing connection to ${address}, connection to peer ${peerId} already exists`);
      throw new Error(`Connection to peer ${peerId} already exists`);
    }
    if (this.peerSockets.hasTarget(peerId)) {
      await peerConnection.close();
      this.logger.info(`Closing connection to ${address}, socket with peer ${peerId} already exists`);
      throw new Error(`Socket to peer ${peerId} already exists`);
    }
    this.peerConnections.set(peerId, peerConnection);
    peerConnection.removeListener('message', queueMessages);
    peerConnection.on('message', (message:any) => {
      this.handleMessage(message);
    });
    for (const message of messageQueue) {
      this.handleMessage(message);
    }
    this.updatePeers();
    this.logger.info(`Connected to ${address} with peer ID ${peerId}`);
    await this.syncPeerConnection(peerId);
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
      new ActiveProviderDump(this.activeProviders.dump()),
      new PeerSubscriptionDump(this.peerSubscriptions.dump()),
    );
    const peerSyncResponsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        reject(new Error(`Timeout waiting for sync response from peer ${peerId}`));
      }, 5000);
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
  async syncPeerSocket(socketId: number, peerId: number) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not publish data to peer ${peerId} (${socketId}), socket does not exist`);
    }
    const peerSync = new PeerSync(
      this.id,
      new DataDump(this.data.dump()),
      new PeerDump(this.peers.dump()),
      new ProviderDump(this.providers.dump()),
      new ActiveProviderDump(this.activeProviders.dump()),
      new PeerSubscriptionDump(this.peerSubscriptions.dump()),
    );
    const peerSyncResponsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('peerSyncResponse', handlePeerSyncReponse);
        reject(new Error(`Timeout waiting for sync response from peer ${peerId}`));
      }, 5000);
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

  isClosing: boolean;
  id: number;
  flushInterval: IntervalID;
  keyFlushInterval: IntervalID;
  messageHashes: LruCache<number, boolean>;
  eventSubscriptions: DirectedGraphMap<number, string>;
  subscriptions: DirectedGraphMap<number, string>;
  peerSockets:DirectedGraphMap<number, number>;
  peerConnections:Map<number, PeerConnection>;
  sockets:Map<number, UWSWebSocket>;
  data:ObservedRemoveMap<string, any>;
  peers:ObservedRemoveMap<number, Array<number>>;
  providers:ObservedRemoveMap<number, Array<string>>;
  provideCallbacks:Map<string, (string, boolean) => void|Promise<void>>;
  activeProviders:ObservedRemoveMap<string, [number, string]>;
  peerSubscriptions:ObservedRemoveSet<[number, string]>;
  peerSubscriptionMap:Map<number, Set<number>>;
  providerRegexes: Map<number, Array<[string, RegExp]>>;
  credentialsHandlerPromises: Map<number, Promise<void>>;
  peerRequestHandler: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  credentialsHandler: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  subscribeRequestHandler: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  eventSubscribeRequestHandler: (name:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  keysForDeletion:Map<string, number>;
  logger: {
    debug: (string) => void,
    info: (string) => void,
    warn: (string) => void,
    error: (string) => void
  };
}

module.exports = Server;
