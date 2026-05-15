import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("mock fixture exposes the expected Bitbucket and Jarvis controls", async () => {
  const server = http.createServer((request, response) => {
    if (request.url.startsWith("/bitbucket")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`
        <input aria-label="Source branch" />
        <button>Continue</button>
        <button>Create</button>
        <button>Merge</button>
      `);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`
      <button>Build</button>
      <label><input type="checkbox" />체크하면 빌드 후 자동으로 "WAS1" 이/가 배포됩니다.</label>
      <div role="alert">빌드 요청이 접수되었습니다.</div>
    `);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const bitbucket = await fetch(`http://127.0.0.1:${port}/bitbucket`).then((response) => response.text());
    const jarvis = await fetch(`http://127.0.0.1:${port}/jarvis`).then((response) => response.text());
    assert.match(bitbucket, /Source branch/);
    assert.match(bitbucket, /Continue/);
    assert.match(jarvis, /Build/);
    assert.match(jarvis, /빌드 요청이 접수/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
