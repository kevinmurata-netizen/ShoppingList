import { offlineStore } from "./offline-store.js";
import { projectList, operationDependencies } from "../shared/operations.js";
import { request } from "./api.js";

const clients = new Map();
export const emptyList = {
  title: "Our family list",
  version: 0,
  items: [],
  usuals: [],
  favoriteStates: [],
};
export class SyncClient {
  constructor(token) {
    this.token = token;
    this.listeners = new Set();
    this.network = navigator.onLine;
    this.state = {
      list: emptyList,
      loaded: false,
      loadError: null,
      connection: "connecting",
      pending: 0,
      issues: [],
      waiting: 0,
      savedAt: null,
      storageError: null,
      offlineReady: false,
    };
    this.subscribe = (listener) => {
      this.listeners.add(listener);
      this.start();
      return () => this.listeners.delete(listener);
    };
    this.getSnapshot = () => this.state;
  }
  emit(extra = {}) {
    this.state = { ...this.state, ...extra };
    for (const listener of this.listeners) listener();
  }
  async reload() {
    try {
      this.disk = await offlineStore.read(this.token);
      this.emit({
        list: projectList(this.disk.base, this.disk.queue) || emptyList,
        loaded: Boolean(this.disk.base) || Boolean(this.failure),
        loadError: this.disk.base ? null : this.failure || null,
        pending: this.disk.queue.filter((op) => op.status !== "blocked").length,
        issues: this.disk.queue.filter((op) => op.status === "blocked"),
        waiting: this.disk.queue.filter((op) => op.status === "waiting").length,
        savedAt: this.disk.savedAt,
        notice:
          this.disk.base && this.failure?.missing ? this.failure.message : null,
        connection: !this.network
          ? "offline"
          : this.flushing &&
              this.disk.queue.some((op) => op.status === "queued")
            ? "syncing"
            : this.socket?.readyState === WebSocket.OPEN
              ? "live"
              : "connecting",
      });
    } catch {
      this.emit({
        storageError:
          "This browser couldn't save your list on this phone. Allow site storage or free some space, then reload. Changes have not been discarded.",
        loaded: true,
      });
    }
  }
  broadcast() {
    this.channel?.postMessage(this.token);
    try {
      localStorage.setItem("family-cart-sync-notice", crypto.randomUUID());
    } catch {}
  }
  start() {
    if (this.started) return this.ready;
    this.started = true;
    this.ready = this.reload();
    if ("serviceWorker" in navigator) {
      const check = async () => {
        const registration = await navigator.serviceWorker.ready;
        const worker =
          navigator.serviceWorker.controller || registration.active;
        if (!worker) return;
        const channel = new MessageChannel();
        const timer = setTimeout(() => channel.port1.close(), 3000);
        channel.port1.onmessage = ({ data }) => {
          clearTimeout(timer);
          channel.port1.close();
          this.emit({
            offlineReady: data.version === "family-cart-shell-v3" && data.ready,
          });
        };
        worker.postMessage({ type: "OFFLINE_READY" }, [channel.port2]);
      };
      navigator.serviceWorker.addEventListener("controllerchange", check);
      navigator.serviceWorker.ready.then(check);
    }
    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("family-cart-sync");
      this.channel.onmessage = (event) => {
        if (event.data === this.token) this.reload().then(() => this.flush());
      };
    }
    this.wake = () => {
      if (!document.hidden) {
        this.network = navigator.onLine;
        this.refresh();
        this.connect();
        this.flush();
      }
    };
    window.addEventListener("online", this.wake);
    window.addEventListener("offline", () => {
      this.network = false;
      this.socket?.close();
      this.reload();
    });
    document.addEventListener("visibilitychange", this.wake);
    window.addEventListener("storage", (event) => {
      if (event.key === "family-cart-sync-notice")
        this.reload().then(() => this.flush());
    });
    this.poll = setInterval(() => {
      this.refresh();
      this.flush();
    }, 30_000);
    this.ready.then(() => {
      this.refresh();
      this.connect();
      this.flush();
    });
    return this.ready;
  }
  async receive(data) {
    try {
      await offlineStore.save(this.token, data);
      this.network = true;
      this.failure = null;
      await this.reload();
      this.broadcast();
    } catch {
      this.emit({
        list: data,
        loaded: true,
        storageError:
          "Your browser couldn't save the latest list on this phone. Free some space or allow site storage, then reload.",
      });
    }
  }
  async refresh() {
    await this.ready;
    if (this.refreshing) return;
    if (!navigator.onLine) {
      this.network = false;
      if (!this.disk?.base)
        this.failure = {
          message:
            "Open this family link online once to save it for offline shopping.",
          missing: false,
        };
      await this.reload();
      return;
    }
    this.refreshing = true;
    try {
      await this.receive(await request(`/api/lists/${this.token}`));
    } catch (error) {
      this.network = Boolean(error.status && error.status < 500);
      this.failure = {
        message:
          error.status === 404
            ? error.message
            : "Open this family link online once to save it for offline shopping.",
        missing: error.status === 404,
      };
      await this.reload();
    } finally {
      this.refreshing = false;
    }
  }
  connect() {
    if (
      !navigator.onLine ||
      (this.socket &&
        [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState))
    )
      return;
    clearTimeout(this.socketTimer);
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live/${this.token}`,
    );
    this.socket = socket;
    socket.onmessage = (event) => {
      try {
        this.receive(JSON.parse(event.data));
        this.flush();
      } catch {}
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      if (!navigator.onLine) this.network = false;
      this.reload();
      this.socketTimer = setTimeout(() => {
        this.connect();
        this.refresh();
        this.flush();
      }, 5000);
    };
  }
  async enqueue(type, payload) {
    await this.start();
    if (this.state.storageError) throw new Error(this.state.storageError);
    let result;
    try {
      result = await offlineStore.enqueue(this.token, type, payload);
    } catch (error) {
      if (error.name === "QuotaExceededError")
        this.emit({
          storageError:
            "This phone is out of browser storage. Free some space before making more offline changes.",
        });
      throw error;
    }
    await this.reload();
    this.broadcast();
    this.flush();
    return result.optimistic;
  }
  async flush() {
    await this.ready;
    if (this.flushing || !navigator.onLine || this.state.storageError) return;
    this.flushing = true;
    const run = async (lock = true) => {
      if (!lock) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.flush(), 300);
        return;
      }
      while (navigator.onLine) {
        await this.reload();
        const blockers = new Set(
          this.disk.queue
            .filter((op) => ["blocked", "waiting"].includes(op.status))
            .map((op) => op.id),
        );
        let op;
        for (const candidate of this.disk.queue.filter(
          (entry) => entry.status === "queued",
        )) {
          const dependencies = operationDependencies(candidate).filter((id) =>
            blockers.has(id),
          );
          if (dependencies.length) {
            await offlineStore.mark(candidate.id, "waiting", {
              dependsOn: dependencies,
            });
            blockers.add(candidate.id);
          } else {
            op = candidate;
            break;
          }
        }
        if (!op) break;
        try {
          const data = await request(`/api/lists/${this.token}/sync`, {
            method: "POST",
            body: JSON.stringify({ operation: op }),
          });
          await offlineStore.acknowledge(this.token, op.id, data);
          this.network = true;
          this.failure = null;
          this.broadcast();
        } catch (error) {
          if (!error.status || error.status >= 500 || error.status === 429) {
            this.network = false;
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => {
              this.refresh();
              this.flush();
            }, 5000);
            break;
          }
          if (error.data?.snapshot)
            await offlineStore.save(this.token, error.data.snapshot);
          await offlineStore.mark(op.id, "blocked", {
            conflict: error.data?.conflict || {
              message: error.message,
              canRetry: false,
              fields: [],
            },
          });
          this.network = true;
          this.broadcast();
        }
      }
    };
    try {
      if (navigator.locks)
        await navigator.locks.request(
          `family-cart-sync-${this.token}`,
          { ifAvailable: true },
          run,
        );
      else await run();
    } catch {
      this.emit({
        storageError:
          "Your phone couldn't update its saved changes. Reload before continuing; your queued changes are still stored.",
      });
    } finally {
      this.flushing = false;
      await this.reload();
    }
  }
  async resolve(id, choice) {
    if (choice !== "dismiss" && this.network) await this.refresh();
    await offlineStore.resolve(this.token, id, choice);
    await this.reload();
    this.broadcast();
    this.flush();
  }
}
export function getSyncClient(token) {
  if (!clients.has(token)) clients.set(token, new SyncClient(token));
  const client = clients.get(token);
  client.start();
  return client;
}
export async function seedList(token, data) {
  await offlineStore.save(token, data);
}
