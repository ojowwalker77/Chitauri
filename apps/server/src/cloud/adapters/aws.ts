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
import { readFile } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import path from "node:path";

import type {
  CloudProviderAdapter,
  CloudProviderInventoryPage,
  CloudProviderLogPage,
  CloudProviderResourceDetail,
} from "../CloudProviderRegistry";
import { CloudOperationError, providerError } from "../Errors";
import { stripUnsafeControlCharacters } from "../normalize";

const AWS_CONTEXT_PREFIX = "aws:profile:";
const AWS_DEFAULT_CONTEXT = CloudContextId.makeUnsafe("aws:default");
const AWS_SETUP_INSTRUCTION =
  "Configure AWS credentials or run `aws sso login`, then refresh Cloud.";
const REQUEST_TIMEOUT_MS = 20_000;
const IDENTITY_TIMEOUT_MS = 8_000;
const MAX_PROFILE_CONTEXTS = 32;
const MAX_IDENTITY_PREFLIGHT_CONCURRENCY = 8;

type AwsContextConfig = { readonly profile: string | null };

function sourceHost(): string {
  return hostname().slice(0, 256) || "TeaCode server";
}

function contextIdForProfile(profile: string): CloudContextId {
  return CloudContextId.makeUnsafe(`${AWS_CONTEXT_PREFIX}${encodeURIComponent(profile)}`);
}

function parseContextId(contextId: CloudContextId): AwsContextConfig | null {
  if (contextId === AWS_DEFAULT_CONTEXT) return { profile: null };
  if (!contextId.startsWith(AWS_CONTEXT_PREFIX)) return null;
  try {
    const profile = decodeURIComponent(contextId.slice(AWS_CONTEXT_PREFIX.length)).trim();
    return profile ? { profile } : null;
  } catch {
    return null;
  }
}

async function configuredProfiles(): Promise<string[]> {
  const profiles = new Set<string>();
  const activeProfile = process.env.AWS_PROFILE?.trim();
  if (activeProfile) profiles.add(activeProfile.slice(0, 128));
  const configPath = process.env.AWS_CONFIG_FILE?.trim() || path.join(homedir(), ".aws", "config");
  try {
    const contents = await readFile(configPath, "utf8");
    for (const match of contents.matchAll(/^\s*\[(?:profile\s+)?([^\]]+)\]\s*$/gim)) {
      const profile = match[1]?.trim().slice(0, 128);
      if (profile) profiles.add(profile);
      if (profiles.size >= MAX_PROFILE_CONTEXTS) break;
    }
  } catch {
    // The default chain can still succeed through environment or workload identity.
  }
  profiles.delete("default");
  return [...profiles].toSorted((left, right) => left.localeCompare(right));
}

async function mapWithConcurrency<A, B>(
  values: readonly A[],
  concurrency: number,
  worker: (value: A) => Promise<B>,
): Promise<B[]> {
  const results: B[] = [];
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(values[index]!);
      }
    }),
  );
  return results;
}

function authStateFromError(cause: unknown): CloudContextSummary["authState"] {
  const message =
    cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  if (message.includes("expired") || message.includes("sso session")) return "expired";
  if (
    message.includes("credential") ||
    message.includes("login") ||
    message.includes("token") ||
    message.includes("profile")
  ) {
    return "unauthenticated";
  }
  return "error";
}

async function awsClientConfig(config: AwsContextConfig, region: string) {
  if (!config.profile) return { region };
  const { fromIni } = await import("@aws-sdk/credential-providers");
  return { region, credentials: fromIni({ profile: config.profile }) };
}

