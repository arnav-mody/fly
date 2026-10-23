// supabase/functions/parse-flight/index.ts
//
// Accepts EITHER an uploaded screenshot (boarding pass, e-ticket, booking
// confirmation) OR pasted/typed free text, and asks Claude to extract every
// flight leg in it as structured JSON. The image is only ever held in memory
// for this one request — it's sent straight to Claude's vision API and never
// written to Storage, so a boarding pass (which can carry a booking reference
// or other identifying detail) never persists anywhere past this request. If
// parsing fails, re-uploading is the retry path, not a saved copy. Returns
// the parsed legs for a human to review/edit in the UI — this function never
// writes to the `flights` table itself; that only happens after the human
// confirms, via save-flight.
//
// Two response shapes:
// - `multi: true` in the body → `{ ok, itinerary: { legs: [...], passenger_names } }`,
//   every leg in the image (outbound, return, each connection). The add-trip
//   flow uses this.
// - otherwise → `{ ok, parsed: {...one flight...} }`, the original shape, so a
//   browser still running an older page build keeps working until it reloads.
//   It's just the first leg of the same extraction.

import Anthropic from "npm:@anthropic-ai/sdk@1";
import { adminClient, CORS_HEADERS, json, requireProfile } from "../_shared/viewer.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

// Opus 5.5 rather than the Haiku this started on: reading a whole itinerary
// (which segments are connections, which block is the return, what's an ad
// for a different flight) is judgment, not just transcription. At low effort
// it's still on the order of a cent or two per screenshot.
const MODEL = "claude-opus-5-5";

// Computed fresh per request from the server's own clock — Claude has no
// reliable notion of "today" on its own (its training cutoff is not today's
// date), so a boarding pass with no printed year was seen defaulting to a
// past year instead of the upcoming one. Every date-related instruction
// below is grounded against this explicit value instead of leaving the
// model to guess.
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const nullableString = (description: string) => ({ type: ["string", "null"], description });

function itinerarySchema(today: string) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["passenger_names", "legs"],
    properties: {
      passenger_names: {
        type: "array",
        items: { type: "string" },
        description: "Every traveler name printed on the document, as printed. Empty if none.",
      },
      legs: {
        type: "array",
        description: "Every booked segment, in the order travelled.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "mode", "airline_code", "flight_number", "from_airport", "to_airport", "date",
            "depart_time", "arrive_time", "arrive_day_offset", "direction", "connects_to_next",
            "low_confidence_fields",
          ],
          properties: {
            mode: { type: "string", enum: ["flight", "train"] },
            airline_code: nullableString(
              "2-letter IATA airline code, e.g. 'UA'. Best guess from the airline name/logo if the code itself isn't printed. Null for trains.",
            ),
            flight_number: nullableString("Digits only, no airline-code prefix, e.g. '905'. Null for trains."),
            from_airport: nullableString(
              "3-letter IATA origin airport code for flights; the station's city name for trains.",
            ),
            to_airport: nullableString(
              "3-letter IATA destination airport code for flights; the station's city name for trains.",
            ),
            date: nullableString(
              `Departure date as YYYY-MM-DD. Today is ${today}. If a year is printed, use it exactly as ` +
                "printed, even if that makes the trip dated in the past (someone may be logging an old " +
                "trip on purpose). If only month/day is printed with NO year, assume this is an upcoming " +
                `trip — pick the soonest date on/after ${today} that matches that month/day.`,
            ),
            depart_time: nullableString("Local departure time as 24-hour HH:MM (zero-padded), if printed."),
            arrive_time: nullableString(
              "Local arrival time as 24-hour HH:MM (zero-padded), ONLY if explicitly printed — never calculate or guess this.",
            ),
            arrive_day_offset: {
              type: ["integer", "null"],
              description:
                "How many calendar days after this leg's departure date it lands, in local time at each " +
                "end: 0 = same day, 1 = next day ('+1'), 2 = two days later ('+2'), -1 = the previous " +
                "calendar day (westbound across the date line). Read it from a printed '+1'/'+2' marker " +
                "or a separately printed arrival date. If neither is printed, only answer when the route " +
                "makes it unambiguous (an evening long-haul departure with a morning arrival can't be the " +
                "same day). Null if you can't tell.",
            },
            direction: {
              type: "string",
              enum: ["outbound", "return", "unknown"],
              description:
                "Which half of a round trip this leg belongs to, from headings like Depart/Return, " +
                "Outbound/Inbound, or the route turning back home. 'unknown' for one-way trips or when it isn't shown.",
            },
            connects_to_next: {
              type: ["boolean", "null"],
              description:
                "True if the NEXT leg in this list is a connection on the same journey (it departs from " +
                "where this one lands, as part of the same booked journey — a layover). False if the next " +
                "leg starts a separate journey (e.g. the return) or this is the last leg. Null if unsure.",
            },
            low_confidence_fields: {
              type: "array",
              items: { type: "string" },
              description: "Names of this leg's fields you're genuinely unsure about, so the UI can flag them.",
            },
          },
        },
      },
    },
  };
}

