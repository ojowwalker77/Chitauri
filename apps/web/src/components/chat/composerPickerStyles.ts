// FILE: composerPickerStyles.ts
// Purpose: Shared tokens for picker open panels (shell, options, radius) and composer chrome.
// Layer: UI styling helper
// Exports: surface/option/radius tokens; open panels via ComposerPickerMenuPopup / ComposerPickerSelectPopup

import { OVERLAY_SURFACE_CLASS_NAME, PANEL_SURFACE_CLASS_NAME } from "~/components/ui/surface";

export { COMPOSER_PICKER_SIZE, type ComposerPickerSize } from "./composerPickerSize";

/** Compatibility shadow token for consumers that compose popup chrome incrementally. */
export const COMPOSER_SURFACE_SHADOW_CLASS_NAME = "shadow-[0_16px_44px_rgba(0,0,0,0.5)]";

// Uses the UI-sm token so picker labels sit slightly below the editor text size.
// The sm: override is required to beat the Button component's base responsive text classes.
export const COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME =
  "text-[length:var(--app-font-size-ui-sm,13px)] text-[var(--color-text-foreground-secondary)] sm:text-[length:var(--app-font-size-ui-sm,13px)] font-normal hover:text-[var(--color-text-foreground)] data-pressed:text-[var(--color-text-foreground)]";

/**
 * Compact pill trigger for the composer-footer toolbar pickers (environment + branch).
 * Matches `PickerTriggerButton` sizing (ui-sm label) so the project / environment / branch
 * row in the empty-state footer reads as one set. Pair with a `size-3.5` leading icon and a
 * `size-3` `ChevronDownIcon` so the three triggers stay on identical icon + chevron sizes.
 */
export const COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME = `inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-[var(--color-background-elevated-secondary)] ${COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME}`;

/** Caps model-provider submenu height; pairs with the list scroll class below. */
export const COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME =
  "[--available-height:min(20rem,55vh)]";

/** Sticky search header inside composer picker submenus. */
export const COMPOSER_PICKER_SEARCH_HEADER_CLASS_NAME =
  "sticky z-20 shrink-0 border-b border-[color:color-mix(in_srgb,var(--foreground)_6%,transparent)] bg-transparent px-1.5 pb-1.5 pt-1";

/** Search field styling inside composer picker submenus. */
export const COMPOSER_PICKER_SEARCH_INPUT_CLASS_NAME =
  "rounded-lg border-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] bg-[color-mix(in_srgb,white_92%,transparent)] shadow-none before:hidden has-focus-visible:border-[color:color-mix(in_srgb,var(--foreground)_14%,transparent)] has-focus-visible:ring-0 [&_input]:font-sans [&_input]:placeholder:text-muted-foreground/55";

/** Scrollable model list body inside searchable provider submenus. */
export const COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME =
  "max-h-[min(var(--available-height,20rem),20rem)]";

/** Scroll chrome for long model-provider lists. */
export const COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME = "composer-picker-scroll";

/** Corner radius for picker panel chrome and panel-level surfaces. */
export const COMPOSER_PICKER_RADIUS_CLASS_NAME = "rounded-xl";

/** Tighter corner radius for option rows / selection pills inside picker panels. */
export const COMPOSER_PICKER_OPTION_RADIUS_CLASS_NAME = "rounded-lg";

/** Collapsible section headers inside model provider lists. */
export const COMPOSER_PICKER_MODEL_GROUP_HEADER_CLASS_NAME = `grid w-full grid-cols-[0.75rem_minmax(0,1fr)_2.5rem] items-center gap-x-1.5 ${COMPOSER_PICKER_RADIUS_CLASS_NAME} px-2 py-1 text-left text-[11px] font-medium text-muted-foreground/80 outline-none transition-colors hover:bg-hover focus-visible:ring-0`;

/** Indents model row labels under collapsible group headers. */
export const COMPOSER_PICKER_MODEL_ROW_LABEL_INDENT_CLASS_NAME = "pl-[1.125rem]";

/** Muted accent text for effort labels and empty-landing folder names. */
export const COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME = "text-muted-foreground/45";