async function inspectContext(
  contextId: CloudContextId,
  config: AwsContextConfig,
): Promise<CloudContextSummary> {
  const label = config.profile ? `AWS · ${config.profile}` : "AWS · default chain";
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  try {
    const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
    const client = new STSClient(await awsClientConfig(config, region));
    try {
      const identity = await client.send(new GetCallerIdentityCommand({}), {
        abortSignal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
      });
      if (!identity.Account || !identity.Arn)
        throw new Error("AWS STS returned an incomplete identity.");
      return {
        id: contextId,
        provider: "aws",
        label,
        authState: "authenticated",
        principalLabel: identity.Arn.slice(0, 256),
        accountId: identity.Account.slice(0, 256),
        projectId: null,
        sourceHost: sourceHost(),
        expiresAt: null,
        setupInstruction: null,
        warnings: [],
      };
    } finally {
      client.destroy();
    }
  } catch (cause) {
    return {
      id: contextId,
      provider: "aws",
      label,
      authState: authStateFromError(cause),
      principalLabel: null,
      accountId: null,
      projectId: null,
      sourceHost: sourceHost(),
      expiresAt: null,
      setupInstruction: config.profile
        ? `Run \`aws sso login --profile ${config.profile}\` if this profile uses IAM Identity Center.`
        : AWS_SETUP_INSTRUCTION,
      warnings: [
        authStateFromError(cause) === "expired"
          ? "The AWS session for this context is expired."
          : "AWS credentials for this context could not be resolved.",
      ],
    };
  }
}

function encodeResourceId(externalId: string): CloudResourceId {
  return CloudResourceId.makeUnsafe(`aws:${Buffer.from(externalId).toString("base64url")}`);
}

function decodeResourceId(resourceId: CloudResourceId): string | null {
  if (!resourceId.startsWith("aws:")) return null;
  try {
    return Buffer.from(resourceId.slice(4), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

type ArnParts = {
  readonly partition: string;
  readonly service: string;
  readonly region: string;
  readonly accountId: string;
  readonly resource: string;
};

function parseArn(arn: string): ArnParts | null {
  const parts = arn.split(":");
  if (parts.length < 6 || parts[0] !== "arn") return null;
  return {
    partition: parts[1] ?? "aws",
    service: parts[2] ?? "unknown",
    region: parts[3] ?? "",
    accountId: parts[4] ?? "",
    resource: parts.slice(5).join(":"),
  };
}

function resourceName(arn: string): string {
  const parsed = parseArn(arn);
  const resource = parsed?.resource ?? arn;
  return (resource.split(/[/:]/).findLast((part) => part.length > 0) ?? resource).slice(0, 256);
}

function resourceType(arn: string, nativeType?: string): string {
  const parsed = parseArn(arn);
  if (nativeType?.trim()) return nativeType.trim().slice(0, 256);
  const kind = parsed?.resource.split(/[/:]/).find((part) => part.length > 0) ?? "resource";
  return `${parsed?.service ?? "aws"}:${kind}`.slice(0, 256);
}

function stringRecord(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const key = "Key" in entry ? entry.Key : "key" in entry ? entry.key : null;
          const entryValue = "Value" in entry ? entry.Value : "value" in entry ? entry.value : null;
          return typeof key === "string" && typeof entryValue === "string"
            ? [[key.slice(0, 256), entryValue.slice(0, 2_048)] as const]
            : [];
        })
        .slice(0, 128),
    );
  }
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 128)
      .map(([key, entryValue]) => [key.slice(0, 256), entryValue.slice(0, 2_048)]),
  );
}

function tagsFromProperties(
  properties: ReadonlyArray<{ Name?: string | undefined; Data?: unknown }> | undefined,
) {
  const tags = properties?.find((property) => property.Name?.toLowerCase() === "tags")?.Data;
  return stringRecord(tags);
}

function awsConsoleUrl(arn: string): string {
  const parsed = parseArn(arn);
  if (!parsed) return "https://console.aws.amazon.com/resource-explorer/home";
  const region = parsed.region || "us-east-1";
  const name = resourceName(arn);
  switch (parsed.service) {
    case "lambda":
      return `https://${region}.console.aws.amazon.com/lambda/home?region=${encodeURIComponent(region)}#/functions/${encodeURIComponent(name)}`;
    case "ecs":
      return `https://${region}.console.aws.amazon.com/ecs/v2/home?region=${encodeURIComponent(region)}`;
    case "cloudformation":
      return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${encodeURIComponent(region)}#/stacks/stackinfo?stackId=${encodeURIComponent(arn)}`;
    case "eks":
      return `https://${region}.console.aws.amazon.com/eks/clusters/${encodeURIComponent(name)}?region=${encodeURIComponent(region)}`;
    default:
      return `https://${region}.console.aws.amazon.com/resource-explorer/home?region=${encodeURIComponent(region)}#/search?query=${encodeURIComponent(arn)}`;
  }
}

