// supabase/functions/parse-flight/index.ts
//
// Accepts EITHER an uploaded boarding-pass/e-ticket image OR pasted/typed
// free-text flight details, and asks Claude (forced tool-use) to extract
// structured flight fields. The image is only ever held in memory for this
// one request — it's sent straight to Claude's vision API and never written
// to Storage, so a boarding pass (which can carry a booking reference or
// other identifying detail) never persists anywhere past this request. If
// parsing fails, re-uploading is the retry path, not a saved copy. Returns
// the parsed fields for a human to review/edit in the UI — this function
// never writes to the `flights` table itself; that only happens after the
// human confirms, via save-flight.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

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
        arrive_day_offset: {
          type: ["integer", "null"],
          minimum: -1,
          maximum: 3,
          description:
            "How many calendar days after the departure date the arrival lands, in local time at each " +
            "airport: 0 = same day, 1 = next day ('+1'), 2 = two days later ('+2' — common on long " +
            "one-stop itineraries like New York to Mumbai), -1 = the previous calendar day (westbound " +
            "across the date line). Read it from a printed '+1'/'+2' marker or a separately printed " +
            "arrival date. If neither is printed, only answer when the route makes it unambiguous (an " +
            "evening long-haul departure with a morning arrival time can't be the same day). Null if " +
            "you can't tell — never guess.",
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
      return json({ ok: false, error: `AI parsing failed (${aiRes.status})`, detail }, 502);
    }

    const aiData = await aiRes.json();
    const toolUse = (aiData.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse) return json({ ok: false, error: "AI didn't return structured data" }, 502);

    // Tool-use output isn't strictly schema-validated: clamp the day offset to
    // what the form can show, and keep emitting the old arrives_next_day
    // boolean so a browser still running the previous page build keeps
    // working until it reloads.
    const parsed = { ...toolUse.input };
    const offset = Number.isInteger(parsed.arrive_day_offset) ? parsed.arrive_day_offset : null;
    parsed.arrive_day_offset = offset == null ? null : Math.max(-1, Math.min(3, offset));
    parsed.arrives_next_day = parsed.arrive_day_offset == null ? null : parsed.arrive_day_offset >= 1;
    // Seen in practice: Claude naming the field arrival_time instead of
    // the schema's arrive_time.
    if (!parsed.arrive_time && parsed.arrival_time) parsed.arrive_time = parsed.arrival_time;

    return json({ ok: true, parsed });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
