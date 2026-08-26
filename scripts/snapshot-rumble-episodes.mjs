#!/usr/bin/env node
// Scheduled updater for assets/data/episodes-rumble-archive.json -- run
// daily by a cron job on genesis (~/bin/update_rlp_episodes.sh), not as a
// Cloudflare Pages Function or a GitHub Actions workflow. Both of those
// were tried first and both get a 403 from Rumble's bot-protection --
// Cloudflare's edge network and GitHub-hosted runners are both well-known
// automation IP ranges. A personal machine's own connection isn't, which
// is the whole reason this runs there instead. See functions/api/episodes.js
// for the full story.
//
// Fetches Rumble's channel page 1 (always the newest ~25 videos -- new
// episodes never need deeper pages), keeps only episodes past
// FRN_ARCHIVE_MAX_EPISODE, and MERGES them into whatever's already in the
// archive file rather than overwriting it. That matters: once the show has
// posted 25+ episodes since #597, the earliest of those will scroll off
// Rumble's own page 1 -- overwriting on every run would silently drop them
// back out of our record the day that happens. Merging means once an
// episode is captured here, it's permanent.
//
// Usage: node scripts/snapshot-rumble-episodes.mjs

import fs from "node:fs/promises";
import { FRN_ARCHIVE_MAX_EPISODE, extractRumbleItems } from "../functions/_lib/episodeSources.mjs";

const RUMBLE_CHANNEL_URL = "https://rumble.com/user/ReloadingPodcast";
const OUT_PATH = new URL("../assets/data/episodes-rumble-archive.json", import.meta.url);

const res = await fetch(RUMBLE_CHANNEL_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!res.ok) {
  console.error(`Rumble fetch failed: HTTP ${res.status}`);
  process.exit(1);
}

const html = await res.text();
const fresh = extractRumbleItems(html).filter(
  (ep) => ep.episodeNumber !== null && ep.episodeNumber > FRN_ARCHIVE_MAX_EPISODE
);

if (!fresh.length) {
  console.error("No qualifying episodes found on Rumble's page -- page shape may have changed.");
  process.exit(1);
}

let existing = [];
try {
  existing = JSON.parse(await fs.readFile(OUT_PATH, "utf8"));
} catch {
  // No existing file yet -- first run.
}

const byNumber = new Map(existing.map((ep) => [ep.episodeNumber, ep]));
let added = 0;
for (const ep of fresh) {
  if (!byNumber.has(ep.episodeNumber)) added++;
  byNumber.set(ep.episodeNumber, ep); // fresh data wins on overlap (e.g. a corrected title)
}

const merged = [...byNumber.values()].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
await fs.writeFile(OUT_PATH, JSON.stringify(merged, null, 2) + "\n");

console.log(`Rumble archive: ${merged.length} episodes total (${added} new this run).`);
