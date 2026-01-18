import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { invoke, invokeStream, options as aiOptions } from "./ai";

const http = httpRouter();

/**
 * POST /session/register
 * Called by WS server when host creates a session
 */
http.route({
  path: "/session/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    
    const result = await ctx.runMutation(api.sessions.register, {
      code: body.code,
      hostName: body.hostName,
      hostClientId: body.hostClientId,
      movieTitle: body.movieTitle || "Unknown Movie",
      worldUrl: body.worldUrl,
      flyApp: body.flyApp,
      wsUrl: body.wsUrl,
      foundryUrl: body.foundryUrl,
      maxViewers: body.maxViewers || 8,
    });
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

/**
 * POST /session/heartbeat
 * Called periodically by WS server to keep session alive
 */
http.route({
  path: "/session/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    
    const result = await ctx.runMutation(api.sessions.heartbeat, {
      code: body.code,
      viewerCount: body.viewerCount,
      isMoviePlaying: body.isMoviePlaying,
    });
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

/**
 * POST /session/end
 * Called by WS server when host disconnects
 */
http.route({
  path: "/session/end",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    
    const result = await ctx.runMutation(api.sessions.end, {
      code: body.code,
    });
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

/**
 * GET /sessions
 * Get list of active sessions (can be called from anywhere)
 */
http.route({
  path: "/sessions",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const sessions = await ctx.runQuery(api.sessions.list, {});
    
    return new Response(JSON.stringify(sessions), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

/**
 * OPTIONS handler for CORS preflight
 */
http.route({
  path: "/session/register",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/session/heartbeat",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/session/end",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ========== AI Chat Proxy ==========
// Routes NPC chat through Convex to keep Braintrust API key server-side

http.route({
  path: "/ai/invoke",
  method: "POST",
  handler: invoke,
});

http.route({
  path: "/ai/invoke",
  method: "OPTIONS",
  handler: aiOptions,
});

http.route({
  path: "/ai/stream",
  method: "POST",
  handler: invokeStream,
});

http.route({
  path: "/ai/stream",
  method: "OPTIONS",
  handler: aiOptions,
});

export default http;
