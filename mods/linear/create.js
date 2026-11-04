import { div, svg } from 'gpui-kit';
import { v_flex, h_flex, Input, InputState, Textarea, TextareaState, Button, Switch } from 'gpui-base';
import { shared, setShared, openOverlay, closeOverlay, appHome, notify } from 'herdr';
import * as fs from 'fs/promises';
import { exec } from 'herdr';
import { action, loading, Tag, statusBadge, priorityBadge } from './ui.js';
import { DRAFTS, CREATED, priorities, draftFor, reconcile, requestFor, afterCreated } from './create-model.js';

export function openCreate(space, project, expanded = false) {
  return openOverlay({ mod: 'linear', props: { create: true, space, project, expanded }, kind: 'dialog', modal: true, width: expanded ? 0.94 : 760, height: expanded ? 0.94 : 540 });
}
const names = { team: '团队', state: '状态', priority: '优先级', project: '项目', labels: '标签', cycle: '周期', milestone: '里程碑' };
const empty = { teams: [], projects: [], states: [], labels: [], cycles: [], milestones: [] };

export class Composer {
  constructor(props, cx, call) {
    this.props = props; this.call = call;
    this.draft = draftFor(shared(DRAFTS)?.[props.space], props.project);
    this.pickJob = this.draft.pickJob;
    this.options = empty; this.epoch = 0; this.canWrite = false;
    if (this.draft.uncertain) this.error = 'Linear 可能已收到这个 issue。请先到 Linear 确认，避免重复创建。';
    this.inputs = {};
    for (const [key, placeholder] of Object.entries({ title: 'Issue title', dueDate: 'YYYY-MM-DD', estimate: '未设置', parentId: '如 JUP-123' })) {
      const input = InputState.new({ placeholder, value: this.draft[key] });
      input.on('change', (_e, cx) => { this.draft[key] = input.value(); this.save(); cx.notify(); });
      this.inputs[key] = input;
    }
    this.description = TextareaState.new({ placeholder: 'Add description…  支持 Markdown', value: this.draft.description, rows: 6 });
    this.description.on('change', (_e, cx) => { this.draft.description = this.description.value(); this.save(); cx.notify(); });
    this.search = InputState.new({ placeholder: '搜索…' });
    this.search.on('change', (_e, cx) => { this.highlight = 0; cx.notify(); });
    this.search.on('submit', (_e, cx) => { if (this.picker && this.rows()[this.highlight]) this.choose(this.rows()[this.highlight], cx); });
    this.focus = cx.focus_handle();
    this.pickerFocus = cx.focus_handle();
    cx.timer.every(2000, cx => { if (this.draft.jobId || this.pickJob || this.authPending) this.poll(cx); });
    this.load(cx);
    cx.timer.after(0, () => this.inputs.title.focus());
  }

  save() { setShared(DRAFTS, { ...(shared(DRAFTS) || {}), [this.props.space]: { ...this.draft } }); }
  close() { this.save(); }
  dismiss() { this.save(); closeOverlay(this.props.overlay); }
  get locked() { return Boolean(this.submitting || this.draft.jobId || this.draft.uncertain); }

  work(cx, fn) {
    cx.spawn(async cx => { try { await fn(cx); } catch (e) { this.error = e.message; } finally { cx.notify(); } });
  }

  load(cx) {
    const epoch = ++this.epoch;
    this.loading = true; if (!this.draft.uncertain) this.error = null;
    this.work(cx, async cx => {
      try {
        const status = await this.call('status');
        if (epoch !== this.epoch) return;
        this.canWrite = status.canWrite; this.authPending = status.pending; this.authChecked = true;
        if (!status.authenticated) { this.error = '请授权 Linear 后继续。'; return; }
        let data = await this.call('create-options', this.draft.project || '', this.draft.team || '');
        if (epoch !== this.epoch) return;
        if (!this.draft.team) {
          const project = data.projects.find(p => p.id === this.draft.project);
          const team = data.teams.find(t => project?.teamIds.includes(t.id)) || data.teams[0];
          if (team) data = await this.call('create-options', this.draft.project || '', team.id);
          if (epoch !== this.epoch) return;
          this.draft.team = team?.id || '';
        }
        this.options = data; this.draft = reconcile(this.draft, data);
        if (!this.draft.state) this.draft.state = (data.states.find(s => s.type === 'backlog') || data.states.find(s => s.type === 'unstarted') || data.states[0])?.id || '';
        this.save();
      } finally { if (epoch === this.epoch) this.loading = false; }
    });
    cx.notify();
  }

