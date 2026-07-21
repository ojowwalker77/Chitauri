import { assert, describe, it } from "vitest";

import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  formatShortcutLabel,
  isBrowserToggleShortcut,
  isChatNewShortcut,
  isChatNewChatShortcut,
  isDiffToggleShortcut,
  isOpenFavoriteEditorShortcut,
  isSidebarToggleShortcut,
  resolveShortcutCommand,
  shouldShowThreadJumpHints,
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  type ShortcutEventLike,
} from "./keybindings";

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: "j",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

function modShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
    ...overrides,
  };
}

function ctrlShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    modKey: false,
    ...overrides,
  };
}

function whenIdentifier(name: string): KeybindingWhenNode {
  return { type: "identifier", name };
}

function whenNot(node: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "not", node };
}

function whenAnd(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "and", left, right };
}

function whenOr(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "or", left, right };
}

// Mirrors the production `whenCreationAllowed` guard: new-surface chords fire outside the
// terminal everywhere, and also from the terminal on macOS (where Cmd-chords never reach
// the shell). `isMac` is derived from the platform inside resolveContext.
const whenCreationAllowed = whenOr(
  whenNot(whenIdentifier("terminalFocus")),
  whenIdentifier("isMac"),
);

interface TestBinding {
  shortcut: KeybindingShortcut;
  command: KeybindingCommand;
  whenAst?: KeybindingWhenNode;
}

function compile(bindings: TestBinding[]): ResolvedKeybindingsConfig {
  return bindings.map((binding) => ({
    command: binding.command,
    shortcut: binding.shortcut,
    ...(binding.whenAst ? { whenAst: binding.whenAst } : {}),
  }));
}

// Mirror the server defaults here so frontend shortcut resolution stays aligned.
const DEFAULT_BINDINGS = compile([
  { shortcut: modShortcut("b"), command: "sidebar.toggle" },
  { shortcut: modShortcut("b", { altKey: true }), command: "rightPanel.toggle" },
  { shortcut: modShortcut("k"), command: "sidebar.search" },
  { shortcut: modShortcut("o", { shiftKey: true }), command: "sidebar.addProject" },
  { shortcut: modShortcut("i"), command: "sidebar.importThread" },
  { shortcut: modShortcut("b", { shiftKey: true }), command: "browser.toggle" },
  { shortcut: modShortcut("d"), command: "diff.toggle" },
  {
    shortcut: modShortcut("l", { metaKey: true, modKey: false }),
    command: "composer.focus.toggle",
  },
  { shortcut: modShortcut("m", { shiftKey: true }), command: "modelPicker.toggle" },
  { shortcut: modShortcut("e", { shiftKey: true }), command: "traitsPicker.toggle" },
  { shortcut: modShortcut("u", { shiftKey: true }), command: "settings.usage" },
  { shortcut: modShortcut("n"), command: "chat.new" },
  { shortcut: modShortcut("n", { shiftKey: true }), command: "chat.newLatestProject" },
  { shortcut: modShortcut("n", { altKey: true }), command: "chat.newChat" },
  { shortcut: modShortcut("c", { altKey: true }), command: "chat.newClaude" },
  { shortcut: modShortcut("x", { altKey: true }), command: "chat.newCodex" },
  { shortcut: modShortcut("r", { altKey: true }), command: "chat.newCursor" },
  { shortcut: modShortcut("\\"), command: "chat.split" },
  { shortcut: modShortcut("1"), command: "thread.jump.1" },
  { shortcut: modShortcut("2"), command: "thread.jump.2" },
  { shortcut: modShortcut("3"), command: "thread.jump.3" },
  { shortcut: modShortcut("4"), command: "thread.jump.4" },
  { shortcut: modShortcut("5"), command: "thread.jump.5" },
  { shortcut: modShortcut("6"), command: "thread.jump.6" },
  { shortcut: modShortcut("7"), command: "thread.jump.7" },
  { shortcut: modShortcut("8"), command: "thread.jump.8" },
  { shortcut: modShortcut("9"), command: "thread.jump.9" },
  { shortcut: modShortcut("]", { shiftKey: true }), command: "chat.visible.next" },
  { shortcut: modShortcut("[", { shiftKey: true }), command: "chat.visible.previous" },
  { shortcut: modShortcut("o"), command: "editor.openFavorite" },
]);

