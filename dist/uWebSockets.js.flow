// @flow

/* Under construction, lots of things to add */

/** Native type representing a raw uSockets struct us_listen_socket. */
interface us_listen_socket {

}

/** Recognized string types, things C++ can read and understand as strings */
export type UWSRecognizedString = string | ArrayBuffer | Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

/** A UWSWebSocket connection that is valid from open to close event */
export interface UWSWebSocket {
    /** Sends a message. Make sure to check getBufferedAmount() before sending. Returns true for success, false for built up backpressure that will drain when time is given. */
    send(message: UWSRecognizedString, isBinary?: boolean, compress?: boolean) : boolean;

    /** Returns the bytes buffered in backpressure. */
    getBufferedAmount() : number;

    /** Gradefully closes this UWSWebSocket. Immediately calls close handler. */
    end(code: number, shortMessage: UWSRecognizedString) : UWSWebSocket;

    /** Forefully closes this UWSWebSocket. Immediately calls close handler. */
    close() : UWSWebSocket;

    /** Subscribe to a topic in MQTT syntax */
    subscribe(topic: UWSRecognizedString) : UWSWebSocket;

    /** Publish a message to a topic in MQTT syntax */
    publish(topic: UWSRecognizedString, message: UWSRecognizedString) : UWSWebSocket;

    /** Unsubscribe from topic (not implemented yet) */
    unsubscribe(topic: UWSRecognizedString) : UWSWebSocket;

    /** Returns the remote IP address */
    getRemoteAddress() : ArrayBuffer;

    id?:number;

    credentials?:Object;
}

/** An HttpResponse is valid until either onAborted callback or any of the .end/.tryEnd calls succeed. You may attach user data to this object. */
export  interface HttpResponse {
    /** Writes the HTTP status message such as "200 OK". */
    writeStatus(status: UWSRecognizedString) : HttpResponse;
    /** Writes key and value to HTTP response. */
    writeHeader(key: UWSRecognizedString, value: UWSRecognizedString) : HttpResponse;
    /** Enters or continues chunked encoding mode. Writes part of the response. End with zero length write. */
    write(chunk: UWSRecognizedString) : HttpResponse;
    /** Ends this response by copying the contents of body. */
    end(body: UWSRecognizedString) : HttpResponse;
    /** Ends this response, or tries to, by streaming appropriately sized chunks of body. Use in conjunction with onWritable. Returns tuple [ok, hasResponded].*/
    tryEnd(fullBodyOrChunk: UWSRecognizedString, totalSize: number) : [boolean, boolean];

    /** Immediately force closes the connection. */
    close() : HttpResponse;

    /** Returns the global byte write offset for this response. Use with onWritable. */
    getWriteOffset() : number;

    /** Registers a handler for writable events. Continue failed write attempts in here.
     * You MUST return true for success, false for failure.
     * Writing nothing is always success, so by default you must return true.
     */
    onWritable(handler: (offset: number) => boolean) : HttpResponse;

    /** Every HttpResponse MUST have an attached abort handler IF you do not respond
     * to it immediately inside of the callback. Returning from an Http request handler
     * without attaching (by calling onAborted) an abort handler is ill-use and will termiante.
     * When this event emits, the response has been aborted and may not be used. */
    onAborted(handler: (res: HttpResponse) => void) : HttpResponse;

    /** Handler for reading data from POST and such requests. You MUST copy the data of chunk if isLast is not true. We Neuter ArrayBuffers on return, making it zero length.*/
    onData(handler: (chunk: ArrayBuffer, isLast: boolean) => void) : HttpResponse;

    /** Returns the remote IP address */
    getRemoteAddress() : ArrayBuffer;

    /** Arbitrary user data may be attached to this object */
    [key: string]: any;
}

/** An UWSHttpRequest is stack allocated and only accessible during the callback invocation. */
export interface UWSHttpRequest {
    /** Returns the lowercased header value or empty string. */
    getHeader(lowerCaseKey: UWSRecognizedString) : string;
    /** Returns the parsed parameter at index. Corresponds to route. */
    getParameter(index: number) : string;
    /** Returns the URL including initial /slash */
    getUrl() : string;
    /** Returns the HTTP method, useful for "any" routes. */
    getMethod() : string;
    /** Returns the part of URL after ? sign or empty string. */
    getQuery() : string;
}

/** A structure holding settings and handlers for a UWSWebSocket route handler. */
export interface UWSWebSocketBehavior {
    /** Maximum length of received message. */
    maxPayloadLength?: number;
    /** Maximum amount of seconds that may pass without sending or getting a message. */
    idleTimeout?: number;
    /** 0 = no compression, 1 = shared compressor, 2 = dedicated compressor. See C++ project. */
    compression?: CompressOption;
    /** Handler for new UWSWebSocket connection. UWSWebSocket is valid from open to close, no errors. */
    open?: (ws: UWSWebSocket, req: UWSHttpRequest) => void;
    /** Handler for a UWSWebSocket message. */
    message?: (ws: UWSWebSocket, message: ArrayBuffer, isBinary: boolean) => void | Promise<void>;
    /** Handler for when UWSWebSocket backpressure drains. Check ws.getBufferedAmount(). */
    drain?: (ws: UWSWebSocket) => void;
    /** Handler for close event, no matter if error, timeout or graceful close. You may not use UWSWebSocket after this event. */
    close?: (ws: UWSWebSocket, code: number, message: ArrayBuffer) => void;
}

/** Options used when constructing an app. */
interface AppOptions {
    key_file_name?: UWSRecognizedString;
    cert_file_name?: UWSRecognizedString;
    passphrase?: UWSRecognizedString;
    dh_params_file_name?: UWSRecognizedString;
}

/** UWSTemplatedApp is either an SSL or non-SSL app. */
export interface UWSTemplatedApp {
    /** Listens to hostname & port. Callback hands either false or a listen socket. */
    listen(host: UWSRecognizedString, port: number, cb: (listenSocket: us_listen_socket) => void): UWSTemplatedApp;
    /** Listens to port. Callback hands either false or a listen socket. */
    listen(port: number, cb: (listenSocket: any) => void): UWSTemplatedApp;
    /** Registers an HTTP GET handler matching specified URL pattern. */
    get(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP POST handler matching specified URL pattern. */
    post(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP OPTIONS handler matching specified URL pattern. */
    options(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP DELETE handler matching specified URL pattern. */
    del(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP PATCH handler matching specified URL pattern. */
    patch(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP PUT handler matching specified URL pattern. */
    put(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP HEAD handler matching specified URL pattern. */
    head(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP CONNECT handler matching specified URL pattern. */
    connect(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP TRACE handler matching specified URL pattern. */
    trace(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers an HTTP handler matching specified URL pattern on any HTTP method. */
    any(pattern: UWSRecognizedString, handler: (res: HttpResponse, req: UWSHttpRequest) => void) : UWSTemplatedApp;
    /** Registers a handler matching specified URL pattern where UWSWebSocket upgrade requests are caught. */
    ws(pattern: UWSRecognizedString, behavior: UWSWebSocketBehavior) : UWSTemplatedApp;

    forcefully_free(): void;
}

export type CompressOption = 0|1|2;


