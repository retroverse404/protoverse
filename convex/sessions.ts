import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// Stale session threshold: 90 seconds without heartbeat
const STALE_THRESHOLD_MS = 90_000;

/**
 * Register a new session (called when host creates a session)
 */
export const register = mutation({
  args: {
    code: v.string(),
    hostName: v.string(),
    hostClientId: v.string(),
    movieTitle: v.string(),
    worldUrl: v.string(),
    flyApp: v.string(),
    wsUrl: v.string(),
    foundryUrl: v.string(),
    maxViewers: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if session with this code already exists
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    
    if (existing) {
      // Update existing session (host reconnected)
      await ctx.db.patch(existing._id, {
        hostName: args.hostName,
        hostClientId: args.hostClientId,
        lastHeartbeat: Date.now(),
      });
      return { sessionId: existing._id, updated: true };
    }
    
    // Create new session
    const sessionId = await ctx.db.insert("sessions", {
      code: args.code,
      hostName: args.hostName,
      hostClientId: args.hostClientId,
      movieTitle: args.movieTitle,
      worldUrl: args.worldUrl,
      flyApp: args.flyApp,
      wsUrl: args.wsUrl,
      foundryUrl: args.foundryUrl,
      viewerCount: 0,
      maxViewers: args.maxViewers,
      isMoviePlaying: false,
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
    });
    
    return { sessionId, updated: false };
  },
});

/**
 * Heartbeat - update last seen time and viewer count
 */
export const heartbeat = mutation({
  args: {
    code: v.string(),
    viewerCount: v.optional(v.number()),
    isMoviePlaying: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    
    if (!session) {
      return { success: false, error: "Session not found" };
    }
    
    const updates: Record<string, unknown> = {
      lastHeartbeat: Date.now(),
    };
    
    if (args.viewerCount !== undefined) {
      updates.viewerCount = args.viewerCount;
    }
    if (args.isMoviePlaying !== undefined) {
      updates.isMoviePlaying = args.isMoviePlaying;
    }
    
    await ctx.db.patch(session._id, updates);
    return { success: true };
  },
});

/**
 * End a session (called when host disconnects)
 */
export const end = mutation({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    
    if (session) {
      await ctx.db.delete(session._id);
      return { success: true };
    }
    return { success: false, error: "Session not found" };
  },
});

/**
 * List all active sessions (for lobby page)
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessions = await ctx.db.query("sessions").collect();
    
    // Filter out stale sessions (no heartbeat in threshold)
    const activeSessions = sessions.filter(
      (s) => now - s.lastHeartbeat < STALE_THRESHOLD_MS
    );
    
    // Return public info only (no internal IDs)
    return activeSessions.map((s) => ({
      code: s.code,
      hostName: s.hostName,
      movieTitle: s.movieTitle,
      flyApp: s.flyApp,
      wsUrl: s.wsUrl,
      foundryUrl: s.foundryUrl,
      viewerCount: s.viewerCount,
      maxViewers: s.maxViewers,
      isMoviePlaying: s.isMoviePlaying,
      createdAt: s.createdAt,
    }));
  },
});

/**
 * Get a specific session by code
 */
export const getByCode = query({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    
    if (!session) return null;
    
    // Check if stale
    if (Date.now() - session.lastHeartbeat > STALE_THRESHOLD_MS) {
      return null;
    }
    
    return {
      code: session.code,
      hostName: session.hostName,
      movieTitle: session.movieTitle,
      flyApp: session.flyApp,
      wsUrl: session.wsUrl,
      foundryUrl: session.foundryUrl,
      viewerCount: session.viewerCount,
      maxViewers: session.maxViewers,
      isMoviePlaying: session.isMoviePlaying,
      createdAt: session.createdAt,
    };
  },
});

/**
 * Internal: Clean up stale sessions (called by cron)
 */
export const cleanupStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const threshold = now - STALE_THRESHOLD_MS;
    
    const staleSessions = await ctx.db
      .query("sessions")
      .withIndex("by_lastHeartbeat", (q) => q.lt("lastHeartbeat", threshold))
      .collect();
    
    for (const session of staleSessions) {
      console.log(`[Cleanup] Removing stale session: ${session.code}`);
      await ctx.db.delete(session._id);
    }
    
    return { removed: staleSessions.length };
  },
});
