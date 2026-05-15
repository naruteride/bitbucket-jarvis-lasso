import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import {
	PORT,
	PUBLIC_DIR,
	detectBrowserExecutablePath,
	publicProjectConfig
} from "./config.js";
import { RunManager } from "./runner.js";
import { loadState, rememberRunSelection } from "./storage.js";
import { validateRunRequest } from "./validation.js";

const manager = new RunManager();

const server = http.createServer(async (request, response) => {
	try {
		const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

		if (request.method === "GET" && url.pathname === "/api/config") {
			const state = await loadState();
			return sendJson(response, 200, {
				projects: publicProjectConfig(),
				recentBranches: state.recentBranches,
				lastSelection: state.lastSelection,
				browserExecutablePath: state.browserExecutablePath || detectBrowserExecutablePath(),
				activeRunId: manager.activeRunId
			});
		}

		if (request.method === "POST" && url.pathname === "/api/run") {
			const body = await readJson(request);
			const validation = validateRunRequest(body);
			if (!validation.ok) {
				return sendJson(response, 400, { errors: validation.errors });
			}

			await rememberRunSelection(validation.value);
			const run = manager.start(validation.value);
			return sendJson(response, 202, { runId: run.id });
		}

		const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
		if (request.method === "GET" && eventMatch) {
			return manager.subscribe(eventMatch[1], response);
		}

		const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
		if (request.method === "POST" && cancelMatch) {
			const cancelled = manager.cancel(cancelMatch[1]);
			return sendJson(response, cancelled ? 202 : 404, { cancelled });
		}

		if (request.method === "GET") {
			return serveStatic(url.pathname, response);
		}

		sendJson(response, 405, { error: "Method not allowed" });
	} catch (error) {
		const statusCode = error.statusCode || 500;
		sendJson(response, statusCode, {
			error: error.message || "Unexpected server error"
		});
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`Bitbucket Jarvis Lasso is running at http://127.0.0.1:${PORT}`);
});

async function readJson(request) {
	const chunks = [];
	let length = 0;
	for await (const chunk of request) {
		length += chunk.length;
		if (length > 1024 * 128) {
			const error = new Error("Request body is too large");
			error.statusCode = 413;
			throw error;
		}
		chunks.push(chunk);
	}

	if (!chunks.length) {
		return {};
	}

	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, response) {
	const requestedPath = pathname === "/" ? "/index.html" : pathname;
	const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requestedPath)}`);
	const relativePath = path.relative(PUBLIC_DIR, filePath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return sendJson(response, 403, { error: "Forbidden" });
	}

	try {
		const content = await fs.readFile(filePath);
		response.writeHead(200, {
			"Content-Type": contentType(filePath),
			"Cache-Control": "no-cache"
		});
		response.end(content);
	} catch (error) {
		if (error.code === "ENOENT") {
			sendJson(response, 404, { error: "Not found" });
		} else {
			throw error;
		}
	}
}

function sendJson(response, statusCode, payload) {
	response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
	response.end(`${JSON.stringify(payload)}\n`);
}

function contentType(filePath) {
	const extension = path.extname(filePath).toLowerCase();
	return (
		{
			".html": "text/html; charset=utf-8",
			".css": "text/css; charset=utf-8",
			".js": "application/javascript; charset=utf-8",
			".json": "application/json; charset=utf-8",
			".png": "image/png",
			".svg": "image/svg+xml"
		}[extension] || "application/octet-stream"
	);
}
