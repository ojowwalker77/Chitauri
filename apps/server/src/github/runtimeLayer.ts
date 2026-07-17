import { Layer } from "effect";

import { GitCoreLive } from "../git/Layers/GitCore";
import { GitHubWorkbenchLive } from "./Layers/GitHubWorkbench";
import { GitHubApiClientLayerLive } from "./apiRuntimeLayer";

export const GitHubWorkbenchLayerLive = GitHubWorkbenchLive.pipe(
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubApiClientLayerLive),
);