function resourceSummary(input: {
  readonly arn: string;
  readonly accountId: string;
  readonly region: string;
  readonly nativeType?: string | undefined;
  readonly properties?:
    | ReadonlyArray<{
        Name?: string | undefined;
        Data?: unknown;
      }>
    | undefined;
  readonly observedAt?: Date | undefined;
  readonly state?: string | null | undefined;
}): CloudResourceSummary {
  return {
    id: encodeResourceId(input.arn),
    provider: "aws",
    externalId: input.arn.slice(0, 4_096),
    type: resourceType(input.arn, input.nativeType),
    name: resourceName(input.arn),
    accountId: input.accountId.slice(0, 256),
    projectId: null,
    location: input.region ? input.region.slice(0, 256) : null,
    state: input.state?.slice(0, 256) ?? null,
    tags: tagsFromProperties(input.properties),
    consoleUrl: awsConsoleUrl(input.arn).slice(0, 4_096),
    ownership: { confidence: "untracked", evidence: [] },
    observedAt: (input.observedAt ?? new Date()).toISOString(),
  };
}

type AwsInventoryCursor = {
  readonly version: 1;
  readonly regionIndex: number;
  readonly token: string | null;
};

function encodeCursor(cursor: AwsInventoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string | null): AwsInventoryCursor {
  if (!cursor) return { version: 1, regionIndex: 0, token: null };
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<AwsInventoryCursor>;
    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.regionIndex) ||
      (parsed.regionIndex ?? -1) < 0 ||
      (parsed.token !== null && typeof parsed.token !== "string")
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as AwsInventoryCursor;
  } catch (cause) {
    throw new CloudOperationError({
      code: "invalid_scope",
      operation: "aws.searchResources",
      detail: "The AWS inventory cursor is invalid or expired.",
      retryable: false,
      cause,
    });
  }
}

function assertAwsScope(binding: CloudProjectBinding, arn: string): ArnParts {
  const parsed = parseArn(arn);
  if (!parsed || !binding.expectedAccountId || parsed.accountId !== binding.expectedAccountId) {
    throw new CloudOperationError({
      code: "invalid_scope",
      operation: "aws.resourceScope",
      detail: "The selected AWS resource does not belong to this binding's pinned account.",
      retryable: false,
    });
  }
  const resourceRegion = parsed.region || "global";
  if (!binding.regions.includes(resourceRegion)) {
    throw new CloudOperationError({
      code: "invalid_scope",
      operation: "aws.resourceScope",
      detail: `The selected AWS resource is outside the binding's allowed regions.`,
      retryable: false,
    });
  }
  return parsed;
}

function health(
  status: CloudResourceHealth["status"],
  summary: string,
  facts: Record<string, string>,
): CloudResourceHealth {
  return { status, summary: summary.slice(0, 4_096), facts, observedAt: new Date().toISOString() };
}

function activityFromHealth(
  arn: string,
  currentHealth: CloudResourceHealth,
): CloudResourceActivity[] {
  const timestamp =
    currentHealth.facts.lastDeploymentAt ??
    currentHealth.facts.lastUpdatedAt ??
    currentHealth.facts.lastModified ??
    currentHealth.facts.lastStartedAt;
  if (!timestamp || Number.isNaN(new Date(timestamp).valueOf())) return [];
  return [
    {
      id: `aws-activity:${Buffer.from(`${arn}:${timestamp}`).toString("base64url")}`,
      kind: "provider-observation",
      summary: "Provider reported a recent resource lifecycle timestamp.",
      occurredAt: new Date(timestamp).toISOString(),
      consoleUrl: awsConsoleUrl(arn),
    },
  ];
}

