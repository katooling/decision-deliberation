import assert from "node:assert/strict";
import test from "node:test";

import { startLocalServer } from "../src/http/local-server.js";

test("local server does not let request handlers weaken shared security headers", async () => {
  const server = await startLocalServer({
    handlers: [async () => ({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "ok",
      headers: {
        "cache-control": "public, max-age=3600",
        "content-security-policy": "default-src *",
        "x-frame-options": "SAMEORIGIN",
      },
    })],
  });
  try {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  } finally {
    await server.close();
  }
});
