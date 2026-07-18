import { ProjectId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverCloudProject } from "./projectDiscovery";

const temporaryRoots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "teacode-cloud-discovery-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("discoverCloudProject", () => {
  it("finds typed IaC and provider-auth evidence without returning source values", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "infra"), { recursive: true });
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(root, "infra", "main.tf"),
      'provider "aws" { region = var.region }\nresource "aws_lambda_function" "api" {}\n',
    );
    await writeFile(
      path.join(root, ".github", "workflows", "deploy.yml"),
      "steps:\n  - uses: google-github-actions/auth@v3\n    with:\n      workload_identity_provider: private-value\n",
    );

    const result = await discoverCloudProject({
      root,
      projectId: ProjectId.makeUnsafe("project-discovery"),
    });
    expect(result.providers).toEqual(["aws", "gcp"]);
    expect(result.tools).toEqual(["github-actions", "terraform"]);
    expect(result.evidence.map((row) => row.path)).toEqual([
      ".github/workflows/deploy.yml",
      "infra/main.tf",
    ]);
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("aws_lambda_function");
  });

  it("ignores state, secrets, generated directories, and symlinks", async () => {
    const root = await fixtureRoot();
    const outside = await fixtureRoot();
    await mkdir(path.join(root, ".terraform"), { recursive: true });
    await mkdir(path.join(root, ".aws"), { recursive: true });
    await mkdir(path.join(root, ".kube"), { recursive: true });
    await writeFile(path.join(root, "terraform.tfstate"), '{"provider":"aws"}');
    await writeFile(path.join(root, "deploy.tfplan"), "aws provider binary plan");
    await writeFile(path.join(root, ".env.production"), "GOOGLE_APPLICATION_CREDENTIALS=x");
    await writeFile(path.join(root, ".aws", "credentials"), "[default]\naws_access_key_id=x");
    await writeFile(path.join(root, ".kube", "config"), "apiVersion: v1\nkind: Config");
    await writeFile(path.join(root, "service-account.json"), '{"type":"service_account"}');
    await writeFile(path.join(root, ".terraform", "main.tf"), 'provider "aws" {}');
    await writeFile(path.join(outside, "main.tf"), 'provider "google" {}');
    await symlink(outside, path.join(root, "linked-infra"));

    const result = await discoverCloudProject({
      root,
      projectId: ProjectId.makeUnsafe("project-ignored"),
    });
    expect(result.evidence).toEqual([]);
  });

  it("does not treat release scripts or generic GitHub releases as cloud ownership", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(root, "script"), { recursive: true });
    await writeFile(
      path.join(root, ".github", "workflows", "release.yml"),
      "steps:\n  - uses: actions/checkout@v4\n  - run: bun run build\n",
    );
    await writeFile(path.join(root, "script", "release.sh"), "bun run build\n");

    const result = await discoverCloudProject({
      root,
      projectId: ProjectId.makeUnsafe("project-release-only"),
    });
    expect(result.providers).toEqual([]);
    expect(result.evidence).toEqual([]);
  });
});
