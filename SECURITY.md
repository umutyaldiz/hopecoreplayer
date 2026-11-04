# Security Policy

## Supported versions

Security fixes are released for the latest minor version of the `@hopeplayer/*` packages. Older versions are deprecated on npm — please update to the latest release.

| Version | Supported |
|---|---|
| latest 1.x | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report it privately through GitHub: **[Report a vulnerability](https://github.com/umutyaldiz/hopecoreplayer/security/advisories/new)** (repository → Security → Advisories → Report a vulnerability).

Please include:

- the affected package and version,
- a description of the issue and its impact (e.g. XSS through an option or an API response, URL scheme bypass, data sent to a third party),
- steps or a minimal `player.options` object to reproduce it.

You can expect an acknowledgement within **3 working days** and an assessment within **7 days**. Once a fix is released, the advisory is published with credit to you (unless you prefer to stay anonymous).

## Scope notes

- The player renders data from options and from APIs you configure (`sponsorship`, `adTriggers`, `geoChecker`…). Values are validated and rendered as plain text; a way to execute script or load a non-`http(s)` URL through them is in scope.
- Third-party SDKs (Google IMA, GPT, Prebid.js, Cast SDK, hls.js) are loaded from their official sources; issues inside those SDKs should be reported to their vendors.
