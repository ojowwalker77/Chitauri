# Orchestrator Mode v2 — make the seat actually delegate

**Status:** spec, ready to implement
**Date:** 2026-07-17
**North-star metric:** delegations per seat thread. Today it is `0` across 23 seat threads all-time, in both environments. Anything above zero on a fresh seat with a normal coding prompt is the bar for "works."

---

## 1. Why v1 fails (verified 2026-07-17)

The plumbing is fine. The seat model just never chooses to delegate, and the UI hides that nothing happened.

Verified against the running TeaCode v0.6.2 build (`app.asar` extracted and inspected), `~/.teacode/userdata/state.sqlite`, server logs, and the Codex rollout of a live seat session:

1. **The seat has no orchestrator identity.** The only signal is the MCP server `instructions` string (`formatRoutingInstructions`) plus three tool descriptions. Codex receives its normal full-access coding persona and a normal coding prompt in a workspace it can edit directly. Doing the work itself is the path of least resistance, so it always does. Seats demonstrably _do_ call other MCP tools (`node_repl`, `codex_apps`) — the orchestrator tools are never _compelling_, not never _available_.
2. **Success is unobservable.** `OrchestratorControlPlane` logs nothing when a seat session is created or when the MCP handshake succeeds. Neither server nor UI can distinguish "armed seat" from "silently broken seat."
3. **The UI shows intent, not state.** The composer chip reflects `orchestrator_mode` recorded at thread creation. The delegation panel only renders once delegations exist. A seat that never delegates is pixel-identical to a plain Codex thread.
4. **Known wiring gaps** (from code trace):
   - Forked threads never get MCP injected — `ProviderForkThreadInput` has no `mcpServers` field; the fork branch in `ensureSessionForThread` returns before `startProviderSession`.
   - If the seat policy changes after thread creation, `requireSeat` throws inside `startProviderSession` and the _whole turn_ fails with an opaque error while the UI still shows a healthy Orchestrator chip.
   - MCP is injected only at session start; a `thread.meta.update` flip of `orchestratorMode` mid-session would silently do nothing until restart (latent — UI doesn't expose it today).

Key existing hooks (all already shipped, reused below):

| Hook                                    | Location                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP injection at session start          | `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` (`startProviderSession`, ~L711)                                                                 |
| Per-turn developer instructions (Codex) | `apps/server/src/codexAppServerManager.ts` — `buildCodexCollaborationMode` → `collaborationMode.settings.developer_instructions` on `turn/start` (~L616, ~L1092) |
| System-prompt append (Claude)           | `apps/server/src/provider/Layers/ClaudeAdapter.ts` — `systemPrompt: { type: "preset", preset: "claude_code", append }` (~L3331)                                  |
| Control plane, tools, lanes             | `apps/server/src/orchestrator/Layers/OrchestratorControlPlane.ts`                                                                                                |
| Domain-event push to web                | channel `orchestration.domainEvent`                                                                                                                              |

---

## 2. Design principle

**Mode must change behavior, not just tooling.** v2 has three legs, and all three ship together in Phase 1:

1. The seat is _told_ it is an orchestrator, in a channel the model actually weights (developer/system prompt, per turn).
2. The server _knows_ whether the seat is armed (handshake observed) and says so out loud (events + logs).
3. The UI _shows_ seat state at all times — including, especially, when nothing has been delegated.

---

## 3. Wiring spec

### 3.1 Seat persona injection (the core fix)

**Contract** (`packages/contracts/src/provider.ts`):

- Add `orchestratorSeat?: { readonly lanes: ReadonlyArray<{ lane: string; provider: string; model: string; escalation: ReadonlyArray<string> }> }` to `ProviderSessionStartInput`. Schema-only; the reactor populates it from `settings.orchestrator` at the same place it resolves `mcpServers`.

**Reactor** (`ProviderCommandReactor.startProviderSession`):

- Where `orchestratorMcpServer` is resolved today, also pass `orchestratorSeat` with the resolved lane policy. One source of truth: a new `formatSeatPersona(policy)` in a shared module (`apps/server/src/orchestrator/seatPersona.ts`), consumed by both adapters. Do **not** duplicate the text per adapter.

**Codex adapter** (`codexAppServerManager.ts`):

- Store the seat flag + persona on the session context at `startSession`.
- In `sendTurn`, when the context is a seat, append the persona to `collaborationMode.settings.developer_instructions` (both default and plan modes). This is the exact mechanism plan mode already uses, so it survives resume, compaction, and mid-session model switches. If `collaborationMode` is undefined (no `interactionMode`), synthesize a default-mode collaboration block so the persona is never dropped.

**Claude adapter** (`ClaudeAdapter.ts`):

- When `input.orchestratorSeat` is present, append the persona to `systemPrompt.append` (after `EMBEDDED_CLAUDE_SYSTEM_PROMPT_APPEND`).

**Persona text** (`formatSeatPersona`) — the behavioral contract, roughly:

```
<orchestrator_seat>
You are the orchestrator seat for this thread. Your job is to plan, delegate,
review, and integrate — not to implement.

Default behavior for any implementation work (code changes, refactors, UI work,
test writing, bulk edits): call the `chitauri_orchestrator.delegate` tool. Each
delegation runs a specialist agent in an isolated worktree and returns its final
message and diff.

Route by lane, never by model:
- bulk: {provider}:{model}    — mechanical/bulk edits, migrations
- ui: {provider}:{model}      — visual/interaction work
- explore: {provider}:{model} — read-only investigation, research
- verify: {provider}:{model}  — running checks, reproducing bugs, validating diffs

Do the following YOURSELF, never delegate: judgment, planning, decomposition,
reviewing returned diffs, answering the user, and trivial fixes (≲10 lines in
one file). If a task decomposes into independent pieces, delegate them in
parallel. After every delegation, review the returned diff before relying on it.

If `chitauri_orchestrator` tools are unavailable, say so explicitly in your
reply — do not silently do the work yourself.
</orchestrator_seat>
```

The lane table is rendered from live settings at session/turn time, not hardcoded. The last paragraph is the tripwire that converts "silently broken" into a user-visible sentence.

`formatRoutingInstructions` (MCP metadata) stays as-is — harmless reinforcement.

### 3.2 Seat health: observe the handshake, emit it, log it

The control plane terminates the MCP HTTP endpoint itself, so "did the tools reach the model" is directly observable — v1 just never looked.

**Control plane** (`OrchestratorControlPlane.ts`):

- Track per-seat status: `pending` (session started, MCP server handed to provider) → `connected` (MCP `initialize` + `tools/list` served for that seat's token) → `degraded` (see 3.3).
- Log with `Effect.logInfo` at: seat session created, `initialize` received, `tools/list` served, every tool call (name, lane, taskId), delegation completed/failed. This single item would have reduced today's multi-hour investigation to one grep.

**Events** (`packages/contracts/src/orchestration.ts`):

- New domain event `thread.orchestrator-seat-status` `{ threadId, status: "pending" | "connected" | "degraded", reason?: string, at }`. Projector writes `orchestrator_seat_status TEXT` + `orchestrator_seat_status_reason TEXT` onto `projection_threads` (new migration), and it flows to the web over `orchestration.domainEvent` like everything else.

**Timeout:** if a seat session reaches `running` and no `initialize` arrives within 30s, emit `degraded` with `reason: "handshake-timeout"`. (Codex connects `required: true` MCP servers during `thread/start`, so in practice this fires only when something is truly wrong.)

### 3.3 Degrade, don't detonate

`startProviderSession` currently lets `requireSeat` failures kill the session start. Change to:

- Catch control-plane errors around `getMcpServerForSeat`. On failure: start the session **without** MCP, emit `degraded` with the concrete reason (`"seat-model-not-in-policy"`, `"provider-unsupported"`, …), and log it. The user's turn always runs; the UI shows a degraded seat instead of a dead turn (see 4.4).

### 3.4 Close the wiring gaps

- **Fork path:** add `mcpServers` (and `orchestratorSeat`) to `ProviderForkThreadInput` (`packages/contracts/src/provider.ts`) and populate them in the fork branch of `ensureSessionForThread` exactly as in `startProviderSession`. Codex + Claude adapters pass them through on fork.
- **Mid-session flips:** reject `thread.meta.update` changes to `orchestratorMode` in the decider (`decider.ts` ~L760) when a provider session exists for the thread. The UI never sends this today; the guard keeps a future code path from reintroducing the silent-no-tools state.

### 3.5 Persist delegations

Delegation tasks currently live in an in-memory `Map` (`MAX_RETAINED_TASKS = 200`) and die with the server. Add table `orchestrator_tasks`:

```sql
CREATE TABLE orchestrator_tasks (
  task_id TEXT PRIMARY KEY,
  seat_thread_id TEXT NOT NULL,
  child_thread_id TEXT,
  lane TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,            -- queued | running | completed | failed | timed-out
  result_json TEXT,                -- final message + diff stat
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_orchestrator_tasks_seat ON orchestrator_tasks(seat_thread_id);
```

Control plane writes through on every transition; `status`/`result` tools and the UI panel read from it. Active-task caps (`MAX_ACTIVE_TASKS`, `MAX_ACTIVE_TASKS_PER_SEAT`) unchanged.

---

## 4. UI/UX spec

### 4.1 Seat identity lives in the thread header, not the composer

- Seat threads get a persistent header badge: **⬡ Orchestrator seat** with a status dot — gray `pending`, green `connected`, amber `degraded`. Tooltip carries the reason string verbatim from the seat-status event. Clicking opens the delegation panel.
- The composer chip stays a **picker for drafts only**. On an active server thread it becomes a non-editable reflection of the thread (clicking opens the panel). The current behavior — changing mode on a server thread silently spawning a new draft — is the trap that produced three duplicate seats on 2026-07-16. If we keep new-thread-from-mode-switch, the affordance must say so: menu item copy "Start new single-agent thread", not a toggle.

### 4.2 The delegation panel always renders on seat threads

This is the single biggest UX change: **silence must be visible.**

- **Empty state** (no delegations yet): seat status line ("Connected — delegation tools armed" / degraded reason), the lane→model routing table from live settings, and one sentence of expectation: "Implementation work will be delegated to specialist agents in isolated worktrees."
- **Per-delegation cards** (backed by `orchestrator_tasks`): lane, routed model, status (`queued / running / ready to review / failed`), elapsed time, diff stat when done, and a click-through to the child thread. Reuse the existing `OrchestratorDelegationPanel` card states; they're fine — they've just never had data.
- Panel open/close uses the shared disclosure motion (`apps/web/src/lib/disclosureMotion.ts`) per repo convention.

### 4.3 Delegations are first-class conversation items

Map MCP tool calls on server `chitauri_orchestrator` to a dedicated activity rendering (in the event projection, keyed on server name — not in the generic MCP branch):

- `delegate` → card: "**Delegated to ui lane** · claude-opus-4-8 · ⟳ running" updating in place through the task lifecycle, with the goal text and a link to the child thread.
- `result` → compact card with diff stat + "Review diff" action.

A generic "MCP tool call" row is exactly how v1 made orchestration invisible even in the one world where it worked.

### 4.4 Degraded state is a banner with a way out

When seat status is `degraded`, show a thread-level banner: the reason in plain words plus one-click remediation — "Update seat policy" (opens orchestrator settings) or "Continue single-agent for this thread" (dismiss; turns keep running without tools, which 3.3 already guarantees).

### 4.5 Defaults

Orchestrator stays the default draft mode **only after** Phase 1 lands. Defaulting into a mode that visibly does nothing is how trust in the feature died; with the panel + persona in place the default becomes self-demonstrating.

---

## 5. Acceptance criteria

Wiring:

- [ ] A seat session's Codex `turn/start` params contain the persona in `collaborationMode.settings.developer_instructions` (adapter unit test), and Claude's query options contain it in `systemPrompt.append`.
- [ ] Extend the PR #30 TCP-listener regression test: a simulated MCP client performing `initialize` + `tools/list` against the control plane flips seat status `pending → connected` and the domain event is emitted.
- [ ] Fork of a seat thread starts its provider session with `mcpServers` populated (unit test on the fork branch).
- [ ] Seat-policy mismatch at session start yields a running session + `degraded` event, not a failed turn.
- [ ] `orchestrator_tasks` rows survive a server restart; `status` tool answers from persistence.

Behavior (manual, the one that matters):

- [ ] Fresh seat thread, prompt: "Remove the New Thread welcome UI" (the exact task from today's screenshot). Expected: the seat plans, calls `delegate` at least once (ui lane), the panel shows the running child, the returned diff appears, the seat reviews it. **No coaching in the prompt.**
- [ ] Same setup with the control plane deliberately unreachable: the seat _says_ its orchestrator tools are unavailable (persona tripwire), and the header shows amber.

Observability:

- [ ] `grep "seat" server.log` after one delegation shows: created → initialize → tools/list → delegate → completed.

---

## 6. Phasing

**Phase 1 — make it delegate (ship together, this is the feature):** 3.1 persona injection (both providers) · 3.2 seat status events + logging · 4.1 header badge · 4.2 always-on panel with empty state.

**Phase 2 — make it robust:** 3.3 degrade-not-fail + 4.4 banner · 3.4 fork + meta-update guards · 3.5 task persistence.

**Phase 3 — make it good:** 4.3 first-class delegation cards · richer review/merge flow on returned diffs · auto-verify lane wiring (`autoVerifyDiffs`).

Phase 1 is deliberately small: one shared persona module, ~20 lines in each adapter, one event type, one UI panel change. Every previous attempt fixed transport; this one fixes _incentive_ and _visibility_, which is where the feature actually failed.
