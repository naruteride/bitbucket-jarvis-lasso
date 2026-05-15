import { runDeploymentFlow } from "./automation.js";

export class RunManager {
  #runs = new Map();
  #activeRunId = null;

  get activeRunId() {
    return this.#activeRunId;
  }

  getRun(id) {
    return this.#runs.get(id);
  }

  start(request) {
    if (this.#activeRunId) {
      const active = this.#runs.get(this.#activeRunId);
      if (active && active.status === "running") {
        const error = new Error("이미 실행 중인 작업이 있습니다.");
        error.statusCode = 409;
        throw error;
      }
    }

    const run = {
      id: createRunId(),
      status: "running",
      request,
      events: [],
      clients: new Set(),
      abortController: new AbortController(),
      startedAt: new Date().toISOString(),
      finishedAt: null
    };
    this.#runs.set(run.id, run);
    this.#activeRunId = run.id;
    this.#emit(run, "info", "작업을 시작합니다.", { request: summarizeRequest(request) });

    queueMicrotask(async () => {
      try {
        await runDeploymentFlow({
          request,
          runId: run.id,
          signal: run.abortController.signal,
          log: (level, message, details) => this.#emit(run, level, message, details)
        });

        if (run.abortController.signal.aborted) {
          run.status = "cancelled";
          this.#emit(run, "warn", "작업이 취소되었습니다.");
        } else {
          run.status = "success";
          this.#emit(run, "success", "모든 요청이 접수되었습니다.");
        }
      } catch (error) {
        run.status = run.abortController.signal.aborted ? "cancelled" : "failed";
        this.#emit(run, "error", error.message, error.details || {});
      } finally {
        run.finishedAt = new Date().toISOString();
        this.#activeRunId = this.#activeRunId === run.id ? null : this.#activeRunId;
        this.#emit(run, "done", `작업 상태: ${run.status}`, {
          status: run.status,
          finishedAt: run.finishedAt
        });
      }
    });

    return run;
  }

  cancel(id) {
    const run = this.#runs.get(id);
    if (!run) {
      return false;
    }
    run.abortController.abort();
    this.#emit(run, "warn", "취소 요청을 보냈습니다. 현재 브라우저 동작이 끝나면 중단합니다.");
    return true;
  }

  subscribe(id, response) {
    const run = this.#runs.get(id);
    if (!run) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "실행 내역을 찾을 수 없습니다." }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    for (const event of run.events) {
      writeEvent(response, event);
    }

    run.clients.add(response);
    response.on("close", () => {
      run.clients.delete(response);
    });
  }

  #emit(run, level, message, details = {}) {
    const event = {
      seq: run.events.length + 1,
      time: new Date().toISOString(),
      level,
      message,
      details
    };
    run.events.push(event);
    for (const client of run.clients) {
      writeEvent(client, event);
    }
  }
}

function writeEvent(response, event) {
  response.write(`event: ${event.level}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${random}`;
}

function summarizeRequest(request) {
  return {
    projectKey: request.projectKey,
    branchName: request.branchName,
    mergePr: request.mergePr,
    targets: request.targets,
    mode: request.mode
  };
}
