// supabase/functions/parse-flight/index.ts
//
// Accepts EITHER an uploaded boarding-pass/e-ticket image OR pasted/typed
// free-text flight details, and asks Claude (forced tool-use) to extract
// structured flight fields. An image also gets stored in the
// `boarding-passes` bucket first; plain text has nothing to store. Returns
// the parsed fields for a human to review/edit in the UI — this function
// never writes to the `flights` table itself; that only happens after the
// human confirms, via save-flight.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

// Computed fresh per request from the server's own clock — Claude has no
// reliable notion of "today" on its own (its training cutoff is not today's
// date), so a boarding pass with no printed year was seen defaulting to a
// past year instead of the upcoming one. Every date-related instruction
// below is grounded against this explicit value instead of leaving the
// model to guess.
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFlightTool(today: string) {
  return {
    name: "record_flight",
    description:
      "Structured flight details extracted from a boarding pass, e-ticket, or booking confirmation image.",
    input_schema: {
      type: "object",
      properties: {
        passenger_name: { type: ["string", "null"], description: "Name printed on the document, if visible." },
        airline_code: {
          type: ["string", "null"],
          description: "2-letter IATA airline code, e.g. 'UA'. Best guess from the airline name/logo if the code itself isn't printed.",
        },
        flight_number: { type: ["string", "null"], description: "Digits only, no airline-code prefix, e.g. '905'." },
        from_airport: { type: ["string", "null"], description: "3-letter IATA origin airport code." },
        to_airport: { type: ["string", "null"], description: "3-letter IATA destination airport code." },
        date: {
          type: ["string", "null"],
          description:
            `Departure date as YYYY-MM-DD. Today is ${today}. If a year is printed, use it exactly as ` +
            "printed, even if that makes the flight dated in the past (someone may be logging an old " +
            "trip on purpose). If only month/day is printed with NO year, assume this is an upcoming " +
            `trip being booked or checked in for around now — pick the soonest date on/after ${today} ` +
            "that matches that month/day, not a past year.",
        },
        depart_time: { type: ["string", "null"], description: "Local departure time as 24-hour HH:MM, if printed." },
        arrive_time: {
          type: ["string", "null"],
          description: "Local arrival time as 24-hour HH:MM, ONLY if explicitly printed — never calculate or guess this.",
        },
        low_confidence_fields: {
          type: "array",
          items: { type: "string" },
          description: "Names of the above fields you're genuinely unsure about, so the UI can flag them for double-checking.",
        },
      },
      required: ["airline_code", "flight_number", "from_airport", "to_airport", "date", "depart_time"],
    },
  } as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { image, mediaType, text } = await req.json();
    const hasImage = !!image && !!mediaType;
    const hasText = !!text && !!String(text).trim();
    if (!hasImage && !hasText) return json({ ok: false, error: "Missing image or text" }, 400);
    if (hasImage && !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
      return json({ ok: false, error: "Unsupported image type — use JPEG, PNG, WebP, or GIF" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Store the raw image first, before calling the AI — if parsing fails
    // downstream, the upload itself isn't lost and can be retried or fixed
    // by hand without asking the family member to re-upload. Pasted text has
    // nothing to store, so this whole step is skipped for that path.
    let path: string | null = null;
    if (hasImage) {
      const ext = mediaType.split("/")[1];
      path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("boarding-passes")
        .upload(path, base64ToBytes(image), { contentType: mediaType });
      if (uploadError) return json({ ok: false, error: `Upload failed: ${uploadError.message}` }, 500);
    }

    const today = todayISO();
    const content: unknown[] = [];
    if (hasImage) content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
    content.push({
      type: "text",
      text: hasImage
        ? `Today's date is ${today}. This is a photo or screenshot of a boarding pass, e-ticket, ` +
          "or flight booking confirmation. Extract the flight details using the record_flight " +
          "tool. If a field genuinely isn't visible in the image, use null for it rather than " +
          "guessing — a family member will review and fill in gaps by hand before this is saved."
        : `Today's date is ${today}. This is pasted or typed text describing a flight — could be ` +
          "a booking confirmation email, an itinerary, or just someone's own shorthand notes. " +
          "Extract the flight details using the record_flight tool. If a field genuinely isn't " +
          "mentioned, use null for it rather than guessing — a family member will review and " +
          "fill in gaps by hand before this is saved.\n\n---\n" + String(text).slice(0, 8000),
    });

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        tools: [buildFlightTool(today)],
        tool_choice: { type: "tool", name: "record_flight" },
        messages: [{ role: "user", content }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return json({ ok: false, error: `AI parsing failed (${aiRes.status})`, detail, imagePath: path }, 502);
    }

    const aiData = await aiRes.json();
    const toolUse = (aiData.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse) return json({ ok: false, error: "AI didn't return structured data", imagePath: path }, 502);

    return json({ ok: true, parsed: toolUse.input, imagePath: path });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64; // strip a data: URL prefix if present
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
