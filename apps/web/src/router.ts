import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { StoreProvider } from "./store";

type RouterHistory = NonNullable<Parameters<typeof createRouter>[0]["history"]>;

export function getRouter(history: RouterHistory) {
  const queryClient = new QueryClient({
    // Deliberately minimal. An earlier version of this also set
    // `refetchOnWindowFocus: false`, `retry: 1` and a global `staleTime`, which
    // looked like a safe tightening and was not:
    //
    //  * `refetchOnWindowFocus: false` broke read-file freshness. The workspace
    //    preview writes a whole file back from cache when a markdown checkbox is
    //    toggled, so editing that file in another editor and returning silently
    //    overwrote the external edit. Focus refetch was the only thing keeping
    //    that cache honest — nothing invalidates read-file on a human edit.
    //  * `retry: 1` made a failed `serverConfig` fetch sticky for the session.
    //    It has `staleTime: Infinity` and no retry of its own, so a cold launch
    //    that beats the socket left keybindings empty until a manual reload.
    //
    // Queries that want a cadence own it in their option factory. `gcTime` is
    // the one safe global: it only delays eviction of already-idle caches.
    defaultOptions: {
      queries: {
        gcTime: 10 * 60_000,
      },
    },
  });

  return createRouter({
    routeTree,
    history,
    // Routes are auto-code-split and have no loaders, so intent preloading only
    // fetches the route chunk on link hover/touch — first navigation skips the
    // chunk download/parse wait.
    defaultPreload: "intent",
    context: {
      queryClient,
    },
    Wrap: ({ children }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(StoreProvider, null, children),
      ),
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
