import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    // Session identification
    code: v.string(),           // "HYG2CQ" - the join code
    
    // Host info
    hostName: v.string(),       // "Martin"
    hostClientId: v.string(),   // Internal WS client ID
    
    // Movie info
    movieTitle: v.string(),     // "Big Trouble in Little China"
    worldUrl: v.string(),       // "/theatership/world.json"
    
    // Connection URLs
    flyApp: v.string(),         // "protoverse-bigtrouble"
    wsUrl: v.string(),          // "wss://protoverse-bigtrouble.fly.dev:8765"
    foundryUrl: v.string(),     // "wss://protoverse-bigtrouble.fly.dev/ws"
    
    // Session state
    viewerCount: v.number(),    // Current number of viewers
    maxViewers: v.number(),     // Max allowed viewers
    isMoviePlaying: v.boolean(), // Whether movie is currently playing
    
    // Timestamps
    createdAt: v.number(),      // When session was created
    lastHeartbeat: v.number(),  // Last heartbeat timestamp (for cleanup)
  })
    .index("by_code", ["code"])
    .index("by_flyApp", ["flyApp"])
    .index("by_lastHeartbeat", ["lastHeartbeat"]),
});
