// supabase/functions/parse-flight/index.ts
//
// Accepts an uploaded boarding-pass / e-ticket / confirmation-email image,
// stores it in the `boarding-passes` bucket, and asks Claude (vision, forced
// tool-use) to extract structured flight details. Returns the parsed fields
// for a human to review/edit in the UI, plus the storage path — this
// function never writes to the `flights` table itself; that only happens
// after the human confirms, via save-flight.

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

const FLIGHT_TOOL = {
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
        description: "Departure date as YYYY-MM-DD. If only month/day is printed with no year, infer the most plausible upcoming year.",
      },
      depart_time: { type: ["string", "null"], description: "Local departure time as 24-hour HH:MM, if printed." },
      arrive_time: {
        type: ["string", "null"],
        description: "Local arrival time as 24-hour HH:MM, ONLY if explicitly printed — never calculate or guess this.",
      },
      seat: { type: ["string", "null"] },
      confirmation: { type: ["string", "null"], description: "Booking reference / confirmation / PNR code." },
      gate: { type: ["string", "null"] },
      terminal: { type: ["string", "null"] },
      low_confidence_fields: {
        type: "array",
        items: { type: "string" },
        description: "Names of the above fields you're genuinely unsure about, so the UI can flag them for double-checking.",
      },
    },
    required: ["airline_code", "flight_number", "from_airport", "to_airport", "date", "depart_time"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { image, mediaType } = await req.json();
    if (!image || !mediaType) return json({ ok: false, error: "Missing image or mediaType" }, 400);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
      return json({ ok: false, error: "Unsupported image type — use JPEG, PNG, WebP, or GIF" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Store the raw image first, before calling the AI — if parsing fails
    // downstream, the upload itself isn't lost and can be retried or fixed
    // by hand without asking the family member to re-upload.
    const ext = mediaType.split("/")[1];
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("boarding-passes")
      .upload(path, base64ToBytes(image), { contentType: mediaType });
    if (uploadError) return json({ ok: false, error: `Upload failed: ${uploadError.message}` }, 500);

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
        tools: [FLIGHT_TOOL],
        tool_choice: { type: "tool", name: "record_flight" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              {
                type: "text",
                text:
                  "This is a photo or screenshot of a boarding pass, e-ticket, or flight booking " +
                  "confirmation. Extract the flight details using the record_flight tool. If a field " +
                  "genuinely isn't visible in the image, use null for it rather than guessing — a " +
                  "family member will review and fill in gaps by hand before this is saved.",
              },
            ],
          },
        ],
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
