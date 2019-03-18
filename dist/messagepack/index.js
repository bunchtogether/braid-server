//      

const msgpack = require('msgpack5')();

function encode(o              ) {
  return msgpack.encode(o.value);
}

function encodeEmpty() {
  return Buffer.from([]);
}

class Credentials {
  constructor(value       ) {
    this.value = value;
  }
                
}

function decodeCredentials(buffer        ) {
  const value = msgpack.decode(buffer);
  return new Credentials(value);
}

class CredentialsResponse {
  constructor(value                                                  ) {
    this.value = value;
  }
                                                           
}

function decodeCredentialsResponse(buffer        ) {
  const value = msgpack.decode(buffer);
  return new CredentialsResponse(value);
}

class DataDump {
  constructor(queue                     , ids                = []) {
    this.queue = queue;
    this.ids = ids;
  }
                             
                    
}

function decodeDataDump(buffer        ) {
  const decoded = msgpack.decode(buffer);
  return new DataDump(decoded[0], decoded[1]);
}

function encodeDataDump(dump          ) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class PeerDump {
  constructor(queue                     , ids                = []) {
    this.queue = queue;
    this.ids = ids;
  }
                             
                    
}

function decodePeerDump(buffer        ) {
  const decoded = msgpack.decode(buffer);
  return new PeerDump(decoded[0], decoded[1]);
}

function encodePeerDump(dump          ) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class ProviderDump {
  constructor(queue                     , ids                = []) {
    this.queue = queue;
    this.ids = ids;
  }
                             
                    
}

function decodeProviderDump(buffer        ) {
  const decoded = msgpack.decode(buffer);
  return new ProviderDump(decoded[0], decoded[1]);
}

function encodeProviderDump(dump              ) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class ActiveProviderDump {
  constructor(queue                     , ids                = []) {
    this.queue = queue;
    this.ids = ids;
  }
                             
                    
}

function decodeActiveProviderDump(buffer        ) {
  const decoded = msgpack.decode(buffer);
  return new ActiveProviderDump(decoded[0], decoded[1]);
}

function encodeActiveProviderDump(dump                    ) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class PeerSubscriptionDump {
  constructor(queue                     , ids                = []) {
    this.queue = queue;
    this.ids = ids;
  }
                             
                    
}

function decodePeerSubscriptionDump(buffer        ) {
  const decoded = msgpack.decode(buffer);
  return new PeerSubscriptionDump(decoded[0], decoded[1]);
}

function encodePeerSubscriptionDump(dump                      ) {
  return msgpack.encode([dump.queue, dump.ids]);
}

class PeerRequest {
  constructor(value       ) {
    this.value = value;
  }
                
}

function decodePeerRequest(buffer        ) {
  const value = msgpack.decode(buffer);
  return new PeerRequest(value);
}

class PeerResponse {
  constructor(value                                                              ) {
    this.value = value;
  }
                                                                       
}

function decodePeerResponse(buffer        ) {
  const value = msgpack.decode(buffer);
  return new PeerResponse(value);
}

class Unpeer {}

function decodeUnpeer() {
  return new Unpeer();
}

class SubscribeRequest {
  constructor(value       ) {
    this.value = value;
  }
                
}

function decodeSubscribeRequest(buffer        ) {
  const value = msgpack.decode(buffer);
  return new SubscribeRequest(value);
}

class SubscribeResponse {
  constructor(value                                                              ) {
    this.value = value;
  }
                                                                       
}

function decodeSubscribeResponse(buffer        ) {
  const value = msgpack.decode(buffer);
  return new SubscribeResponse(value);
}

class Unsubscribe {
  constructor(value       ) {
    this.value = value;
  }
                
}

function decodeUnsubscribe(buffer        ) {
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
module.exports.getArrayBuffer = (b        ) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
