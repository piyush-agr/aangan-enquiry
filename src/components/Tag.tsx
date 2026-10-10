import { LABEL } from "./format";

export function Tag({ value, label }: { value: string; label?: string }) {
  return <span className={`tag t-${value}`}>{label ?? LABEL[value] ?? value}</span>;
}
