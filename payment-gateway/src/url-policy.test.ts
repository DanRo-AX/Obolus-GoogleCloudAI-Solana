import assert from "node:assert/strict";
import test from "node:test";
import {
  browserOriginAllowed,
  secureServiceOrigin,
  secureServiceUrl,
} from "./url-policy.js";

test("secret-bearing service URLs require encrypted remote transport", () => {
  assert.equal(
    secureServiceUrl("RPC", "https://rpc.example/v1?api-key=opaque"),
    "https://rpc.example/v1?api-key=opaque",
  );
  assert.equal(
    secureServiceOrigin("API", "http://127.0.0.1:8787"),
    "http://127.0.0.1:8787",
  );
  assert.throws(() => secureServiceUrl("API", "http://api.example"), /must use HTTPS/);
  assert.throws(
    () => secureServiceUrl("API", "https://user:secret@api.example"),
    /must not embed credentials/,
  );
  assert.throws(
    () => secureServiceOrigin("API", "https://api.example/internal"),
    /without a path or query/,
  );
  assert.throws(
    () => secureServiceOrigin("API", "https://api.example?token=misplaced"),
    /without a path or query/,
  );
});

test("local development accepts equivalent loopback browser origins", () => {
  assert.equal(
    browserOriginAllowed("http://127.0.0.1:4322", "http://localhost:4322", false),
    true,
  );
  assert.equal(
    browserOriginAllowed("http://[::1]:4322", "http://localhost:4322", false),
    true,
  );
  assert.equal(
    browserOriginAllowed("http://127.0.0.1:4323", "http://localhost:4322", false),
    false,
  );
  assert.equal(
    browserOriginAllowed("https://127.0.0.1:4322", "http://localhost:4322", false),
    false,
  );
});

test("managed environments require the configured browser origin exactly", () => {
  assert.equal(
    browserOriginAllowed("https://app.example", "https://app.example", true),
    true,
  );
  assert.equal(
    browserOriginAllowed("http://127.0.0.1:4322", "http://localhost:4322", true),
    false,
  );
  assert.equal(
    browserOriginAllowed("https://evil.example", "https://app.example", true),
    false,
  );
});
