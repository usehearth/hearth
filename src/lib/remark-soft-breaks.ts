// Single line breaks in a message stay line breaks (like Claude Code's own output), instead of markdown's rule that
// joins them into one paragraph: a three-line standup should read as three lines. Code blocks are left alone.
type Node = { type: string; value?: string; children?: Node[] };

export function remarkSoftBreaks() {
  const walk = (node: Node) => {
    if (!node.children) return;
    const out: Node[] = [];
    for (const c of node.children) {
      if (c.type === 'text' && c.value?.includes('\n')) {
        c.value.split('\n').forEach((part, i) => {
          if (i) out.push({ type: 'break' });
          if (part) out.push({ type: 'text', value: part });
        });
      } else {
        walk(c);
        out.push(c);
      }
    }
    node.children = out;
  };
  return (tree: Node) => walk(tree);
}