async function awsHealth(
  config: AwsContextConfig,
  arn: string,
  parsed: ArnParts,
): Promise<CloudResourceHealth> {
  const clientConfig = await awsClientConfig(config, parsed.region || "us-east-1");
  const abortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (parsed.service === "lambda") {
    const { LambdaClient, GetFunctionConfigurationCommand } =
      await import("@aws-sdk/client-lambda");
    const client = new LambdaClient(clientConfig);
    try {
      const result = await client.send(new GetFunctionConfigurationCommand({ FunctionName: arn }), {
        abortSignal,
      });
      const state = result.State ?? "Unknown";
      return health(
        state === "Active" ? "healthy" : state === "Failed" ? "unhealthy" : "degraded",
        `Lambda function is ${state.toLowerCase()}.`,
        {
          state,
          runtime: result.Runtime ?? "unknown",
          lastUpdateStatus: result.LastUpdateStatus ?? "unknown",
          lastModified: result.LastModified ?? "unknown",
          version: result.Version ?? "unknown",
        },
      );
    } finally {
      client.destroy();
    }
  }
  if (parsed.service === "ecs" && parsed.resource.startsWith("service/")) {
    const { ECSClient, DescribeServicesCommand } = await import("@aws-sdk/client-ecs");
    const [, cluster, service] = parsed.resource.split("/");
    const client = new ECSClient(clientConfig);
    try {
      const result = await client.send(
        new DescribeServicesCommand({ cluster, services: [service ?? arn] }),
        { abortSignal },
      );
      const item = result.services?.[0];
      if (!item) return health("unknown", "ECS did not return this service.", {});
      const desired = item.desiredCount ?? 0;
      const running = item.runningCount ?? 0;
      return health(
        desired > 0 && running < desired
          ? "unhealthy"
          : item.status === "ACTIVE"
            ? "healthy"
            : "degraded",
        `${running} of ${desired} desired ECS tasks are running.`,
        {
          status: item.status ?? "unknown",
          desiredCount: String(desired),
          runningCount: String(running),
          pendingCount: String(item.pendingCount ?? 0),
          lastDeploymentAt: item.deployments?.[0]?.updatedAt?.toISOString() ?? "unknown",
        },
      );
    } finally {
      client.destroy();
    }
  }
  if (parsed.service === "cloudformation") {
    const { CloudFormationClient, DescribeStacksCommand } =
      await import("@aws-sdk/client-cloudformation");
    const client = new CloudFormationClient(clientConfig);
    try {
      const result = await client.send(new DescribeStacksCommand({ StackName: arn }), {
        abortSignal,
      });
      const stack = result.Stacks?.[0];
      const status = stack?.StackStatus ?? "UNKNOWN";
      const normalized = status.toLowerCase();
      return health(
        normalized.endsWith("complete") && !normalized.includes("rollback")
          ? "healthy"
          : normalized.includes("failed") || normalized.includes("rollback")
            ? "unhealthy"
            : "degraded",
        `CloudFormation stack status is ${status}.`,
        {
          status,
          terminationProtection: String(stack?.EnableTerminationProtection ?? false),
          driftInformation: stack?.DriftInformation?.StackDriftStatus ?? "not checked",
          lastUpdatedAt:
            (stack?.LastUpdatedTime ?? stack?.CreationTime)?.toISOString() ?? "unknown",
        },
      );
    } finally {
      client.destroy();
    }
  }
  if (parsed.service === "eks" && parsed.resource.startsWith("cluster/")) {
    const { EKSClient, DescribeClusterCommand } = await import("@aws-sdk/client-eks");
    const client = new EKSClient(clientConfig);
    try {
      const result = await client.send(new DescribeClusterCommand({ name: resourceName(arn) }), {
        abortSignal,
      });
      const status = result.cluster?.status ?? "UNKNOWN";
      return health(
        status === "ACTIVE" ? "healthy" : status === "FAILED" ? "unhealthy" : "degraded",
        `EKS cluster status is ${status}.`,
        {
          status,
          version: result.cluster?.version ?? "unknown",
          endpointAccess: result.cluster?.resourcesVpcConfig?.endpointPublicAccess
            ? "public"
            : "private",
        },
      );
    } finally {
      client.destroy();
    }
  }
  return health("unsupported", "Live health is not yet supported for this AWS resource type.", {});
}

function cleanLogText(value: string): { readonly text: string; readonly truncated: boolean } {
  const cleaned = stripUnsafeControlCharacters(value);
  return cleaned.length > 16_384
    ? { text: cleaned.slice(0, 16_384), truncated: true }
    : { text: cleaned, truncated: false };
}