const INSTRUCTIONS =
  "Extract every booked flight (or train) segment using the JSON format provided.\n" +
  "- A connecting itinerary lists each segment separately: return each one as its own leg " +
  "(New York → London and London → Mumbai are two legs), never one collapsed leg.\n" +
  "- Include both the outbound and the return if both are shown.\n" +
  "- Skip anything that isn't this booking: search results, ads, upgrade offers, alternative " +
  "flights, and segments marked cancelled or replaced.\n" +
  "- If a field genuinely isn't visible, use null rather than guessing — a family member " +
  "reviews every leg before it's saved.\n" +
  "- If nothing in the input is a trip, return an empty legs list.";

type Leg = Record<string, unknown> & {
  arrive_time?: string | null;
  arrival_time?: string | null;
  arrive_day_offset?: number | null;
};

// Structured outputs guarantee the shape, not the semantics — keep the day
// offset inside what the form can show, and fold in the arrival_time spelling
// Claude has been seen using in place of arrive_time.
function normalizeLeg(leg: Leg) {
  const out = { ...leg };
  if (!out.arrive_time && out.arrival_time) out.arrive_time = out.arrival_time;
  delete out.arrival_time;
  const offset = Number.isInteger(out.arrive_day_offset) ? (out.arrive_day_offset as number) : null;
  out.arrive_day_offset = offset == null ? null : Math.max(-1, Math.min(3, offset));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    // Every call costs real money (a Claude request), so only signed-in
    // family and friends can make one.
    const auth = await requireProfile(req, adminClient());
    if (auth.error) return auth.error;

    const { image, mediaType, text, multi } = await req.json();
    const hasImage = !!image && !!mediaType;
    const hasText = !!text && !!String(text).trim();
    if (!hasImage && !hasText) return json({ ok: false, error: "Missing image or text" }, 400);
    if (hasImage && !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
      return json({ ok: false, error: "Unsupported image type — use JPEG, PNG, WebP, or GIF" }, 400);
    }

    const today = todayISO();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (hasImage) content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
    content.push({
      type: "text",
      text: hasImage
        ? `Today's date is ${today}. This is a photo or screenshot of a boarding pass, e-ticket, ` +
          `booking confirmation, or itinerary.\n\n${INSTRUCTIONS}`
        : `Today's date is ${today}. This is pasted or typed text describing a trip — could be a ` +
          `booking confirmation email, an itinerary, or someone's own shorthand notes.\n\n${INSTRUCTIONS}` +
          "\n\n---\n" + String(text).slice(0, 8000),
    });

    let response;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // Refusals are very unlikely on a boarding pass, but a declined request
        // re-runs on Anthropic's recommended fallback instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: itinerarySchema(today) },
        },
        messages: [{ role: "user", content }],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        return json({ ok: false, error: "Too many uploads at once — wait a moment and try again." }, 429);
      }
      if (err instanceof Anthropic.BadRequestError) {
        return json({ ok: false, error: "Couldn't read that one — try a clearer screenshot?", detail: err.message }, 400);
      }
      if (err instanceof Anthropic.APIError) {
        return json({ ok: false, error: `AI parsing failed (${err.status})`, detail: err.message }, 502);
      }
      throw err;
    }

    if (response.stop_reason === "refusal") {
      return json({ ok: false, error: "Couldn't read that one — try a different screenshot?" }, 422);
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return json({ ok: false, error: "AI didn't return structured data" }, 502);

    let itinerary: { legs: Leg[]; passenger_names: string[] };
    try {
      itinerary = JSON.parse(textBlock.text);
    } catch {
      return json({ ok: false, error: "AI returned something unreadable — try again?" }, 502);
    }
    const legs = (itinerary.legs ?? []).map(normalizeLeg);
    const passengerNames = itinerary.passenger_names ?? [];

    if (multi) return json({ ok: true, itinerary: { legs, passenger_names: passengerNames } });

    // Legacy single-flight shape for older page builds.
    const first = legs[0];
    if (!first) return json({ ok: false, error: "Couldn't find a flight in that — mind typing it in?" }, 422);
    const offset = first.arrive_day_offset as number | null;
    return json({
      ok: true,
      parsed: {
        ...first,
        passenger_name: passengerNames[0] ?? null,
        arrives_next_day: offset == null ? null : offset >= 1,
      },
    });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});
