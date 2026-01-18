/**
 * AI Chat Proxy
 * 
 * Proxies requests to Braintrust API, keeping the API key server-side.
 * Set BRAINTRUST_API_KEY in Convex dashboard environment variables.
 */

import { httpAction } from "./_generated/server";

const BRAINTRUST_INVOKE_URL = 'https://api.braintrust.dev/function/invoke';

/**
 * Invoke a Braintrust function (non-streaming)
 */
export const invoke = httpAction(async (ctx, request) => {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "BRAINTRUST_API_KEY not configured" }),
      { 
        status: 500, 
        headers: corsHeaders("application/json")
      }
    );
  }

  try {
    const body = await request.json();
    
    const response = await fetch(BRAINTRUST_INVOKE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: body.input,
        stream: false,
        project_name: body.projectName,
        slug: body.slug
      })
    });

    const result = await response.text();
    
    return new Response(result, {
      status: response.status,
      headers: corsHeaders("application/json")
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: corsHeaders("application/json")
      }
    );
  }
});

/**
 * Invoke a Braintrust function with streaming
 * Proxies the stream directly to the client
 */
export const invokeStream = httpAction(async (ctx, request) => {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  
  console.log("[AI] invokeStream called, apiKey exists:", !!apiKey);
  
  if (!apiKey) {
    console.log("[AI] No API key found!");
    return new Response(
      JSON.stringify({ error: "BRAINTRUST_API_KEY not configured" }),
      { 
        status: 500, 
        headers: corsHeaders("application/json")
      }
    );
  }

  try {
    const body = await request.json();
    console.log("[AI] Request body:", JSON.stringify(body));
    
    // Use non-streaming for now since Convex doesn't proxy streams well
    const btRequest = {
      input: body.input,
      stream: false,  // Changed to non-streaming
      project_name: body.projectName,
      slug: body.slug
    };
    console.log("[AI] Braintrust request:", JSON.stringify(btRequest));
    
    const response = await fetch(BRAINTRUST_INVOKE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(btRequest)
    });

    console.log("[AI] Braintrust response status:", response.status);
    
    const responseText = await response.text();
    console.log("[AI] Braintrust response:", responseText.substring(0, 500));

    if (!response.ok) {
      console.log("[AI] Braintrust error:", responseText);
      return new Response(
        JSON.stringify({ error: responseText }),
        { 
          status: response.status, 
          headers: corsHeaders("application/json")
        }
      );
    }

    // Return as SSE format for compatibility with client
    // Parse the response and wrap in SSE event
    try {
      const data = JSON.parse(responseText);
      const content = data.output || data.result || responseText;
      console.log("[AI] Extracted content:", content);
      
      // Format as SSE stream (single event with full response)
      const sseResponse = `data: ${JSON.stringify({ type: "text_delta", data: content })}\n\ndata: [DONE]\n\n`;
      
      return new Response(sseResponse, {
        status: 200,
        headers: corsHeaders("text/event-stream")
      });
    } catch (e) {
      // If not JSON, return raw text
      const sseResponse = `data: ${JSON.stringify({ type: "text_delta", data: responseText })}\n\ndata: [DONE]\n\n`;
      return new Response(sseResponse, {
        status: 200,
        headers: corsHeaders("text/event-stream")
      });
    }
  } catch (error: any) {
    console.log("[AI] Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: corsHeaders("application/json")
      }
    );
  }
});

/**
 * CORS headers helper
 */
function corsHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/**
 * OPTIONS handler for CORS preflight
 */
export const options = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
});
