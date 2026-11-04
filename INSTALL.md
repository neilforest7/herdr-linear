# Installing Herdr Linear

This guide is for the agent installing or updating the mod, and for manual installation.
Read `~/.config/herdr-app/AGENTS.md` and [RECIPE.md](RECIPE.md) before changing the running Herdr setup.

## Agent installation

1. Check the requirements below. Keep a persistent checkout of this repository in the user's projects directory. Read the source before running the installer.
2. Run `npm ci` in that checkout. The mod needs both `mods/linear/` and the Node helper under `helper/`.
3. Inspect the current layout and any existing `mods/linear` installation. For a new installation, resolve name clashes according to Herdr's instructions. For an update, reuse the existing checkout and installation.
4. Run `node install.mjs`. The installer adds the button and panel to the current layout and records the helper path. If the layout lacks the required nodes, use Herdr's layout API to adapt the current custom layout, following its existing conventions.
5. Run `herdr-app check` on the installed mod and check `herdr-app status` for errors. Open the Linear panel and leave browser authorization and project selection to the user.

Linear uses the network and runs a local Node helper. OAuth credentials are stored in macOS Keychain; project bindings, downloaded images, and creation job files are stored in Herdr's home. Selected attachments are read locally and uploaded when creating an issue. Explain these accesses before installation, as Herdr's instructions require.

Keep the checkout and its dependencies available after installation. If the checkout moves, rerun the installer. Use the same `HERDR_APP_HOME` as the running Herdr window.

For updates, pull into the existing checkout, run `npm ci`, and rerun `node install.mjs`. Keep the user's project bindings and local credentials. Adapt the button and panel integration to any layout changes made since installation.

## Requirements

- macOS. OAuth credentials are stored in macOS Keychain.
- Node.js 22 or later and npm.
- Herdr running, with `herdr-app` available on your PATH. Tested with Herdr 0.1.13.
- A layout with a `tabs` block and either a `panel-body` stack or a `work-body` row. Herdr's default `main` layout has these nodes.

The panel uses Herdr's native GPUI mod API. It runs inside Herdr; there is no standalone web app.

## Install

```sh
git clone https://github.com/neilforest7/herdr-linear.git
cd herdr-linear
npm ci
node install.mjs
```

The installer copies `mods/linear` into your Herdr home, adds the tab-bar button and side panel to the current layout, and saves a layout backup before changing it. A supported built-in layout is cloned first. Layouts without the required nodes are rejected.

Open **Linear** in the tab bar, authorize access in your browser, and select a project. The choice applies to the current space. In the project picker, **这个 space 不需要绑定 Linear** means “This space doesn't need Linear.”

Keep this checkout in place: the installed mod calls the helper from this directory. After moving the checkout, run the installer again.

For a custom Herdr home, use the same environment variable when starting Herdr and installing the mod:

```sh
HERDR_APP_HOME=/path/to/herdr-home node install.mjs
```

## Update

```sh
git pull --ff-only
npm ci
node install.mjs
```

Run the installer in each layout where you want the button. Herdr updates preserve custom mods and layouts; changes to Herdr's mod API may require an update to this project.

## Authorization and local data

The helper connects to [Linear's official MCP server](https://linear.app/docs/mcp) at `https://mcp.linear.app/mcp`, replacing `/mcp/readonly` as the primary endpoint. OAuth uses PKCE and dynamic client registration. You do not need to create a Linear OAuth application or paste an API key.

Initial authorization requests only `read` scope for browsing. The first attempt to create an issue requests optional additional `write` consent in the browser (`read write`). Declining leaves browsing available. Using `/mcp` does not itself grant write access.

After consent, credentials are reused when reopening the composer, switching spaces, and restarting Herdr. The MCP SDK refreshes access tokens silently. Browser consent is requested again only when the saved authorization is unavailable, expired, or revoked.

OAuth tokens and client registration are stored in the **Herdr Linear MCP** entry in macOS Keychain. Project bindings and skipped-space choices are stored in Herdr's shared state. Helper paths and downloaded issue images are stored under `data/linear/` in your Herdr home; creation requests and job status are stored under `data/linear/create/`. Creation requests can contain issue text and local attachment paths. The browser login status file is stored at `data/linear-auth.json` in your Herdr home.

All Linear requests run on your Mac, including when you work in a remote Herdr space. If authorization expires and cannot be refreshed, open the panel and authorize again.

To remove the local OAuth credentials:

```sh
node helper/client.mjs logout
```

This clears the Keychain entry. You can also revoke the app's access in Linear.

## Create an issue

Open **Create Issue** in the panel. Enter a title and Markdown description, choose a team, state, priority, project, and colored labels, and add attachments. **More** contains due date (`dueDate`), estimate, cycle, milestone, and parent issue. The composer has no assignee field. Enable **Create more** to keep it open after a successful creation.

## Development

```sh
npm test
herdr-app check mods/linear
```

The Node tests cover OAuth, pagination, issue data, descriptions and images, space auto-collapse, composer drafts, creation validation, uploads, and duplicate submission protection. `herdr-app check` validates the initial native view; it does not replace checking later states in the running app.

Manual verification is required: start with `read` consent, browse, decline the first write request and confirm browsing still works, then approve `read write` and check creation, attachments, and **Create more** in a test workspace. These are required checks, not claims of completed consent or real-write testing.

| Path | Purpose |
| --- | --- |
| `mods/linear/` | Native panel, button, UI components, and icons |
| `helper/` | OAuth, MCP requests, issue normalization, and image handling |
| `install.mjs` | Install the mod and connect it to a layout |
| `RECIPE.md` | Mod structure and behavior for Herdr agents |
