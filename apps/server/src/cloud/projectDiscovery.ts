import type {
  CloudDiscoveryEvidence,
  CloudDiscoveryTool,
  CloudProjectDiscoveryResult,
  CloudProvider,
  ProjectId,
} from "@t3tools/contracts";
import { constants } from "node:fs";
import { open, opendir, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_SCANNED_FILES = 20_000;
const MAX_EVIDENCE = 512;
const MAX_SOURCE_BYTES = 256 * 1024;

const IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".pulumi",
  ".terraform",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /\.tfstate(?:\.|$)/i,
  /\.tfplan(?:\.|$)/i,
  /(^|\/)\.kube\/config(?:\.|$)/i,
  /(^|\/)kubeconfig(?:\.|$)/i,
  /(^|\/)(?:\.aws\/credentials|credentials|application_default_credentials)(?:\.[^/]*)?$/i,
  /(^|\/)(?:service[-_]?account|adc)(?:[._-][^/]*)?\.json$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /(?:^|[._-])secret(?:s)?(?:[._-]|$)/i,
  /\.(?:key|pem|p12|pfx)$/i,
];

type DiscoveryCandidate = {
  readonly path: string;
  readonly absolutePath: string;
};

function normalizeRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isSensitivePath(relativePath: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

async function collectCandidates(root: string): Promise<{
  files: DiscoveryCandidate[];
  warnings: string[];
}> {
  const canonicalRoot = await realpath(root);
  const files: DiscoveryCandidate[] = [];
  const warnings: string[] = [];
  const directories = [canonicalRoot];
  let scanned = 0;

  while (directories.length > 0 && scanned < MAX_SCANNED_FILES) {
    const directory = directories.pop();
    if (!directory) break;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      warnings.push(`Could not inspect ${normalizeRelativePath(canonicalRoot, directory) || "."}.`);
      continue;
    }
    for await (const entry of entries) {
      if (scanned >= MAX_SCANNED_FILES) break;
      scanned += 1;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) directories.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelativePath(canonicalRoot, absolutePath);
      if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) continue;
      if (isSensitivePath(relativePath)) continue;
      files.push({ path: relativePath, absolutePath });
    }
  }

  if (scanned >= MAX_SCANNED_FILES) {
    warnings.push(`Repository discovery stopped after ${MAX_SCANNED_FILES} entries.`);
  }
  return { files, warnings };
}

