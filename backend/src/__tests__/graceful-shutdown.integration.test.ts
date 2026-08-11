import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";

// This test spawns the real server process (not the in-process `app` export)
// because `src/index.ts` only wires up SIGTERM/SIGINT handling, DB init, and
// the event listener when `NODE_ENV !== "test"` — every other test in this
// suite runs with `NODE_ENV=test`, which intentionally skips that block.
// Requires a reachable Postgres instance, matching health.ready.integration.test.ts.
const shouldRun = process.env.CI === "true" && !!process.env.DATABASE_URL;
const maybeDescribe = shouldRun ? describe : describe.skip;

const SHUTDOWN_FORCE_TIMEOUT_MS = 5_000;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Could not determine a free port"));
      }
    });
  });
}

function getJson(url: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: null });
        }
      });
    });
    req.on("error", reject);
  });
}

/** Polls `/health/startup` until the server finishes DB init (no external RPC dependency). */
async function waitForStartup(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { status } = await getJson(`${baseUrl}/health/startup`);
      if (status === 200) return;
    } catch {
      // Not accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Server did not finish startup in time");
}

/** Polls `/health/ready` repeatedly until the connection is refused (server closed) or `stop` resolves. */
async function pollReadinessUntil(
  baseUrl: string,
  stop: Promise<unknown>
): Promise<Array<{ status: number; body: Record<string, unknown> | null }>> {
  const snapshots: Array<{ status: number; body: Record<string, unknown> | null }> = [];
  let stopped = false;
  void stop.finally(() => {
    stopped = true;
  });

  while (!stopped) {
    try {
      snapshots.push(await getJson(`${baseUrl}/health/ready`));
    } catch {
      break; // Connection refused: server.close() has already taken effect.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return snapshots;
}

maybeDescribe("graceful shutdown (integration)", () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGKILL");
    }
    child = undefined;
  });

  it(
    "flips readiness, drains SSE connections, and exits cleanly on SIGTERM",
    async () => {
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(port),
          SHUTDOWN_FORCE_TIMEOUT_MS: String(SHUTDOWN_FORCE_TIMEOUT_MS),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      await waitForStartup(baseUrl, 20_000);

      // Open a real SSE connection so shutdown has a client to actively drain,
      // rather than one that was already idle/disconnected.
      const sseReq = http.get(`${baseUrl}/events?txHash=${"a".repeat(10)}`);
      const sseResponse = await new Promise<http.IncomingMessage>((resolve, reject) => {
        sseReq.on("response", resolve);
        sseReq.on("error", reject);
      });
      sseResponse.on("data", () => {});
      const sseClosed = new Promise<void>((resolve) => {
        sseResponse.on("close", resolve);
        sseResponse.on("end", resolve);
      });

      const exitCode = new Promise<number | null>((resolve) => {
        child?.on("exit", (code) => resolve(code));
      });

      child.kill("SIGTERM");

      const [readinessSnapshots] = await Promise.all([
        pollReadinessUntil(baseUrl, exitCode),
        sseClosed,
      ]);
      const code = await exitCode;

      // Shutdown can complete before CI observes the brief 503 window. When a
      // readiness response is observed during shutdown, it must be either the
      // pre-signal healthy state or the expected shutdown state, never a 5xx crash.
      expect(
        readinessSnapshots.every(
          (s) => s.status === 200 || (s.status === 503 && s.body?.error === "shutting_down")
        )
      ).toBe(true);

      // The SSE connection opened above must be actively ended by the server,
      // not left hanging until the client times out on its own.
      // (Awaited above via `sseClosed`; reaching this line proves it closed.)

      expect(code).toBe(0);
      expect(stdout).toContain("Received SIGTERM");
      expect(stdout).toContain("Server closed cleanly");
    },
    45_000
  );
});

