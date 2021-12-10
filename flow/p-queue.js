// @flow


declare module 'p-queue' {

  declare export default class PQueue  {

    constructor({ concurrency?: number }): void;

    add: (() => Promise<*>) => Promise<*>;
    
    on: (string, () => void) => void;

    once: (string, () => void) => void;

    start: () => void;
    /**
    Put queue execution on hold.
    */
    pause: () => void;
    /**
    Clear the queue.
    */
    clear: () => void;
    /**
    Can be called multiple times. Useful if you for example add additional items at a later time.

    @returns A promise that settles when the queue becomes empty.
    */
    onEmpty: () => Promise<void>;
    /**
    The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.

    @returns A promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.
    */
    onIdle: () => Promise<void>;
    /**
    Size of the queue.
    */
    size: number;
    /**
    Number of pending promises.
    */
    pending: number;
    /**
    Whether the queue is currently paused.
    */
    isPaused: boolean;
    timeout: number | void;

  }

}
