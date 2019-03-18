// @flow

const msgpack = require('msgpack5')();

function encode(o: {value: any}) {
  return msgpack.encode(o.value);
}

function encodeEmpty() {
  return Buffer.from([]);
}

class Credentials {
  constructor(value:Object) {
    this.value = value;
  }
  value: Object;
}

function decodeCredentials(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new Credentials(value);
}

class CredentialsResponse {
  constructor(value:{success: boolean, code: number, message: string}) {
    this.value = value;
  }
  value: {success: boolean, code: number, message: string};
}

function decodeCredentialsResponse(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new CredentialsResponse(value);
}

class DataDump {
  constructor(queue:[Array<*>, Array<*>], ids?:Array<number> = []) {
    this.queue = queue;
    this.ids = ids;
  }
  queue:[Array<*>, Array<*>];
  ids:Array<number>;
}

function decodeDataDump(buffer: Buffer) {
  const decoded = msgpack.decode(buffer);
  return new DataDump(decoded[0], decoded[1]);
}

function encodeDataDump(dump: DataDump) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class PeerDump {
  constructor(queue:[Array<*>, Array<*>], ids?:Array<number> = []) {
    this.queue = queue;
    this.ids = ids;
  }
  queue:[Array<*>, Array<*>];
  ids:Array<number>;
}

function decodePeerDump(buffer: Buffer) {
  const decoded = msgpack.decode(buffer);
  return new PeerDump(decoded[0], decoded[1]);
}

function encodePeerDump(dump: PeerDump) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class ProviderDump {
  constructor(queue:[Array<*>, Array<*>], ids?:Array<number> = []) {
    this.queue = queue;
    this.ids = ids;
  }
  queue:[Array<*>, Array<*>];
  ids:Array<number>;
}

function decodeProviderDump(buffer: Buffer) {
  const decoded = msgpack.decode(buffer);
  return new ProviderDump(decoded[0], decoded[1]);
}

function encodeProviderDump(dump: ProviderDump) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class ActiveProviderDump {
  constructor(queue:[Array<*>, Array<*>], ids?:Array<number> = []) {
    this.queue = queue;
    this.ids = ids;
  }
  queue:[Array<*>, Array<*>];
  ids:Array<number>;
}

function decodeActiveProviderDump(buffer: Buffer) {
  const decoded = msgpack.decode(buffer);
  return new ActiveProviderDump(decoded[0], decoded[1]);
}

function encodeActiveProviderDump(dump: ActiveProviderDump) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class PeerSubscriptionDump {
  constructor(queue:[Array<*>, Array<*>], ids?:Array<number> = []) {
    this.queue = queue;
    this.ids = ids;
  }
  queue:[Array<*>, Array<*>];
  ids:Array<number>;
}

function decodePeerSubscriptionDump(buffer: Buffer) {
  const decoded = msgpack.decode(buffer);
  return new PeerSubscriptionDump(decoded[0], decoded[1]);
}

function encodePeerSubscriptionDump(dump: PeerSubscriptionDump) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class PeerRequest {
  constructor(value:number) {
    this.value = value;
  }
  value: number;
}

function decodePeerRequest(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new PeerRequest(value);
}

class PeerResponse {
  constructor(value:{id?:number, success: boolean, code: number, message: string}) {
    this.value = value;
  }
  value: {id?:number, success: boolean, code: number, message: string};
}

function decodePeerResponse(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new PeerResponse(value);
}

class Unpeer {}

function decodeUnpeer() {
  return new Unpeer();
}

class SubscribeRequest {
  constructor(value:string) {
    this.value = value;
  }
  value: string;
}

function decodeSubscribeRequest(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new SubscribeRequest(value);
}

class SubscribeResponse {
  constructor(value:{key:string, success: boolean, code: number, message: string}) {
    this.value = value;
  }
  value: {key:string, success: boolean, code: number, message: string};
}

function decodeSubscribeResponse(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new SubscribeResponse(value);
}

class Unsubscribe {
  constructor(value:string) {
    this.value = value;
  }
  value: string;
}

function decodeUnsubscribe(buffer: Buffer) {
  const value = msgpack.decode(buffer);
  return new Unsubscribe(value);
}

msgpack.register(0x1, Credentials, encode, decodeCredentials);
msgpack.register(0x2, CredentialsResponse, encode, decodeCredentialsResponse);

msgpack.register(0x3, DataDump, encodeDataDump, decodeDataDump);
msgpack.register(0x4, ProviderDump, encodeProviderDump, decodeProviderDump);
msgpack.register(0x5, ActiveProviderDump, encodeActiveProviderDump, decodeActiveProviderDump);
msgpack.register(0x6, PeerDump, encodePeerDump, decodePeerDump);
msgpack.register(0x7, PeerSubscriptionDump, encodePeerSubscriptionDump, decodePeerSubscriptionDump);

msgpack.register(0x10, PeerRequest, encode, decodePeerRequest);
msgpack.register(0x11, PeerResponse, encode, decodePeerResponse);
msgpack.register(0x12, Unpeer, encodeEmpty, decodeUnpeer);

msgpack.register(0x20, SubscribeRequest, encode, decodeSubscribeRequest);
msgpack.register(0x21, SubscribeResponse, encode, decodeSubscribeResponse);
msgpack.register(0x22, Unsubscribe, encode, decodeUnsubscribe);


module.exports.DataDump = DataDump;
module.exports.ProviderDump = ProviderDump;
module.exports.ActiveProviderDump = ActiveProviderDump;
module.exports.PeerDump = PeerDump;
module.exports.PeerSubscriptionDump = PeerSubscriptionDump;
module.exports.Credentials = Credentials;
module.exports.CredentialsResponse = CredentialsResponse;
module.exports.SubscribeRequest = SubscribeRequest;
module.exports.SubscribeResponse = SubscribeResponse;
module.exports.Unsubscribe = Unsubscribe;
module.exports.PeerRequest = PeerRequest;
module.exports.PeerResponse = PeerResponse;
module.exports.Unpeer = Unpeer;
module.exports.encode = msgpack.encode;
module.exports.decode = msgpack.decode;
module.exports.getArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
