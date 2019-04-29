// @flow

const { EventEmitter } = require('events');
const WS = require('ws');

const {
  encode,
  decode,
  Credentials,
  CredentialsResponse,
  PeerRequest,
  PeerResponse,
  Unpeer,
} = require('@bunchtogether/braid-messagepack');

class PeerError extends Error {
  code: number;
  peerId: number | void;
  constructor(message:string, code:number, peerId?: number) {
    super(message);
    this.name = 'PeerError';
    this.code = code;
    this.peerId = peerId;
  }
}

class CredentialsError extends Error {
  code: number;
  constructor(message:string, code:number) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

class PeerConnection extends EventEmitter {
  constructor(id: number, address:string, credentials?:Object = {}) {
    super();
    this.id = id;
    this.address = address;
    this.credentials = credentials;
    this.timeoutDuration = 5000;
  }

  async open() {
    let heartbeatInterval;

    const ws = new WS(this.address);

    ws.on('open', () => {
      this.emit('open');
      this.ws = ws;
      heartbeatInterval = setInterval(() => {
        ws.send(new Uint8Array([0]));
      }, 5000);
    });

    ws.on('close', (code: number, reason:string) => {
      delete this.ws;
      this.emit('close', code, reason);
      clearInterval(heartbeatInterval);
    });

    ws.on('message', (data) => {
      const message = decode(data);
      if (message instanceof CredentialsResponse) {
        this.emit('credentialsResponse', message.value.success, message.value.code, message.value.message);
      } else if (message instanceof PeerResponse) {
        this.emit('peerResponse', message.value.id, message.value.success, message.value.code, message.value.message);
      } else {
        this.emit('message', message);
      }
    });

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.removeListener('open', onOpen);
        reject(event);
      };
      this.once('error', onError);
      this.once('open', onOpen);
    });
    if (this.credentials) {
      await this.sendCredentials(this.credentials);
    }
    const peerId = await this.sendPeerRequest();
    return peerId;
  }

  async close(code?: number, reason?: string) {
    if (!this.ws) {
      return;
    }
    await new Promise((resolve, reject) => {
      const onClose = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event: Event) => {
        this.removeListener('close', onClose);
        reject(event);
      };
      this.once('error', onError);
      this.once('close', onClose);
      this.ws.close(code, reason);
    });
  }

  async sendCredentials(credentials: Object) {
    if (!this.ws) {
      throw new Error('Unable to send credentials, not open');
    }
    const responsePromise = new Promise((resolve, reject) => {
      const handleCredentialsResponse = (success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        if (success) {
          resolve();
        } else {
          reject(new CredentialsError(message, code));
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        reject(new CredentialsError(`Credentials response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
      }, this.timeoutDuration);
      this.on('credentialsResponse', handleCredentialsResponse);
    });
    this.ws.send(encode(new Credentials(credentials)));
    await responsePromise;
  }

  async sendPeerRequest() {
    if (!this.ws) {
      throw new Error('Unable to peer, not open');
    }
    const responsePromise = new Promise((resolve, reject) => {
      const handlePeerResponse = (id, success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('peerResponse', handlePeerResponse);
        if (success) {
          resolve(id);
        } else {
          reject(new PeerError(message, code, id));
        }
      };
      const timeout = setTimeout(() => {
        this.removeListener('peerResponse', handlePeerResponse);
        reject(new PeerError(`Peer response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
      }, this.timeoutDuration);
      this.on('peerResponse', handlePeerResponse);
    });
    this.ws.send(encode(new PeerRequest(this.id)));
    const peerId = await responsePromise;
    return peerId;
  }

  unpeer() {
    if (!this.ws) {
      throw new Error('Unable to unpeer, not open');
    }
    this.ws.send(encode(new Unpeer()));
  }

  id:number;
  address:string;
  credentials: Object;
  ws: WS;
  timeoutDuration: number;
}

module.exports = PeerConnection;