function escapeCloudWatchRegexLiteral(value: string): string {
  return stripUnsafeControlCharacters(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function toIsoDate(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function logEntryFromFields(
  fields: ReadonlyArray<{
    field?: string | undefined;
    value?: string | undefined;
  }>,
  index: number,
): CloudLogEntry {
  const values = new Map(
    fields.flatMap((field) => (field.field ? [[field.field, field.value ?? ""]] : [])),
  );
  const timestamp = toIsoDate(values.get("@timestamp"));
  const message = cleanLogText(values.get("@message") ?? "");
  return {
    id: `aws-log:${Buffer.from(`${timestamp}:${index}`).toString("base64url")}`,
    timestamp,
    severity: values.get("@level")?.slice(0, 256) || null,
    message: message.text,
    source: (values.get("@logStream") || "CloudWatch Logs").slice(0, 256),
    truncated: message.truncated,
  };
}

export function makeAwsCloudProviderAdapter(): CloudProviderAdapter {
  const listContexts: CloudProviderAdapter["listContexts"] = () =>
    Effect.promise(async () => {
      const profiles = await configuredProfiles();
      const contexts = [
        await inspectContext(AWS_DEFAULT_CONTEXT, { profile: null }),
        ...(await mapWithConcurrency(profiles, MAX_IDENTITY_PREFLIGHT_CONCURRENCY, (profile) =>
          inspectContext(contextIdForProfile(profile), { profile }),
        )),
      ];
      return contexts;
    });

  const resolveContext: CloudProviderAdapter["resolveContext"] = (contextId) => {
    const config = parseContextId(contextId);
    return config
      ? Effect.promise(() => inspectContext(contextId, config))
      : Effect.fail(
          new CloudOperationError({
            code: "invalid_scope",
            operation: "aws.resolveContext",
            detail: `AWS context '${contextId}' is invalid.`,
            retryable: false,
          }),
        );
  };

  const searchResources: CloudProviderAdapter["searchResources"] = ({
    binding,
    context,
    request,
  }) =>
    Effect.tryPromise({
      try: async (): Promise<CloudProviderInventoryPage> => {
        const config = parseContextId(context.id);
        if (!config) throw new Error("AWS context is invalid.");
        const cursor = decodeCursor(request.cursor);
        const searchableRegions = binding.regions.filter((region) => region !== "global");
        const region = searchableRegions[cursor.regionIndex];
        if (!region) throw new Error("AWS inventory cursor is outside the binding's regions.");
        const { ResourceExplorer2Client, SearchCommand } =
          await import("@aws-sdk/client-resource-explorer-2");
        const client = new ResourceExplorer2Client(await awsClientConfig(config, region));
        try {
          const result = await client.send(
            new SearchCommand({
              QueryString: request.query?.trim() || "*",
              MaxResults: request.limit,
              NextToken: cursor.token ?? undefined,
            }),
            { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
          );
          const warnings: string[] = [];
          const resources = (result.Resources ?? [])
            .flatMap((resource) => {
              if (!resource.Arn || !resource.OwningAccountId) return [];
              if (resource.OwningAccountId !== binding.expectedAccountId) {
                warnings.push(
                  "AWS Resource Explorer returned a resource outside the pinned account.",
                );
                return [];
              }
              const arnRegion = parseArn(resource.Arn)?.region || "global";
              if (!binding.regions.includes(arnRegion)) {
                warnings.push(
                  "AWS Resource Explorer returned resources outside the binding's allowed regions; TeaCode omitted them.",
                );
                return [];
              }
              const summary = resourceSummary({
                arn: resource.Arn,
                accountId: resource.OwningAccountId,
                region: arnRegion,
                nativeType: resource.ResourceType ?? resource.CfnResourceType,
                properties: resource.Properties,
                observedAt: resource.LastReportedAt,
              });
              if (
                request.types.length > 0 &&
                !request.types.some((type) =>
                  summary.type.toLowerCase().includes(type.toLowerCase()),
                )
              ) {
                return [];
              }
              return [summary];
            })
            .slice(0, request.limit);
          const nextCursor = result.NextToken
            ? encodeCursor({ version: 1, regionIndex: cursor.regionIndex, token: result.NextToken })
            : cursor.regionIndex + 1 < searchableRegions.length
              ? encodeCursor({ version: 1, regionIndex: cursor.regionIndex + 1, token: null })
              : null;
          if (searchableRegions.length > 1) {
            warnings.push(
              "AWS inventory is paged by allowed region; aggregator indexes can produce duplicate resources across pages.",
            );
          }
          return {
            resources,
            nextCursor,
            completeness: nextCursor ? "partial" : "complete",
            warnings: [...new Set(warnings)].slice(0, 64),
          };
        } finally {
          client.destroy();
        }
      },
      catch: (cause) =>
        cause instanceof CloudOperationError
          ? cause
          : providerError({
              operation: "aws.searchResources",
              cause,
              setupInstruction:
                "Enable Resource Explorer and configure a default searchable view in an allowed region.",
            }),
    });

  const resourceDetail: CloudProviderAdapter["resourceDetail"] = ({ binding, context, request }) =>
    Effect.tryPromise({
      try: async (): Promise<CloudProviderResourceDetail> => {
        const config = parseContextId(context.id);
        const arn = decodeResourceId(request.resourceId);
        if (!config || !arn) throw new Error("AWS resource identity is invalid.");
        const parsed = assertAwsScope(binding, arn);
        const currentHealth = await awsHealth(config, arn, parsed);
        return {
          resource: resourceSummary({
            arn,
            accountId: parsed.accountId,
            region: parsed.region,
            state: currentHealth.facts.state ?? currentHealth.facts.status ?? currentHealth.status,
          }),
          health: currentHealth,
          activity: activityFromHealth(arn, currentHealth),
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
          : providerError({ operation: "aws.resourceDetail", cause }),
    });

  const queryLogs: CloudProviderAdapter["queryLogs"] = ({ binding, context, request }) =>
    Effect.tryPromise({
      try: async (): Promise<CloudProviderLogPage> => {
        const config = parseContextId(context.id);
        const arn = decodeResourceId(request.resourceId);
        if (!config || !arn) throw new Error("AWS resource identity is invalid.");
        const parsed = assertAwsScope(binding, arn);
        if (parsed.service !== "lambda") {
          return {
            entries: [],
            completeness: "partial",
            warnings: [
              "Bounded log discovery is not available for this AWS resource type; use its console link.",
            ],
          };
        }
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
            operation: "aws.queryLogs",
            detail: "Cloud log queries require a valid range no wider than 24 hours.",
            retryable: false,
          });
        }
        const {
          CloudWatchLogsClient,
          GetQueryResultsCommand,
          StartQueryCommand,
          StopQueryCommand,
        } = await import("@aws-sdk/client-cloudwatch-logs");
        const client = new CloudWatchLogsClient(
          await awsClientConfig(config, parsed.region || binding.regions[0]!),
        );
        try {
          const literalQuery = request.query?.trim()
            ? ` | filter @message like /${escapeCloudWatchRegexLiteral(request.query)}/`
            : "";
          const started = await client.send(
            new StartQueryCommand({
              logGroupName: `/aws/lambda/${resourceName(arn)}`,
              startTime: Math.floor(start.valueOf() / 1_000),
              endTime: Math.floor(end.valueOf() / 1_000),
              queryString: `fields @timestamp, @message, @logStream | sort @timestamp desc${literalQuery} | limit ${request.limit}`,
              limit: request.limit,
            }),
            { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
          );
          if (!started.queryId)
            throw new Error("CloudWatch Logs did not return a query identifier.");
          let result = await client.send(new GetQueryResultsCommand({ queryId: started.queryId }), {
            abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          for (
            let attempt = 0;
            ["Running", "Scheduled"].includes(result.status ?? "") && attempt < 20;
            attempt += 1
          ) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            result = await client.send(new GetQueryResultsCommand({ queryId: started.queryId }), {
              abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
          }
          const complete = result.status === "Complete";
          let stopped = false;
          if (!complete) {
            try {
              await client.send(new StopQueryCommand({ queryId: started.queryId }), {
                abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              });
              stopped = true;
            } catch {
              // Return bounded partial data even when query cancellation is denied.
            }
          }
          return {
            entries: (result.results ?? [])
              .slice(0, request.limit)
              .map((fields, index) => logEntryFromFields(fields, index)),
            completeness: complete ? "complete" : "partial",
            warnings: complete
              ? []
              : [
                  `CloudWatch Logs query ended with status ${result.status ?? "Unknown"}.${stopped ? " The server stopped the remaining query work." : ""}`,
                ],
          };
        } finally {
          client.destroy();
        }
      },
      catch: (cause) =>
        cause instanceof CloudOperationError
          ? cause
          : providerError({ operation: "aws.queryLogs", cause }),
    });

  return {
    provider: "aws",
    listContexts,
    resolveContext,
    searchResources,
    resourceDetail,
    queryLogs,
  };
}