describe("when expressions", () => {
  it("supports and/not compositions", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "chat.split",
        whenAst: whenAnd(whenIdentifier("chatOpen"), whenNot(whenIdentifier("composerFocus"))),
      },
    ]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { chatOpen: true, composerFocus: false },
      }),
      "chat.split",
    );
    assert.isNull(
      resolveShortcutCommand(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { chatOpen: false, composerFocus: false },
      }),
    );
    assert.isNull(
      resolveShortcutCommand(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { chatOpen: true, composerFocus: true },
      }),
    );
  });

  it("supports when boolean literals", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "chat.new", whenAst: whenIdentifier("true") },
      { shortcut: modShortcut("m"), command: "chat.newChat", whenAst: whenIdentifier("false") },
    ]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
      "chat.new",
    );
    assert.isNull(
      resolveShortcutCommand(event({ key: "m", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
    );
  });

  it("matches physical digit shortcuts even when event.key is layout-shifted", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({
          code: "Digit1",
          key: "&",
          ctrlKey: true,
        }),
        DEFAULT_BINDINGS,
        { platform: "Win32" },
      ),
      "thread.jump.1",
    );
  });

  it("matches physical bracket shortcuts even when event.key differs from the printed symbol", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("[", { shiftKey: true }),
        command: "chat.visible.previous",
      },
    ]);

    assert.strictEqual(
      resolveShortcutCommand(
        event({
          code: "BracketLeft",
          key: "^",
          ctrlKey: true,
          shiftKey: true,
        }),
        keybindings,
        { platform: "Win32" },
      ),
      "chat.visible.previous",
    );
  });
});

describe("settings shortcuts", () => {
  it("opens usage settings with Cmd+Shift+U", () => {
    assert.equal(
      resolveShortcutCommand(event({ key: "u", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
      "settings.usage",
    );
  });
});

describe("composer focus shortcuts", () => {
  it("toggles composer focus with Cmd+L", () => {
    assert.equal(
      resolveShortcutCommand(event({ key: "l", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
      "composer.focus.toggle",
    );
  });

  it("does not treat Ctrl+L as the composer focus shortcut on non-macOS", () => {
    assert.isNull(
      resolveShortcutCommand(event({ key: "l", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });
});

describe("thread jump shortcuts", () => {
  it("maps thread jump indices to commands and back", () => {
    assert.strictEqual(threadJumpCommandForIndex(0), "thread.jump.1");
    assert.strictEqual(threadJumpCommandForIndex(8), "thread.jump.9");
    assert.isNull(threadJumpCommandForIndex(9));
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.4"), 3);
    assert.isNull(threadJumpIndexFromCommand("chat.new"));
  });

  it("resolves numbered thread jumps", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "3", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
      "thread.jump.3",
    );
  });

  it("shows thread jump hints only while a numbered jump modifier combo is active", () => {
    assert.isTrue(
      shouldShowThreadJumpHints(event({ key: "Meta", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      shouldShowThreadJumpHints(event({ key: "Control", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
    assert.isFalse(
      shouldShowThreadJumpHints(event({ key: "Shift", shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
  });
});

describe("shortcutLabelForCommand", () => {
  it("returns the most recent binding label", () => {
    const bindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "chat.split",
        whenAst: whenIdentifier("composerFocus"),
      },
      {
        shortcut: modShortcut("\\", { shiftKey: true }),
        command: "chat.split",
        whenAst: whenNot(whenIdentifier("composerFocus")),
      },
    ]);
    assert.strictEqual(shortcutLabelForCommand(bindings, "chat.split", "Linux"), "Ctrl+Shift+\\");
  });

  it("respects explicit context when resolving conflicting labels", () => {
    const bindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "chat.split",
        whenAst: whenIdentifier("composerFocus"),
      },
      {
        shortcut: modShortcut("\\", { shiftKey: true }),
        command: "chat.split",
        whenAst: whenNot(whenIdentifier("composerFocus")),
      },
    ]);
    assert.strictEqual(
      shortcutLabelForCommand(bindings, "chat.split", {
        platform: "Linux",
        context: { composerFocus: false },
      }),
      "Ctrl+Shift+\\",
    );
  });

  it("returns labels for chrome and creation commands", () => {
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "sidebar.addProject", "MacIntel"),
      "⇧⌘O",
    );
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.new", "MacIntel"), "⌘N");
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.newLatestProject", "MacIntel"),
      "⇧⌘N",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.newChat", "MacIntel"),
      "⌥⌘N",
    );
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "diff.toggle", "Linux"), "Ctrl+D");
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "sidebar.toggle", "MacIntel"),
      "⌘B",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "sidebar.search", "MacIntel"),
      "⌘K",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "browser.toggle", "MacIntel"),
      "⇧⌘B",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "modelPicker.toggle", "MacIntel"),
      "⇧⌘M",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "traitsPicker.toggle", "MacIntel"),
      "⇧⌘E",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "composer.focus.toggle", "MacIntel"),
      "⌘L",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "thread.jump.1", "MacIntel"),
      "⌘1",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "thread.jump.2", "Linux"),
      "Ctrl+2",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.visible.next", "MacIntel"),
      "⇧⌘]",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.visible.previous", "MacIntel"),
      "⇧⌘[",
    );
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "editor.openFavorite", "Linux"),
      "Ctrl+O",
    );
  });
});