// NOTE: Composer picker section headers (Effort, Thinking, Mode, …) now render
// through the shared `MenuGroupLabel` primitive (../ui/menu) so they stay in
// sync with dropdown group labels like "Git actions". Picker padding is still
// tuned via the `--picker-section-py` token on `[data-slot="menu-label"]`.

export const COMPOSER_MAX_WIDTH_CLASS_NAME = "max-w-[45rem]";
/** The chat column shows the window canvas (`.claude-main-shell`) through itself.
 *  Only needed where a surface would otherwise default to an opaque fill. */
export const CHAT_SURFACE_TRANSPARENT_CLASS_NAME = "bg-transparent";

/** Flat, clipped main canvas. The sidebar owns the only persistent panel layer. */
export const CHAT_CONTENT_CARD_CLASS_NAME = "chat-content-card relative overflow-hidden";

/** Chat canvas shared by thread and route surfaces. */
export const CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME = `${CHAT_SURFACE_TRANSPARENT_CLASS_NAME} ${CHAT_CONTENT_CARD_CLASS_NAME}`;

/** Clipped full-height inset shell for app routes. */
export const CHAT_ROUTE_INSET_SHELL_CLASS_NAME =
  "h-full min-h-0 overflow-hidden overscroll-y-none text-foreground";

/** Outer viewport shell for the split/single thread content wrapper that carries the card. */
export const CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME =
  "flex h-full min-h-0 min-w-0 flex-1 overflow-hidden";

/** Shared max width for the chat column (transcript + composer). */
export const CHAT_COLUMN_MAX_WIDTH_CLASS_NAME = COMPOSER_MAX_WIDTH_CLASS_NAME;
/** Horizontal padding shared by the transcript and composer columns. */
export const CHAT_COLUMN_GUTTER_CLASS_NAME =
  "px-[var(--app-density-chat-gutter-x,0.75rem)] sm:px-[var(--app-density-chat-gutter-x-lg,1.25rem)]";
/** Centers the chat column and applies the shared max width. */
export const CHAT_COLUMN_FRAME_CLASS_NAME = `mx-auto w-full min-w-0 ${COMPOSER_MAX_WIDTH_CLASS_NAME}`;

/** Max width for the composer shell. */
export const COMPOSER_COLUMN_FRAME_CLASS_NAME = CHAT_COLUMN_FRAME_CLASS_NAME;

/**
 * Frame for rows stacked above the composer (queued steer/queue rows, live file
 * changes, active task list). Sits at `w-11/12` and is centered (`mx-auto`) so the
 * stack reads as an inset rail above the full-width composer input.
 *
 * Prefer ComposerStackedPanel inside ComposerColumnFrame instead of using this
 * token directly so chrome and attached-radius behavior stay centralized.
 */
export const COMPOSER_STACKED_HEADER_FRAME_CLASS_NAME = "mx-auto -mb-px w-11/12 min-w-0";

/** Opaque base behind the composer shell where it overlaps the transcript. */
export const COMPOSER_INPUT_SHELL_CLASS_NAME =
  "group chat-composer-shell bg-background transition-colors duration-200";

/** Defined composer border: the heaviest border token nudged a bit darker with foreground. */
export const COMPOSER_SURFACE_BORDER_CLASS_NAME =
  "border-[color:color-mix(in_srgb,var(--foreground)_9%,transparent)]";

/** Shared border for panels stacked above the composer; dark mode matches the live changes strip. */
export const COMPOSER_STACKED_SURFACE_BORDER_CLASS_NAME = [
  COMPOSER_SURFACE_BORDER_CLASS_NAME,
  "dark:border-[color:color-mix(in_srgb,var(--color-border-heavy)_50%,transparent)]",
].join(" ");

/** Border-only chrome for opaque persistent surfaces. */
export const RAISED_SURFACE_CHROME_CLASS_NAME = `border ${COMPOSER_SURFACE_BORDER_CLASS_NAME}`;

/** Composer input shell with the same visible border in every runtime. */
export const COMPOSER_INPUT_SURFACE_CLASS_NAME = `chat-composer-surface border ${COMPOSER_SURFACE_BORDER_CLASS_NAME} transition-colors duration-200`;

