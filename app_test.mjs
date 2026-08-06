import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ApiError,
  CAPABILITY_EXPLANATIONS,
  catalogFreshness,
  catalogViewModel,
  classifyError,
  detailViewModel,
  isCatalogStale,
  loadCatalog,
  loadPackage,
  requestJson,
} from "./app-core.mjs";

const entry = {
  package_name: "org.example.maps",
  version_name: "1.2.3",
  version_code: 123,
  apk_url: "https://f-droid.org/repo/org.example.maps_123.apk",
  sha256: "a".repeat(64),
  manifest_findings: {
    automotive_candidate: true,
    automotive_feature: false,
    car_app_service: true,
    exported_services: 2,
  },
  upstream_urls: {
    source_code: "https://example.com/source",
    issue_tracker: "https://example.com/issues",
    website: "https://example.com",
  },
};

const catalog = {
  catalog_version: 1,
  generated_at: "2026-08-06T12:00:00Z",
  source: "F-Droid",
  entries: [entry],
};

test("catalog view model renders entries, search results, and freshness", () => {
  const model = catalogViewModel(catalog, "maps");
  assert.equal(model.entries.length, 1);
  assert.equal(model.visibleEntries[0].package_name, entry.package_name);
  assert.equal(model.freshness.status, "current");
  assert.equal(model.source, "F-Droid");
});

test("detail view model includes capabilities, findings, checksums, and every upstream link", () => {
  const model = detailViewModel(entry, catalog);
  assert.deepEqual(
    model.capabilities.map((capability) => capability.detected),
    [true, false, true],
  );
  assert.equal(model.findings.exported_services, 2);
  assert.deepEqual(
    model.upstream.map((link) => link.key),
    ["source_code", "issue_tracker", "website"],
  );
  assert.equal(model.entry.sha256, "a".repeat(64));
  assert.match(CAPABILITY_EXPLANATIONS.automotive_candidate, /Broad scanner gate/);
  assert.match(CAPABILITY_EXPLANATIONS.automotive_feature, /android\.hardware\.type\.automotive/);
  assert.match(CAPABILITY_EXPLANATIONS.car_app_service, /CarAppService/);
});

test("detail loading requests the package endpoint without credentials", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify(entry), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const loaded = await loadPackage(fetchImpl, entry.package_name);
  assert.equal(loaded.package_name, entry.package_name);
  assert.equal(calls[0].path, "/v1/catalog/org.example.maps");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("catalog API and missing-package errors classify separately", async () => {
  const unavailable = await assert.rejects(
    () => loadCatalog(async () => new Response(JSON.stringify({ error: "down" }), { status: 503 })),
    (error) => error instanceof ApiError && error.status === 503,
  );
  assert.equal(unavailable, undefined);
  const missing = new ApiError("not found", 404);
  assert.equal(classifyError(missing, "detail"), "missing");
  assert.equal(classifyError(missing, "catalog"), "error");
});

test("generated_at marks old catalogs stale", () => {
  const now = Date.parse("2026-08-06T12:00:00Z");
  assert.equal(isCatalogStale("2026-08-03T11:59:59Z", now), true);
  assert.equal(isCatalogStale("2026-08-06T11:59:59Z", now), false);
  assert.equal(catalogFreshness("invalid", now).status, "unknown");
});

test("public JSON requests never switch to POST or upload paths", async () => {
  const calls = [];
  await requestJson(async (path, options) => {
    calls.push({ path, options });
    return new Response("{}", { status: 200 });
  }, "/v1/catalog");
  assert.equal(calls[0].path, "/v1/catalog");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "omit");
});

test("nginx serves imported ES modules with a JavaScript MIME type", async () => {
  const nginx = await readFile(new URL("./nginx.conf", import.meta.url), "utf8");
  assert.match(nginx, /location\s+~\*\s+\\\.mjs\$\s*\{/);
  assert.match(nginx, /default_type\s+application\/javascript\s*;/);
});
