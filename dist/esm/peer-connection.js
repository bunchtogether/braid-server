import EventEmitter from 'events';
import WS from 'ws';
import { encode, decode, Credentials, CredentialsResponse, PeerRequest, PeerResponse, Unpeer } from '@bunchtogether/braid-messagepack';

class CloseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloseError';
    this.code = 502;
  }

}

class PeerError extends Error {
  constructor(message, code, peerId) {
    super(message);
    this.name = 'PeerError';
    this.code = code;
    this.peerId = peerId;
  }

}

class CredentialsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }

}

export default class PeerConnection extends EventEmitter {
  constructor(id, address, maxPayloadLength, credentials = {}) {
    super();
    this.id = id;
    this.address = address;
    this.maxPayloadLength = maxPayloadLength;
    this.credentials = credentials;
    this.timeoutDuration = 5000;
  }

  async open() {
    let heartbeatInterval;
    const ws = new WS(this.address, {
      maxPayload: this.maxPayloadLength
    });
    ws.on('error', () => {
      this.emit('error', new Error(`Websocket error when connecting to ${this.address}, check the 'close' event for additional details`));
    });
    ws.on('open', () => {
      this.emit('open');
      this.ws = ws;
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === 1) {
          ws.send(new Uint8Array([0]));
        }
      }, 5000);
    });
    ws.on('close', (code, reason) => {
      delete this.ws;
      this.emit('close', code, reason);
      clearInterval(heartbeatInterval);
    });
    ws.on('message', data => {
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

      const onError = error => {
        this.removeListener('open', onOpen);
        reject(error);
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

  async close(code, reason) {
    const ws = this.ws;

    if (!ws) {
      throw new Error('Unable to close, socket does not exist');
    }

    await new Promise((resolve, reject) => {
      const onClose = () => {
        this.removeListener('error', onError);
        resolve();
      };

      const onError = error => {
        this.removeListener('close', onClose);
        reject(error);
      };

      this.once('error', onError);
      this.once('close', onClose);
      ws.close(code, reason);
    });
  }

  async sendCredentials(credentials) {
    const ws = this.ws;

    if (!ws) {
      throw new Error('Unable to send credentials, not open');
    }

    await new Promise((resolve, reject) => {
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
        this.removeListener('credentialsResponse', handleCredentialsResponse);
        reject(new CloseError('Connection closed before credentials response was received'));
      };

      const handleCredentialsResponse = (success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
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
      this.on('close', handleClose);
      this.on('credentialsResponse', handleCredentialsResponse);
      ws.send(encode(new Credentials(credentials)));
    });
  }

  sendPeerRequest() {
    const ws = this.ws;

    if (!ws) {
      throw new Error('Unable to peer, not open');
    }

    return new Promise((resolve, reject) => {
      const handleClose = () => {
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
        this.removeListener('peerResponse', handlePeerResponse);
        reject(new CloseError('Connection closed before peer response was received'));
      };

      const handlePeerResponse = (id, success, code, message) => {
        clearTimeout(timeout);
        this.removeListener('close', handleClose);
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
      this.on('close', handleClose);
      this.on('peerResponse', handlePeerResponse);
      ws.send(encode(new PeerRequest(this.id)));
    });
  }

  unpeer() {
    const ws = this.ws;

    if (!ws) {
      throw new Error('Unable to unpeer, not open');
    }

    ws.send(encode(new Unpeer()));
  }

}
//# sourceMappingURL=peer-connection.js.map