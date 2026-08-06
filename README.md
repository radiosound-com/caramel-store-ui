# Caramel Store UI

Static catalog UI for Caramel Vanilla. It reads only the public catalog API:

- `GET /v1/catalog`
- `GET /v1/catalog/<package-name>`

The UI is intentionally same-origin with the API. The OKD router sends the
longer `/v1/catalog` paths to the API Route and the root path to this static
application. The UI has no import controls and contains no import credentials.
It links to upstream artifacts and never mirrors APK files.

The image is published to GHCR by the included GitHub Actions workflow. The
production deployment and Route live in the
[caramel-store-manifests](https://github.com/radiosound-com/caramel-store-manifests)
repository.

Licensed under the Apache License, Version 2.0.
