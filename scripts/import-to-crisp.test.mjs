import assert from "node:assert/strict";
import test from "node:test";

test("updates an existing Crisp article instead of creating a duplicate", async () => {
  const originalArgv = process.argv;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalTimeout = globalThis.setTimeout;
  const calls = [];

  process.argv = [...process.argv, "--execute", "--locale=en"];
  process.env.CRISP_WEBSITE_ID = "test-website";
  process.env.CRISP_TOKEN_ID = "test-token";
  process.env.CRISP_TOKEN_KEY = "test-secret";
  console.log = () => {};
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const endpoint = new URL(url).pathname;
    let data = {};
    if (endpoint.endsWith("/locales/1")) data = [{ locale: "en" }];
    if (endpoint.endsWith("/articles/1")) data = [{ article_id: "existing-article", title: "SimSIM Help Center" }];
    if (endpoint.endsWith("/articles/2")) data = [];
    if (endpoint.endsWith("/categories/1")) data = [];
    if (endpoint.endsWith("/category") && options.method === "POST") data = { category_id: "new-category" };
    if (endpoint.endsWith("/article") && options.method === "POST") data = { article_id: "new-article" };
    return new Response(JSON.stringify({ error: false, data }), { status: 200 });
  };

  try {
    await import(`./import-to-crisp.mjs?test=${Date.now()}`);
  } finally {
    process.argv = originalArgv;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    globalThis.setTimeout = originalTimeout;
  }

  assert.ok(
    calls.some(({ url, options }) => new URL(url).pathname.endsWith("/article/existing-article") && options.method === "PUT"),
    "the existing article should be updated",
  );
  assert.equal(
    calls.some(({ url, options }) => new URL(url).pathname.endsWith("/article") && options.method === "POST" && options.body.includes("SimSIM Help Center")),
    false,
    "the existing article should not be created again",
  );
});
