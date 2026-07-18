# TeaCode Design System

Monochromatic, minimal, systematic. The UI chrome is grayscale only; color exists
solely to indicate state. Inspired by the "Modern. Minimal. Systematic." sheet
(docs/mockups reference): flat white surfaces, hairline borders, near-black text,
generous whitespace.

## 1. Principles

1. **Chrome is monochrome.** Backgrounds, borders, buttons, icons, chips, hovers,
   selections of UI structure — all grayscale. No brand orange, no gold, no coral,
   no decorative tints anywhere.
2. **Color = meaning. Red, green, blue ONLY.** If an element is colored, it is
   indicating something. If it isn't indicating anything, it is grayscale.
3. **Dark mode is an inversion, not a second palette.** The same neutral ramp with
   roles flipped, plus alpha variants of the ramp poles. No new hues in dark mode;
   the three semantic colors are identical in both modes.
4. **Provider icons keep their brand identity.** A provider glyph is a logo, not
   chrome: it may use its brand fill (e.g. Claude's coral). Brand color lives
   inside the icon component only — it never leaks into surrounding chrome
   tokens, borders, or text.

## 2. Neutral ramp

One ramp, six stops. Everything grayscale derives from these (or an alpha/color-mix
variant of the two poles — alpha variants are not "new colors").

| Token                | Light                 | Dark (inverted)                        |
| -------------------- | --------------------- | -------------------------------------- |
| `--background`       | `#ffffff`             | `#111318`                              |
| `--panel` (surface)  | `#f7f8fa`             | `color-mix(#ffffff 4%, #111318)`       |
| `--well` (inset)     | `#f2f2f4`             | `color-mix(#ffffff 2%, #111318)`       |
| `--border`           | `#e5e7eb`             | `rgba(255,255,255,0.08)`               |
| `--panel-border`     | `#e5e7eb`             | `rgba(255,255,255,0.08)`               |
| `--divider`          | `#f2f2f4`             | `rgba(255,255,255,0.05)`               |
| `--foreground`       | `#111318`             | `#f7f8fa`                              |
| `--muted-foreground` | `#6b7280`             | `#9aa1ad` (`#6b7280` lightened by mix) |
| `--faint`            | mix(foreground 45%)   | mix(foreground 45%)                    |
| `--hover`            | `rgba(17,19,24,0.05)` | `rgba(255,255,255,0.05)`               |
| `--selected`         | `rgba(17,19,24,0.08)` | `rgba(255,255,255,0.08)`               |
| `--input`            | `#f7f8fa`             | `color-mix(#ffffff 5%, #111318)`       |

Retired tokens: `--accent` (orange), `--claude`, `--gold`, `--app-sidebar-coral`.
`--warning` no longer exists as a hue of its own — see semantics. Do not
reintroduce them; if old code references them they must be migrated, not aliased.

## 3. Semantic colors (the only three)

| Token       | Value     | Means                                                                                                |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `--danger`  | `#e94b4b` | Errors, failures, destructive actions, diff deletions                                                |
| `--success` | `#4cb782` | Success, completed, merged, healthy, diff additions                                                  |
| `--info`    | `#3b82f6` | Needs-your-attention (pending approval, awaiting input), links, focus, selection, active/in-progress |

Same three values in light and dark. Foreground-on-tint variants are derived with
`color-mix` against `--foreground`/`--background`, never new hexes.

- `--destructive` stays as an alias of `--danger` for existing call sites.
- Tinted usage: backgrounds at 8–14% mix, borders at ~30% mix, text at full value.
- A colored element must be _stating_ one of the meanings above. A spinner spinning
  is already an indication — it stays monochrome; motion carries the meaning.

### State mapping (replaces orange/gold statuses)

| State                               | Treatment                                  |
| ----------------------------------- | ------------------------------------------ |
| Working / streaming / thinking      | Monochrome spinner (`--muted-foreground`)  |
| Active agent / in-progress dot      | `--info` pulse dot                         |
| Pending approval / awaiting input   | `--info` (text + dot)                      |
| Completed / success                 | `--success`                                |
| Error / failed / stopped-on-error   | `--danger`                                 |
| Connecting / idle                   | Monochrome                                 |
| Plan ready (was violet)             | `--info`                                   |
| Terminal process running (was teal) | `--success`                                |
| Favorite model star (was gold)      | Monochrome (filled = foreground)           |
| Usage warning (was gold)            | `--danger` at text level, no tinted panels |

## 4. Focus, selection, input states

- **Keyboard focus (`:focus-visible`)**: 2px `--info` outline, offset 2px. This is
  the only focus ring in the app.
- **Focused text inputs / composer**: NO colored ring, NO accent border. The border
  darkens one step (`color-mix(foreground 20%, border)`); background stays. The
  composer must read as a calm monochrome surface when focused.
- **Caret**: `--foreground` (was orange).
- **Text selection (`::selection`)**: `--info` at ~25% alpha (was orange).

## 5. Surfaces, borders, spacing

- Borders are 1px hairlines of `--border`. 2px reserved for emphasis (rare).
- Dividers use `--divider` (lighter than borders).
- Flat surfaces: no gradients (the desktop drag strip gradient becomes flat
  `--background`), no glass/backdrop blur on persistent chrome, shadows only on
  true overlays (menus, dialogs).
- Spacing on the 8pt grid: 4, 8, 12, 16, 24, 32, 48, 64.
- Radii: tight but not square. Base `--radius: 0.5rem`; the derived scale
  (`--radius-sm` … `--radius-4xl`) follows. One-off radii should stay within a
  step of the scale; pills (`999px`) remain for genuinely round controls.
- Typography: Inter (UI) / 0xProto (mono) unchanged.

## 6. Components

- **Buttons**: primary = solid `--foreground` fill with `--background` text;
  secondary = `--panel` surface with 1px `--border`; tertiary/ghost = text only
  with `--hover` on hover; destructive = `--danger`. No gold/accent variants.
- **Badges / alerts / toasts**: neutral by default; red/green/blue variants only
  for the semantic meanings in §3. The gold/warning variants migrate per the state
  table.
- **Links**: `--info`.
- **Inline chips (mentions, files, skills)**: neutral (grayscale surface + border).
  Chips are structure, not status.
- **Switches / checkboxes / radios**: checked state uses `--foreground` fill
  (monochrome, per the sheet), not a color — on/off is structure, not status.
- **Ultrathink / extended-thinking chrome**: monochrome (foreground-mix pill and
  text). It labels a mode, it doesn't indicate state.
- **Activity heatmap**: grayscale ramp (foreground-mix intensity steps).
- **Provider icons**: brand fill allowed, scoped to the glyph itself (icon-local
  constant, not a chrome token). Icon choice must derive from the thread's
  _current model selection provider_ — never from a cached/stale session value.

## 7. Dark mode rule

Dark mode = invert the neutral ramp roles (§2 table, right column) using only ramp
members and alpha/color-mix variants of `#ffffff`/`#111318`. Semantic colors do not
change. If a dark-mode value can't be expressed as a ramp member or a mix of the
poles, the design is wrong — do not invent a new hex.

## 8. Motion — the attention budget

Animation is never allowed to make the user wait. If the user asked for
something and an animation stands between them and it, the animation has
failed regardless of how nice it looks.

Duration tokens (single source: the `@theme` block in `apps/web/src/index.css`;
they back the Tailwind `duration-*` utilities):

| Token                 | ms  | Job                                      |
| --------------------- | --- | ---------------------------------------- |
| `duration-press`      | 140 | Press/hover feedback on buttons and rows |
| `duration-tooltip`    | 160 | Tooltip fade                             |
| `duration-menu`       | 200 | Menus, popovers, dialogs                 |
| `duration-disclosure` | 220 | Expand/collapse (see disclosure rule)    |
| `duration-sheet`      | 220 | Sheets, drawers, sliding panels          |

Rules:

- **Interaction-path motion is ≤ 220ms with zero entrance delay.** New tokens
  above 220ms need a written justification in this file.
- **One source for toggles.** Every open/close animation uses
  `apps/web/src/lib/disclosureMotion.ts` (or `DisclosureRegion` /
  `CollapsiblePanel` / `DisclosureChevron`). Never a bespoke height/opacity
  transition.
- **Reduced motion is not optional.** Every transition/animation carries
  `motion-reduce:*` (utilities) or a `prefers-reduced-motion` block (CSS) —
  including ambient loops (skeleton shimmer, pulse dots); the static element
  must still read as its state with the loop stopped.
- Ambient loops (spinners, pulses, shimmer) are exempt from the 220ms ceiling
  but must be quiet: they signal, they don't perform.
- Hide-delays that _reduce_ churn (e.g. the scrollbar's idle fade-out) are
  allowed; delays before showing something are not.

## 9. Feedback — every wait is visible

Anything the user does that makes them wait MUST show that something is
happening. Silence during an async operation is a bug, not a style choice.

- **Buttons that fire async work** disable and swap their leading icon for a
  `Spinner` while in flight; they refuse double-fires.
- **Content that is loading** renders `Skeleton` blocks — never the empty
  state. "Empty" and "not loaded yet" are different states and must render
  differently (see `threadDetailSyncedById` for the transcript pattern).
- **Long-running background operations** (worktree prep, handoff, session
  spawn) surface on whatever chrome remains visible after the trigger closes —
  a spinner on the trigger, a status chip, or a progress toast at start.
- Reuse the existing primitives: `Spinner`, `Skeleton`,
  `ThreadRunningSpinner`, `DiffPanelLoadingState`, the "Loading models"
  picker pattern. Do not invent new loading visuals.
- Working/streaming states stay monochrome per §3 — motion carries the
  meaning.
