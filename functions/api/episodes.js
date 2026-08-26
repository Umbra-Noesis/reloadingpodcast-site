// Episode list, merged from two sources:
//
//  - Episodes #1-FRN_ARCHIVE_MAX_EPISODE: served from the static snapshot at
//    /assets/data/episodes-frn-archive.json. FRN (the show's original host)
//    stopped publishing new Reloading Podcast episodes after #597, and their
//    own RSS feed only ever carries a capped number of recent items anyway
//    (see scripts/snapshot-frn-episodes.mjs for detail) -- so rather than
//    depend on their feed staying up and unchanged forever, that range is
//    frozen into our own permanent copy.
//  - Episodes newer than that: scraped live from Rumble
//    (rumble.com/user/ReloadingPodcast), which is where new episodes
//    actually land now. Rumble doesn't publish an RSS/JSON feed, but its
//    channel page embeds the same structured data its own front end uses to
//    render the video grid, which we parse directly.
//
// Anything Rumble shows at or below FRN_ARCHIVE_MAX_EPISODE is deliberately
// ignored -- the FRN snapshot already owns that range permanently, so this
// can't develop a gap even if Rumble's own archive later starts trimming
// its older pages (short of it someday trimming all the way past #597,
// which would take trimming through the show's entire posting history since
// this was written -- a problem for a future re-look, not this design).

const FRN_ARCHIVE_MAX_EPISODE = 597;
const RUMBLE_CHANNEL_URL = "https://rumble.com/user/ReloadingPodcast";

function parseEpisodeNumber(title) {
  const m = (title || "").match(/Reloading Podcast\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

async function loadFrnArchive(context) {
  const url = new URL(context.request.url);
  const archiveUrl = new URL("/assets/data/episodes-frn-archive.json", url.origin);
  const res = await context.env.ASSETS.fetch(new Request(archiveUrl));
  if (!res.ok) return [];
  return res.json();
}

async function debugRumbleFetch() {
  const res = await fetch(RUMBLE_CHANNEL_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 0 },
  });
  const body = await res.text();
  return new Response(JSON.stringify({
    status: res.status,
    ok: res.ok,
    headers: Object.fromEntries(res.headers.entries()),
    bodyLength: body.length,
    bodyStart: body.slice(0, 1500),
    hasGridMarker: body.includes("rum-videos-grid"),
  }, null, 2), { headers: { "content-type": "application/json" } });
}

async function loadNewRumbleEpisodes() {
  const res = await fetch(RUMBLE_CHANNEL_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 1800, cacheEverything: true },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const m = html.match(/<rum-videos-grid>\s*<script type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }

  return (data.items || [])
    .map((it) => ({
      episodeNumber: parseEpisodeNumber(it.title),
      title: it.title,
      link: it.url,
      pubDate: it.upload_date,
      image: it.thumb,
      duration: it.duration,
      source: "rumble",
    }))
    // Page 1 is always the newest 25 videos, so it's all we need to find
    // anything past the frozen FRN ceiling -- no pagination required.
    .filter((ep) => ep.episodeNumber !== null && ep.episodeNumber > FRN_ARCHIVE_MAX_EPISODE);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.searchParams.has("debugRumble")) return debugRumbleFetch();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 300);

  const [archive, freshFromRumble] = await Promise.all([
    loadFrnArchive(context),
    loadNewRumbleEpisodes().catch(() => []),
  ]);

  const episodes = [...freshFromRumble, ...archive]
    // Publish date, not episode number -- FRN's own numbering has at least
    // one bad entry (an episode titled "1546" published in mid-2025, over a
    // year before the real #597), so number isn't a safe sort key.
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, limit);

  return new Response(JSON.stringify({ episodes }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=1800",
    },
  });
}
