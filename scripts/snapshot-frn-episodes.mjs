#!/usr/bin/env node
// One-time (re-runnable) snapshot of FRN's RSS feed into a static JSON file.
//
// FRN stopped publishing new Reloading Podcast episodes after #597, and
// their feed only ever carries a capped number of recent items anyway (it
// doesn't reach episode 1). Since it's not gaining anything new, there's no
// reason to keep depending on their server being up/unchanged forever --
// this script captures what's there now into assets/data/episodes-frn-archive.json,
// which functions/api/episodes.js then treats as the permanent record for
// every episode at or below FRN_ARCHIVE_MAX_EPISODE (see that file).
//
// Re-run this only if FRN ever resumes publishing and you want to raise the
// ceiling -- it isn't part of the normal build/deploy.
//
// Usage: node scripts/snapshot-frn-episodes.mjs

const FEED_URL = "https://firearmsradio.net/category/podcasts/reloading-2/feed/";
const OUT_PATH = new URL("../assets/data/episodes-frn-archive.json", import.meta.url);

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripCdata(str) {
  const m = str.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : str;
}

function getTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return "";
  return decodeEntities(stripCdata(m[1]).trim());
}

function excerpt(description, maxLen = 220) {
  const text = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function parseEpisodeNumber(title) {
  const m = title.match(/Reloading Podcast\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

const res = await fetch(FEED_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!res.ok) {
  console.error(`Feed fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const xml = await res.text();
const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

const episodes = itemBlocks
  .map((block) => {
    const enclosureMatch = block.match(/<enclosure[^>]*url="([^"]+)"/);
    const imageMatch = block.match(/<itunes:image[^>]*href="([^"]+)"/);
    const title = getTag(block, "title");
    return {
      episodeNumber: parseEpisodeNumber(title),
      title,
      link: getTag(block, "link"),
      pubDate: getTag(block, "pubDate"),
      excerpt: excerpt(getTag(block, "description")),
      audio: enclosureMatch ? enclosureMatch[1] : null,
      image: imageMatch ? imageMatch[1] : null,
      source: "frn",
    };
  })
  .filter((ep) => ep.episodeNumber !== null)
  // Sort by actual publish date, not the parsed episode number -- FRN's own
  // numbering isn't reliable (one item in this feed is titled "Reloading
  // Podcast 1546" despite being published in July 2025, over a year before
  // the real #597; sorting by number would shove that straight to the top).
  .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

const fs = await import("node:fs/promises");
await fs.writeFile(OUT_PATH, JSON.stringify(episodes, null, 2) + "\n");

console.log(
  `Wrote ${episodes.length} episodes (#${episodes[episodes.length - 1].episodeNumber}` +
  `–#${episodes[0].episodeNumber}) to ${OUT_PATH.pathname}`
);
