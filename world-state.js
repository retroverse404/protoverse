import { worldNoAllocator } from "./worldno.js";

/**
 * Represents the state for a single world
 */
export class WorldStateEntry {
  constructor(worldData, worldUrl, worldno) {
    this.data = worldData;
    this.url = worldUrl;
    this.worldno = worldno;
    this.name = worldData?.name;
    if(!this.name) {
      console.error("WorldStateEntry: No name found for world:", this.url);
    }
    if(!this.url) {
      console.error("WorldStateEntry: No url found for world:", this.url);
    }
    this.mesh = null;
    this.portalPairs = [];
  }
}

/**
 * Manages state for all loaded worlds
 */
export class WorldState {
  constructor() {
    this.worlds = new Map(); // Map<worldUrl, WorldStateEntry>
  }


  get(worldUrl) {
    let state = this.worlds.get(worldUrl);
    if (!state) {
      console.warn("WorldState: get: world not found:", worldUrl);
      return null;
    }
    return state;
  }

  create(worldUrl, worldData, worldno = 0) {
    let state = this.worlds.get(worldUrl);
    if (state) {
      console.warn("WorldState: create: world already exists:", worldUrl);
      return state; // Return existing state instead of null
    }
    state = new WorldStateEntry(worldData, worldUrl, worldno);
    this.worlds.set(worldUrl, state);
    return state;
  }

  set(worldUrl, state) {
    this.worlds.set(worldUrl, state);
  }

  getOrCreate(worldUrl, worldData, worldno) {
    let state = this.worlds.get(worldUrl);
    if (!state) {
      console.log('WorldState: creating state for:', worldUrl);
      state = this.create(worldUrl, worldData, worldno);
    }
    return state;
  }

  /**
   * Delete world state entry and release its worldno
   * @param {string} worldUrl 
   */
  delete(worldUrl) {
    const state = this.worlds.get(worldUrl);
    if (state) {
      // Return worldno to allocator
      if (state.worldno !== undefined) {
        worldNoAllocator.release(state.worldno);
      }
      this.worlds.delete(worldUrl);
    }
  }

  /**
   * Check if world exists
   * @param {string} worldUrl 
   * @returns {boolean}
   */
  has(worldUrl) {
    return this.worlds.has(worldUrl);
  }

  /**
   * Get all world entries
   * @returns {IterableIterator<[string, WorldStateEntry]>}
   */
  entries() {
    return this.worlds.entries();
  }

  /**
   * Get all world URLs
   * @returns {IterableIterator<string>}
   */
  keys() {
    return this.worlds.keys();
  }

  /**
   * Get all world state entries
   * @returns {IterableIterator<WorldStateEntry>}
   */
  values() {
    return this.worlds.values();
  }
}

