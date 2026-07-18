import { Layer } from "effect";

import { GitCoreLive } from "../git/Layers/GitCore";
import { ProjectionProjectRepositoryLive } from "../persistence/Layers/ProjectionProjects";
import { CloudProviderRegistryLive } from "./CloudProviderRegistry";
import { CloudProjectBindingsLive } from "./Layers/CloudProjectBindings";
import { CloudWorkbenchLive } from "./Layers/CloudWorkbench";

export const CloudWorkbenchLayerLive = CloudWorkbenchLive.pipe(
  Layer.provideMerge(CloudProjectBindingsLive),
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(CloudProviderRegistryLive),
  Layer.provideMerge(GitCoreLive),
);
