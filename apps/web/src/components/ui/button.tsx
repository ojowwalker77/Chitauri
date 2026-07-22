"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";
import { extendButtonIconChildSelectors } from "~/lib/central-icons";

/** Slightly softer outline border for header chrome buttons in dark mode. */
const headerButtonDarkBorderClassName =
  "dark:border-[color:color-mix(in_srgb,var(--color-border)_80%,transparent)]";

// Variant taxonomy (visual treatment) × size axis × content (icon / text / icon+text).
//
//   filled      → default (subtle) | secondary | destructive | prominent
//   outlined    → outline | primary-outline | secondary-outline | destructive-outline | chrome-outline
//   ghostly     → ghost | chrome | subtle | link
//
// Sizes pair text variants (chip/xs/sm/default/lg/xl) with their square
// icon-only counterparts (icon-chip/icon-xs/icon-sm/icon/icon-lg/icon-xl) at
// matching heights, so a text button and an icon-only button sit on the same
// baseline in a toolbar row. `chip`/`icon-chip` are for inline action pills
// inside queued-message rows, badges, etc.
//
// ICON SIZE IS NOT A SIZE-VARIANT KNOB. Every button renders its icon at 14px —
// the navigation size — except the `xl` pair, which is the card-scale CTA and
// uses 20px. Height and padding carry the size difference; the glyph does not.
// This used to fan out across six per-size overrides AND a `sm:` breakpoint step
// (18px→16px, 16px→14px, …), which meant the same icon changed size depending on
// which button it landed in and how wide the window was.
//
// Visual style is intentionally flat — no drop shadows, no inset highlights, no
// pseudo-element edge glints. Buttons are solid color + border + hover-bg only.
// If you need depth, add a single new variant rather than reintroducing shadows
// piecewise; the flat look is the project default and what most surfaces expect.
//
// Adding a new variant? Mirror an existing one's border/focus treatment so the
// family stays visually coherent. Prefer adding a variant over passing a
// className override at the call site.
//
// Press feedback (`active:scale-[0.97]`) lives on the BASE, so every variant and size
// answers a press instantly — that acknowledgement is what makes a control feel like it
// heard you, and a button that only reacts on release reads as broken. `link` opts out
// below (it renders as inline text, which shouldn't squash).
//
// The property list names `scale`, NOT `transform`, and that distinction is load-bearing:
// Tailwind v4's `scale-*` utilities compile to the standalone `scale:` property, which
// `transition-property: transform` does not cover. Naming `transform` here would leave the
// press snapping to 0.96 with no tween — visually broken, but silent (it still compiles,
// typechecks, and lints). `transition-transform` would also work since it expands to
// `transform, translate, scale, rotate`, but spelling the list keeps `transition-all` out.
//
// Careful at call sites: `cn` runs tailwind-merge, which collapses ALL `transition-*` into
// one group — so passing any `transition-…` via className REPLACES this list wholesale and
// silently drops the press tween. Prefer a variant over a call-site transition override.
const buttonVariants = cva(
  extendButtonIconChildSelectors(
    "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-[length:var(--app-font-size-ui,14px)] outline-none transition-[color,background-color,border-color,scale] duration-press ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ),
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        chip: "h-auto gap-1 px-2 py-0.5 text-[length:var(--app-font-size-ui-sm,13px)] sm:h-auto",
        default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
        icon: "size-9 sm:size-8",
        "icon-chip": "size-6 sm:size-6",
        "icon-lg": "size-10 sm:size-9",
        "icon-sm": "size-8 sm:size-7",
        "icon-xl": extendButtonIconChildSelectors(
          "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5",
        ),
        "icon-xs": "size-7 sm:size-6",
        lg: "h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9",
        sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
        xl: extendButtonIconChildSelectors(
          "h-11 px-[calc(--spacing(4)-1px)] sm:h-10 [&_svg:not([class*='size-'])]:size-5",
        ),
        xs: "h-7 gap-1 px-[calc(--spacing(2)-1px)] text-[length:var(--app-font-size-ui-sm,13px)] sm:h-6",
      },
      variant: {
        chrome:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] hover:bg-hover hover:text-[var(--color-text-foreground)] data-pressed:bg-selected data-pressed:text-[var(--color-text-foreground)]",
        "chrome-outline": extendButtonIconChildSelectors(
          "border-panel-border bg-transparent text-[var(--color-text-foreground)] hover:bg-hover data-pressed:bg-selected [&_svg]:mx-0",
        ),
        default:
          "border-transparent bg-selected text-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] data-pressed:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]",
        destructive:
          "border-destructive bg-destructive text-white hover:bg-destructive/90 data-pressed:bg-destructive/90",
        "destructive-outline":
          "border-transparent bg-transparent text-destructive hover:bg-hover hover:text-destructive data-pressed:bg-hover data-pressed:text-destructive",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] hover:bg-hover hover:text-[var(--color-text-foreground)] data-pressed:bg-selected data-pressed:text-[var(--color-text-foreground)]",
        // Renders as inline text rather than a button surface, so it takes the underline
        // as its press/hover answer and opts out of the base squash.
        link: "border-transparent underline-offset-4 active:scale-100 hover:underline data-pressed:underline",
        outline:
          "border-panel-border bg-transparent text-[var(--color-text-foreground)] hover:bg-hover data-pressed:bg-hover",
        "primary-outline":
          "border-panel-border bg-transparent text-[var(--color-text-foreground)] hover:bg-hover data-pressed:bg-hover",
        // Lifts on hover, so its press has to read from BOTH rest (1.0) and hover (1.05):
        // landing under rest is what still registers as "pushed" on a touchscreen, where
        // the hover lift never happens.
        prominent:
          "border-transparent bg-foreground text-background transition-[background-color,scale,opacity] duration-press ease-out hover:bg-[var(--color-text-foreground-secondary)] active:scale-[0.97] disabled:opacity-20 disabled:active:scale-100",
        secondary:
          "border-transparent bg-hover text-secondary-foreground hover:bg-selected data-pressed:bg-selected",
        "secondary-outline":
          "border-panel-border bg-transparent text-[var(--color-text-foreground)] hover:bg-hover data-pressed:bg-hover",
        subtle:
          "border-transparent bg-selected text-[var(--color-text-foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] data-pressed:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]",
        // Was a gold "needs attention" pill; keeps the variant name for external
        // callers but now signals attention with the info tint (§3 state table).
        gold: "border-[color:color-mix(in_srgb,var(--info)_30%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)] text-info hover:bg-[color-mix(in_srgb,var(--info)_16%,transparent)] data-pressed:bg-[color-mix(in_srgb,var(--info)_16%,transparent)]",
      },
    },
    compoundVariants: [
      {
        class:
          "!box-border !h-auto !min-h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)] !py-0.5 text-[length:var(--app-font-size-ui,14px)] sm:!h-auto sm:px-[calc(--spacing(2.5)-1px)] sm:text-[length:var(--app-font-size-ui-sm,13px)]",
        size: "xs",
        variant: "chrome-outline",
      },
      {
        class: "!size-8 sm:!size-7",
        size: "icon-xs",
        variant: "chrome-outline",
      },
    ],
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, render, ...props },
  ref,
) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    ref,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
});

/** Dialog footers and inline error actions share this sizing override. */
const dialogActionButtonClassName = "!h-auto !min-h-8 !px-3 !py-1 !font-normal sm:!min-h-7";

export { Button, buttonVariants, dialogActionButtonClassName, headerButtonDarkBorderClassName };
