import { Schema } from "effect";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  KeybindingsConfig,
  KeybindingRule,
  ResolvedKeybindingRule,
  ResolvedKeybindingsConfig,
} from "./keybindings";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const decodeResolvedRule = Schema.decodeUnknownEffect(ResolvedKeybindingRule as never);

it.effect("parses keybinding rules", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingRule, {
      key: "mod+b",
      command: "sidebar.toggle",
    });
    assert.strictEqual(parsed.command, "sidebar.toggle");

    const parsedRightPanelToggle = yield* decode(KeybindingRule, {
      key: "mod+alt+b",
      command: "rightPanel.toggle",
    });
    assert.strictEqual(parsedRightPanelToggle.command, "rightPanel.toggle");

    const parsedSearch = yield* decode(KeybindingRule, {
      key: "mod+k",
      command: "sidebar.search",
    });
    assert.strictEqual(parsedSearch.command, "sidebar.search");

    const parsedAddProject = yield* decode(KeybindingRule, {
      key: "mod+shift+o",
      command: "sidebar.addProject",
    });
    assert.strictEqual(parsedAddProject.command, "sidebar.addProject");

    const parsedImportThread = yield* decode(KeybindingRule, {
      key: "mod+shift+i",
      command: "sidebar.importThread",
    });
    assert.strictEqual(parsedImportThread.command, "sidebar.importThread");

    const parsedDiffToggle = yield* decode(KeybindingRule, {
      key: "mod+d",
      command: "diff.toggle",
    });
    assert.strictEqual(parsedDiffToggle.command, "diff.toggle");

    const parsedBrowserToggle = yield* decode(KeybindingRule, {
      key: "mod+shift+b",
      command: "browser.toggle",
    });
    assert.strictEqual(parsedBrowserToggle.command, "browser.toggle");

    const parsedModelPickerToggle = yield* decode(KeybindingRule, {
      key: "mod+shift+m",
      command: "modelPicker.toggle",
    });
    assert.strictEqual(parsedModelPickerToggle.command, "modelPicker.toggle");

    const parsedTraitsPickerToggle = yield* decode(KeybindingRule, {
      key: "mod+shift+e",
      command: "traitsPicker.toggle",
    });
    assert.strictEqual(parsedTraitsPickerToggle.command, "traitsPicker.toggle");

    const parsedComposerFocusToggle = yield* decode(KeybindingRule, {
      key: "cmd+l",
      command: "composer.focus.toggle",
    });
    assert.strictEqual(parsedComposerFocusToggle.command, "composer.focus.toggle");

    const parsedNewChat = yield* decode(KeybindingRule, {
      key: "mod+alt+n",
      command: "chat.newChat",
    });
    assert.strictEqual(parsedNewChat.command, "chat.newChat");

    const parsedLatestProject = yield* decode(KeybindingRule, {
      key: "mod+shift+n",
      command: "chat.newLatestProject",
    });
    assert.strictEqual(parsedLatestProject.command, "chat.newLatestProject");

    const parsedLegacyLocal = yield* decode(KeybindingRule, {
      key: "mod+shift+n",
      command: "chat.newLocal",
    });
    assert.strictEqual(parsedLegacyLocal.command, "chat.newLocal");

    const parsedCursor = yield* decode(KeybindingRule, {
      key: "mod+alt+r",
      command: "chat.newCursor",
    });
    assert.strictEqual(parsedCursor.command, "chat.newCursor");

    const parsedThreadJump = yield* decode(KeybindingRule, {
      key: "mod+3",
      command: "thread.jump.3",
    });
    assert.strictEqual(parsedThreadJump.command, "thread.jump.3");

    const parsedVisibleNext = yield* decode(KeybindingRule, {
      key: "mod+shift+]",
      command: "chat.visible.next",
    });
    assert.strictEqual(parsedVisibleNext.command, "chat.visible.next");

    const parsedVisiblePrevious = yield* decode(KeybindingRule, {
      key: "mod+shift+[",
      command: "chat.visible.previous",
    });
    assert.strictEqual(parsedVisiblePrevious.command, "chat.visible.previous");
  }),
);

it.effect("rejects invalid command values", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(KeybindingRule, {
        key: "mod+j",
        command: "script.Test.run",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts dynamic script run commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingRule, {
      key: "mod+r",
      command: "script.setup.run",
    });
    assert.strictEqual(parsed.command, "script.setup.run");
  }),
);

it.effect("parses keybindings array payload", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingsConfig, [
      { key: "mod+j", command: "sidebar.toggle" },
      { key: "mod+d", command: "diff.toggle", when: "chatFocus" },
    ]);
    assert.lengthOf(parsed, 2);
  }),
);

it.effect("parses resolved keybinding rules", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingRule, {
      command: "diff.toggle",
      shortcut: {
        key: "d",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
      whenAst: {
        type: "and",
        left: { type: "identifier", name: "sidebarOpen" },
        right: {
          type: "not",
          node: { type: "identifier", name: "composerFocus" },
        },
      },
    });
    assert.strictEqual(parsed.shortcut.key, "d");
  }),
);

it.effect("parses resolved keybindings arrays", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      {
        command: "sidebar.toggle",
        shortcut: {
          key: "j",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      },
    ]);
    assert.lengthOf(parsed, 1);
  }),
);

it.effect("drops unknown fields in resolved keybinding rules", () =>
  decodeResolvedRule({
    command: "sidebar.toggle",
    shortcut: {
      key: "j",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
    },
    key: "mod+j",
  }).pipe(
    Effect.map((parsed) => {
      const view = parsed as Record<string, unknown>;
      assert.strictEqual("key" in view, false);
      assert.strictEqual(view.command, "sidebar.toggle");
    }),
  ),
);
