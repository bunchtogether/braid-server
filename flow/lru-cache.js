
declare module "lru-cache" {

  declare class LRUCache<K, V> {
    constructor(options: Options<K, V>): LRUCache<K, V>;
    set: (key: K, value: V, maxAge?: number) => void;
    get: (key: K) => V;
    peek: (key: K) => V;
    del: (key: K) => void;
    reset: () => void;
    has: (key: K) => boolean;
    forEach:((key: K, value: V, cache: LRUCache<K, V>) => void) => void;
    // TODO add the rest of the things documented at https://www.npmjs.com/package/lru-cache
    prune: () => void;
  }

  declare type Options<K, V> = {
    max?: number,
    maxAge?: number,
    length?: (value: V, key: K) => number,
    dispose?: (key: K, value: V) => void,
    stale?: boolean,
    ...
  };

  declare module.exports: typeof LRUCache;
  // TODO You can supply just an integer (max size), or even nothing at all.
 // declare export default <K, V>(options: Options<K, V>) => LRUCache<K, V>;
}
