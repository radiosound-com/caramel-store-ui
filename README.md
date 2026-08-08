# Caramel Store UI

Static catalog UI for Caramel Vanilla. It reads the public catalog API and the
signed first-party repository index:

- `GET /v1/catalog`
- `GET /v1/catalog/<package-name>`
- `GET /fdroid/repo/caramel-index-v1.json`

The UI is intentionally same-origin with the API. The OKD router sends the
longer `/v1/catalog` paths to the API Route and the root path to this static
application. The UI has no import controls and contains no import credentials.
It links to upstream artifacts and never mirrors APK files.

The image is published to GHCR by the included GitHub Actions workflow. The
production deployment and Route live in the
[caramel-store-manifests](https://github.com/radiosound-com/caramel-store-manifests)
repository.

The catalog merges curated upstream applications with signed first-party
releases, preferring the first-party entry when a package is present in both.
It displays the catalog freshness timestamp and marks revisions older than 48
hours as stale. Package details include the display name, summary, description,
icon, screenshots, manifest findings, automotive capability flags, SHA-256
checksum, APK download action, and validated HTTPS upstream links. Browser
requests are credential-free GETs and never contain import controls or
credentials.

Run the dependency-free UI tests with:

```sh
node --test app_test.mjs
```

Licensed under the Apache License, Version 2.0.