/** Active segment fill in the sidebar Threads/Workspace picker. */
export const SIDEBAR_SEGMENTED_PICKER_ACTIVE_CLASS_NAME =
  "relative z-[1] text-[var(--color-text-foreground)]";

/** Compatibility base for consumers that add transient elevation separately. */
export const APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME = `relative ${PANEL_SURFACE_CLASS_NAME} text-popover-foreground`;

/** Default floating popup shell (dropdown menus, selects, popovers). */
export const APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME = `relative ${OVERLAY_SURFACE_CLASS_NAME} text-popover-foreground`;

/**
 * Overlay chrome shared by plain tooltips and sidebar hover cards.
 */
export const APP_TOOLTIP_SURFACE_CLASS_NAME = `relative ${OVERLAY_SURFACE_CLASS_NAME} rounded-lg text-popover-foreground`;

/** Compatibility backdrop hook for composer picker dropdown panels. */
export const COMPOSER_PICKER_MENU_BACKDROP_CLASS_NAME = "composer-picker-menu-surface";

/** Shared border, radius, and shadow for composer-attached popup panels. */
export const COMPOSER_PICKER_MENU_SURFACE_CHROME_CLASS_NAME = `border border-border ${COMPOSER_PICKER_RADIUS_CLASS_NAME} ${COMPOSER_SURFACE_SHADOW_CLASS_NAME}`;

/** Visual shell for composer picker dropdown panels (menus attached to the composer). */
export const COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME = `relative ${OVERLAY_SURFACE_CLASS_NAME} text-popover-foreground`;

/** Backdrop layer hook inside open picker panels. */
export const COMPOSER_PICKER_MENU_POPUP_BACKDROP_LAYER_CLASS_NAME = `${COMPOSER_PICKER_MENU_BACKDROP_CLASS_NAME} pointer-events-none absolute inset-0 rounded-[inherit]`;

/** Scrollable list body inside open picker panels. */
export const COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME = `relative z-1 w-full min-w-0 overflow-y-auto overscroll-contain ${COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME}`;

/** Viewport wrapper for anchored select popups (width follows trigger). */
export const COMPOSER_PICKER_MENU_POPUP_VIEWPORT_CLASS_NAME =
  "relative min-w-(--anchor-width) max-h-[min(var(--available-height),28rem)]";

/** Option row shared by composer menus and composer-surface select popups. Sizing via picker size CSS vars.
 *  Leading-icon rules are declared for both `<svg>` (Tabler/Lucide) and the Central
 *  icon `<span data-slot=central-icon>` so a masked Central glyph (e.g. the Explorer
 *  "folders" or Terminal "console" icon) lines up and dims exactly like the SVG icons
 *  instead of sitting brighter and 2px out of alignment. */
export const COMPOSER_PICKER_MENU_OPTION_CLASS_NAME = `[&>svg,&>[data-slot=central-icon]]:-mx-0.5 flex cursor-default select-none items-center ${COMPOSER_PICKER_OPTION_RADIUS_CLASS_NAME} text-[length:var(--app-font-size-ui,14px)] text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)] data-disabled:opacity-64 [&>svg:not([class*='opacity-']),&>[data-slot=central-icon]:not([class*='opacity-'])]:opacity-80 [&>svg,&>[data-slot=central-icon]]:pointer-events-none [&>svg,&>[data-slot=central-icon]]:shrink-0`;

/** Same as menu options, adapted for select item grid layout. */
export const COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME = `${COMPOSER_PICKER_MENU_OPTION_CLASS_NAME} grid in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)]`;

/** Same chrome as picker menus, for composer-attached tooltips. */
export const COMPOSER_PICKER_TOOLTIP_SURFACE_CLASS_NAME = `${COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME} font-normal text-[var(--color-text-foreground)]`;

/** Opaque floating panel for the slash/mention command menu and @local browser. */
export const COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME = `relative ${OVERLAY_SURFACE_CLASS_NAME} bg-popover text-popover-foreground`;

