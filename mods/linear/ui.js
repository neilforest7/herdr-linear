import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { settings } from "herdr";
import { detailMarkdown } from "./model.js";

export function action(id, label, fn, t, { icon, selected = false, quiet = false } = {}) {
  return h_flex().id(id).h(28).px(8).gap(6).items_center().flex_none().rounded(5).text_size(12)
    .text_color(selected ? t.foreground : quiet ? t.muted : t.foreground)
    .bg(selected ? t.selected : quiet ? t.background : t.raised)
    .hover(s => s.bg(t.hover).text_color(t.foreground)).focus(s => s.bg(t.selected)).cursor_pointer()
    .tab_index(0).accessibility_label(label).tooltip(label)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(fn)
    .on_key_down((e, cx) => { if (!e.is_held && (e.key === "enter" || e.key === "space")) { cx.stop_propagation(); fn(e, cx); } })
    .when(Boolean(icon), el => el.child(svg(`mods/linear/${icon}.svg`).size(13)))
    .child(label);
}

export function loading(label, t) {
  return h_flex().gap(7).items_center().text_size(12).text_color(t.muted)
    .child(svg("mods/linear/spinner.svg").size(13).spin(900)).child(label);
}

export function Tag(label, t, { icon, color, neutral = false } = {}) {
  const dark = settings().dark;
  const tones = dark
    ? [["#23364b", "#bfdafa"], ["#203c34", "#afe0c8"], ["#40351f", "#f2d695"], ["#422937", "#efb7d1"]]
    : [["#e8f1fd", "#244f7c"], ["#e4f4ed", "#1f614a"], ["#fff1d6", "#6d4c0b"], ["#fbe8ee", "#87394e"]];
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [background, foreground] = neutral ? [t.raised, t.foreground] : tones[hash % tones.length];
  return h_flex().h(22).px(7).gap(5).items_center().flex_none().rounded(4).bg(background)
    .text_size(12).text_color(foreground)
    .when(Boolean(icon), el => el.child(svg(`mods/linear/${icon}.svg`).size(12).text_color(color || t.muted)))
    .child(label);
}

export function statusBadge(issue, t) {
  const type = ["backlog", "unstarted", "started", "completed", "canceled"].includes(issue.statusType) ? issue.statusType : "unstarted";
  const color = type === "started" ? t.working : type === "completed" ? t.done : t.muted;
  return Tag(issue.status || "未知状态", t, { icon: `status-${type}`, color, neutral: true });
}

export function priorityBadge(issue, t, iconOnly = false) {
  const p = issue.priority;
  const value = Number.isInteger(p?.value) && p.value >= 0 && p.value <= 4 ? p.value : 0;
  const color = value === 1 ? t.blocked : value === 2 ? t.working : t.muted;
  const label = p?.name || "未设置优先级";
  return h_flex().gap(6).items_center().flex_none().text_size(12).text_color(t.foreground)
    .tooltip(`优先级：${label}`).accessibility_label(`优先级：${label}`)
    .child(svg(`mods/linear/priority-${value}.svg`).size(15).text_color(color))
    .when(!iconOnly, el => el.child(label));
}

export function issueRow(issue, id, open, t, compact = false) {
  const activate = (_e, cx) => open(issue, cx);
  return v_flex().id(id).px(12).py(compact ? 8 : 11).gap(6).border_b(1).border_color(t.border)
    .hover(s => s.bg(t.hover)).focus(s => s.bg(t.selected)).cursor_pointer().tab_index(0)
    .accessibility_label(`${issue.identifier} ${issue.title} ${issue.status || ""} ${issue.priority?.name || ""}`)
    .on_click(activate).on_key_down((e, cx) => { if (!e.is_held && (e.key === "enter" || e.key === "space")) { cx.stop_propagation(); activate(e, cx); } })
    .child(h_flex().gap(8).items_center().justify_between()
      .child(div().font_family("Geist Mono").text_size(12).text_color(t.muted).child(issue.identifier || "Issue"))
      .when(!compact, el => el.child(priorityBadge(issue, t, true))))
    .child(div().text_size(14).text_color(t.foreground).child(issue.title || issue.identifier || "Issue"))
    .when(Boolean(issue.status) || !compact, el => el.child(h_flex().gap(10).items_center().justify_between()
      .child(statusBadge(issue, t))
      .when(Boolean(issue.assignee), row => row.child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(issue.assignee)))))
    .when(Boolean(issue.labels?.length), el => el.child(h_flex().gap(4).flex_wrap()
      .children(issue.labels.map(label => Tag(typeof label === "string" ? label : label.name, t)))));
}

