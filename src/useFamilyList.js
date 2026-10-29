import { useSyncExternalStore } from "react";
import { emptyList, getSyncClient } from "./sync-client.js";
const emptyState = {
  list: emptyList,
  loaded: true,
  loadError: null,
  connection: "idle",
  pending: 0,
  issues: [],
  waiting: 0,
  savedAt: null,
  storageError: null,
};
const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyState;
export function useFamilyList(token) {
  const client = token ? getSyncClient(token) : null;
  return useSyncExternalStore(
    client?.subscribe || emptySubscribe,
    client?.getSnapshot || emptySnapshot,
  );
}
