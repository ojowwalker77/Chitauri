import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, it } from "vitest";

import { orchestratorMcpEffectRouteLayer } from "./http";
import {
  OrchestratorControlPlane,
  type OrchestratorControlPlaneShape,
} from "./orchestrator/Services/OrchestratorControlPlane";

async function withOrchestratorMcpServer(
  controlPlane: OrchestratorControlPlaneShape,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  let nodeServer: http.Server | null = null;
  try {
    await Effect.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const httpServer = yield* NodeHttpServer.make(
            () => {
              nodeServer = http.createServer();
              return nodeServer;
            },
            { port: 0, host: "127.0.0.1" },
          );
          const httpApp = yield* HttpRouter.toHttpEffect(orchestratorMcpEffectRouteLayer);
          yield* httpServer.serve(httpApp);
        }).pipe(Effect.provide(Layer.succeed(OrchestratorControlPlane, controlPlane))),
        scope,
      ),
    );
    const address = (nodeServer as http.Server | null)?.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected Effect server to expose an address");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

it("preserves MCP response headers across the Web-to-Effect HTTP bridge", async () => {
  const initializeResult = {
    jsonrpc: "2.0",
    id: 0,
    result: {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "chitauri_orchestrator", version: "0.1.0" },
      capabilities: { tools: { listChanged: true } },
    },
  };
  const unexpectedControlPlaneCall = (method: string) =>
    Effect.die(new Error(`Unexpected OrchestratorControlPlane.${method} call`));
  const controlPlane: OrchestratorControlPlaneShape = {
    getMcpServerForSeat: () => unexpectedControlPlaneCall("getMcpServerForSeat"),
    handleHttpRequest: () =>
      Effect.succeed(
        new Response(JSON.stringify(initializeResult), {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "mcp-session-123",
          },
        }),
      ),
    getTaskStatus: () => unexpectedControlPlaneCall("getTaskStatus"),
    getTaskResult: () => unexpectedControlPlaneCall("getTaskResult"),
  };

  await withOrchestratorMcpServer(controlPlane, async (origin) => {
    const response = await fetch(`${origin}/api/orchestrator/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {} },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("mcp-session-id")).toBe("mcp-session-123");
    await expect(response.json()).resolves.toEqual(initializeResult);
  });
});
