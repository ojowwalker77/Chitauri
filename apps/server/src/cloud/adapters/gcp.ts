import {
  CloudContextId,
  CloudResourceId,
  type CloudContextSummary,
  type CloudLogEntry,
  type CloudProjectBinding,
  type CloudResourceActivity,
  type CloudResourceHealth,
  type CloudResourceSummary,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { hostname } from "node:os";

import type {
  CloudProviderAdapter,
  CloudProviderInventoryPage,
  CloudProviderLogPage,
  CloudProviderResourceDetail,
} from "../CloudProviderRegistry";
import { CloudOperationError, providerError } from "../Errors";
import { stripUnsafeControlCharacters } from "../normalize";

const GCP_ADC_CONTEXT = CloudContextId.makeUnsafe("gcp:adc");
const GCP_SETUP_INSTRUCTION =
  "Configure Application Default Credentials with `gcloud auth application-default login`, then refresh Cloud.";
const REQUEST_TIMEOUT_MS = 20_000;
const IDENTITY_TIMEOUT_MS = 8_000;
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

type GcpAssetSearchResult = {
  readonly name?: string;
  readonly assetType?: string;
  readonly project?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly location?: string;
  readonly labels?: Record<string, string>;
  readonly state?: string;
  readonly updateTime?: string;
};

type GcpAssetSearchResponse = {
  readonly results?: GcpAssetSearchResult[];
  readonly nextPageToken?: string;
};

type GcpLogEntry = {
  readonly insertId?: string;
  readonly timestamp?: string;
  readonly receiveTimestamp?: string;
  readonly severity?: string;
  readonly textPayload?: string;
  readonly jsonPayload?: unknown;
  readonly protoPayload?: unknown;
  readonly logName?: string;
};

type GcpLogListResponse = {
  readonly entries?: GcpLogEntry[];
  readonly nextPageToken?: string;
};

function sourceHost(): string {
  return hostname().slice(0, 256) || "TeaCode server";
}

function gcpAuthState(cause: unknown): CloudContextSummary["authState"] {
  const message =
    cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  if (message.includes("expired") || message.includes("invalid_grant")) return "expired";
  if (
    message.includes("credential") ||
    message.includes("login") ||
    message.includes("could not load") ||
    message.includes("default credentials")
  ) {
    return "unauthenticated";
  }
  return "error";
}

async function makeGoogleAuth() {
  const { GoogleAuth } = await import("google-auth-library");
  return new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
}

async function withIdentityTimeout<A>(promise: Promise<A>): Promise<A> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Google identity preflight timed out.")),
          IDENTITY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function inspectContext(): Promise<CloudContextSummary> {
  try {
    const auth = await makeGoogleAuth();
    const [projectId, accessToken] = await withIdentityTimeout(
      Promise.all([auth.getProjectId(), auth.getAccessToken()]),
    );
    if (!projectId || !accessToken) throw new Error("Google ADC returned an incomplete identity.");
    return {
      id: GCP_ADC_CONTEXT,
      provider: "gcp",
      label: `Google Cloud · ${projectId}`.slice(0, 256),
      authState: "authenticated",
      principalLabel: null,
      accountId: null,
      projectId: projectId.slice(0, 256),
      sourceHost: sourceHost(),
      expiresAt: null,
      setupInstruction: null,
      warnings: [
        "Application Default Credentials do not expose a principal label safely for every credential type.",
      ],
    };
  } catch (cause) {
    return {
      id: GCP_ADC_CONTEXT,
      provider: "gcp",
      label: "Google Cloud · Application Default Credentials",
      authState: gcpAuthState(cause),
      principalLabel: null,
      accountId: null,
      projectId: null,
      sourceHost: sourceHost(),
      expiresAt: null,
      setupInstruction: GCP_SETUP_INSTRUCTION,
      warnings: [
        gcpAuthState(cause) === "expired"
          ? "The Google Application Default Credentials session is expired."
          : "Google Application Default Credentials could not be resolved.",
      ],
    };
  }
}

function encodeResourceId(projectId: string, externalId: string): CloudResourceId {
  return CloudResourceId.makeUnsafe(
    `gcp:${Buffer.from(JSON.stringify({ version: 1, projectId, externalId })).toString("base64url")}`,
  );
}

function decodeResourceId(
  resourceId: CloudResourceId,
): { readonly projectId: string; readonly externalId: string } | null {
  if (!resourceId.startsWith("gcp:")) return null;
  try {
    const parsed = JSON.parse(Buffer.from(resourceId.slice(4), "base64url").toString("utf8")) as {
      readonly version?: unknown;
      readonly projectId?: unknown;
      readonly externalId?: unknown;
    };
    return parsed.version === 1 &&
      typeof parsed.projectId === "string" &&
      typeof parsed.externalId === "string"
      ? { projectId: parsed.projectId, externalId: parsed.externalId }
      : null;
  } catch {
    return null;
  }
}

function resourceName(externalId: string, displayName?: string): string {
  return (
    displayName?.trim() ||
    externalId.split("/").findLast((part) => part.length > 0) ||
    "Google Cloud resource"
  ).slice(0, 256);
}

function safeTags(labels: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 128)
      .map(([key, value]) => [key.slice(0, 256), value.slice(0, 2_048)]),
  );
}

