import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, props, theme, layout, run, shared, setShared, exec, appHome, readTextFile, nextCommand } from "herdr";
import { find, visibleIssues, issueURL, issueReference, webURL } from "./model.js";
import { action, loading, issueRow, detailContent } from "./ui.js";

const BINDINGS = "linear.projects.v1";
const activeSpace = () => spaces().find(s => s.active);
const visible = () => !find(layout(), "panel")?.hidden && find(layout(), "panel-body")?.active === "linear";
const later = (cx, fn) => cx.spawn(async cx => { await cx.sleep(0); await fn(cx); });
const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export default class Linear extends View {
  init(_props, cx) {
    this.button = Boolean(props()?.button);
    if (this.button) {
      const enabled = shared("workspace.panels") ?? ["files", "changes"];
      if (!enabled.includes("linear")) setShared("workspace.panels", [...enabled, "linear"]);
      return;
    }
    this.epoch = 0; this.projects = []; this.issues = []; this.authenticated = null;
    this.history = []; this.filter = "all";
    this.input = InputState.new({ placeholder: "搜索编号、标题、负责人" });
    this.input.on("change", (_e, cx) => cx.notify());
    this.focus = cx.focus_handle();
    cx.spawn(async cx => { for (;;) { const c = await nextCommand(); if (c === "focus") this.focus.focus(); } });
    cx.timer.every(2000, cx => { if (this.pending && !this.busy) this.load(cx); });
    cx.timer.every(60000, cx => { if (visible() && !this.busy && !this.pending && !this.choosing) this.refresh(cx); });
  }

  async call(command, ...args) {
    const config = JSON.parse(await readTextFile(`${appHome()}/data/linear/config.json`) ?? "null");
    if (!config?.helper || !config.node) throw new Error("请重新安装 Linear 模块。");
    const result = await exec(config.node, [config.helper, command, ...args]);
    let data;
    try { data = JSON.parse(result.stdout); } catch { throw new Error("Linear 连接中断，请重试。"); }
    if (data.ok === false || result.code !== 0) {
      const error = new Error(data.error === "Linear request timed out" ? "Linear 请求超时，请重试。" : "无法读取 Linear，请重试。");
      error.authRequired = data.authRequired;
      throw error;
    }
    return data;
  }

  task(cx, kind, work) {
    const epoch = ++this.epoch;
    this.busy = kind; this.error = null;
    cx.notify();
    cx.spawn(async cx => {
      try { await work(epoch); }
      catch (error) {
        if (epoch === this.epoch) {
          this.error = error.message;
          if (error.authRequired) { this.authenticated = false; this.pending = false; this.error = "Linear 授权已失效，请重新授权。"; }
        }
      } finally { if (epoch === this.epoch) { this.busy = null; cx.notify(); } }
    });
  }

  load(cx) {
    if (this.busy) return;
    const binding = shared(BINDINGS)?.[this.space];
    this.task(cx, binding?.id && !this.choosing ? "issues" : "projects", async epoch => {
      const status = await this.call("status");
      if (epoch !== this.epoch) return;
      this.authenticated = status.authenticated; this.pending = status.pending;
      if (status.error) this.error = "授权未完成，请重新尝试。";
      if (!this.authenticated) return;
      if (!binding?.id || this.choosing) {
        const data = await this.call("projects");
        if (epoch === this.epoch) this.projects = data.projects;
      } else {
        const data = await this.call("issues", binding.id);
        if (epoch === this.epoch) { this.issues = data.issues; this.loaded = true; this.updated = clock(); }
      }
    });
  }

  refresh(cx) {
    if (this.busy) return;
    if (this.selected && this.authenticated) this.fetchIssue(cx);
    else this.load(cx);
  }

  fetchIssue(cx) {
    const id = this.selected.id;
    this.task(cx, "detail", async epoch => {
      const data = await this.call("issue", id);
      if (epoch === this.epoch) { this.selected = data.issue; this.detailLoaded = true; this.detailUpdated = clock(); }
    });
  }

  openIssue(issue, cx) {
    if (this.selected) this.history.push(this.selected);
    this.selected = issue; this.detailLoaded = false; this.detailUpdated = null;
    this.fetchIssue(cx);
  }

  back(cx) {
    ++this.epoch; this.busy = null; this.error = null;
    this.selected = this.history.pop() ?? null;
    this.detailLoaded = false;
    if (this.selected) this.fetchIssue(cx);
    else if (!this.loaded) this.load(cx);
    cx.notify();
  }

  link(url, cx) {
    const id = issueReference(url);
    if (id) this.openIssue({ id, identifier: id }, cx);
    else if (webURL(url)) cx.open_url(url);
  }

  login(cx) {
    this.task(cx, "auth", async epoch => {
      const data = await this.call("login");
      if (epoch === this.epoch) { this.pending = Boolean(data.pending); this.authenticated = Boolean(data.authenticated); }
    });
  }

  bind(project, cx) {
    setShared(BINDINGS, { ...(shared(BINDINGS) ?? {}), [this.space]: { id: project.id, name: project.name } });
    ++this.epoch; this.busy = null; this.choosing = false; this.issues = []; this.loaded = false;
    this.selected = null; this.history = []; this.updated = null; this.input.set_value(""); this.filter = "all";
    this.load(cx);
  }

  disable(cx) {
    setShared(BINDINGS, { ...(shared(BINDINGS) ?? {}), [this.space]: { disabled: true } });
    ++this.epoch; this.busy = null; this.error = null;
    this.selected = null; this.history = []; this.issues = []; this.loaded = false;
    run("layout.hide", { id: "panel" });
    cx.notify();
  }

  render(cx) {
    const t = theme();
    if (this.button) {
      const space = activeSpace()?.id;
      const disabled = shared(BINDINGS)?.[space]?.disabled === true;
      if (space !== this.buttonSpace || disabled !== this.disabled) {
        this.buttonSpace = space; this.disabled = disabled; this.manualOpenSpace = null;
      }
      if (disabled && visible() && this.manualOpenSpace !== space) later(cx, () => {
        if (activeSpace()?.id === space && shared(BINDINGS)?.[space]?.disabled === true && this.manualOpenSpace !== space && visible()) run("layout.hide", { id: "panel" });
      });
      return h_flex().size_full().px(6).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(action("linear-toggle", "Linear", () => {
          if (visible()) run("layout.hide", { id: "panel" });
          else { this.manualOpenSpace = space; run("layout.select", { stack: "panel-body", child: "linear" }); run("layout.show", { id: "panel" }); }
        }, t, { selected: visible(), icon: "linear" }));
    }
    const space = activeSpace();
    const binding = shared(BINDINGS)?.[space?.id];
    const showing = visible();
    if (space?.id !== this.space) {
      this.space = space?.id; ++this.epoch; this.busy = null; this.error = null;
      this.issues = []; this.projects = []; this.loaded = false; this.choosing = false;
      this.selected = null; this.history = []; this.detailLoaded = false;
      this.input.set_value(""); this.updated = null; this.wasVisible = false; this.filter = "all";
    }
    if (showing && !this.wasVisible && space) later(cx, cx => this.refresh(cx));
    this.wasVisible = showing;
    const root = v_flex().size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground).text_size(13)
      .rounded(10).border(1).border_color(t.border).track_focus(this.focus)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .on_key_down((e, cx) => { if (!e.is_held && e.key === "escape" && this.selected) { cx.stop_propagation(); this.back(cx); } });
    const header = h_flex().px(12).h(44).flex_none().gap(8).items_center().border_b(1).border_color(t.border);
    if (this.selected) {
      header.child(action("detail-back", "返回", (_e, cx) => this.back(cx), t, { icon: "back", quiet: true }))
        .child(div().text_size(12).font_semibold().child(this.selected.identifier || "Issue"));
    } else header.child(svg("mods/linear/linear.svg").size(16)).child(div().font_semibold().child("Linear"));
    header.child(div().flex_1());
    if (this.selected && issueURL(this.selected.url)) header.child(action("issue-external", "Linear", (_e, cx) => cx.open_url(issueURL(this.selected.url)), t, { icon: "external", quiet: true }));
    header.child(action("linear-close", "收起", () => run("layout.hide", { id: "panel" }), t, { quiet: true }));
    root.child(header);
    if (!space) return root.child(div().p(20).text_color(t.muted).child("选择一个 space 后连接 Linear。"));
    if (this.error) root.child(v_flex().px(16).py(12).gap(8).bg(t.surface)
      .child(div().text_size(12).child(this.error))
      .when(!this.busy, el => el.child(action("retry", "重试", (_e, cx) => this.refresh(cx), t, { icon: "refresh" }))));
    if (this.authenticated === null) return root.child(div().p(20).child(loading("正在检查 Linear 连接…", t)));
    if (!this.authenticated) {
      return root.child(v_flex().p(20).gap(14)
        .child(div().text_size(18).font_semibold().child("连接 Linear"))
        .child(div().text_color(t.muted).child(this.pending ? "请在浏览器中完成授权。" : "授权后选择 project，绑定到当前 space。"))
        .when(Boolean(this.busy) || this.pending, el => el.child(loading(this.pending ? "等待浏览器授权…" : "正在连接…", t)))
        .when(!this.busy && !this.pending, el => el.child(action("linear-login", "授权 Linear", (_e, cx) => this.login(cx), t, { icon: "external" }))));
    }
    if (this.selected) {
      if (this.detailLoaded || !this.busy) root.child(h_flex().px(16).py(8).gap(8).items_center().justify_between()
        .child(this.busy === "detail" ? loading(this.detailLoaded ? "正在更新…" : "正在加载详情…", t) : div().text_size(11).text_color(t.muted).child(this.detailUpdated ? `同步于 ${this.detailUpdated}` : ""))
        .when(!this.busy, el => el.child(action("detail-refresh", "刷新", (_e, cx) => this.fetchIssue(cx), t, { icon: "refresh", quiet: true }))));
      return root.child(detailContent(this.selected, { loaded: this.detailLoaded, busy: this.busy === "detail", width: this.width, open: (issue, cx) => this.openIssue(issue, cx), link: (url, cx) => this.link(url, cx) }, t));
    }
    if (!binding?.id || this.choosing) {
      root.child(v_flex().p(16).gap(8).child(div().text_size(16).font_semibold().child("选择 project"))
        .child(div().text_color(t.muted).text_size(12).child(`绑定到 ${space.name}`))
        .when(Boolean(binding?.id), el => el.child(action("cancel-project", "返回 issues", (_e, cx) => { ++this.epoch; this.busy = null; this.choosing = false; this.load(cx); }, t, { icon: "back", quiet: true }))));
      root.child(v_flex().px(16).pb(12).gap(8)
        .child(action("disable-linear", "这个 space 不需要绑定 Linear", (_e, cx) => this.disable(cx), t, { quiet: true })));
      if (this.busy) root.child(div().px(16).py(12).child(loading("正在读取 projects…", t)));
      else if (!this.error && !this.projects.length) root.child(div().p(16).text_color(t.muted).child("没有可访问的 project，请检查 Linear 项目权限。"));
      return root.child(v_flex().id("linear-projects").flex_1().min_h(0).overflow_y_scrollbar().px(12).gap(4)
        .children(this.projects.map(p => action(`project-${p.id}`, p.name, (_e, cx) => this.bind(p, cx), t, { selected: p.id === binding?.id }))));
    }
    root.child(h_flex().px(16).pt(14).pb(10).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(16).font_semibold().child(binding.name))
      .when(!this.busy, el => el.child(action("change-project", "更换", (_e, cx) => { this.choosing = true; this.load(cx); }, t, { quiet: true }))
        .child(action("refresh", "刷新", (_e, cx) => this.load(cx), t, { icon: "refresh", quiet: true }))));
    root.child(div().mx(16).px(8).py(6).rounded(5).bg(t.surface).border(1).border_color(t.input).child(Input.new(this.input)));
    const filtered = visibleIssues(this.issues, this.input.value(), this.filter);
    root.child(h_flex().px(16).py(10).gap(4).items_center()
      .children([["all", "全部"], ["open", "未结束"], ["ended", "已结束"]].map(([id, name]) => action(`filter-${id}`, name, (_e, cx) => { this.filter = id; cx.notify(); }, t, { selected: this.filter === id, quiet: true }))));
    root.child(h_flex().px(16).pb(10).gap(8).items_center().justify_between().text_size(11).text_color(t.muted)
      .child(`${filtered.length} issues`)
      .child(this.busy ? loading(this.loaded ? "正在同步…" : "正在加载…", t) : div().child(this.updated ? `同步于 ${this.updated}` : "")));
    if (!this.busy && !this.error && this.loaded && !filtered.length) root.child(div().p(20).text_color(t.muted).child(this.input.value() || this.filter !== "all" ? "没有匹配的 issue。" : "这个 project 暂无 issues。"));
    return root.child(v_flex().id("linear-issues").flex_1().min_h(0).overflow_y_scrollbar().px(4)
      .children(filtered.map(issue => issueRow(issue, `issue-${issue.id}`, (issue, cx) => this.openIssue(issue, cx), t))));
  }
}
