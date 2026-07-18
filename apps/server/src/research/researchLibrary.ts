// FILE: researchLibrary.ts
// Purpose: Durable research artifact discovery plus the managed /research Agent Skill.
// Layer: Server research domain

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type {
  ResearchDocument,
  ResearchDocumentSummary,
  ResearchListResult,
  ResearchReference,
  ResearchSetArchivedResult,
} from "@t3tools/contracts";

import { parseManagedWorktreeWorkspaceRoot } from "../workspace/managedWorktree";

const RESEARCH_DIRECTORY_NAME = "research";
const MANIFEST_SUFFIX = ".research.json";
const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_SCAN_DEPTH = 4;
const MANAGED_SKILL_MARKER = "<!-- chitauri-managed-research-skill -->";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function titleFromFilename(filename: string): string {
  const stem = filename.slice(0, -nodePath.extname(filename).length);
  const words = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length > 0 ? words.replace(/^./, (letter) => letter.toUpperCase()) : "Research";
}

function encodeDocumentId(storagePath: string): string {
  return Buffer.from(storagePath, "utf8").toString("base64url");
}

function decodeDocumentId(id: string): string {
  try {
    return Buffer.from(id, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function documentManifestPath(documentPath: string): string {
  return `${documentPath.slice(0, -nodePath.extname(documentPath).length)}${MANIFEST_SUFFIX}`;
}

function isPathInside(root: string, target: string): boolean {
  const relative = nodePath.relative(root, target);
  return relative.length > 0 && !relative.startsWith("..") && !nodePath.isAbsolute(relative);
}

async function readManifest(
  path: string,
): Promise<{ value: JsonRecord | null; path: string | null }> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, "utf8")) as unknown;
    return { value: isRecord(parsed) ? parsed : null, path };
  } catch {
    return { value: null, path: null };
  }
}

