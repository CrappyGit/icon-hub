# Icon Hub

A Sine mod for Zen Browser that adds a **More** tab to Zen's icon picker, for
space and folder icons. Works alongside Zia's icon tab.

It has three sources, switched at the top of the tab:

- **Iconify**: search over 200,000 icons from about 200 sets
  ([icon-sets.iconify.design](https://icon-sets.iconify.design)). Pick a set
  (Emoji, Fluent Emoji, Noto, Lucide, Tabler, Phosphor, Material…) to search
  only that set, or to browse it without searching. One-colour icons follow
  your theme's colour, like Zen's own icons.
- **Logos**: the brand logos from [svgl.app](https://svgl.app). Logos with light
  and dark versions use the one that fits your current theme.
- **Custom**: your own icons. Put SVG or PNG files in the folder that
  **Open folder** opens (`chrome/sine-mods/icon-hub-icons/custom/` in your
  profile), then press **Reload**.

A picked icon is saved to `chrome/sine-mods/icon-hub-icons/` in your profile, so
it keeps working offline and if the site changes.

## Install

1. In Sine's settings, turn on **Enable installing JS from unofficial sources**
   (`sine.allow-unsafe-js` in `about:config`).
2. In Sine's mod list, enter `CrappyGit/icon-hub` and press **Install**.
3. Restart Zen.

## Change the sets

The sets listed under Iconify are the `SETS` list at the top of
`icon-hub.uc.js`. Any set's id from icon-sets.iconify.design works there.

Icons and logos are © their owners; each Iconify set and svgl.app logo has its
own licence.
