"use client";

/**
 * The copyable target (hostname, etc.) inside a type-to-confirm dialog label.
 *
 * Three behaviors are load-bearing inside a shadcn <Label>:
 *  - `select-all` overrides the Label's `select-none` so one click selects
 *    the whole value, ready for ⌘C;
 *  - click preventDefault stops the label from forwarding the click as focus
 *    to the input, which would drop the selection mid-copy;
 *  - mousedown stopPropagation keeps Radix Label's own mousedown handler
 *    (which preventDefaults double-clicks to suppress accidental label
 *    selection) from killing double-click selection of the value.
 */
const SelectableConfirmTarget = ({ value }: { value: string }) => (
  <span
    className="font-mono text-foreground select-all cursor-text"
    onClick={(event) => event.preventDefault()}
    onMouseDown={(event) => event.stopPropagation()}
  >
    {value}
  </span>
);

export default SelectableConfirmTarget;
