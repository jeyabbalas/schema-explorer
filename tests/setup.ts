// Vitest setup: give every test an IndexedDB implementation (the app persists datasets and the
// library caches vectors there). Individual tests that need isolation create a fresh IDBFactory.
import "fake-indexeddb/auto";
