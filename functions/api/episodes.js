// Episode list, merged from two static, permanently-growing archives:
//
//  - assets/data/episodes-frn-archive.json: FRN stopped publishing new
//    Reloading Podcast episodes after #597, and their own RSS feed only
//    ever carried a capped number of recent items to begin with (see
//    scripts/snapshot-frn-episodes.mjs). Frozen once, never refreshed.
//  - assets/data/episodes-rumble-archive.json: everything #598+, kept
//    current by a daily cron job on genesis (~/bin/update_rlp_episodes.sh
//    + scripts/snapshot-rumble-episodes.mjs), not by anything running here
//    on Cloudflare.
//
// That external-job design isn't incidental: fetching Rumble live from
// *inside* this Function doesn't work. Rumble's own Cloudflare
// bot-protection challenges any request that originates from a well-known
// automation IP range -- confirmed directly for both Cloudflare's own edge
// network (403, `cf-mitigated: challenge`, a "Just a moment..." JS
// challenge page) and GitHub Actions' hosted runners, which is why this
// runs from a personal machine's own connection instead. Hence reading a
// pre-fetched static file here rather than scraping Rumble on every
// visitor request.
//
// Both archives only ever grow -- once an episode lands in one it stays
// there permanently, even if Rumble's own page later stops showing it
// (it will, eventually: Rumble's channel page only ever shows the current
// page of videos, so an episode scrolls out of page 1 once ~25 newer ones
// exist; the scheduled job merges instead of overwriting for exactly this
// reason). Sort is by actual publish date, not parsed episode number: the
// FRN feed has one item mistitled "Reloading Podcast 1546" despite being
// published in mid-2025, over a year before the real #597.

async function loadArchive(context, path) {
  const url = new URL(context.request.url);
  const assetUrl = new URL(path, url.origin);
  const res = await context.env.ASSETS.fetch(new Request(assetUrl));
  if (!res.ok) return [];
  return res.json();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 300);

  const [frnArchive, rumbleArchive] = await Promise.all([
    loadArchive(context, "/assets/data/episodes-frn-archive.json"),
    loadArchive(context, "/assets/data/episodes-rumble-archive.json"),
  ]);

  const episodes = [...rumbleArchive, ...frnArchive]
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, limit);

  return new Response(JSON.stringify({ episodes }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=1800",
    },
  });
}