  authorize(cx) {
    if (!this.authChecked || this.canWrite || this.authPending) return;
    this.authPending = true; this.error = null;
    this.work(cx, async cx => { try { const data = await this.call('login', 'write'); this.authPending = data.pending; if (data.canWrite) { this.canWrite = true; this.load(cx); } } catch (e) { this.authPending = false; throw e; } });
    cx.notify();
  }

  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    this.work(cx, async cx => {
      try {
        if (this.authPending) {
          const status = await this.call('status');
          this.authPending = status.pending; this.canWrite = status.canWrite;
          if (!status.pending) { if (status.error) this.error = '授权未完成，请重新尝试。'; else if (status.authenticated) this.load(cx); }
        }
        if (this.pickJob && this.pickJob !== 'starting') {
          const result = await this.call('create-status', this.pickJob);
          if (!result.pending) { this.pickJob = null; this.draft.pickJob = null; this.save(); if (result.files) this.addFiles(result.files, cx); if (result.error) this.error = '无法选择附件，请重试或拖入文件。'; }
        }
        if (this.draft.jobId) {
          const result = await this.call('create-status', this.draft.jobId);
          if (result.missing && this.draft.requestPath) {
            try { await this.call('create-start', this.draft.requestPath); }
            catch (e) { if (e.authRequired) { this.draft.jobId = null; this.draft.requestPath = null; this.canWrite = false; this.save(); } throw e; }
            return;
          }
          this.phase = result.phase;
          if (!result.pending) {
            if (result.issue) {
              const issue = result.issue;
              setShared(CREATED, { space: this.props.space, issue, at: Date.now() });
              notify({ title: `${issue.identifier || 'Issue'} 已创建`, body: issue.title || this.draft.title, level: 'success' });
              this.draft = afterCreated(this.draft); this.save();
              if (this.draft.createMore) { this.inputs.title.set_value(''); this.description.set_value(''); this.inputs.title.focus(); this.success = `${issue.identifier || 'Issue'} 已创建`; }
              else this.dismiss();
            } else {
              this.draft.uncertain = Boolean(result.uncertain); this.draft.jobId = null; this.draft.requestPath = null;
              this.error = result.uncertain ? 'Linear 可能已收到这个 issue。请先到 Linear 确认，避免重复创建。' : `创建失败：${result.error || '请重试'}`;
              this.save();
            }
          }
        }
      } finally { this.polling = false; }
    });
  }

  addFiles(files, cx) {
    if (this.locked) return;
    for (const f of files) {
      const file = typeof f === 'string' ? { path: f, name: f.split('/').pop() } : f;
      if (file.size >= 2_000_000_000) { this.error = '单个附件必须小于 2 GB。'; continue; }
      if (!this.draft.attachments.some(x => x.path === file.path)) this.draft.attachments.push(file);
    }
    this.save(); cx.notify();
  }

  pickFiles(cx) {
    if (this.pickJob || this.locked) return;
    this.pickJob = 'starting';
    this.work(cx, async () => { try { this.pickJob = (await this.call('choose-files')).jobId; this.draft.pickJob = this.pickJob; this.save(); } catch (e) { this.pickJob = null; throw e; } });
    cx.notify();
  }

  submit(cx) {
    if (this.locked || this.loading || this.pickJob || !this.canWrite) return;
    try { requestFor(this.draft, ''); } catch (e) { this.error = e.message; cx.notify(); return; }
    this.submitting = true; this.error = null; this.success = null; this.picker = null;
    this.work(cx, async () => {
      try {
        const idResult = await exec('/usr/bin/uuidgen', []);
        const id = idResult.stdout.trim().toLowerCase();
        if (idResult.code !== 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('无法生成创建请求，请重试。');
        const request = requestFor(this.draft, id);
        const dir = `${appHome()}/data/linear/create`;
        const path = `${dir}/request-${id}.json`;
        for (const [cmd, args] of [['/bin/mkdir', ['-p', dir]], ['/bin/chmod', ['700', dir]]]) { const r = await exec(cmd, args); if (r.code !== 0) throw new Error('无法保存创建请求。'); }
        await fs.writeFile(path, JSON.stringify(request));
        if ((await exec('/bin/chmod', ['600', path])).code !== 0) throw new Error('无法保护创建请求。');
        // Keep the job ID before dispatch so closing this dialog cannot lose a submitted request.
        this.draft.jobId = id; this.draft.requestPath = path; this.save();
        await this.call('create-start', path);
      } catch (e) {
        if (e.authRequired) { this.draft.jobId = null; this.draft.requestPath = null; this.canWrite = false; this.save(); this.error = '请重新授权创建权限。'; }
        else if (this.draft.jobId) this.error = '正在确认提交结果，请稍候。';
        else throw e;
      } finally { this.submitting = false; }
    });
    cx.notify();
  }

  showPicker(key, cx) {
    if (this.locked || this.loading) return;
    this.picker = this.picker === key ? null : key; this.highlight = 0;
    this.search.set_value(''); if (this.picker) this.search.focus(); cx.notify();
  }

  rows() {
    const key = this.picker;
    const list = key === 'priority' ? priorities.map((name, id) => ({ id, name })) : this.options[{ team: 'teams', state: 'states', project: 'projects', labels: 'labels', cycle: 'cycles', milestone: 'milestones' }[key]] || [];
    const rows = list.filter(x => (key !== 'project' || x.teamIds.includes(this.draft.team)) && `${x.name || ''} ${x.key || ''} ${x.number || ''}`.toLowerCase().includes(this.search.value().toLowerCase()));
    return ['project', 'cycle', 'milestone', 'state'].includes(key) ? [{ id: '', name: '未设置' }, ...rows] : rows;
  }

  choose(row, cx) {
    const key = this.picker;
    if (this.locked || !key) return;
    if (key === 'labels') this.draft.labels = this.draft.labels.includes(row.id) ? this.draft.labels.filter(id => id !== row.id) : [...this.draft.labels, row.id];
    else { this.draft[key] = row.id; this.picker = null; this.inputs.title.focus(); }
    if (key === 'team') { this.draft.state = ''; this.draft.cycle = ''; this.draft.parentId = ''; this.inputs.parentId.set_value(''); this.draft.labels = []; if (!this.options.projects.find(p => p.id === this.draft.project)?.teamIds.includes(row.id)) this.draft.project = ''; this.draft.milestone = ''; this.load(cx); }
    if (key === 'project') { this.draft.milestone = ''; this.load(cx); }
    this.save(); cx.notify();
  }

  chip(key, label, content, t) {
    return Button.new(`create-${key}`).h(30).px(10).rounded(15).bg(this.picker === key ? t.selected : t.raised).border(1).border_color(t.border)
      .text_size(12).text_color(t.foreground).disabled(this.locked || this.loading).accessibility_label(`${names[key]}：${label}`).tooltip(`${names[key]}：${label}`)
      .on_click((_e, cx) => this.showPicker(key, cx)).child(content || label);
  }

  renderPicker(t) {
    const rows = this.rows(), key = this.picker;
    const selected = id => key === 'labels' ? this.draft.labels.includes(id) : this.draft[key] === id;
    return v_flex().flex_1().min_h(0).gap(8).p(12).rounded(8).bg(t.surface).border(1).border_color(t.border).track_focus(this.pickerFocus)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') { cx.stop_propagation(); this.picker = null; this.inputs.title.focus(); cx.notify(); }
        else if (['down', 'arrowdown', 'up', 'arrowup'].includes(e.key)) { cx.stop_propagation(); this.highlight = Math.max(0, Math.min(rows.length - 1, this.highlight + (e.key.includes('down') ? 1 : -1))); cx.notify(); }
        else if (e.key === 'enter' && !e.is_held && rows[this.highlight]) { cx.stop_propagation(); this.choose(rows[this.highlight], cx); }
      })
      .child(h_flex().items_center().gap(8).child(div().font_semibold().child(names[key])).child(div().flex_1()).child(action('picker-done', '完成', (_e, cx) => { this.picker = null; this.inputs.title.focus(); cx.notify(); }, t, { quiet: true })))
      .child(div().bg(t.background).rounded(5).p(6).child(Input.new(this.search)))
      .child(v_flex().id('create-options').flex_1().min_h(0).overflow_y_scrollbar().gap(3)
        .children(rows.map((row, index) => Button.new(`option-${key}-${row.id || 'none'}`).h(32).px(8).rounded(4).text_size(12).bg(index === this.highlight ? t.selected : t.surface).text_color(t.foreground)
          .accessibility_label(row.name || `Cycle ${row.number}`).on_click((_e, cx) => this.choose(row, cx))
          .child(h_flex().w_full().gap(8).items_center().child(key === 'labels' ? Tag(row.name, t) : key === 'priority' ? priorityBadge({ priority: { value: row.id, name: row.name } }, t) : key === 'state' && row.id ? statusBadge({ status: row.name, statusType: row.type }, t) : div().child(row.key ? `${row.key} · ${row.name}` : row.name || `Cycle ${row.number}`))
            .child(div().flex_1()).child(selected(row.id) ? '✓' : ''))))
        .when(!rows.length, el => el.child(div().p(10).text_color(t.muted).child('没有可选项'))));
  }

  render(cx, t) {
    const d = this.draft, o = this.options;
    const canSubmit = !this.locked && !this.loading && this.canWrite && Boolean(d.title.trim()) && Boolean(d.team) && !this.pickJob;
    const team = o.teams.find(x => x.id === d.team), state = o.states.find(x => x.id === d.state), project = o.projects.find(x => x.id === d.project);
    const root = v_flex().size_full().min_h(0).min_w(0).p(22).gap(16).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.focus)
      .on_drop((e, cx) => this.addFiles(e.paths || [], cx))
      .on_key_down((e, cx) => { if (!e.is_held && e.key === 'enter' && (e.modifiers.platform || e.modifiers.control)) { cx.stop_propagation(); this.submit(cx); } });
    root.child(h_flex().gap(10).items_center()
      .child(this.chip('team', team?.name || '团队', div().font_semibold().child(team?.key || team?.name || '选择团队'), t))
      .child(div().text_color(t.dim).child('›')).child(div().text_size(15).child('New issue')).child(div().flex_1())
      .child(action('create-expand', this.props.expanded ? '还原' : '展开', () => { this.save(); closeOverlay(this.props.overlay); openCreate(this.props.space, this.props.project, !this.props.expanded); }, t, { icon: 'expand', quiet: true }))
      .child(action('create-close', '关闭', () => this.dismiss(), t, { icon: 'close', quiet: true })));
    if (!this.authChecked) root.child(loading('正在检查已保存的授权…', t));
    if (this.authChecked && !this.canWrite) root.child(h_flex().gap(10).items_center().flex_wrap().p(10).rounded(6).bg(t.surface)
      .child(div().flex_1().text_size(12).text_color(t.muted).child(this.authPending ? '请在浏览器中完成创建权限授权。' : '首次创建需要授权写入权限，之后会自动复用。'))
      .when(!this.authPending, el => el.child(action('create-authorize', '授权创建', (_e, cx) => this.authorize(cx), t, { icon: 'external' }))));
    if (this.error) root.child(h_flex().gap(10).items_center().flex_wrap().child(div().flex_1().text_size(12).text_color(t.blocked).child(this.error))
      .when(!this.locked && !this.loading, el => el.child(action('create-reload', '重新读取属性', (_e, cx) => this.load(cx), t, { quiet: true })))
      .when(Boolean(d.uncertain), el => el.child(action('create-check-linear', '在 Linear 中确认', (_e, cx) => cx.open_url('https://linear.app'), t, { icon: 'external' }))
        .child(action('create-confirm-checked', '已核对，解锁草稿', (_e, cx) => { d.uncertain = false; this.error = null; this.save(); cx.notify(); }, t, { quiet: true }))));
    if (this.success) root.child(div().text_size(12).text_color(t.done).child(this.success));
    root.child(div().text_size(22).font_semibold().child(Input.new(this.inputs.title).disabled(this.locked).accessibility_label('Issue title')));
    const body = v_flex().flex_1().min_h(0).gap(12);
    if (this.picker) body.child(this.renderPicker(t));
    else body.child(v_flex().id('create-body').flex_1().min_h(0).overflow_y_scrollbar().gap(12)
      .child(Textarea.new(this.description).h(this.more ? 110 : 170).disabled(this.locked).accessibility_label('Issue description'))
      .when(this.more, el => el.child(v_flex().gap(10).p(12).bg(t.surface).rounded(6)
        .child(h_flex().gap(16).flex_wrap().children([['dueDate', '截止日期'], ['estimate', '估点'], ['parentId', '父 issue']].map(([key, label]) => v_flex().w(key === 'parentId' ? 180 : 140).gap(5).child(div().text_size(11).text_color(t.muted).child(label)).child(div().p(6).rounded(4).bg(t.background).border(1).border_color(t.input).child(Input.new(this.inputs[key]).disabled(this.locked).accessibility_label(label))))))
        .child(h_flex().gap(8).flex_wrap()
          .child(this.chip('cycle', o.cycles.find(x => x.id === d.cycle)?.name || (d.cycle ? `Cycle ${o.cycles.find(x => x.id === d.cycle)?.number || ''}` : '周期'), null, t))
          .child(this.chip('milestone', o.milestones.find(x => x.id === d.milestone)?.name || '里程碑', null, t)))))
      .when(d.attachments.length > 0, el => el.child(v_flex().gap(6).children(d.attachments.map((file, i) => h_flex().gap(8).items_center().child(svg('mods/linear/attachment.svg').size(13)).child(div().flex_1().truncate().text_size(12).child(file.name)).child(Button.new(`remove-file-${i}`).disabled(this.locked).text_size(12).on_click((_e, cx) => { d.attachments.splice(i, 1); this.save(); cx.notify(); }).child('移除')))))));
    root.child(body);
    root.child(h_flex().gap(8).flex_wrap().items_center()
      .child(this.chip('state', state?.name || '状态', statusBadge({ status: state?.name || '状态', statusType: state?.type }, t), t))
      .child(this.chip('priority', priorities[d.priority], priorityBadge({ priority: { value: d.priority, name: priorities[d.priority] } }, t), t))
      .child(this.chip('project', project?.name || '项目', null, t))
      .child(this.chip('labels', `${d.labels.length} 个标签`, d.labels.length ? h_flex().gap(4).children(d.labels.slice(0, 2).map(id => Tag(o.labels.find(x => x.id === id)?.name || '标签', t))).when(d.labels.length > 2, el => el.child(`+${d.labels.length - 2}`)) : div().child('Labels'), t))
      .child(Button.new('create-more-properties').h(30).px(10).rounded(15).bg(t.raised).text_color(t.muted).accessibility_label('更多属性').disabled(this.locked).on_click((_e, cx) => { this.more = !this.more; this.picker = null; cx.notify(); }).child('•••')));
    const pendingText = this.submitting ? '正在保存请求…' : d.jobId ? ({ queued: '等待创建…', validating: '正在校验属性…', uploading: '正在上传附件…', creating: '正在创建 issue…' }[this.phase] || '正在确认创建结果…') : this.pickJob ? '正在选择附件…' : this.loading && this.authChecked ? '正在读取属性…' : '';
    root.child(h_flex().gap(12).items_center().flex_wrap()
      .child(Button.new('create-attachment').h(32).px(10).rounded(16).bg(t.raised).text_color(t.muted).disabled(this.locked || Boolean(this.pickJob)).accessibility_label('添加附件，也可以拖入文件').tooltip('添加附件，也可以拖入文件').on_click((_e, cx) => this.pickFiles(cx)).child(svg('mods/linear/attachment.svg').size(16)))
      .when(Boolean(pendingText), el => el.child(loading(pendingText, t))).child(div().flex_1())
      .child(Switch.new('create-more').checked(d.createMore).disabled(this.locked).accessibility_label('Create more').on_change((checked, cx) => { d.createMore = checked; this.save(); cx.notify(); })
        .w(30).h(18).rounded(9).bg(d.createMore ? t.accent : t.dim).child(div().w(14).h(14).m(2).rounded(7).bg(t.background).when(d.createMore, el => el.ml(14))))
      .child(div().text_size(12).text_color(t.muted).child('Create more'))
      .child(Button.new('create-submit').h(34).px(16).rounded(17).bg(canSubmit ? t.accent : t.raised).text_color(canSubmit ? t.accent_foreground : t.dim).font_semibold().text_size(13).disabled(!canSubmit).accessibility_label('Create issue').tooltip('Create issue · ⌘ Enter').on_click((_e, cx) => this.submit(cx)).child('Create issue')));
    return root;
  }
}
