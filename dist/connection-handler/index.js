//      

const crypto = require('crypto');
const farmhash = require('farmhash');
const { hash32 } = require('@bunchtogether/hash-object');
const { ObservedRemoveMap, ObservedRemoveSet } = require('observed-remove');
const DirectedGraphMap = require('directed-graph-map');
const LruCache = require('lru-cache');
const { EventEmitter } = require('events');
const PeerConnection = require('./peer-connection');
const logger = require('../logger')('Connection Handler');

const nanomatch = require('nanomatch');
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
  PeerRequest,
  PeerResponse,
  SubscribeRequest,
  SubscribeResponse,
  Unsubscribe,
} = require('../messagepack');
const {
  OPEN,
} = require('../constants');

function randomInteger() {
  return crypto.randomBytes(4).readUInt32BE(0, true);
}

class ConnectionHandler extends EventEmitter {
  constructor(server             , websocketPath         = '/*', websocketOptions          = { compression: 0, maxPayloadLength: 16 * 1024 * 1024, idleTimeout: 10 }) {
    super();
    this.messageHashes = new LruCache({ max: 500 });

    // Primary data object, used by all peers and partially shared with subscribers
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Peer connections map, each peer stores the peers it is connected to
    //   Key: Peer ID
    //   Value: Array of peer IDs
    this.peers = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Provider map, each peer stores globs it can provide data for
    //   Key: Peer ID
    //   Value: Array of globs
    this.providers = new ObservedRemoveMap([], { bufferPublishing: 0 });

    // Active provider map for each key
    //   Key: key
    //   Value: Peer ID
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
    //   Value: Matcher function
    this.providerMatchers = new Map();

    // Callbacks for providing / unproviding
    //   Key: glob
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

    this.id = randomInteger();
    this.isClosing = false;

    this.setCredentialsHandler(async (credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setPeerRequestHandler(async (credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setSubscribeRequestHandler(async (key       , credentials        ) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.data.on('publish', (queue                     ) => {
      this.publishDumpToPeers(new DataDump(queue, [this.id]));
      this.publishData(queue);
    });
    this.providers.on('publish', (queue                     ) => {
      this.publishDumpToPeers(new ProviderDump(queue, [this.id]));
    });
    this.activeProviders.on('publish', (queue                     ) => {
      this.publishDumpToPeers(new ActiveProviderDump(queue, [this.id]));
    });
    this.peers.on('publish', (queue                     ) => {
      this.publishDumpToPeers(new PeerDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('publish', (queue                     ) => {
      this.publishDumpToPeers(new PeerSubscriptionDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('add', ([peerId, key]) => {
      let peerIds = this.peerSubscriptionMap.get(key);
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
      }
    });
    this.peers.on('set', (peerId, peerIds, previousPeerIds) => {
      if (this.id !== peerId && peerIds && previousPeerIds && peerIds.length < previousPeerIds.length) {
        this.prunePeers();
      }
    });
    this.activeProviders.on('set', (key       , [peerId       , glob       ], previousPeerIdAndGlob                   ) => {
      if (this.id === peerId) {
        const callback = this.provideCallbacks.get(glob);
        if (!callback) {
          this.unprovide(glob);
          return;
        }
        callback(key, true);
      } else if (previousPeerIdAndGlob) {
        const [previousPeerId, previousGlob] = previousPeerIdAndGlob;
        if (previousPeerId !== peerId) {
          return;
        }
        const callback = this.provideCallbacks.get(previousGlob);
        if (!callback) {
          this.unprovide(previousGlob);
          return;
        }
        callback(key, false);
      }
    });
    this.activeProviders.on('delete', (key       , [peerId       , glob       ]) => {
      if (this.id === peerId) {
        const callback = this.provideCallbacks.get(glob);
        if (!callback) {
          this.unprovide(glob);
          return;
        }
        callback(key, false);
      }
    });
    this.providers.on('set', (peerId       , globs              ) => {
      this.providerMatchers.set(peerId, globs.map((glob) => [glob, nanomatch.matcher(glob)]));
    });
    this.providers.on('delete', (peerId       ) => {
      this.providerMatchers.delete(peerId);
    });
    const options = Object.assign({}, websocketOptions, {
      open: (ws, req) => { // eslint-disable-line no-unused-vars
        const socketId = randomInteger();
        ws.id = socketId; // eslint-disable-line no-param-reassign
        this.sockets.set(socketId, ws);
        this.emit(OPEN, socketId);
        logger.info(`${socketId}: Connected`);
      },
      message: async (ws, data, isBinary) => {
        const socketId = ws.id;
        if (!socketId) {
          logger.error('Received message without socket ID');
          return;
        }
        if (!isBinary) {
          logger.error(`${socketId}: Sent non-binary message: ${data.toString()}`);
          return;
        }
        const message = decode(data);
        if (message instanceof DataDump || message instanceof PeerDump || message instanceof ProviderDump || message instanceof ActiveProviderDump || message instanceof PeerSubscriptionDump) {
          if (!this.peerSockets.hasSource(socketId)) {
            logger.error(`${socketId}: Sent dump but is not a peer`);
            return;
          }
          this.handleMessage(message);
        }
        if (this.isClosing) {
          return;
        }
        if (message instanceof Credentials) {
          logger.info(`${socketId}: Sent credentials`);
          const credentials = { client: message.value };
          const response = await this.credentialsHandler(credentials);
          if (response.success) {
            ws.credentials = credentials; // eslint-disable-line no-param-reassign
          }
          const unencoded = new CredentialsResponse({ success: response.success, code: response.code, message: response.message });
          ws.send(getArrayBuffer(encode(unencoded)), true, false);
        } else if (message instanceof PeerRequest) {
          const peerId = message.value;
          if (this.peerConnections.has(peerId)) {
            logger.error(`${socketId}: Connection to peer ${peerId} already exists`);
            const unencoded = new PeerResponse({ success: false, code: 400, message: `Connection to peer ${peerId} already exists` });
            ws.send(getArrayBuffer(encode(unencoded)), true, false);
            return;
          }
          if (this.peerSockets.hasTarget(peerId)) {
            logger.error(`${socketId}: Socket to peer ${peerId} already exists`);
            const unencoded = new PeerResponse({ success: false, code: 400, message: `Socket to peer ${peerId} already exists` });
            ws.send(getArrayBuffer(encode(unencoded)), true, false);
            return;
          }
          const response = await this.peerRequestHandler(ws.credentials);
          if (response.success) {
            const unencoded = new PeerResponse({ id: this.id, success: true, code: response.code, message: response.message });
            ws.send(getArrayBuffer(encode(unencoded)), true, false);
            this.addPeer(socketId, peerId);
          } else {
            const unencoded = new PeerResponse({ success: false, code: response.code, message: response.message });
            ws.send(getArrayBuffer(encode(unencoded)), true, false);
          }
        } else if (message instanceof SubscribeRequest) {
          const response = await this.subscribeRequestHandler(message.value, ws.credentials);
          if (response.success) {
            this.addSubscription(socketId, message.value);
          }
          const unencoded = new SubscribeResponse({ key: message.value, success: response.success, code: response.code, message: response.message });
          ws.send(getArrayBuffer(encode(unencoded)), true, false);
        } else if (message instanceof Unsubscribe) {
          this.removeSubscription(socketId, message.value);
        }
      },
      close: (ws, code, data) => { // eslint-disable-line no-unused-vars
        const socketId = ws.id;
        if (!socketId) {
          logger.error('Received close without socket ID');
          return;
        }
        this.removeSubscriptions(socketId);
        if (this.peerSockets.hasSource(socketId)) {
          this.peerSockets.removeSource(socketId);
          this.updatePeers();
          this.prunePeers();
        }
        this.sockets.delete(socketId);
        logger.info(`${socketId}: Closed with code ${code}`);
      },
    });
    server.ws(websocketPath, options);
  }

  throwOnLeakedReferences() {
    if (this.sockets.size > 0) {
      throw new Error(`${this.id}: ${this.sockets.size} referenced sockets`);
    }
    if (this.peerSockets.size > 0) {
      throw new Error(`${this.id}: ${this.peerSockets.size} referenced peer sockets`);
    }
    if (this.peerConnections.size > 0) {
      throw new Error(`${this.peerConnections.size} referenced peer connections`);
    }
    if (this.peers.size > 0) {
      throw new Error(`${this.id}: ${this.peers.size} referenced peers`);
    }
    if (this.providers.size > 0) {
      throw new Error(`${this.providers.size} referenced providers`);
    }
    if (this.providerMatchers.size > 0) {
      throw new Error(`${this.providerMatchers.size} referenced provider matchers`);
    }
    if (this.subscriptions.size > 0) {
      throw new Error(`${this.subscriptions.size} referenced peer subscriptions`);
    }
    if (this.peerSubscriptions.size > 0) {
      throw new Error(`${this.peerSubscriptions.size} referenced subscribers`);
    }
    if (this.activeProviders.size > 0) {
      throw new Error(`${this.activeProviders.size} referenced activeProviders`);
    }
  }

  publishDumpToPeers(dump                                                                       ) {
    const peerIds = dump.ids;
    const peerSockets = [];
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
        peerSockets.push(peerConnection.ws);
      }
    }
    if (peerSockets.length === 0 && peerUWSSockets.length === 0) {
      return;
    }
    const encoded = encode(dump);
    for (const ws of peerSockets) {
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

  setCredentialsHandler(func                                                                                       ) { // eslint-disable-line no-unused-vars
    this.credentialsHandler = func;
  }

  setPeerRequestHandler(func                                                                                       ) { // eslint-disable-line no-unused-vars
    this.peerRequestHandler = func;
  }

  setSubscribeRequestHandler(func                                                                                                   ) { // eslint-disable-line no-unused-vars
    this.subscribeRequestHandler = func;
  }

  addPeer(socketId       , peerId       ) {
    logger.info(`Adding peer ${socketId}:${peerId}`);
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not add peer with socket ID ${socketId}, socket does not exist`);
    }
    logger.info(`${socketId}: Peered ${this.id}:${peerId}`);
    this.peerSockets.addEdge(socketId, peerId);
    if (this.data.size > 0) {
      ws.send(getArrayBuffer(encode(new DataDump(this.data.dump(), [this.id]))), true, false);
    }
    if (this.providers.size > 0) {
      ws.send(getArrayBuffer(encode(new ProviderDump(this.providers.dump(), [this.id]))), true, false);
    }
    if (this.activeProviders.size > 0) {
      ws.send(getArrayBuffer(encode(new ActiveProviderDump(this.activeProviders.dump(), [this.id]))), true, false);
    }
    if (this.peers.size > 0) {
      ws.send(getArrayBuffer(encode(new PeerDump(this.peers.dump(), [this.id]))), true, false);
    }
    this.updatePeers();
  }

  handleMessage(message                                                                       ) {
    const hash = hash32(message.queue);
    if (this.messageHashes.has(hash)) {
      return;
    }
    this.messageHashes.set(hash, true);
    if (message instanceof DataDump) {
      this.data.process(message.queue);
      this.publishData(message.queue);
    } else if (message instanceof PeerSubscriptionDump) {
      this.peerSubscriptions.process(message.queue);
    } else if (message instanceof ProviderDump) {
      this.providers.process(message.queue);
    } else if (message instanceof ActiveProviderDump) {
      this.activeProviders.process(message.queue);
    } else if (message instanceof PeerDump) {
      this.peers.process(message.queue);
    }
    this.publishDumpToPeers(message);
  }

  publishData(queue                     ) {
    const insertions = new Map();
    const deletions = new Map();
    const subscriptionMap = new Map();
    for (const [key, valuePair] of queue[0]) {
      insertions.set(key, valuePair);
      for (const socketId of this.subscriptions.getSources(key)) {
        let subscriptions = subscriptionMap.get(socketId);
        if (!subscriptions) {
          subscriptions = [];
          subscriptionMap.set(socketId, subscriptions);
        }
        subscriptions.push(key);
      }
    }
    for (const [valueId, key] of queue[1]) {
      deletions.set(key, valueId);
      for (const socketId of this.subscriptions.getSources(key)) {
        let subscriptions = subscriptionMap.get(socketId);
        if (!subscriptions) {
          subscriptions = [];
          subscriptionMap.set(socketId, subscriptions);
        }
        subscriptions.push(key);
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

  addSubscription(socketId       , key       ) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not add subscriber with socket ID ${socketId} for key ${key}, socket does not exist`);
    }
    this.subscriptions.addEdge(socketId, key);
    if (!this.peerSubscriptions.has([this.id, key])) {
      this.peerSubscriptions.add([this.id, key]);
    }
    this.assignProvider(key);
  }

  assignProvider(key       ) {
    if (this.activeProviders.has(key)) {
      return;
    }
    const peerIdAndGlobs = [];
    for (const [peerId, matchers] of this.providerMatchers) {
      for (const [glob, isMatch] of matchers) {
        if (isMatch(key)) {
          peerIdAndGlobs.push([peerId, glob]);
          break;
        }
      }
    }
    if (peerIdAndGlobs.length === 0) {
      logger.error(`Unable to find provider for ${key}`);
      return;
    }
    peerIdAndGlobs.sort((x, y) => (x[0] > y[0] ? 1 : -1));
    const peerIdAndGlob = peerIdAndGlobs[farmhash.hash32(key) % peerIdAndGlobs.length];
    this.activeProviders.set(key, peerIdAndGlob);
  }

  removeSubscription(socketId       , key       ) {
    this.subscriptions.removeEdge(socketId, key);
    if (this.subscriptions.getTargets(key).size === 0) {
      this.peerSubscriptions.delete([this.id, key]);
    }
  }

  removeSubscriptions(socketId       ) {
    for (const key of this.subscriptions.getTargets(socketId)) {
      this.removeSubscription(socketId, key);
    }
  }

  provide(glob       , callback                                      ) {
    logger.info(`Providing ${glob}`);
    const globs = new Set(this.providers.get(this.id));
    globs.add(glob);
    this.providers.set(this.id, [...globs]);
    this.provideCallbacks.set(glob, callback);
  }

  unprovide(glob       ) {
    logger.info(`Unproviding ${glob}`);
    const globs = new Set(this.providers.get(this.id));
    globs.delete(glob);
    this.provideCallbacks.delete(glob);
    if (globs.size > 0) {
      this.providers.set(this.id, [...globs]);
    } else {
      this.providers.delete(this.id);
    }
    for (const [key, [peerId, activeGlob]] of this.activeProviders) {
      if (glob === activeGlob && peerId === this.id) {
        this.activeProviders.delete(key);
        this.assignProvider(key);
      }
    }
  }

  async closePeerConnections() {
    await Promise.all([...this.peerConnections.values()].map((peerConnection) => peerConnection.close()));
  }

  updatePeers() {
    const peerIds = [...this.peerConnections.keys(), ...this.peerSockets.targets];
    this.peers.set(this.id, peerIds);
  }

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

  prunePeers() {
    const connectedPeerIds = new Set();
    const disconnectedPeerIds = new Set();
    this.connectedPeers(this.id, connectedPeerIds);
    for (const peerId of this.peers.keys()) {
      if (!connectedPeerIds.has(peerId)) {
        disconnectedPeerIds.add(peerId);
      }
    }
    disconnectedPeerIds.forEach((peerId) => this.disconnectFromPeer(peerId));
  }

  disconnectFromPeer(peerId        ) {
    logger.info(`Disconnecting from peer ${peerId}`);
    this.peers.delete(peerId);
    this.providers.delete(peerId);
    this.providerMatchers.delete(peerId);
    for (const [pId, key] of this.peerSubscriptions) {
      if (pId === peerId) {
        this.peerSubscriptions.delete([pId, key]);
      }
    }
    for (const [key, pId] of this.activeProviders) {
      if (pId === peerId) {
        this.activeProviders.delete(key);
        this.assignProvider(key);
      }
    }
  }

  async close() {
    logger.info('Closing');
    await this.closePeerConnections();
    for (const socket of this.sockets.values()) {
      socket.end(1000, 'Shutting down');
    }
    const timeout = Date.now() + 10000;
    while (this.sockets.size > 0 && Date.now() < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() > timeout) {
      logger.warn('Closed after timeout');
    } else {
      logger.info('Closed');
    }
  }

  async connectToPeer(address       , credentials         ) {
    const peerConnection = new PeerConnection(this.id, address, credentials);
    const peerId = await peerConnection.open();
    if (this.peerConnections.has(peerId)) {
      await peerConnection.close();
      logger.error(`Connection to peer ${peerId} already exists`);
      throw new Error(`Connection to peer ${peerId} already exists`);
    }
    if (this.peerSockets.hasTarget(peerId)) {
      await peerConnection.close();
      logger.error(`Socket to peer ${peerId} already exists`);
      throw new Error(`Socket to peer ${peerId} already exists`);
    }
    peerConnection.on('close', () => {
      this.peerConnections.delete(peerId);
      this.updatePeers();
      this.prunePeers();
    });
    peerConnection.on('message', (message    ) => {
      this.handleMessage(message);
    });
    this.peerConnections.set(peerId, peerConnection);
    this.updatePeers();
    if (peerConnection.ws.readyState === 1) {
      if (this.data.size > 0) {
        peerConnection.ws.send(encode(new DataDump(this.data.dump(), [this.id])));
      }
      if (this.providers.size > 0) {
        peerConnection.ws.send(encode(new ProviderDump(this.providers.dump(), [this.id])));
      }
      if (this.activeProviders.size > 0) {
        peerConnection.ws.send(encode(new ActiveProviderDump(this.activeProviders.dump(), [this.id])));
      }
      if (this.peers.size > 0) {
        peerConnection.ws.send(encode(new PeerDump(this.peers.dump(), [this.id])));
      }
    }
  }

                     
             
                          
                                                 
                                               
                                              
                                    
                                      
                                                 
                                                     
                                                          
                                                              
                                              
                                               
                                                                      
                                                                                                            
                                                                                                            
                                                                                                                             
}

module.exports = ConnectionHandler;