async function readManifestForUpdate(path: string): Promise<JsonRecord> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`Research manifest must contain a JSON object: ${path}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function normalizeReference(value: unknown, index: number): ResearchReference | null {
  if (!isRecord(value)) return null;
  const target = optionalString(value.target ?? value.url ?? value.path);
  if (!target) return null;
  const rawKind = optionalString(value.kind ?? value.type);
  const kind =
    rawKind === "file" ||
    rawKind === "url" ||
    rawKind === "command" ||
    rawKind === "issue" ||
    rawKind === "pull-request" ||
    rawKind === "other"
      ? rawKind
      : /^https?:\/\//i.test(target)
        ? "url"
        : "file";
  return {
    id: optionalString(value.id) ?? `reference-${index + 1}`,
    label: optionalString(value.label ?? value.title) ?? target,
    kind,
    target,
    description: optionalString(value.description ?? value.note),
    line: optionalPositiveInteger(value.line),
  };
}

function normalizeReferences(manifest: JsonRecord | null): ResearchReference[] {
  const values = Array.isArray(manifest?.references) ? manifest.references : [];
  return values.flatMap((value, index) => {
    const reference = normalizeReference(value, index);
    return reference ? [reference] : [];
  });
}

function normalizeTags(manifest: JsonRecord | null): string[] {
  if (!Array.isArray(manifest?.tags)) return [];
  return manifest.tags.flatMap((value) => {
    const tag = optionalString(value);
    return tag ? [tag] : [];
  });
}

function repositoryRecord(manifest: JsonRecord | null): JsonRecord | null {
  return isRecord(manifest?.repository) ? manifest.repository : null;
}

// Research created inside a linked git worktree frequently records the worktree as
// "repository.root". Resolve the main checkout so project matching downstream lands
// on the originating project instead of minting a new project per worktree.
async function normalizeRepositoryPlacement(input: {
  repositoryRoot: string | null;
  worktreePath: string | null;
}): Promise<{ repositoryRoot: string | null; worktreePath: string | null }> {
  if (!input.repositoryRoot) return input;
  let gitPointerFileContents: string;
  try {
    const gitPath = nodePath.join(input.repositoryRoot, ".git");
    const gitStat = await fs.stat(gitPath);
    if (!gitStat.isFile()) return input;
    gitPointerFileContents = await fs.readFile(gitPath, "utf8");
  } catch {
    return input;
  }
  const mainRoot = parseManagedWorktreeWorkspaceRoot({
    gitPointerFileContents,
    path: nodePath,
    worktreePath: input.repositoryRoot,
  });
  if (!mainRoot) return input;
  return {
    repositoryRoot: mainRoot,
    worktreePath: input.worktreePath ?? input.repositoryRoot,
  };
}

async function loadDocument(input: {
  plansRoot: string;
  documentPath: string;
  includeContent: boolean;
}): Promise<ResearchDocument | null> {
  const resolvedPlansRoot = nodePath.resolve(input.plansRoot);
  const resolvedDocumentPath = nodePath.resolve(input.documentPath);
  if (!isPathInside(resolvedPlansRoot, resolvedDocumentPath)) return null;

  const extension = nodePath.extname(resolvedDocumentPath).toLowerCase();
  if (extension !== ".md") return null;

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolvedDocumentPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) return null;

  const storagePath = nodePath.relative(resolvedPlansRoot, resolvedDocumentPath);
  const segments = storagePath.split(nodePath.sep);
  const repositoryName = segments[0] === RESEARCH_DIRECTORY_NAME ? segments[1] : segments[0];
  const manifestResult = await readManifest(documentManifestPath(resolvedDocumentPath));
  const manifest = manifestResult.value;
  const repository = repositoryRecord(manifest);
  const placement = await normalizeRepositoryPlacement({
    repositoryRoot: optionalString(repository?.root ?? manifest?.repositoryRoot),
    worktreePath: optionalString(repository?.worktree ?? manifest?.worktreePath),
  });
  const references = normalizeReferences(manifest);
  const title = optionalString(manifest?.title) ?? titleFromFilename(resolvedDocumentPath);
  const content = input.includeContent ? await fs.readFile(resolvedDocumentPath, "utf8") : "";

  return {
    id: encodeDocumentId(storagePath),
    title,
    summary: optionalString(manifest?.summary ?? manifest?.description),
    format: "markdown",
    repositoryName:
      optionalString(repository?.name ?? manifest?.repositoryName) ?? repositoryName ?? "Research",
    repositoryRoot: placement.repositoryRoot,
    worktreePath: placement.worktreePath,
    branch: optionalString(repository?.branch ?? manifest?.branch),
    createdAt: optionalString(manifest?.createdAt) ?? stat.birthtime.toISOString(),
    updatedAt: optionalString(manifest?.updatedAt) ?? stat.mtime.toISOString(),
    archivedAt: optionalString(manifest?.archivedAt),
    storagePath: storagePath.split(nodePath.sep).join("/"),
    referenceCount: references.length,
    tags: normalizeTags(manifest),
    content,
    documentPath: resolvedDocumentPath,
    manifestPath: manifestResult.path,
    references,
  };
}

async function collectDocumentPaths(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const nested = await Promise.all(
    sorted.map(async (entry) => {
      const path = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) return collectDocumentPaths(path, depth + 1);
      if (!entry.isFile()) return [];
      return nodePath.extname(entry.name).toLowerCase() === ".md" ? [path] : [];
    }),
  );
  return nested.flat();
}

export function researchPlansRoot(chitauriBaseDir: string): string {
  return nodePath.join(chitauriBaseDir, "plans", RESEARCH_DIRECTORY_NAME);
}

export async function listResearchDocuments(chitauriBaseDir: string): Promise<ResearchListResult> {
  const plansRoot = researchPlansRoot(chitauriBaseDir);
  await fs.mkdir(plansRoot, { recursive: true });
  const documents = (
    await Promise.all(
      (
        await collectDocumentPaths(plansRoot)
      ).map((documentPath) => loadDocument({ plansRoot, documentPath, includeContent: false })),
    )
  )
    .filter((document): document is ResearchDocument => document !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(
      ({
        content: _content,
        documentPath: _documentPath,
        manifestPath: _manifestPath,
        references: _references,
        ...summary
      }) => summary satisfies ResearchDocumentSummary,
    );
  return { documents, plansRoot };
}

export async function readResearchDocument(
  chitauriBaseDir: string,
  id: string,
): Promise<ResearchDocument | null> {
  const plansRoot = researchPlansRoot(chitauriBaseDir);
  const storagePath = decodeDocumentId(id);
  if (!storagePath || nodePath.isAbsolute(storagePath)) return null;
  return loadDocument({
    plansRoot,
    documentPath: nodePath.join(plansRoot, storagePath),
    includeContent: true,
  });
}

export async function setResearchDocumentArchived(
  chitauriBaseDir: string,
  id: string,
  archived: boolean,
): Promise<ResearchSetArchivedResult | null> {
  const plansRoot = researchPlansRoot(chitauriBaseDir);
  const storagePath = decodeDocumentId(id);
  if (!storagePath || nodePath.isAbsolute(storagePath)) return null;

  const documentPath = nodePath.join(plansRoot, storagePath);
  const document = await loadDocument({ plansRoot, documentPath, includeContent: true });
  if (!document) return null;

  const manifestPath = documentManifestPath(documentPath);
  const manifest = await readManifestForUpdate(manifestPath);
  const nextManifest = {
    ...manifest,
    archivedAt: archived ? new Date().toISOString() : null,
  } satisfies JsonRecord;
  const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporaryManifestPath, manifestPath);
  } finally {
    await fs.rm(temporaryManifestPath, { force: true }).catch(() => undefined);
  }

  const updated = await loadDocument({ plansRoot, documentPath, includeContent: true });
  return updated ? { document: updated } : null;
}

function researchSkillMarkdown(chitauriBaseDir: string): string {
  const plansRoot = researchPlansRoot(chitauriBaseDir);
  return `---
