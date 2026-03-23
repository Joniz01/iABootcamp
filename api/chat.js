// api/chat.js — Vercel Serverless Function
// Proxies requests to Gemini or Groq server-side to avoid CORS issues

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { provider, apiKey, systemPrompt, messages } = body;

  if (!provider || !apiKey || !messages) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
  }

  // Security: basic key format validation server-side
  if (provider === "gemini" && !apiKey.startsWith("AIza")) {
    return new Response(JSON.stringify({ error: "Invalid Gemini API key format" }), { status: 400 });
  }
  if (provider === "groq" && !apiKey.startsWith("gsk_")) {
    return new Response(JSON.stringify({ error: "Invalid Groq API key format" }), { status: 400 });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  };

  try {
    if (provider === "gemini") {
      // Build Gemini contents array
      let contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }],
      }));
      if (contents.length === 0) {
        contents = [{ role: "user", parts: [{ text: "Inicia." }] }];
      }
      if (contents[contents.length - 1].role !== "user") {
        contents.push({ role: "user", parts: [{ text: "continúa" }] });
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
            contents,
            generationConfig: { maxOutputTokens: 1200, temperature: 0.7 },
          }),
        }
      );

      if (!geminiRes.ok) {
        const errData = await geminiRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errData?.error?.message || `Gemini HTTP ${geminiRes.status}` }),
          { status: geminiRes.status, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } }
        );
      }
      // Stream the response directly
      return new Response(geminiRes.body, { status: 200, headers: corsHeaders });

    } else if (provider === "groq") {
      const groqMsgs = [{ role: "system", content: systemPrompt || "Eres un tutor útil." }];
      for (const m of messages) {
        groqMsgs.push({ role: m.role, content: m.content });
      }

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1200,
          stream: true,
          messages: groqMsgs,
        }),
      });

      if (!groqRes.ok) {
        const errData = await groqRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errData?.error?.message || `Groq HTTP ${groqRes.status}` }),
          { status: groqRes.status, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } }
        );
      }
      return new Response(groqRes.body, { status: 200, headers: corsHeaders });

    } else {
      return new Response(JSON.stringify({ error: "Proveedor no soportado" }), { status: 400 });
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Error interno del servidor" }),
      { status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } }
    );
  }
}
