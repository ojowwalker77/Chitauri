import { Layer } from "effect";

import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore";
import { GitHubApiClientLive } from "./Layers/GitHubApiClient";

/** One memoizable GitHub transport: auth, request dedupe, ETags, and rate-limit state. */
export const GitHubApiClientLayerLive = GitHubApiClientLive.pipe(
  Layer.provide(ServerSecretStoreLive),
);
