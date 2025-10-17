interface ServerOptions {
    port?: number;
    mockWrites?: boolean;
    configPath?: string;
}
export declare function createWebServer(options?: ServerOptions): {
    app: import("express-serve-static-core").Express;
    server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
    wss: import("ws").Server<typeof import("ws"), typeof import("http").IncomingMessage>;
};
export {};
//# sourceMappingURL=index.d.ts.map