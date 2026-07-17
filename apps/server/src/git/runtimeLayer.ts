import { Layer } from "effect";

import { GitCoreLive } from "./Layers/GitCore";
import { GitHubApiLive } from "./Layers/GitHubApi";
import { GitManagerLive } from "./Layers/GitManager";
import { GitStatusBroadcasterLive } from "./Layers/GitStatusBroadcaster";
import { CodexTextGenerationServiceLive } from "./Layers/CodexTextGeneration";
import { CursorTextGenerationServiceLive } from "./Layers/CursorTextGeneration";
import {
  KiloTextGenerationServiceLive,
  OpenCodeTextGenerationServiceLive,
} from "./Layers/OpenCodeTextGeneration";
import { ProviderTextGenerationLive } from "./Layers/ProviderTextGeneration";
import { OpenCodeRuntimeLive } from "../provider/opencodeRuntime";
import { GitHubApiClientLayerLive } from "../github/apiRuntimeLayer";

export const TextGenerationLayerLive = ProviderTextGenerationLive.pipe(
  Layer.provide(CodexTextGenerationServiceLive),
  Layer.provide(CursorTextGenerationServiceLive),
  Layer.provide(KiloTextGenerationServiceLive.pipe(Layer.provide(OpenCodeRuntimeLive))),
  Layer.provide(OpenCodeTextGenerationServiceLive.pipe(Layer.provide(OpenCodeRuntimeLive))),
);

const GitHubWorkflowApiLayerLive = GitHubApiLive.pipe(
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubApiClientLayerLive),
);

export const GitManagerLayerLive = GitManagerLive.pipe(
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubWorkflowApiLayerLive),
  Layer.provideMerge(TextGenerationLayerLive),
);

export const GitStatusBroadcasterLayerLive = GitStatusBroadcasterLive.pipe(
  Layer.provide(Layer.mergeAll(GitCoreLive, GitManagerLayerLive)),
);

export const GitLayerLive = Layer.mergeAll(
  GitCoreLive,
  GitManagerLayerLive,
  GitStatusBroadcasterLayerLive,
);
