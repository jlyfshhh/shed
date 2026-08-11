# Browser security and phone installation

Shed is designed for a trusted home network. Keep it behind your router and do
not forward its port directly to the public internet.

## HTTP versus HTTPS

Shed works as a normal website at a local HTTP address. Browsers reserve some
installed-app features for a **secure context**:

- HTTPS is a secure context. The same-device `localhost` exception is also
  secure, but an address such as `http://192.168.x.x` or an HTTP `.local`
  hostname ordinarily is not.
- A phone may still offer **Add to Home Screen** for a plain LAN HTTP site, but
  behavior differs by browser and OS. Treat it as a convenient shortcut, not a
  guarantee of full PWA install prompts or offline operation.
- Shed does not currently ship an offline service worker. Care records always
  come from the self-hosted server, so the server and network must be reachable
  even when the icon launches in a standalone window.
- For consistent secure-context behavior, put Shed behind a trusted HTTPS
  reverse proxy on the LAN. Keep household sign-in enabled and keep the host
  firewalled; HTTPS does not make direct internet exposure appropriate.

## Response policy

Every Shed route receives a Content Security Policy, MIME-sniffing protection,
frame denial, a no-referrer policy, and a restrictive browser permissions
policy. Uploaded plan sheets retain their stricter sandbox policy.

The current React runtime and pre-paint theme bootstrap emit inline scripts,
and component styles use inline style attributes. The compatible CSP therefore
still includes `unsafe-inline` for scripts and styles. Scripts, connections,
images, workers, and manifests otherwise stay on Shed's own origin; plugins are
disabled and framing is denied. A future nonce-based runtime could remove the
inline-script exception.
