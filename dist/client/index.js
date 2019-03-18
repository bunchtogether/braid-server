//      

const { EventEmitter } = require('events');
const WebSocket = require('isomorphic-ws');
const { ObservedRemoveMap } = require('observed-remove');

const {
  encode,
  decode,
  Credentials,
  CredentialsResponse,
  DataDump,
  SubscribeRequest,
  SubscribeResponse,
  Unsubscribe,
} = require('../messagepack');

class CredentialsError extends Error {
               
  constructor(message       , code       ) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

class SubscribeError extends Error {
               
  constructor(message       , code       ) {
    super(message);
    this.name = 'SubscribeError';
    this.code = code;
  }
}

class Client extends EventEmitter {
  constructor(address       , credentials        ) {
    super();
    this.data = new ObservedRemoveMap([], { bufferPublishing: 0 });
    this.address = address;
    this.credentials = credentials;
    this.timeoutDuration = 5000;
    this.subscriptions = new Map();
  }

  async open() {
    const ws = new WebSocket(this.address);

    ws.onopen = () => {
      this.emit('open');
      this.ws = ws;
    };

    ws.onclose = (event) => {
      const { wasClean, reason, code } = event;
      console.log(`${wasClean ? 'Cleanly' : 'Uncleanly'} closed websocket connection to ${this.address} with code ${code}: ${reason}`);
      delete this.ws;
      this.emit('close', code, reason);
    };

    ws.onmessage = (event) => {
      const { data } = event;
      const message = decode(data);
      if (message instanceof DataDump) {
        this.data.process(message.queue); // eslint-disable-line no-underscore-dangle
      } else if (message instanceof CredentialsResponse) {
        this.emit('credentialsResponse', ws, message.value.success, message.value.code, message.value.message);
      } else if (message instanceof SubscribeResponse) {
        this.emit('subscribeResponse', message.value.key, message.value.success, message.value.code, message.value.message);
      }
    };

    ws.onerror = (event) => {
      this.emit('error', event);
    };

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event       ) => {
        this.removeListener('open', onOpen);
        reject(event);
      };
      this.once('error', onError);
      this.once('open', onOpen);
    });
    if (this.credentials) {
      await this.sendCredentials(this.credentials);
    }
  }

  async close(code         , reason         ) {
    if (!this.ws) {
      return;
    }
    await new Promise((resolve, reject) => {
      const onClose = () => {
        this.removeListener('error', onError);
        resolve();
      };
      const onError = (event       ) => {
        this.removeListener('close', onClose);
        reject(event);
      };
      this.once('error', onError);
      this.once('close', onClose);
      this.ws.close(code, reason);
    });
  }

  async sendCredentials(credentials        ) {
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

  async subscribe(key        , callback               ) {
    if (!this.ws) {
      throw new Error('Unable to subscribe, not open');
    }
    let subscriptions = this.subscriptions.get(key);
    if (subscriptions) {
      subscriptions.add(callback);
    } else {
      subscriptions = new Set([callback]);
      this.subscriptions.set(key, subscriptions);
      const responsePromise = new Promise((resolve, reject) => {
        const handleSubscribeResponse = (k, success, code, message) => {
          if (k !== key) {
            return;
          }
          clearTimeout(timeout);
          this.removeListener('subscribeResponse', handleSubscribeResponse);
          if (success) {
            resolve();
          } else {
            reject(new SubscribeError(message, code));
          }
        };
        const timeout = setTimeout(() => {
          this.removeListener('subscribeResponse', handleSubscribeResponse);
          reject(new SubscribeError(`Subscription response timeout after ${Math.round(this.timeoutDuration / 100) / 10} seconds`, 504));
        }, this.timeoutDuration);
        this.on('subscribeResponse', handleSubscribeResponse);
      });
      this.ws.send(encode(new SubscribeRequest(key)));
      await responsePromise;
    }
    callback(this.data.get(key)); // eslint-disable-line no-underscore-dangle
  }

  unsubscribe(key        , callback               ) {
    if (!this.ws) {
      throw new Error('Unable to unsubscribe, not open');
    }
    const subscriptions = this.subscriptions.get(key);
    if (!subscriptions) {
      return;
    }
    subscriptions.delete(callback);
    if (subscriptions.size === 0) {
      this.subscriptions.delete(key);
      this.ws.send(encode(new Unsubscribe(key)));
    }
  }

            
                 
                      
                                                
                
                                      
                          
}

module.exports = Client;
