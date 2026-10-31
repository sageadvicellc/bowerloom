/** Text with `inline code` in backticks. Everything else stays plain. */
export default function ProductText({ children }: { children: string }) {
  return <>{children.split(/`([^`]+)`/g).map((part, index) => index % 2 === 1 ? <code key={index}>{part}</code> : part)}</>;
}