describe("chat/editor shortcuts", () => {
  it("matches chat.new shortcut", () => {
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches chat.newChat shortcut", () => {
    assert.isTrue(
      isChatNewChatShortcut(event({ key: "n", metaKey: true, altKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewChatShortcut(event({ key: "n", ctrlKey: true, altKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("resolves chat.newLatestProject shortcut", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "n", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newLatestProject",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "n", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { composerFocus: false },
      }),
      "chat.newLatestProject",
    );
  });

  it("resolves sidebar.addProject shortcut", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "o", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "sidebar.addProject",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "o", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { composerFocus: false },
      }),
      "sidebar.addProject",
    );
  });

  it("resolves provider-specific new chat shortcuts", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "c", metaKey: true, altKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newClaude",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "x", metaKey: true, altKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newCodex",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "r", metaKey: true, altKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newCursor",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ code: "KeyC", key: "ç", metaKey: true, altKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { composerFocus: false },
        },
      ),
      "chat.newClaude",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ code: "KeyX", key: "≈", metaKey: true, altKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { composerFocus: false },
        },
      ),
      "chat.newCodex",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ code: "KeyR", key: "®", metaKey: true, altKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
          context: { composerFocus: false },
        },
      ),
      "chat.newCursor",
    );
  });

  it("resolves visible chat cycle shortcuts", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "]", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.visible.next",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "[", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.visible.previous",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "}", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.visible.next",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "{", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.visible.previous",
    );
  });

  it("matches editor.openFavorite shortcut", () => {
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches diff.toggle shortcut", () => {
    assert.isTrue(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
  });

  it("matches sidebar.toggle shortcut", () => {
    assert.isTrue(
      isSidebarToggleShortcut(event({ key: "b", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
  });

  it("resolves rightPanel.toggle", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "b", metaKey: true, altKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
      "rightPanel.toggle",
    );
  });

  it("resolves sidebar.search regardless of composer focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "sidebar.search",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { composerFocus: true },
      }),
      "sidebar.search",
    );
  });

  it("matches browser.toggle shortcut", () => {
    assert.isTrue(
      isBrowserToggleShortcut(
        event({ key: "b", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
        },
      ),
    );
  });
});

describe("cross-command precedence", () => {
  it("uses when + order so a later focused rule overrides a global rule", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "chat.new" },
      {
        shortcut: modShortcut("n"),
        command: "chat.newChat",
        whenAst: whenIdentifier("composerFocus"),
      },
    ]);

    assert.isTrue(
      isChatNewChatShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: true },
      }),
    );
    assert.isFalse(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: true },
      }),
    );
    assert.isFalse(
      isChatNewChatShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
    );
  });

  it("still lets a later global rule win when both rules match", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("n"),
        command: "chat.newChat",
        whenAst: whenIdentifier("composerFocus"),
      },
      { shortcut: modShortcut("n"), command: "chat.new" },
    ]);

    assert.isFalse(
      isChatNewChatShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { composerFocus: true },
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { composerFocus: true },
      }),
    );
  });
});

