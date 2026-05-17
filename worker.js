// VitalCore — Cloudflare Worker API Proxy v3
// Handles multi-turn web search tool loop automatically.

export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();

      const requestBody = {
        ...body,
        max_tokens: 1024,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
        }],
      };

      // Multi-turn loop: keep going until Claude returns end_turn or no tool_use
      let messages = [...(requestBody.messages || [])];
      let finalData = null;
      const MAX_TURNS = 5;

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ ...requestBody, messages }),
        });

        const data = await response.json();

        if (data.error) {
          return new Response(JSON.stringify({ error: data.error.message || "Anthropic API error" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        finalData = data;

        // If stop_reason is end_turn or no tool_use blocks, we're done
        const hasToolUse = (data.content || []).some(b => b.type === "tool_use");
        if (!hasToolUse || data.stop_reason === "end_turn") {
          break;
        }

        // Build tool_result messages for each tool_use block
        const assistantMsg = { role: "assistant", content: data.content };
        const toolResults = (data.content || [])
          .filter(b => b.type === "tool_use")
          .map(b => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: b.type === "web_search_20250305"
              ? JSON.stringify(b.input)
              : "Tool executed",
          }));

        messages = [
          ...messages,
          assistantMsg,
          { role: "user", content: toolResults },
        ];
      }

      return new Response(JSON.stringify(finalData), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }
};