//      

// Based on https://raw.githubusercontent.com/pbojinov/request-ip/master/src/index.js

const { Address4, Address6 } = require('ip-address');

const correctForm = (s        ) => {
  if (!s) {
    return null;
  }
  const v4 = new Address4(s);
  if (v4.isValid()) {
    return v4.correctForm();
  }
  const v6 = new Address6(s);
  if (v6.isValid()) {
    return v6.correctForm();
  }
  return null;
};

module.exports = (ws              , req            ) => {
  let ipString;

  // Standard headers used by Amazon EC2, Heroku, and others.
  ipString = correctForm(req.getHeader('x-client-ip'));
  if (ipString) {
    return ipString;
  }

  const forwardedForString = req.getHeader('x-forwarded-for');
  if (forwardedForString) {
    const forwardedIps = forwardedForString.split(',').map((e) => {
      const ip = e.trim();
      if (ip.includes(':')) {
        const splitted = ip.split(':');
        // make sure we only use this if it's ipv4 (ip:port)
        if (splitted.length === 2) {
          return splitted[0];
        }
      }
      return ip;
    });
    for (const forwardedIp of forwardedIps) {
      ipString = correctForm(forwardedIp);
      if (ipString) {
        return ipString;
      }
    }
  }

  // Cloudflare.
  // @see https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-
  // CF-Connecting-IP - applied to every request to the origin.
  ipString = correctForm(req.getHeader('cf-connecting-ip'));
  if (ipString) {
    return ipString;
  }

  // Fastly and Firebase hosting header (When forwared to cloud function)
  ipString = correctForm(req.getHeader('fastly-client-ip'));
  if (ipString) {
    return ipString;
  }

  // Akamai and Cloudflare: True-Client-IP.
  ipString = correctForm(req.getHeader('true-client-ip'));
  if (ipString) {
    return ipString;
  }

  // Default nginx proxy/fcgi; alternative to x-forwarded-for, used by some proxies.
  ipString = correctForm(req.getHeader('x-real-ip'));
  if (ipString) {
    return ipString;
  }

  // (Rackspace LB and Riverbed's Stingray)
  // http://www.rackspace.com/knowledge_center/article/controlling-access-to-linux-cloud-sites-based-on-the-client-ip-address
  // https://splash.riverbed.com/docs/DOC-1926
  ipString = correctForm(req.getHeader('x-cluster-client-ip'));
  if (ipString) {
    return ipString;
  }

  ipString = correctForm(req.getHeader('x-forwarded'));
  if (ipString) {
    return ipString;
  }

  ipString = correctForm(req.getHeader('forwarded-for'));
  if (ipString) {
    return ipString;
  }

  const v6 = Address6.fromUnsignedByteArray(new Uint8Array(ws.getRemoteAddress()));
  const v4 = v6.to4();
  if (v4.isValid()) {
    return v4.correctForm();
  }
  if (v6.isValid()) {
    return v6.correctForm();
  }
  return undefined;
};