name: research
description: Create or substantially revise a durable Markdown TeaCode research plan. Use when the user invokes /research, asks to research a repository before implementation, wants an implementation plan saved for later, or asks for a polished research artifact with clickable sources.
---

${MANAGED_SKILL_MARKER}

# Create TeaCode research

Research the real repository before writing conclusions. Save the durable result outside the repository so it survives branch and worktree deletion.

## Output location

Write exactly one document and one sibling manifest below:

\`${plansRoot}/<repo-slug>/<YYYY-MM-DD>/<document-slug>.md\`
\`${plansRoot}/<repo-slug>/<YYYY-MM-DD>/<document-slug>.research.json\`

Use lowercase filesystem-safe slugs. Create missing directories. Never save secrets, credentials, raw environment dumps, or private tokens.

Research documents MUST use Markdown. Do not create or save HTML research artifacts, even when the user asks for diagrams or a highly visual presentation. Express those ideas with clear Markdown headings, tables, lists, code blocks, and links instead.

## Document quality

- Ground claims in inspected code, current authoritative documentation, or explicitly labeled inference.
- Lead with the recommended direction, then explain architecture, UX, risks, sequence, and verification.
- Name concrete files, symbols, commands, and product behavior where useful.
- Make the plan executable by a fresh implementation agent without replaying the research.
- Use only Markdown, with a concise table of contents for long documents and tables only when they make comparisons easier to scan.
- Prefer compact diagrams expressed as fenced text when spatial relationships materially improve understanding.

## Manifest object

Write valid JSON with this shape:

\`\`\`json
{
  "version": 1,
  "title": "Clear human title",
  "summary": "One-sentence decision-oriented summary",
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp",
  "archivedAt": null,
  "repository": {
    "name": "repository-name",
    "root": "/absolute/project/root",
    "worktree": "/absolute/active/worktree-or-null",
    "branch": "active-branch-or-null"
  },
  "tags": ["architecture", "implementation"],
  "references": [
    {
      "id": "stable-short-id",
      "label": "Human label",
      "kind": "file",
      "target": "/absolute/path/or-https-url",
      "description": "Why this source matters",
      "line": 42
    }
  ]
}
\`\`\`

\`repository.root\` MUST be the main repository checkout (the folder the user added as a project), never a temporary or linked worktree (for example anything under \`.teacode/worktrees\` or the legacy \`.chitauri/worktrees\`). If you are running inside a worktree, resolve the main checkout with \`git rev-parse --path-format=absolute --git-common-dir\` (the root is its parent directory), put that in \`root\`, and put the worktree you are working in under \`worktree\`.

Allowed reference kinds are \`file\`, \`url\`, \`command\`, \`issue\`, \`pull-request\`, and \`other\`. Use absolute paths for file references and HTTPS URLs for web references. Omit \`line\` when it does not apply. Use JSON \`null\` for an unavailable worktree or branch.

New research MUST set \`archivedAt\` to JSON \`null\`. When revising an existing manifest, preserve its current \`archivedAt\` value unless the user explicitly asks to change the archive state.

## Finish

Validate that both files exist and that the manifest parses as JSON. Return one compact object in the final response so TeaCode and the user can identify the artifact:

\`{"type":"chitauri.research","documentPath":"<absolute path>","manifestPath":"<absolute path>","title":"<title>","referenceCount":<number>}\`
`;
}

export async function ensureManagedResearchSkill(chitauriBaseDir: string): Promise<string> {
  const skillDir = nodePath.join(chitauriBaseDir, "skills", "research");
  const skillPath = nodePath.join(skillDir, "SKILL.md");
  const nextContent = researchSkillMarkdown(chitauriBaseDir);
  await fs.mkdir(skillDir, { recursive: true });
  let currentContent: string | null = null;
  try {
    currentContent = await fs.readFile(skillPath, "utf8");
  } catch {
    currentContent = null;
  }
  if (currentContent === null || currentContent.includes(MANAGED_SKILL_MARKER)) {
    if (currentContent !== nextContent) {
      await fs.writeFile(skillPath, nextContent, "utf8");
    }
  }
  await fs.mkdir(researchPlansRoot(chitauriBaseDir), { recursive: true });
  return skillPath;
}
