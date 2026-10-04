import type { ReactNode } from 'react';

/** Product names have a reading style distinct from executable commands. */
export function Propernoun({ children }: { children: ReactNode }) {
  return <span className="propernoun">{children}</span>;
}

export default function ProductText({ children }: { children: string }) {
  return <>{children.split(/(\b(?:Teams|Relay|Roots|Vines|Workbench|git|Git|node|Node|npm)\b|@sagetrellis\/[a-z-]+)/g).map((part, index) => {
    if (/^(Teams|Relay|Roots|Vines|Workbench)$/.test(part)) return <Propernoun key={index}>{part}</Propernoun>;
    if (/^(git|Git|node|Node|npm|@sagetrellis\/[a-z-]+)$/.test(part)) return <code key={index}>{/^(Git|Node)$/.test(part) ? part.toLowerCase() : part}</code>;
    return part;
  })}</>;
}
