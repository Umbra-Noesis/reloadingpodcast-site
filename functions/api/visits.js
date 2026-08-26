// Tiny visitor counter backed by Workers KV (binding: VISITS). Counts one
// visit per (day, visitor) pair rather than raw page loads, so refreshing
// the page doesn't inflate the numbers. GET returns { today, allTime }.
//
// Visitor identity is a same-day-only SHA-256 hash of IP + User-Agent —
// enough to dedupe repeat loads without ever storing the IP itself. The
// "seen" marker expires after ~26 hours so KV doesn't accumulate entries
// forever.

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

async function hashVisitor(ip, ua, day) {
  const data = new TextEncoder().encode(`${ip}|${ua}|${day}|reloadingpodcast-visits`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function currentCounts(env, day) {
  const [todayRaw, allTimeRaw] = await Promise.all([
    env.VISITS.get(`day:${day}`),
    env.VISITS.get("total"),
  ]);
  return {
    today: parseInt(todayRaw || "0", 10),
    allTime: parseInt(allTimeRaw || "0", 10),
  };
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const day = todayKey();
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const ua = request.headers.get("User-Agent") || "";
  const seenKey = `seen:${day}:${await hashVisitor(ip, ua, day)}`;

  const alreadySeen = await env.VISITS.get(seenKey);
  if (alreadySeen) {
    return json(await currentCounts(env, day));
  }

  // First time we've seen this visitor today — mark them and bump both
  // counters. Not atomic, but at this site's traffic level occasional
  // undercounting from a race is an acceptable tradeoff for staying on
  // plain KV instead of a Durable Object.
  await env.VISITS.put(seenKey, "1", { expirationTtl: 60 * 60 * 26 });
  const counts = await currentCounts(env, day);
  const today = counts.today + 1;
  const allTime = counts.allTime + 1;
  await Promise.all([
    env.VISITS.put(`day:${day}`, String(today)),
    env.VISITS.put("total", String(allTime)),
  ]);

  return json({ today, allTime });
}
