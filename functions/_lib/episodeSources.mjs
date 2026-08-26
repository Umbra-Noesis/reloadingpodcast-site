// Shared parsing helpers used by both the live episodes Function
// (functions/api/episodes.js) and the scheduled Rumble-archive updater
// (scripts/snapshot-rumble-episodes.mjs), so the two never drift apart.

// Episodes at or below this number are permanently owned by
// assets/data/episodes-frn-archive.json (FRN stopped publishing new
// Reloading Podcast episodes after #597). Anything above it comes from
// Rumble instead -- see functions/api/episodes.js for the full story.
export const FRN_ARCHIVE_MAX_EPISODE = 597;

export function parseEpisodeNumber(title) {
  const m = (title || "").match(/Reloading Podcast\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Extracts the video list Rumble embeds in its channel page for its own
// front end to render (no public RSS/API exists there). Returns [] if the
// page's shape has changed and the marker can't be found, rather than
// throwing -- callers should treat that as "nothing new this run", not a
// hard failure.
export function extractRumbleItems(html) {
  const m = html.match(/<rum-videos-grid>\s*<script type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }

  return (data.items || []).map((it) => ({
    episodeNumber: parseEpisodeNumber(it.title),
    title: it.title,
    link: it.url,
    pubDate: it.upload_date,
    image: it.thumb,
    duration: it.duration,
    source: "rumble",
  }));
}
