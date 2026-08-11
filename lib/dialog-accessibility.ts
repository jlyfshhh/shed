export type DialogKeyAction = "close" | "first" | "last" | "dialog" | "none";

/** Pure keyboard decision used by the browser manager and its regression test. */
export function dialogKeyAction(
  key: string,
  shiftKey: boolean,
  activeIndex: number,
  focusableCount: number,
): DialogKeyAction {
  if (key === "Escape") return "close";
  if (key !== "Tab") return "none";
  if (focusableCount === 0) return "dialog";
  if (shiftKey && activeIndex <= 0) return "last";
  if (!shiftKey && (activeIndex < 0 || activeIndex === focusableCount - 1)) return "first";
  return "none";
}
