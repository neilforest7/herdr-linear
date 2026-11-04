export const DRAFTS = 'linear.drafts.v1';
export const CREATED = 'linear.created.v1';
export const priorities = ['未设置优先级', 'Urgent', 'High', 'Normal', 'Low'];

export function draftFor(saved, project) {
  return { title: '', description: '', team: '', state: '', priority: 0, project: project || '', labels: [], attachments: [], dueDate: '', estimate: '', cycle: '', milestone: '', parentId: '', createMore: false, ...saved };
}

export function reconcile(draft, options) {
  const next = { ...draft };
  if (!options.teams.some(t => t.id === next.team)) next.team = '';
  if (next.project && !options.projects.some(p => p.id === next.project && (!next.team || p.teamIds.includes(next.team)))) { next.project = ''; next.milestone = ''; }
  for (const [key, list] of [['state', 'states'], ['cycle', 'cycles'], ['milestone', 'milestones']]) {
    if (!options[list].some(x => x.id === next[key])) next[key] = '';
  }
  next.labels = next.labels.filter(id => options.labels.some(x => x.id === id));
  return next;
}

export function requestFor(draft, id) {
  if (!draft.title.trim()) throw new Error('请填写 issue 标题。');
  if (!draft.team) throw new Error('请选择团队。');
  if (draft.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) || !Number.isFinite(Date.parse(draft.dueDate)) || new Date(draft.dueDate).toISOString().slice(0, 10) !== draft.dueDate)) throw new Error('截止日期请使用 YYYY-MM-DD。');
  if (draft.estimate !== '' && (!Number.isFinite(Number(draft.estimate)) || Number(draft.estimate) < 0)) throw new Error('估点应为非负数。');
  return {
    id, team: draft.team, title: draft.title.trim(), description: draft.description,
    priority: draft.priority, labels: draft.labels, attachments: draft.attachments,
    ...Object.fromEntries(['state', 'project', 'dueDate', 'cycle', 'milestone', 'parentId'].filter(k => draft[k]).map(k => [k, draft[k]])),
    ...(draft.estimate !== '' ? { estimate: Number(draft.estimate) } : {}),
  };
}

export function afterCreated(draft) {
  return { ...draft, title: '', description: '', attachments: [], jobId: null, requestPath: null, uncertain: false };
}
