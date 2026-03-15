#!/usr/bin/env npx tsx
/**
 * Admin script: geo-reference a festival venue map image.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... \
 *   FESTIVAL_NAME="Lightning in a Bottle 2026" \
 *   VENUE_ADDRESS="Bradley, CA 93426 (Lake San Antonio)" \
 *   MAP_IMAGE_URL="https://example.com/lib-2026-venue-map.png" \
 *   npx tsx scripts/geo-reference-map.ts
 *
 * Outputs mapOverlay.anchors JSON to paste into the festival config.
 *
 * Install the Anthropic SDK once before running:
 *   npm install --save-dev @anthropic-ai/sdk
 */

import Anthropic from "@anthropic-ai/sdk";

const FESTIVAL_NAME = process.env.FESTIVAL_NAME;
const VENUE_ADDRESS = process.env.VENUE_ADDRESS;
const MAP_IMAGE_URL = process.env.MAP_IMAGE_URL;

if (!FESTIVAL_NAME || !VENUE_ADDRESS || !MAP_IMAGE_URL) {
  console.error(
    "Missing required environment variables: FESTIVAL_NAME, VENUE_ADDRESS, MAP_IMAGE_URL"
  );
  process.exit(1);
}

const client = new Anthropic();

async function geoReferenceMap(): Promise<void> {
  console.log(`\nGeo-referencing map for: ${FESTIVAL_NAME}`);
  console.log(`Venue: ${VENUE_ADDRESS}`);
  console.log(`Image: ${MAP_IMAGE_URL}\n`);

  const prompt = `This is the official venue map for "${FESTIVAL_NAME}" held at "${VENUE_ADDRESS}".

Analyze the map image and identify distinctive geographic features visible in it — lakes, rivers, roads, coastlines, parking areas, or unique land shapes.

Using your knowledge of the real-world location of this venue, estimate the GPS coordinates of:
- The top-left (NW) corner of this image
- The bottom-right (SE) corner of this image

Reason step by step:
1. Identify the most distinctive terrain features in the map (e.g., the shape of a lake, a road intersection, a hillside)
2. Match those features to your knowledge of the real-world location at "${VENUE_ADDRESS}"
3. Estimate the geographic extent of the map based on scale indicators, distances between known landmarks, or typical festival footprint
4. Derive the corner coordinates

Return ONLY valid JSON in this exact format with no other text:
{
  "topLeft": { "lat": <number>, "lng": <number> },
  "bottomRight": { "lat": <number>, "lng": <number> }
}`;

  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: MAP_IMAGE_URL! },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  process.stdout.write("Claude is analyzing the map");
  stream.on("text", () => process.stdout.write("."));

  const response = await stream.finalMessage();
  console.log("\n");

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("No text response from Claude");
    process.exit(1);
  }

  // Extract JSON from the response (Claude may wrap it in markdown)
  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Could not find JSON in response:\n", raw);
    process.exit(1);
  }

  let anchors: {
    topLeft: { lat: number; lng: number };
    bottomRight: { lat: number; lng: number };
  };

  try {
    anchors = JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse JSON:\n", jsonMatch[0]);
    process.exit(1);
  }

  const output = {
    mapOverlay: {
      image: MAP_IMAGE_URL,
      anchors,
    },
  };

  console.log("=== Paste into your festival config (venue section) ===\n");
  console.log(JSON.stringify(output, null, 2));
  console.log(
    "\n=== Verify these coordinates look correct on Google Maps before using ==="
  );
  console.log(`  NW corner: https://maps.google.com/?q=${anchors.topLeft.lat},${anchors.topLeft.lng}`);
  console.log(`  SE corner: https://maps.google.com/?q=${anchors.bottomRight.lat},${anchors.bottomRight.lng}`);
}

geoReferenceMap().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
