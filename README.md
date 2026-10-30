# Zotero Quiet Popup

Stops the Zotero reader's link and citation previews from opening every time you hover over a link.
Hold **Ctrl** while hovering to show a preview.

## Settings

**Edit → Settings → Quiet Popup**

- **Only with a key** (default): hold the key while hovering. The key can be Ctrl, Alt, Shift or Super.
- **Never**: hovering never opens a preview.
- **Always**: Zotero's default behavior.

You can still open a preview from the keyboard in any mode: Tab to the link, then press Enter.

## Install

```sh
./build.sh
```

In Zotero, open **Tools → Plugins**, click the gear menu, choose **Install Plugin From File…**, and
select `build/zotero-quiet-popup-1.0.0.xpi`.

Tested on Zotero 10.
