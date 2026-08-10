import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ApiError,
  CAPABILITY_EXPLANATIONS,
  FIRST_PARTY_INDEX_PATH,
  cacheBustedUrl,
  catalogFreshness,
  catalogViewModel,
  classifyError,
  detailViewModel,
  entryRanking,
  entryUpdatedAt,
  isRecentlyUpdated,
  isCatalogStale,
  loadCombinedCatalog,
  loadCatalog,
  loadPackage,
  loadRankings,
  mergeCatalogs,
  requestJson,
  statusLabel,
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
  metadata: {
    locale: "en-US",
    display_name: "Example Maps",
    summary: "Offline maps for everyone",
    description: "Explore places.\n\nStay private.",
    categories: ["Navigation"],
    license: "Apache-2.0",
    last_updated: "2026-08-08T12:00:00Z",
    icon_url: "https://f-droid.org/repo/org.example/en-US/icon.png",
    screenshot_urls: ["https://f-droid.org/repo/org.example/en-US/phoneScreenshots/1.png"],
  },
};

const catalog = {
  catalog_version: 1,
  generated_at: "2099-01-01T12:00:00Z",
  source: "F-Droid",
  entries: [entry],
};

test("catalog view model renders entries, search results, and freshness", () => {
  const model = catalogViewModel(catalog, "maps");
  assert.equal(model.entries.length, 1);
  assert.equal(model.visibleEntries[0].package_name, entry.package_name);
  assert.equal(model.freshness.status, "current");
  assert.equal(model.source, "F-Droid");
  assert.equal(catalogViewModel(catalog, "Example Maps").visibleEntries.length, 1);
});

test("catalog discovery sorts recent updates and optional popularity rankings", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");
  const older = {
    ...entry,
    package_name: "org.example.older",
    metadata: { ...entry.metadata, display_name: "Older App", last_updated: "2026-06-01T12:00:00Z" },
  };
  const model = catalogViewModel(
    { ...catalog, entries: [older, entry] },
    "",
    now,
    [{ package_name: older.package_name, rank: 2 }],
  );
  assert.deepEqual(model.recentEntries.map((item) => item.package_name), [entry.package_name]);
  assert.deepEqual(model.rankedEntries.map((item) => [item.entry.package_name, item.ranking.rank]), [[older.package_name, 2]]);
  assert.equal(isRecentlyUpdated(entry, now), true);
  assert.equal(entryUpdatedAt(entry), Date.parse(entry.metadata.last_updated));
  assert.deepEqual(entryRanking(older, [{ package_name: older.package_name, rank: 2 }]).rank, 2);
});

test("metadata asset URLs change when the published catalog revision changes", () => {
  const original = entry.metadata.screenshot_urls[0];
  const firstRevision = cacheBustedUrl(original, "2026-08-09T18:44:22+00:00");
  const secondRevision = cacheBustedUrl(original, "2026-08-09T19:02:11+00:00");
  assert.notEqual(firstRevision, secondRevision);
  assert.equal(new URL(firstRevision).searchParams.get("caramel_revision"), "2026-08-09T18:44:22+00:00");
  assert.equal(cacheBustedUrl(original), original);
});

test("unreviewed upstream entries keep their status blank", () => {
  assert.equal(statusLabel(entry), "");
  assert.equal(statusLabel(entry, true), "Stale data");
  assert.equal(statusLabel({ ...entry, first_party: true }), "Caramel release");
});

test("combined catalog includes signed first-party releases and prefers them on duplicates", () => {
  const firstParty = {
    generated_at: "2026-08-06T13:00:00Z",
    source: "Caramel App Repository",
    entries: [{ ...entry, first_party: true, metadata: { ...entry.metadata, display_name: "Caramel Example" } }],
  };
  const merged = mergeCatalogs(catalog, firstParty);
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].first_party, true);
  assert.equal(merged.entries[0].metadata.display_name, "Caramel Example");
  assert.match(merged.source, /Caramel App Repository/);
});

test("combined catalog tolerates one unavailable source", async () => {
  const calls = [];
  const fetchImpl = async (path) => {
    calls.push(path);
    if (path === FIRST_PARTY_INDEX_PATH) {
      return new Response(JSON.stringify({
        schema_version: 1,
        generated_at: "2026-08-06T13:00:00Z",
        repository: { name: "Caramel App Repository" },
        packages: [entry],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
  };
  const merged = await loadCombinedCatalog(fetchImpl);
  assert.equal(merged.entries.length, 1);
  assert.match(merged.notice, /curated catalog/);
  assert.deepEqual(calls.sort(), ["/fdroid/repo/caramel-index-v1.json", "/v1/catalog"].sort());
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
  assert.equal(model.metadata.display_name, "Example Maps");
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

test("rankings requests are read-only and omit credentials", async () => {
  const calls = [];
  const rankings = await loadRankings(async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ entries: [] }), { status: 200 });
  });
  assert.deepEqual(rankings.entries, []);
  assert.equal(calls[0].path, "/v1/rankings");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "omit");
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
