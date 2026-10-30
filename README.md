# logicbrowser

a cozy, private chromium browser for big nerds. themed after [logicmeow.co.uk](https://logicmeow.co.uk) (catppuccin mocha, pixel fonts, hard shadows, 100% lowercase).

## features

- **chromium engine** (via electron), a ua that says plain chrome so sites act normally
- **search.cat built in**: anything you type that isn't a url goes to `logicmeow.co.uk/search.cat`, and you get live suggestions from the logicsearch api
- **ad + tracker blocking** from the ghostery engine (easylist + easyprivacy style lists). the shield shows how many things got blocked on each page
- **privacy defaults**: sends do-not-track + global privacy control, denies geolocation/notifications/etc, client hints tidied up
- **private tabs** (⇧⌘N): each one gets its own throwaway session, purple themed
- logicmeow **new tab page** with search, quick links (your bookmarks), a greeting, and a running ads-squished count
- cat themed **error pages**
- tabs you can drag to reorder, reopen closed tab, find in page, zoom, downloads with progress toasts, bookmarks, history suggestions, devtools, compact mode, html5 fullscreen

## run it

```sh
npm install
npm start
```

## build a .dmg / .app

```sh
npm run dist        # macos arm64 -> dist/
npm run dist:all    # mac + windows + linux
```

## shortcuts

| keys | action |
| --- | --- |
| ⌘T / ⌘W | new / close tab |
| ⇧⌘T | reopen closed tab |
| ⇧⌘N | new private tab |
| ⌘L | focus address bar |
| ⌘1–9, ctrl+tab | switch tabs |
| ⌘[ / ⌘] | back / forward |
| ⌘R / ⇧⌘R | reload / hard reload |
| ⌘F | find in page |
| ⌘D | bookmark |
| ⌘= ⌘- ⌘0 | zoom |
| ⇧⌘S | compact mode |
| ⌥⌘I | devtools |

## layout

```
src/main.js            main process: windows, sessions, adblock, logic:// pages, menus
src/preload.js         safe bridge for the browser ui
src/renderer/          browser ui (index.html, ui.css, app.js) + logic:// pages (newtab, error)
src/renderer/theme.css shared logicmeow theme + fonts
```
