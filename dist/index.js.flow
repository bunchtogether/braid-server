// @flow

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
} = require('@bunchtogether/braid-messagepack');

const {
  OPEN,
} = require('./constants');

function randomInteger() {
  return crypto.randomBytes(4).readUInt32BE(0, true);
}

class Server extends EventEmitter {
  constructor(uwsServer:TemplatedApp, websocketPath?:string = '/*', websocketOptions?: Object = { compression: 0, maxPayloadLength: 8 * 1024 * 1024, idleTimeout: 10 }) {
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

    this.setCredentialsHandler(async (credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setPeerRequestHandler(async (credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.setSubscribeRequestHandler(async (key:string, credentials: Object) => // eslint-disable-line no-unused-vars
      ({ success: true, code: 200, message: 'OK' }),
    );
    this.data.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishDumpToPeers(new DataDump(queue, [this.id]));
      this.publishData(queue);
    });
    this.providers.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishDumpToPeers(new ProviderDump(queue, [this.id]));
    });
    this.activeProviders.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishDumpToPeers(new ActiveProviderDump(queue, [this.id]));
    });
    this.peers.on('publish', (queue:[Array<*>, Array<*>]) => {
      this.publishDumpToPeers(new PeerDump(queue, [this.id]));
    });
    this.peerSubscriptions.on('publish', (queue:[Array<*>, Array<*>]) => {
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
    const options = Object.assign({}, websocketOptions, {
      open: (ws, req) => { // eslint-disable-line no-unused-vars
        const socketId = randomInteger();
        ws.id = socketId; // eslint-disable-line no-param-reassign
        ws.credentials = {}; // eslint-disable-line no-param-reassign
        ws.credentials.ip = requestIp(ws, req); // eslint-disable-line no-param-reassign
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
        if (message instanceof DataDump || message instanceof PeerDump || message instanceof ProviderDump || message instanceof ActiveProviderDump || message instanceof PeerSubscriptionDump || message instanceof PeerSync || message instanceof PeerSyncResponse) {
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
        }
      },
      close: (ws, code, data) => { // eslint-disable-line no-unused-vars
        const socketId = ws.id;
        if (!socketId) {
          this.logger.error('Received close without socket ID');
          return;
        }
        this.removeSubscriptions(socketId);
        if (this.peerSockets.hasSource(socketId)) {
          this.peerSockets.removeSource(socketId);
          this.updatePeers();
          this.prunePeers();
        }
        this.sockets.delete(socketId);
        this.logger.info(`Closed socket with ${ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}), code ${code}`);
        delete ws.id; // eslint-disable-line no-param-reassign
        delete ws.credentials; // eslint-disable-line no-param-reassign
      },
    });
    uwsServer.ws(websocketPath, options);
  }

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
      throw new Error(`${this.id}: ${this.subscriptions.size} referenced peer subscriptions`);
    }
    if (this.peerSubscriptions.size > 0) {
      throw new Error(`${this.id}: ${this.peerSubscriptions.size} referenced subscribers`);
    }
    if (this.activeProviders.size > 0) {
      throw new Error(`${this.id}: ${this.activeProviders.size} referenced activeProviders`);
    }
  }

  publishDumpToPeers(dump:ProviderDump|DataDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump) {
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

  setCredentialsHandler(func: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.credentialsHandler = func;
  }

  setPeerRequestHandler(func: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.peerRequestHandler = func;
  }

  setSubscribeRequestHandler(func: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>) { // eslint-disable-line no-unused-vars
    this.subscribeRequestHandler = func;
  }

  async handleCredentialsRequest(socketId: number, existingCredentials: Object, clientCredentials: Object) {
    const credentials = Object.assign({}, existingCredentials, { client: clientCredentials });
    const response = await this.credentialsHandler(credentials);
    const ws = this.sockets.get(socketId);
    if (!ws) {
      this.logger.error(`Cannot respond to credentials request from socket ID ${socketId}, socket does not exist`);
      return;
    }
    if (response.success) {
      this.logger.info(`Credentials from ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) accepted`);
      ws.credentials = credentials; // eslint-disable-line no-param-reassign
    } else {
      this.logger.info(`Credentials from ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) rejected`);
    }
    const unencoded = new CredentialsResponse({ success: response.success, code: response.code, message: response.message });
    ws.send(getArrayBuffer(encode(unencoded)), true, false);
  }

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
    const response = await this.peerRequestHandler(credentials);
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

  async handleSubscribeRequest(socketId:number, credentials:Object, key:string) {
    const response = await this.subscribeRequestHandler(key, credentials);
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

  async addPeer(socketId:number, peerId:number) {
    const ws = this.sockets.get(socketId);
    if (!ws) {
      throw new Error(`Can not add peer with socket ID ${socketId}, socket does not exist`);
    }
    this.logger.info(`Adding peer ${ws.credentials && ws.credentials.ip ? ws.credentials.ip : 'with unknown IP'} (${socketId}) with ID ${peerId}`);
    this.peerSockets.addEdge(socketId, peerId);
    this.updatePeers();
    this.syncPeerSocket(socketId, peerId);
  }

  handleMessage(message:DataDump|ProviderDump|ActiveProviderDump|PeerDump|PeerSubscriptionDump|PeerSync|PeerSyncResponse) {
    if (message instanceof PeerSync) {
      this.handlePeerSync(message);
      return;
    } else if (message instanceof PeerSyncResponse) {
      this.emit('peerSyncResponse', message.value);
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
    this.publishDumpToPeers(message);
  }

  publishData(queue:[Array<*>, Array<*>]) {
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

  addSubscription(socketId:number, key:string) {
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

  removeSubscription(socketId:number, key:string) {
    this.subscriptions.removeEdge(socketId, key);
    if (this.subscriptions.getTargets(key).size === 0) {
      this.peerSubscriptions.delete([this.id, key]);
    }
  }

  removeSubscriptions(socketId:number) {
    for (const key of this.subscriptions.getTargets(socketId)) {
      this.removeSubscription(socketId, key);
    }
  }

  provide(regexString:string, callback: (key:string, active:boolean) => void) {
    const regexStrings = new Set(this.providers.get(this.id));
    regexStrings.add(regexString);
    this.providers.set(this.id, [...regexStrings]);
    this.provideCallbacks.set(regexString, callback);
  }

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

  async closePeerConnections() {
    await Promise.all([...this.peerConnections.values()].map((peerConnection) => peerConnection.close()));
  }

  updatePeers() {
    const peerIds = [...this.peerConnections.keys(), ...this.peerSockets.targets];
    this.peers.set(this.id, peerIds);
  }

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
    disconnectedPeerIds.forEach((peerId) => this.disconnectFromPeer(peerId));
  }

  disconnectFromPeer(peerId: number) {
    this.peers.delete(peerId);
    this.providers.delete(peerId);
    this.providerRegexes.delete(peerId);
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
    this.disconnectFromPeer(this.id);
    if (Date.now() > timeout) {
      this.logger.warn('Closed after timeout');
    } else {
      this.logger.info('Closed');
    }
    this.isClosing = false;
    clearInterval(this.flushInterval);
  }

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

  handlePeerSync(peerSync: PeerSync) {
    this.data.process(peerSync.data.queue, true);
    this.peers.process(peerSync.peers.queue, true);
    this.providers.process(peerSync.providers.queue, true);
    this.activeProviders.process(peerSync.activeProviders.queue, true);
    this.peerSubscriptions.process(peerSync.peerSubscriptions.queue, true);
    const peerConnection = this.peerConnections.get(peerSync.id);
    if (peerConnection) {
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
      this.logger.error(error.message);
    }
  }

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
      this.logger.error(error.message);
    }
  }

  isClosing: boolean;
  id: number;
  flushInterval: IntervalID;
  messageHashes: LruCache;
  subscriptions:DirectedGraphMap<string, string>;
  peerSockets:DirectedGraphMap<number, number>;
  peerConnections:Map<number, PeerConnection>;
  sockets:Map<number, UWSWebSocket>;
  data:ObservedRemoveMap<string, any>;
  peers:ObservedRemoveMap<number, Array<number>>;
  providers:ObservedRemoveMap<number, Array<string>>;
  provideCallbacks:Map<string, (string, boolean) => void>;
  activeProviders:ObservedRemoveMap<string, [number, string]>;
  peerSubscriptions:ObservedRemoveMap<string>;
  peerSubscriptionMap:Map<number, Set<number>>;
  providerRegexes: Map<number, Array<[string, RegExp]>>;
  peerRequestHandler: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  credentialsHandler: (credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  subscribeRequestHandler: (key:string, credentials: Object) => Promise<{ success: boolean, code: number, message: string }>;
  logger: {
    debug: (string) => void,
    info: (string) => void,
    warn: (string) => void,
    error: (string) => void
  };
}

module.exports = Server;