describe("resolveShortcutCommand", () => {
  it("returns dynamic script commands", () => {
    const keybindings = compile([{ shortcut: modShortcut("r"), command: "script.setup.run" }]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "r", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
      "script.setup.run",
    );
  });

  it("resolves configurable composer picker commands", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("m", { altKey: true }),
        command: "modelPicker.toggle",
        whenAst: whenNot(whenIdentifier("composerFocus")),
      },
      {
        shortcut: modShortcut("e", { altKey: true }),
        command: "traitsPicker.toggle",
        whenAst: whenNot(whenIdentifier("composerFocus")),
      },
    ]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "m", metaKey: true, altKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "modelPicker.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "e", metaKey: true, altKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "traitsPicker.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "m", metaKey: true, altKey: true }), keybindings, {
        platform: "MacIntel",
        context: { composerFocus: true },
      }),
      null,
    );
  });

  it("falls back to composer picker defaults when runtime config is missing them", () => {
    const legacyBindings = DEFAULT_BINDINGS.filter(
      (binding) =>
        binding.command !== "modelPicker.toggle" && binding.command !== "traitsPicker.toggle",
    );

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "m", metaKey: true, shiftKey: true }), legacyBindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "modelPicker.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "e", metaKey: true, shiftKey: true }), legacyBindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "traitsPicker.toggle",
    );
  });

  it("falls back to creation defaults when the runtime config is missing them", () => {
    const legacyBindings = DEFAULT_BINDINGS.filter((binding) => binding.command !== "chat.new");

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "n", metaKey: true }), legacyBindings, {
        platform: "MacIntel",
      }),
      "chat.new",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "n", ctrlKey: true }), legacyBindings, {
        platform: "Linux",
      }),
      "chat.new",
    );
  });

  it("falls back to the composer focus default when runtime config is missing it", () => {
    const legacyBindings = DEFAULT_BINDINGS.filter(
      (binding) => binding.command !== "composer.focus.toggle",
    );

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "l", metaKey: true }), legacyBindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "composer.focus.toggle",
    );
  });

  it("falls back to provider-specific new chat defaults when runtime config is missing them", () => {
    const legacyBindings = DEFAULT_BINDINGS.filter(
      (binding) =>
        binding.command !== "chat.newClaude" &&
        binding.command !== "chat.newCodex" &&
        binding.command !== "chat.newCursor",
    );

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "c", metaKey: true, altKey: true }), legacyBindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newClaude",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "x", metaKey: true, altKey: true }), legacyBindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newCodex",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "r", metaKey: true, altKey: true }), legacyBindings, {
        platform: "MacIntel",
        context: { composerFocus: false },
      }),
      "chat.newCursor",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ code: "KeyC", key: "ç", metaKey: true, altKey: true }),
        legacyBindings,
        {
          platform: "MacIntel",
          context: { composerFocus: false },
        },
      ),
      "chat.newClaude",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ code: "KeyX", key: "≈", metaKey: true, altKey: true }),
        legacyBindings,
        {
          platform: "MacIntel",
          context: { composerFocus: false },
        },
      ),
      "chat.newCodex",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ code: "KeyR", key: "®", metaKey: true, altKey: true }),
        legacyBindings,
        {
          platform: "MacIntel",
          context: { composerFocus: false },
        },
      ),
      "chat.newCursor",
    );
  });
});

describe("formatShortcutLabel", () => {
  it("formats labels for macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "MacIntel"),
      "⇧⌘D",
    );
  });

  it("formats labels for non-macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "Linux"),
      "Ctrl+Shift+D",
    );
  });

  it("formats labels for plus key", () => {
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "MacIntel"), "⌘+");
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "Linux"), "Ctrl++");
  });
});

describe("plus key parsing", () => {
  it("matches the plus key shortcut", () => {
    const plusBindings = compile([{ shortcut: modShortcut("+"), command: "sidebar.toggle" }]);
    assert.isTrue(
      isSidebarToggleShortcut(event({ key: "+", metaKey: true }), plusBindings, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isSidebarToggleShortcut(event({ key: "+", ctrlKey: true }), plusBindings, {
        platform: "Linux",
      }),
    );
  });
});
