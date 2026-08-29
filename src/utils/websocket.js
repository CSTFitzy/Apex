/**
 * WebSocket client handler for real-time updates from the Sharknet backend.
 * Manages connection lifecycle, automatic reconnection, and a simple
 * pub/sub API for consuming MAP_UPDATE / WEATHER_ALERT / INTELLIGENCE_UPDATE
 * messages broadcast by the server.
 */

const RECONNECT_DELAY_MS = 3000;

export class SharknetSocket {
  constructor(url = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3000/ws`) {
    this.url = url;
    this.socket = null;
    this.listeners = new Map();
    this.shouldReconnect = true;
  }

  /** Open the WebSocket connection (optionally with an auth token). */
  connect(token) {
    const wsUrl = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;
    this.socket = new WebSocket(wsUrl);

    this.socket.addEventListener('open', () => this.emit('open'));
    this.socket.addEventListener('close', () => {
      this.emit('close');
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(token), RECONNECT_DELAY_MS);
      }
    });
    this.socket.addEventListener('error', (event) => this.emit('error', event));
    this.socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        this.emit(message.type, message.payload);
      } catch {
        this.emit('error', new Error('Failed to parse WebSocket message'));
      }
    });
  }

  /** Subscribe to server-side topics (e.g. 'map', 'weather', 'intelligence'). */
  subscribe(topics) {
    this.send('SUBSCRIBE', { topics });
  }

  /** Send a typed message to the server. */
  send(type, payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  }

  /** Register a listener for a message type ('open', 'close', 'error', or a MESSAGE_TYPE). */
  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  emit(type, payload) {
    this.listeners.get(type)?.forEach((callback) => callback(payload));
  }

  /** Close the connection and stop automatic reconnection. */
  disconnect() {
    this.shouldReconnect = false;
    this.socket?.close();
  }
}

export default SharknetSocket;
