export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const match = find(child, id);
    if (match) return match;
  }
  return null;
}

export function filterIssues(issues, query) {
  const text = query.trim().toLocaleLowerCase();
  return issues.filter(issue => `${issue.identifier} ${issue.title} ${issue.status ?? ""} ${issue.assignee ?? ""}`.toLocaleLowerCase().includes(text));
}

export function issueURL(value) {
  return typeof value === "string" && /^https:\/\/linear\.app\/[^\s]*$/.test(value) ? value : null;
}

export function ended(issue) {
  return issue.statusType === "completed" || issue.statusType === "canceled";
}

export function visibleIssues(issues, query, filter) {
  return filterIssues(issues, query).filter(issue => filter === "all" || (filter === "ended" ? ended(issue) : !ended(issue)));
}

export function issueReference(url) {
  return issueURL(url)?.match(/\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/|$|[?#])/i)?.[1] ?? null;
}

export function webURL(url) {
  return typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

export function detailMarkdown(markdown) {
  let fence = null;
  return markdown.split("\n").map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    return fence ? line : line.replace(/^( {0,3})(#{1,6})([ \t]+)/, (_all, space, hashes, gap) => `${space}${"#".repeat(Math.min(6, hashes.length + 2))}${gap}`);
  }).join("\n");
}