function gcpConsoleUrl(input: {
  readonly projectId: string;
  readonly type: string;
  readonly name: string;
  readonly location: string | null;
  readonly externalId: string;
}): string {
  const project = encodeURIComponent(input.projectId);
  const location = encodeURIComponent(input.location ?? "global");
  const name = encodeURIComponent(input.name);
  if (input.type === "run.googleapis.com/Service") {
    return `https://console.cloud.google.com/run/detail/${location}/${name}/metrics?project=${project}`;
  }
  if (input.type === "container.googleapis.com/Cluster") {
    return `https://console.cloud.google.com/kubernetes/list/overview?project=${project}`;
  }
  if (input.type === "compute.googleapis.com/Instance") {
    return `https://console.cloud.google.com/compute/instancesDetail/zones/${location}/instances/${name}?project=${project}`;
  }
  return `https://console.cloud.google.com/asset-inventory/resources?project=${project}&query=${encodeURIComponent(input.externalId)}`;
}

function resourceSummary(input: {
  readonly projectId: string;
  readonly externalId: string;
  readonly type: string;
  readonly displayName?: string | undefined;
  readonly location?: string | null | undefined;
  readonly state?: string | null | undefined;
  readonly labels?: Record<string, string> | undefined;
  readonly observedAt?: string | undefined;
}): CloudResourceSummary {
  const name = resourceName(input.externalId, input.displayName);
  const location = input.location?.trim() || null;
  return {
    id: encodeResourceId(input.projectId, input.externalId),
    provider: "gcp",
    externalId: input.externalId.slice(0, 4_096),
    type: input.type.slice(0, 256),
    name,
    accountId: null,
    projectId: input.projectId.slice(0, 256),
    location: location?.slice(0, 256) ?? null,
    state: input.state?.slice(0, 256) ?? null,
    tags: safeTags(input.labels),
    consoleUrl: gcpConsoleUrl({
      projectId: input.projectId,
      type: input.type,
      name,
      location,
      externalId: input.externalId,
    }).slice(0, 4_096),
    ownership: { confidence: "untracked", evidence: [] },
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
}

type GcpInventoryCursor = { readonly version: 1; readonly token: string };

function encodeCursor(token: string): string {
  return Buffer.from(JSON.stringify({ version: 1, token } satisfies GcpInventoryCursor)).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<GcpInventoryCursor>;
    if (parsed.version !== 1 || typeof parsed.token !== "string") throw new Error("invalid cursor");
    return parsed.token;
  } catch (cause) {
    throw new CloudOperationError({
      code: "invalid_scope",
      operation: "gcp.searchResources",
      detail: "The Google Cloud inventory cursor is invalid or expired.",
      retryable: false,
      cause,
    });
  }
}

function assertGcpScope(binding: CloudProjectBinding, resourceId: CloudResourceId) {
  const resource = decodeResourceId(resourceId);
  if (!resource || !binding.expectedProjectId || resource.projectId !== binding.expectedProjectId) {
    throw new CloudOperationError({
      code: "invalid_scope",
      operation: "gcp.resourceScope",
      detail:
        "The selected Google Cloud resource does not belong to this binding's pinned project.",
      retryable: false,
    });
  }
  const location = inferLocation(resource.externalId) ?? "global";
  if (!binding.regions.includes(location)) {
    throw new CloudOperationError({
      code: "invalid_scope",
      operation: "gcp.resourceScope",
      detail: "The selected Google Cloud resource is outside the binding's allowed locations.",
      retryable: false,
    });
  }
  return resource;
}

function inferLocation(externalId: string): string | null {
  const match = externalId.match(/\/(?:locations|zones|regions)\/([^/]+)/i);
  return match?.[1] ?? null;
}