async function readCandidate(candidate: DiscoveryCandidate): Promise<string | null> {
  let handle;
  try {
    handle = await open(candidate.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_SOURCE_BYTES) return null;
    return await handle.readFile("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function providersFromTerraform(source: string): CloudProvider[] {
  const providers: CloudProvider[] = [];
  if (/\b(?:provider\s+"aws"|hashicorp\/aws\b|aws_[a-z0-9_]+\b)/i.test(source)) {
    providers.push("aws");
  }
  if (
    /\b(?:provider\s+"google(?:-beta)?"|hashicorp\/google(?:-beta)?\b|google_[a-z0-9_]+\b)/i.test(
      source,
    )
  ) {
    providers.push("gcp");
  }
  return providers;
}

function providerCliMatches(source: string): CloudProvider[] {
  const providers: CloudProvider[] = [];
  if (/(?:^|["';&|]\s*)aws\s+[a-z0-9-]+\b/im.test(source)) providers.push("aws");
  if (/(?:^|["';&|]\s*)gcloud\s+[a-z0-9-]+\b/im.test(source)) providers.push("gcp");
  return providers;
}

function evidence(
  candidate: DiscoveryCandidate,
  tool: CloudDiscoveryTool,
  providers: CloudProvider[],
  reason: string,
): CloudDiscoveryEvidence {
  return { path: candidate.path, tool, providers, reason };
}

async function inspectCandidate(candidate: DiscoveryCandidate): Promise<CloudDiscoveryEvidence[]> {
  const lowerPath = candidate.path.toLowerCase();
  const baseName = path.basename(lowerPath);
  const result: CloudDiscoveryEvidence[] = [];

  if (lowerPath.endsWith(".tf")) {
    const source = (await readCandidate(candidate)) ?? "";
    result.push(
      evidence(candidate, "terraform", providersFromTerraform(source), "Terraform configuration"),
    );
    return result;
  }
  if (baseName === "terragrunt.hcl") {
    result.push(evidence(candidate, "terragrunt", [], "Terragrunt configuration"));
    return result;
  }
  if (baseName === "pulumi.yaml" || baseName === "pulumi.yml") {
    const source = (await readCandidate(candidate)) ?? "";
    const providers: CloudProvider[] = [];
    if (/\baws(?:-|:|\/)/i.test(source)) providers.push("aws");
    if (/\b(?:gcp|google-native)(?:-|:|\/)/i.test(source)) providers.push("gcp");
    result.push(evidence(candidate, "pulumi", providers, "Pulumi project manifest"));
    return result;
  }
  if (baseName === "cdk.json") {
    result.push(evidence(candidate, "cdk", ["aws"], "AWS CDK application manifest"));
    return result;
  }
  if (/^sst\.config\.[cm]?[jt]s$/.test(baseName)) {
    result.push(evidence(candidate, "sst", ["aws"], "SST infrastructure configuration"));
    return result;
  }
  if (baseName === "serverless.yml" || baseName === "serverless.yaml") {
    const source = (await readCandidate(candidate)) ?? "";
    const providers: CloudProvider[] = [];
    if (/\bprovider\s*:\s*aws\b/i.test(source)) providers.push("aws");
    if (/\bprovider\s*:\s*(?:google|gcp)\b/i.test(source)) providers.push("gcp");
    result.push(evidence(candidate, "serverless", providers, "Serverless Framework manifest"));
    return result;
  }
  if (baseName === "chart.yaml") {
    result.push(evidence(candidate, "helm", [], "Helm chart"));
    return result;
  }
  if (baseName === "kustomization.yaml" || baseName === "kustomization.yml") {
    result.push(evidence(candidate, "kustomize", [], "Kustomize manifest"));
    return result;
  }

  const isYaml = /\.ya?ml$/.test(baseName);
  if (isYaml && lowerPath.startsWith(".github/workflows/")) {
    const source = (await readCandidate(candidate)) ?? "";
    const providers: CloudProvider[] = [];
    if (/aws-actions\/configure-aws-credentials@/i.test(source)) providers.push("aws");
    if (/google-github-actions\/auth@/i.test(source)) providers.push("gcp");
    if (providers.length > 0) {
      result.push(
        evidence(candidate, "github-actions", providers, "Workflow establishes cloud identity"),
      );
    }
    return result;
  }

  if (isYaml || baseName.endsWith(".json")) {
    const source = (await readCandidate(candidate)) ?? "";
    if (/\bAWSTemplateFormatVersion\b|\bTransform\s*:\s*AWS::Serverless/i.test(source)) {
      result.push(evidence(candidate, "cloudformation", ["aws"], "CloudFormation or SAM manifest"));
      return result;
    }
    if (
      /(?:^|\/)(?:k8s|kubernetes|manifests|deploy)\//i.test(candidate.path) &&
      /(?:^|\n)\s*apiVersion\s*:/m.test(source) &&
      /(?:^|\n)\s*kind\s*:/m.test(source)
    ) {
      result.push(evidence(candidate, "kubernetes", [], "Kubernetes manifest"));
      return result;
    }
  }

  if (
    baseName === "package.json" ||
    baseName === "makefile" ||
    baseName.startsWith("taskfile.") ||
    baseName.endsWith(".sh")
  ) {
    const source = (await readCandidate(candidate)) ?? "";
    const providers = providerCliMatches(source);
    if (providers.length > 0) {
      result.push(evidence(candidate, "provider-cli", providers, "Script invokes a cloud CLI"));
    }
  }

  return result;
}

export async function discoverCloudProject(input: {
  readonly root: string;
  readonly projectId: ProjectId;
}): Promise<CloudProjectDiscoveryResult> {
  const { files, warnings } = await collectCandidates(input.root);
  const evidenceRows: CloudDiscoveryEvidence[] = [];
  for (const candidate of files) {
    if (evidenceRows.length >= MAX_EVIDENCE) break;
    evidenceRows.push(...(await inspectCandidate(candidate)));
  }
  const boundedEvidence = evidenceRows
    .slice(0, MAX_EVIDENCE)
    .toSorted((left, right) => left.path.localeCompare(right.path));
  if (evidenceRows.length > MAX_EVIDENCE) {
    warnings.push(`Repository evidence was limited to ${MAX_EVIDENCE} files.`);
  }
  return {
    projectId: input.projectId,
    providers: [...new Set(boundedEvidence.flatMap((row) => row.providers))].toSorted(),
    tools: [...new Set(boundedEvidence.map((row) => row.tool))].toSorted(),
    evidence: boundedEvidence,
    warnings: warnings.slice(0, 64),
    scannedAt: new Date().toISOString(),
  };
}
