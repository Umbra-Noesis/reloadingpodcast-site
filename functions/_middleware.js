// Routes reloadingpodcast.net's root to the host-access placeholder page,
// while reloadingpodcast.com (and the .pages.dev preview) keep serving the
// normal public site. Both domains point at this one Pages deployment, so
// this is what keeps them from just being mirrors of each other.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isNet = url.hostname === "reloadingpodcast.net" || url.hostname === "www.reloadingpodcast.net";

  if (isNet && (url.pathname === "/" || url.pathname === "/index.html")) {
    url.pathname = "/net/index.html";
    return context.env.ASSETS.fetch(new Request(url, context.request));
  }

  return context.next();
}
