//      

const { ObservedRemoveMap } = require('observed-remove');
const { EventEmitter } = require('events');

class ManagedObservedRemoveMap       extends EventEmitter {
                              

  constructor(map                        ) {
    super();
    this.map = map;
    map.on('set', (key, value) => {
      this.emit('set', key, value);
    });
    map.on('delete', (key, value) => {
      this.emit('delete', key, value);
    });
  }

  /* :: @@iterator(): Iterator<[K, V]> { return ({}: any); } */
  // $FlowFixMe: computed property
  [Symbol.iterator]() {
    return this.map.entries();
  }

  set(key  , value  ) {
    this.map.set(key, value);
    return this;
  }

  get(key  )           { // eslint-disable-line consistent-return
    return this.map.get(key);
  }

  delete(key  )      {
    this.map.delete(key);
  }

  clear()       {
    for (const key of this.map.keys()) {
      this.map.delete(key);
    }
  }

  entries()                  {
    return this.map.entries();
  }

  forEach(callback         , thisArg     )      {
    if (thisArg) {
      for (const [key, value] of this.map.entries()) {
        callback.bind(thisArg)(value, key, this);
      }
    } else {
      for (const [key, value] of this.map.entries()) {
        callback(value, key, this);
      }
    }
  }

  has(key  )          {
    return this.map.has(key);
  }

  keys()             {
    return this.map.keys();
  }

  values()             {
    return this.map.values();
  }

  get size()        {
    return this.map.size;
  }
}

module.exports = ManagedObservedRemoveMap;
