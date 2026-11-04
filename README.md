# Herdr Linear

English · [中文](README.zh-CN.md)

Read and create Linear issues beside your terminals. Bind a project to each Herdr space, then open Linear from the tab bar.

![List and detail views of Herdr Linear](preview.png)

*List and detail views shown side by side with demo data. Interface labels are currently in Chinese.*

## Install

Paste this into your agent running in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/neilforest7/herdr-linear/tree/main
```

Requires macOS and Node.js 22+. Your agent handles installation; you authorize Linear in the browser and choose a project in the panel. [Installation details](INSTALL.md).

## Features

- **Per-space projects.** Bind each space to a Linear project, or mark it as not needing Linear. Skipped spaces automatically collapse the panel.
- **Issues at a glance.** Identifiers, status and priority icons, assignees, and colored tags. Search and filter the list.
- **Details in place.** Read descriptions, embedded Linear images, estimates, and labels. Follow Blocked by, Blocks, Related to, Duplicate of, and parent issue links; Back or Escape returns to the previous view.
- **Create issues.** A composer with a title, Markdown description, team, state, priority, project, colored labels, and attachments. **More** adds due date, estimate, cycle, milestone, and parent issue. **Create more** keeps the composer open for another issue.
- **Optional write access.** Browsing uses OAuth `read` scope through Linear's official MCP server. Your first creation requests additional `write` consent; browsing works without it. Tokens stay in macOS Keychain. The visible panel refreshes every minute.

## Update

Ask your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then update my Herdr Linear mod from: https://github.com/neilforest7/herdr-linear/tree/main
```

## Documentation

- [Installation, authorization, and development](INSTALL.md)
- [Mod structure and behavior](RECIPE.md)

The tab-bar and side-panel integration follows [Herdr Issues](https://github.com/jankeesvw/herdr-issues). Herdr Linear is an independent community mod, released under the [MIT license](LICENSE).