/** Opaque Environment panel card — same rationale as the command menu (overlays transcript). */
export const ENVIRONMENT_PANEL_SURFACE_CLASS_NAME = `relative ${PANEL_SURFACE_CLASS_NAME} text-popover-foreground`;

/** Slide + inset timing matched to `SIDEBAR_OFFCANVAS_MOTION_CLASS` (right dock / thread sidebar). */
// `translate`, not `transform`: the panel slides via `translate-x-*`, which compiles to the
// standalone `translate:` property in Tailwind v4 and is not covered by `transform`.
export const ENVIRONMENT_PANEL_MOTION_CLASS =
  "transition-[translate,opacity] duration-sheet ease-drawer motion-reduce:transition-none";

/** Transcript/composer right inset when the docked Environment card opens. */
export const ENVIRONMENT_CONTENT_INSET_MOTION_CLASS =
  "transition-[padding-right] duration-sheet ease-drawer motion-reduce:transition-none";

/** Anchors the command menu above the composer editor without shifting layout. */
export const COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME =
  "pointer-events-auto absolute inset-x-0 bottom-full z-20 mb-2 overflow-visible px-1 pt-2";

/** Inline command menu slot for compact composers rendered near the top of a scrollable dialog. */
export const COMPOSER_COMMAND_MENU_INLINE_WRAPPER_CLASS_NAME =
  "pointer-events-auto relative z-20 mb-2 overflow-visible px-1";

/** Default command menu row — transparent until hover or keyboard highlight.
 *  Highlight tints the surface darker (button-secondary), matching every other
 *  composer picker. The `elevated-secondary-opaque` token lightens toward white,
 *  which is invisible on the near-white popover surface, so it is not used here. */
export const COMPOSER_COMMAND_MENU_ITEM_CLASS_NAME =
  "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] data-highlighted:bg-[var(--color-background-button-secondary-hover)]";

/** Active command menu row — keyboard-selected pill fill. */
export const COMPOSER_COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME =
  "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]";

export const COMPOSER_INPUT_SURFACE_BANNER_CLASS_NAME = `chat-composer-surface-banner border-b ${COMPOSER_SURFACE_BORDER_CLASS_NAME} bg-[var(--color-background-elevated-secondary)]`;

/** Minimum composer editor height — two lines at the element's line-height.
 *  `leading-relaxed` (1.625) keeps the input in step with the transcript/bubble leading. */
export const COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME = "leading-relaxed";
export const COMPOSER_EDITOR_TEXT_CLASS_NAME = "text-[length:var(--app-font-size-chat,14px)]";
/** Font, size, and leading shared by the composer editor and its placeholder so the
 *  placeholder always aligns with typed text. Keep both surfaces on this one token. */
export const COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME = `font-system-ui ${COMPOSER_EDITOR_TEXT_CLASS_NAME} ${COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME}`;
/** Muted empty-state copy for the composer prompt editor. */
export const COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME = "text-faint";
export const COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME =
  "min-h-[var(--app-density-composer-editor-min-height,2lh)]";
/** Lexical wraps lines in `<p>` nodes; reset default margins so text sits flush above the footer. */
export const COMPOSER_EDITOR_CONTENT_RESET_CLASS_NAME = "[&_p]:m-0";
/** Shared padding around the composer prompt editor. */
export const COMPOSER_EDITOR_PADDING_CLASS_NAME = [
  "relative",
  "pl-[var(--app-density-composer-editor-padding-x,0.75rem)]",
  "pr-[var(--app-density-composer-editor-padding-x-end,0.875rem)]",
  "pt-[var(--app-density-composer-editor-padding-top,0.75rem)]",
  "pb-[var(--app-density-composer-editor-padding-bottom,0.5rem)]",
].join(" ");
/** Bottom bar row — flush to the composer shell edges. */
export const COMPOSER_FOOTER_ROW_CLASS_NAME = [
  "flex items-center justify-between",
  "pl-[var(--app-density-composer-footer-padding,0.375rem)]",
  "pr-[var(--app-density-composer-footer-padding-end,0.5rem)]",
  "pb-[var(--app-density-composer-footer-padding,0.375rem)]",
].join(" ");