function property(label, value, t) {
  return h_flex().gap(12).items_start().min_w(0)
    .child(div().w(66).flex_none().text_size(12).text_color(t.muted).child(label))
    .child(typeof value === "string" ? div().flex_1().min_w(0).text_size(13).child(value) : value);
}

export function detailContent(issue, { loaded, busy, width = 380, open, link }, t) {
  const body = v_flex().id(`detail-scroll-${issue.id}`).flex_1().min_h(0).overflow_y_scrollbar().px(16).py(14).gap(18);
  body.child(div().text_size(20).font_semibold().child(issue.title || issue.identifier));
  const properties = v_flex().gap(10)
    .child(property("状态", statusBadge(issue, t), t))
    .child(property("优先级", priorityBadge(issue, t), t))
    .child(property("负责人", issue.assignee || "未分配", t));
  if (loaded) {
    properties.child(property("估点", issue.estimate === null || issue.estimate === undefined ? "未设置" : String(issue.estimate), t));
    if (issue.dueDate) properties.child(property("截止日期", issue.dueDate, t));
    if (issue.labels?.length) properties.child(property("标签", h_flex().flex_1().min_w(0).gap(4).flex_wrap().children(issue.labels.map(label => Tag(typeof label === "string" ? label : label.name, t))), t));
    if (issue.project) properties.child(property("项目", issue.project, t));
  }
  body.child(properties);
  if (busy && !loaded) return body.child(loading("正在读取 issue 描述和关联…", t));
  if (!loaded) return body;
  const description = v_flex().gap(10).pt(4).border_t(1).border_color(t.border)
    .child(div().pt(12).font_semibold().text_size(13).child("描述"));
  if (issue.description) {
    const parts = issue.descriptionParts || [{ type: "markdown", text: issue.description }];
    parts.forEach((part, index) => {
      if (part.type === "markdown") description.child(TextView.markdown(`description-${issue.id}-${issue.updatedAt || "current"}-${index}`, detailMarkdown(part.text))
        .selectable(true).text_size(13).text_color(t.foreground).on_link_click((url, cx) => link(url, cx)));
      else if (part.path) {
        const imageWidth = Math.max(1, Math.min(width - 36, part.width || width - 36));
        const imageHeight = part.width && part.height ? imageWidth * part.height / part.width : 180;
        description.child(image(part.path).w(imageWidth).h(imageHeight));
      } else description.child(div().text_size(12).text_color(t.muted).child(part.error || "图片暂时无法加载"));
    });
  } else description.child(div().text_color(t.muted).text_size(12).child("这个 issue 尚未填写描述。"));
  const relations = v_flex().gap(12).pt(14).border_t(1).border_color(t.border)
    .child(div().font_semibold().text_size(13).child("关联 issue"));
  if (issue.relations === null || issue.relations === undefined) {
    relations.child(div().text_size(12).text_color(t.muted).child("Linear 未返回关系信息。"));
  } else {
    const groups = [
      ["blockedBy", "Blocked by · 被阻塞于", issue.relations.blockedBy],
      ["blocks", "Blocks · 阻塞", issue.relations.blocks],
      ["relatedTo", "Related to · 相关", issue.relations.relatedTo],
      ["duplicateOf", "Duplicate of · 重复于", issue.relations.duplicateOf ? [issue.relations.duplicateOf] : []],
    ];
    let count = 0;
    for (const [key, label, rows] of groups) {
      if (!rows?.length) continue;
      count += rows.length;
      relations.child(v_flex().gap(4).child(div().text_size(12).text_color(t.muted).child(label))
        .children(rows.map(row => issueRow(row, `${issue.id}-${key}-${row.id}`, open, t, true))));
    }
    if (!count) relations.child(div().text_size(12).text_color(t.muted).child("暂无阻塞或关联 issue。"));
  }
  body.child(relations);
  body.child(description);
  if (issue.parentId) body.child(action("parent-issue", "查看父 issue", (_e, cx) => open({ id: issue.parentId, identifier: "父 issue" }, cx), t, { quiet: true }));
  if (issue.updatedAt) body.child(div().text_size(11).text_color(t.muted).child(`Linear 更新于 ${new Date(issue.updatedAt).toLocaleString()}`));
  return body;
}
