import { Layer } from "effect";

import { GitHubCliLive } from "../git/Layers/GitHubCli";
import { GitHubWorkbenchLive } from "./Layers/GitHubWorkbench";

export const GitHubWorkbenchLayerLive = GitHubWorkbenchLive.pipe(Layer.provide(GitHubCliLive));
