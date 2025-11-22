// netlify/functions/generate-tags.js
const fetch = require('node-fetch'); // Netlify Node 18+ has fetch global, but this is safe
const MAX_INPUT_LENGTH = 180;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const q = (body.q || '').toString().trim();
    const mode = (body.mode || 'youtube').toString().trim().toLowerCase();

    if (!q || q.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing query' }) };
    }
    if (q.length > MAX_INPUT_LENGTH) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Input too long' }) };
    }

    // Protect: simple rate-limiting placeholder could be implemented via external store (Redis)
    // Production: implement robust rate-limiting (per IP) or API key for heavier traffic.
    
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };

    // Build a safe prompt
    const prompt = [
      { role: "system", content: "You are an assistant that returns a JSON array of short keyword tags for videos. Return ONLY a JSON object like: {\"tags\": [\"tag1\",\"tag2\",...] } . No extra explanation." },
      { role: "user", content: `Generate up to 25 unique short tags for this query: \"${q}\". Mode: ${mode}. Tags should be short (1-4 words), comma-free, and lowercase. Prefer long-tail tags for better targeting. Return only JSON as described.` }
    ];

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: prompt,
        max_tokens: 400,
        temperature: 0.35,
        n: 1,
        stop: null
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Upstream API error', detail: txt }) };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Try to extract JSON from the assistant response safely
    let json;
    try {
      // find first { and last } to extract JSON block
      const first = content.indexOf('{');
      const last = content.lastIndexOf('}');
      const candidate = first >= 0 && last > first ? content.slice(first, last + 1) : content;
      json = JSON.parse(candidate);
    } catch (e) {
      // fallback: convert lines / comma separated text to array
      const fallback = content.replace(/[\n\r]+/g, ',').split(',').map(s => s.trim()).filter(Boolean);
      json = { tags: fallback.slice(0, 25) };
    }

    // finalize and sanitize
    const tags = Array.isArray(json.tags) ? json.tags
      .map(t => t.toString().toLowerCase().replace(/,/g, '').trim())
      .filter(Boolean)
      .slice(0, 25)
      : [];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    };

  } catch (err) {
    console.error('Function error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'internal_error' }) };
  }
};