function inferTypeFromExternalId(externalId: string): string {
  const service = externalId.match(/^\/\/([^/]+)\//)?.[1] ?? "cloudasset.googleapis.com";
  const collection = externalId.split("/").filter(Boolean).at(-2) ?? "Resource";
  const singular = collection.endsWith("s") ? collection.slice(0, -1) : collection;
  return `${service}/${singular.charAt(0).toUpperCase()}${singular.slice(1)}`.slice(0, 256);
}

function health(
  status: CloudResourceHealth["status"],
  summary: string,
  facts: Record<string, string>,
): CloudResourceHealth {
  return { status, summary: summary.slice(0, 4_096), facts, observedAt: new Date().toISOString() };
}

function activityFromHealth(
  resourceId: string,
  consoleUrl: string,
  currentHealth: CloudResourceHealth,
): CloudResourceActivity[] {
  const timestamp = currentHealth.facts.lastUpdatedAt ?? currentHealth.facts.lastStartedAt;
  if (!timestamp || Number.isNaN(new Date(timestamp).valueOf())) return [];
  return [
    {
      id: `gcp-activity:${Buffer.from(`${resourceId}:${timestamp}`).toString("base64url")}`,
      kind: "provider-observation",
      summary: "Provider reported a recent resource lifecycle timestamp.",
      occurredAt: new Date(timestamp).toISOString(),
      consoleUrl,
    },
  ];
}

async function gcpHealth(input: {
  readonly projectId: string;
  readonly externalId: string;
  readonly type: string;
  readonly name: string;
  readonly location: string | null;
}): Promise<CloudResourceHealth> {
  const auth = await makeGoogleAuth();
  const project = encodeURIComponent(input.projectId);
  const location = encodeURIComponent(input.location ?? "-");
  const name = encodeURIComponent(input.name);
  if (input.type === "run.googleapis.com/Service") {
    const response = await auth.request<{
      readonly conditions?: ReadonlyArray<{ type?: string; state?: string; message?: string }>;
      readonly latestReadyRevision?: string;
      readonly latestCreatedRevision?: string;
      readonly ingress?: string;
      readonly updateTime?: string;
    }>({
      url: `https://run.googleapis.com/v2/projects/${project}/locations/${location}/services/${name}`,
      method: "GET",
      timeout: REQUEST_TIMEOUT_MS,
    });
    const ready = response.data.conditions?.find((condition) => condition.type === "Ready");
    const state = ready?.state ?? "CONDITION_UNKNOWN";
    return health(
      state === "CONDITION_SUCCEEDED"
        ? "healthy"
        : state === "CONDITION_FAILED"
          ? "unhealthy"
          : "degraded",
      ready?.message || `Cloud Run readiness is ${state}.`,
      {
        ready: state,
        latestReadyRevision: response.data.latestReadyRevision ?? "unknown",
        latestCreatedRevision: response.data.latestCreatedRevision ?? "unknown",
        ingress: response.data.ingress ?? "unknown",
        lastUpdatedAt: response.data.updateTime ?? "unknown",
      },
    );
  }
  if (input.type === "container.googleapis.com/Cluster") {
    const response = await auth.request<{
      readonly status?: string;
      readonly currentMasterVersion?: string;
      readonly currentNodeVersion?: string;
      readonly nodePools?: ReadonlyArray<unknown>;
    }>({
      url: `https://container.googleapis.com/v1/projects/${project}/locations/${location}/clusters/${name}`,
      method: "GET",
      timeout: REQUEST_TIMEOUT_MS,
    });
    const status = response.data.status ?? "STATUS_UNSPECIFIED";
    return health(
      status === "RUNNING" ? "healthy" : status === "ERROR" ? "unhealthy" : "degraded",
      `GKE cluster status is ${status}.`,
      {
        status,
        controlPlaneVersion: response.data.currentMasterVersion ?? "unknown",
        nodeVersion: response.data.currentNodeVersion ?? "unknown",
        nodePools: String(response.data.nodePools?.length ?? 0),
      },
    );
  }
  if (input.type === "compute.googleapis.com/Instance" && input.location) {
    const response = await auth.request<{
      readonly status?: string;
      readonly machineType?: string;
      readonly lastStartTimestamp?: string;
    }>({
      url: `https://compute.googleapis.com/compute/v1/projects/${project}/zones/${location}/instances/${name}`,
      method: "GET",
      timeout: REQUEST_TIMEOUT_MS,
    });
    const status = response.data.status ?? "UNKNOWN";
    return health(
      status === "RUNNING" ? "healthy" : status === "TERMINATED" ? "degraded" : "unknown",
      `Compute instance status is ${status}.`,
      {
        status,
        machineType: response.data.machineType?.split("/").at(-1) ?? "unknown",
        lastStartedAt: response.data.lastStartTimestamp ?? "unknown",
      },
    );
  }
  return health(
    "unsupported",
    "Live health is not yet supported for this Google Cloud resource type.",
    {},
  );
}

function escapeLoggingLiteral(value: string): string {
  return stripUnsafeControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function cleanLogText(value: string): { readonly text: string; readonly truncated: boolean } {
  const cleaned = stripUnsafeControlCharacters(value);
  return cleaned.length > 16_384
    ? { text: cleaned.slice(0, 16_384), truncated: true }
    : { text: cleaned, truncated: false };
}

function logMessage(entry: GcpLogEntry) {
  if (typeof entry.textPayload === "string") return cleanLogText(entry.textPayload);
  const payload = entry.jsonPayload ?? entry.protoPayload;
  if (payload === undefined) return { text: "", truncated: false };
  try {
    return cleanLogText(JSON.stringify(payload));
  } catch {
    return { text: "[Unserializable structured log payload]", truncated: false };
  }
}

function toLogEntry(entry: GcpLogEntry, index: number): CloudLogEntry {
  const message = logMessage(entry);
  const timestamp = entry.timestamp ?? entry.receiveTimestamp ?? new Date().toISOString();
  return {
    id: `gcp-log:${(entry.insertId || Buffer.from(`${timestamp}:${index}`).toString("base64url")).slice(0, 4_080)}`,
    timestamp,
    severity: entry.severity?.slice(0, 256) ?? null,
    message: message.text,
    source: (entry.logName?.split("/logs/").at(-1) ?? "Cloud Logging").slice(0, 256),
    truncated: message.truncated,
  };
}

export function makeGcpCloudProviderAdapter(): CloudProviderAdapter {
  const listContexts: CloudProviderAdapter["listContexts"] = () =>
    Effect.promise(async () => [await inspectContext()]);

  const resolveContext: CloudProviderAdapter["resolveContext"] = (contextId) =>
    contextId === GCP_ADC_CONTEXT
      ? Effect.promise(inspectContext)
      : Effect.fail(
          new CloudOperationError({
            code: "invalid_scope",
            operation: "gcp.resolveContext",
            detail: `Google Cloud context '${contextId}' is invalid.`,
            retryable: false,
          }),
        );

  const searchResources: CloudProviderAdapter["searchResources"] = ({ binding, request }) =>
    Effect.tryPromise({
      try: async (): Promise<CloudProviderInventoryPage> => {
        if (!binding.expectedProjectId)
          throw new Error("Google Cloud binding has no pinned project.");
        const auth = await makeGoogleAuth();
        const response = await auth.request<GcpAssetSearchResponse>({
          url: `https://cloudasset.googleapis.com/v1/projects/${encodeURIComponent(binding.expectedProjectId)}:searchAllResources`,
          method: "GET",
          params: {
            query: request.query?.trim() ?? "",
            pageSize: request.limit,
            pageToken: decodeCursor(request.cursor) ?? undefined,
            ...(request.types.length > 0 ? { assetTypes: request.types } : {}),
          },
          timeout: REQUEST_TIMEOUT_MS,
        });
        const resources = (response.data.results ?? []).flatMap((result) => {
          if (!result.name || !result.assetType) return [];
          const location = result.location?.trim() || inferLocation(result.name) || "global";
          if (!binding.regions.includes(location)) return [];
          const summary = resourceSummary({
            projectId: binding.expectedProjectId!,
            externalId: result.name,
            type: result.assetType,
            displayName: result.displayName,
            location,
            state: result.state,
            labels: result.labels,
            observedAt: result.updateTime,
          });
          if (
            request.states.length > 0 &&
            (!summary.state || !request.states.some((state) => summary.state === state))
          ) {
            return [];
          }
          return [summary];
        });
        const nextCursor = response.data.nextPageToken
          ? encodeCursor(response.data.nextPageToken)
          : null;
        return {
          resources: resources.slice(0, request.limit),
          nextCursor,
          completeness: nextCursor ? "partial" : "complete",
          warnings:
            resources.length < (response.data.results?.length ?? 0)
              ? [
                  "Google Cloud Asset Inventory returned resources outside the binding's allowed locations; TeaCode omitted them.",
                ]
              : [],
        };
      },
      catch: (cause) =>
        cause instanceof CloudOperationError
          ? cause
          : providerError({
              operation: "gcp.searchResources",
              cause,
              setupInstruction:
                "Enable Cloud Asset Inventory and grant cloudasset.assets.searchAllResources on the pinned project.",
            }),
    });

  const resourceDetail: CloudProviderAdapter["resourceDetail"] = ({ binding, request }) =>
    Effect.tryPromise({
      try: async (): Promise<CloudProviderResourceDetail> => {
        const identity = assertGcpScope(binding, request.resourceId);
        const externalId = identity.externalId;
        const type = inferTypeFromExternalId(externalId);
        const name = resourceName(externalId);
        const location = inferLocation(externalId);
        const currentHealth = await gcpHealth({
          projectId: identity.projectId,
          externalId,
          type,
          name,
          location,
        });
        return {
          resource: resourceSummary({
            projectId: identity.projectId,
            externalId,
            type,
            displayName: name,
            location,
            state: currentHealth.facts.status ?? currentHealth.facts.ready ?? currentHealth.status,
          }),
          health: currentHealth,
          activity: activityFromHealth(
            externalId,
            gcpConsoleUrl({
              projectId: identity.projectId,
              type,
              name,
              location,
              externalId,
            }),
            currentHealth,
          ),
          completeness: currentHealth.status === "unsupported" ? "partial" : "complete",
          warnings:
            currentHealth.status === "unsupported"
              ? [
                  "Inventory and console navigation are available; live detail is not implemented for this type.",
                ]
              : [],
        };
      },
      catch: (cause) =>
        cause instanceof CloudOperationError
          ? cause
          : providerError({ operation: "gcp.resourceDetail", cause }),
    });

  const queryLogs: CloudProviderAdapter["queryLogs"] = ({ binding, request }) =>
    Effect.tryPromise({
      try: async (): Promise<CloudProviderLogPage> => {
        const identity = assertGcpScope(binding, request.resourceId);
        const type = inferTypeFromExternalId(identity.externalId);
        const name = resourceName(identity.externalId);
        const location = inferLocation(identity.externalId);
        const start = new Date(request.startTime);
        const end = new Date(request.endTime);
        if (
          Number.isNaN(start.valueOf()) ||
          Number.isNaN(end.valueOf()) ||
          start >= end ||
          end.valueOf() - start.valueOf() > 24 * 60 * 60_000
        ) {
          throw new CloudOperationError({
            code: "invalid_scope",
            operation: "gcp.queryLogs",
            detail: "Cloud log queries require a valid range no wider than 24 hours.",
            retryable: false,
          });
        }
        let resourceFilter: string | null = null;
        if (type === "run.googleapis.com/Service" && location) {
          resourceFilter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${escapeLoggingLiteral(name)}" AND resource.labels.location="${escapeLoggingLiteral(location)}"`;
        } else if (type === "container.googleapis.com/Cluster") {
          resourceFilter = `resource.type="k8s_container" AND resource.labels.cluster_name="${escapeLoggingLiteral(name)}"`;
        }
        if (!resourceFilter) {
          return {
            entries: [],
            completeness: "partial",
            warnings: [
              "Bounded log discovery is not available for this Google Cloud resource type; use its console link.",
            ],
          };
        }
        const textFilter = request.query?.trim()
          ? ` AND textPayload:"${escapeLoggingLiteral(request.query.trim())}"`
          : "";
        const auth = await makeGoogleAuth();
        const response = await auth.request<GcpLogListResponse>({
          url: "https://logging.googleapis.com/v2/entries:list",
          method: "POST",
          data: {
            resourceNames: [`projects/${identity.projectId}`],
            filter: `${resourceFilter} AND timestamp>="${start.toISOString()}" AND timestamp<="${end.toISOString()}"${textFilter}`,
            orderBy: "timestamp desc",
            pageSize: request.limit,
          },
          timeout: REQUEST_TIMEOUT_MS,
        });
        return {
          entries: (response.data.entries ?? [])
            .slice(0, request.limit)
            .map((entry, index) => toLogEntry(entry, index)),
          completeness: response.data.nextPageToken ? "partial" : "complete",
          warnings: response.data.nextPageToken
            ? [`Cloud Logging returned more than ${request.limit} matching entries.`]
            : [],
        };
      },
      catch: (cause) =>
        cause instanceof CloudOperationError
          ? cause
          : providerError({ operation: "gcp.queryLogs", cause }),
    });

  return {
    provider: "gcp",
    listContexts,
    resolveContext,
    searchResources,
    resourceDetail,
    queryLogs,
  };
}
