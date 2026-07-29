import type { ISocketClient, RawCell, SocketLifecycleHandlers } from '../map/types.js';

/**
 * Drives socket lifecycle events from tests. `connect` only registers handlers (mirroring a real
 * socket, whose `connect` event fires asynchronously) — call `emitConnect` to simulate it.
 */
export class FakeMapSocket implements ISocketClient {
    private handlers: SocketLifecycleHandlers | null = null;
    private connected = false;
    public reconnectCalls = 0;

    connect(handlers: SocketLifecycleHandlers): void {
        this.handlers = handlers;
    }

    isConnected(): boolean {
        return this.connected;
    }

    // Records the call; tests drive the actual recovery via emitConnect (mirroring an async reconnect).
    reconnect(): void {
        this.reconnectCalls += 1;
    }

    disconnect(): void {
        this.connected = false;
        this.handlers = null;
    }

    emitConnect(): void {
        this.connected = true;
        this.handlers?.onConnect();
    }

    emitDisconnect(reason = 'test'): void {
        this.connected = false;
        this.handlers?.onDisconnect(reason);
    }

    emitCell(cell: RawCell): void {
        this.handlers?.onCellUpdate(cell);
    }

    emitError(error: Error): void {
        this.handlers?.onError(error);
    }
}
