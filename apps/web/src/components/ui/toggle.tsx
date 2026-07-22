"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";
import { extendButtonIconChildSelectors } from "~/lib/central-icons";

// Matches the Button base: a press answers instantly with `active:scale-[0.96]`, and the
// hover/on-state colors fade rather than snap (this had no transition at all before).
// `data-pressed` here is Base UI's TOGGLED-ON state, not the transient press — `active:`
// is what covers the finger being down, so the two coexist.
const toggleVariants = cva(
  extendButtonIconChildSelectors(
    "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base text-foreground outline-none transition-[color,background-color,border-color,scale] duration-press ease-out active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-[var(--color-background-button-secondary-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-pressed:bg-[var(--color-background-button-secondary)] data-pressed:text-[var(--color-text-foreground)] sm:text-sm [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ),
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 min-w-9 px-[calc(--spacing(2)-1px)] sm:h-8 sm:min-w-8",
        lg: "h-10 min-w-10 px-[calc(--spacing(2.5)-1px)] sm:h-9 sm:min-w-9",
        sm: "h-8 min-w-8 px-[calc(--spacing(1.5)-1px)] sm:h-7 sm:min-w-7",
        xs: extendButtonIconChildSelectors(
          "h-7 min-w-7 px-[calc(--spacing(1)-1px)] sm:h-6 sm:min-w-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        ),
      },
      variant: {
        default: "border-transparent",
        outline:
          "border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] dark:data-pressed:bg-[var(--color-background-button-secondary)] dark:hover:bg-[var(--color-background-button-secondary-hover)]",
      },
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
