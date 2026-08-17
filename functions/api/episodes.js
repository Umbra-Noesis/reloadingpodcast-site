// Fetches the show's real RSS feed (hosted on FRN/WordPress/PowerPress) and
// hands the site simplified JSON to render episode cards from. Runs
// server-side as a Cloudflare Pages Function so the browser never has to
// deal with cross-origin XML — it just calls /api/episodes on our own domain.
const FEED_URL = "https://firearmsradio.net/category/podcasts/reloading-2/feed/";

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
  // Strip any stray HTML, collapse whitespace, cut cleanly.
  const text = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

  const res = await fetch(FEED_URL, { cf: { cacheTtl: 1800, cacheEverything: true } });
  if (!res.ok) {
    return new Response(JSON.stringify({ episodes: [], error: "feed unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const xml = await res.text();
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  const episodes = itemBlocks.slice(0, limit).map((block) => {
    const enclosureMatch = block.match(/<enclosure[^>]*url="([^"]+)"/);
    const imageMatch = block.match(/<itunes:image[^>]*href="([^"]+)"/);
    return {
      title: getTag(block, "title"),
      link: getTag(block, "link"),
      pubDate: getTag(block, "pubDate"),
      excerpt: excerpt(getTag(block, "description")),
      audio: enclosureMatch ? enclosureMatch[1] : null,
      image: imageMatch ? imageMatch[1] : null,
    };
  });

  return new Response(JSON.stringify({ episodes }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=1800",
    },
  });
}
