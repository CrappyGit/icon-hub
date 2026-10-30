// Icon Hub: a "More" tab in Zen's icon picker, for spaces and folders.
// Three sources: any icon on Iconify (about 200 sets, emoji included), the
// brand logos on svgl.app, and your own icons from a folder in your profile.
// Works next to Zia's own tab.
(() => {
  if (window.__iconHubLoaded) {
    return;
  }
  window.__iconHubLoaded = true;
  console.info("[Icon Hub] loaded in", window.location.href);

  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const ICONIFY = "https://api.iconify.design";
  const SVGL = "https://api.svgl.app";

  // Picked icons are saved into the profile, so they keep working offline.
  // Sine serves chrome/sine-mods/ as chrome://sine/content/, so the folder
  // sits there, outside this mod's own folder (which Sine replaces on every
  // update). Your own icons go in its "custom" folder.
  const SAVE_DIR = PathUtils.join(PathUtils.profileDir, "chrome", "sine-mods", "icon-hub-icons");
  const SAVE_URL = "chrome://sine/content/icon-hub-icons";
  const CUSTOM_DIR = PathUtils.join(SAVE_DIR, "custom");
  const CUSTOM_URL = `${SAVE_URL}/custom`;
  const CUSTOM_TYPES = /\.(svg|png|jpe?g|webp|gif|ico|avif)$/i;

  const SOURCE_PREF = "icon-hub.source";
  const SET_PREF = "icon-hub.iconify-set";

  // The sets to pick from on Iconify (any set's id works here: see
  // icon-sets.iconify.design). "All" searches every set.
  const SETS = [
    { id: "all", label: "All", prefixes: [] },
    { id: "emoji", label: "Emoji", prefixes: ["fluent-emoji-flat", "noto", "twemoji", "openmoji", "streamline-emojis"] },
    { id: "fluent-emoji-flat", label: "Fluent Emoji", prefixes: ["fluent-emoji-flat"] },
    { id: "noto", label: "Noto", prefixes: ["noto"] },
    { id: "twemoji", label: "Twemoji", prefixes: ["twemoji"] },
    { id: "lucide", label: "Lucide", prefixes: ["lucide"] },
    { id: "tabler", label: "Tabler", prefixes: ["tabler"] },
    { id: "ph", label: "Phosphor", prefixes: ["ph"] },
    { id: "material-symbols", label: "Material", prefixes: ["material-symbols"] },
    { id: "mdi", label: "MDI", prefixes: ["mdi"] },
    { id: "simple-icons", label: "Brands", prefixes: ["simple-icons"] },
  ];

  const SOURCES = [
    { id: "iconify", label: "Iconify" },
    { id: "svgl", label: "Logos" },
    { id: "custom", label: "Custom" },
  ];

  const BATCH = 120;
  const SEARCH_DELAY = 250;

  const pref = (name, fallback) => {
    try {
      return Services.prefs.getStringPref(name, fallback);
    } catch {
      return fallback;
    }
  };
  const setPref = (name, value) => {
    try {
      Services.prefs.setStringPref(name, value);
    } catch (err) {
      console.warn("[Icon Hub] couldn't save a setting:", err);
    }
  };

  const isDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

  async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${new URL(url).host} answered ${response.status}`);
    }
    return response.json();
  }

  async function getText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${new URL(url).host} answered ${response.status}`);
    }
    return response.text();
  }

  // Remembers a promise, forgetting it if it fails, so it's tried again
  function cached(map, key, make) {
    if (!map.has(key)) {
      map.set(
        key,
        make().catch((err) => {
          map.delete(key);
          throw err;
        })
      );
    }
    return map.get(key);
  }

  const svgData = (text) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;

  // One-colour icons draw in currentColor, which an image file doesn't
  // know. Saved, they take Zen's icon colour (context-fill, as Zen's own
  // icons do), so they follow the theme; previews get the panel's text colour.
  const recolor = (text, color) => text.replace(/currentColor/g, color);

  async function saveFile(name, text) {
    const file = name.replace(/[^\w.-]/g, "_");
    const path = PathUtils.join(SAVE_DIR, file);
    if (!(await IOUtils.exists(path))) {
      await IOUtils.makeDirectory(SAVE_DIR, { ignoreExisting: true });
      await IOUtils.writeUTF8(path, text);
    }
    return `${SAVE_URL}/${encodeURIComponent(file)}`;
  }

  // ---- Iconify ----

  const iconifySvgs = new Map();
  const iconifySearches = new Map();
  const iconifySets = new Map();

  // Icons are fetched a set at a time, up to 100 per request (Iconify limits
  // how often it's asked, and a screenful would be over a hundred requests),
  // and drawn here from the shapes it sends.
  const ICONS_PER_REQUEST = 100;
  const waiting = new Map(); // prefix -> Map(name -> { resolve, reject })
  let flushTimer = null;

  function buildSvg(data, name) {
    let icon = data.icons?.[name];
    // another name for an icon: draw the one it names
    for (let alias = data.aliases?.[name], hops = 0; !icon && alias && hops < 5; hops++) {
      icon = data.icons?.[alias.parent];
      alias = data.aliases?.[alias.parent];
    }
    if (!icon) {
      return null;
    }
    const left = icon.left ?? data.left ?? 0;
    const top = icon.top ?? data.top ?? 0;
    const width = icon.width ?? data.width ?? 16;
    const height = icon.height ?? data.height ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${icon.body}</svg>`;
  }

  async function fetchIcons(prefix, entries) {
    const names = entries.map(([name]) => name);
    try {
      const data = await getJSON(`${ICONIFY}/${encodeURIComponent(prefix)}.json?icons=${names.map(encodeURIComponent).join(",")}`);
      for (const [name, { resolve, reject }] of entries) {
        const svg = buildSvg(data, name);
        if (svg) {
          resolve(svg);
        } else {
          reject(new Error(`no icon ${prefix}:${name}`));
        }
      }
    } catch (err) {
      for (const [, { reject }] of entries) {
        reject(err);
      }
    }
  }

  function flushIcons() {
    flushTimer = null;
    for (const [prefix, names] of waiting) {
      const entries = [...names];
      for (let i = 0; i < entries.length; i += ICONS_PER_REQUEST) {
        fetchIcons(prefix, entries.slice(i, i + ICONS_PER_REQUEST));
      }
    }
    waiting.clear();
  }

  const iconifySvg = (id) =>
    cached(iconifySvgs, id, () => {
      const [prefix, name] = id.split(":");
      return new Promise((resolve, reject) => {
        if (!waiting.has(prefix)) {
          waiting.set(prefix, new Map());
        }
        waiting.get(prefix).set(name, { resolve, reject });
        flushTimer ??= setTimeout(flushIcons, 30);
      });
    });

  function iconifySearch(query, prefixes) {
    const params = new URLSearchParams({ query, limit: "999" });
    if (prefixes.length) {
      params.set("prefixes", prefixes.join(","));
    }
    const key = params.toString();
    return cached(iconifySearches, key, async () => (await getJSON(`${ICONIFY}/search?${key}`)).icons || []);
  }

  // every icon in a set, for browsing it without a search
  function iconifySet(prefix) {
    return cached(iconifySets, prefix, async () => {
      const data = await getJSON(`${ICONIFY}/collection?prefix=${encodeURIComponent(prefix)}`);
      const names = [...(data.uncategorized || []), ...Object.values(data.categories || {}).flat()];
      return [...new Set(names)].map((name) => `${prefix}:${name}`);
    });
  }

  const iconifyItem = (id) => {
    const [prefix, name] = id.split(":");
    return {
      title: `${name.replace(/-/g, " ")} (${prefix})`,
      preview: async (color) => svgData(recolor(await iconifySvg(id), color)),
      pick: async () => saveFile(`${prefix}--${name}.svg`, recolor(await iconifySvg(id), "context-fill")),
    };
  };

  // ---- svgl.app ----

  let svglCatalog = null;
  const svglFiles = new Map();

  function loadSvgl() {
    svglCatalog ||= getJSON(SVGL)
      .then((list) =>
        list.map((entry) => {
          const route = entry.route;
          const name = entry.subTitle ? `${entry.title} (${entry.subTitle})` : entry.title;
          const categories = [entry.category].flat().filter(Boolean);
          return {
            name,
            light: typeof route === "string" ? route : route.light,
            dark: typeof route === "string" ? route : route.dark,
            search: `${name} ${categories.join(" ")}`.toLowerCase(),
          };
        })
      )
      .catch((err) => {
        svglCatalog = null;
        throw err;
      });
    return svglCatalog;
  }

  const svglItem = (logo) => {
    const url = isDark() ? logo.dark : logo.light;
    const text = () => cached(svglFiles, url, () => getText(url));
    return {
      title: logo.name,
      preview: async () => svgData(await text()),
      pick: async () => {
        const file = decodeURIComponent(new URL(url).pathname.split("/").pop());
        return saveFile(`svgl--${file}`, await text());
      },
    };
  };

  // ---- your own icons ----

  async function customFiles() {
    await IOUtils.makeDirectory(CUSTOM_DIR, { ignoreExisting: true });
    const paths = await IOUtils.getChildren(CUSTOM_DIR);
    return paths
      .map((path) => PathUtils.filename(path))
      .filter((file) => CUSTOM_TYPES.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  const customItem = (file) => {
    const url = `${CUSTOM_URL}/${encodeURIComponent(file)}`;
    return {
      title: file.replace(CUSTOM_TYPES, ""),
      preview: async () => url,
      pick: async () => url,
    };
  };

  function openCustomFolder() {
    IOUtils.makeDirectory(CUSTOM_DIR, { ignoreExisting: true })
      .then(() => {
        const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        dir.initWithPath(CUSTOM_DIR);
        dir.launch();
      })
      .catch((err) => console.warn("[Icon Hub] couldn't open the folder:", err));
  }

  // ---- the tab ----

  function addTab() {
    const picker = window.gZenEmojiPicker;
    const panel = document.getElementById("PanelUI-zen-emojis-picker");
    const pages = document.getElementById("PanelUI-zen-emojis-picker-pages");
    const tabs = document.getElementById("PanelUI-zen-emojis-buttons-wrapper");
    if (!picker || !panel || !pages || !tabs) {
      console.info("[Icon Hub] icon picker not ready yet", {
        picker: !!picker,
        panel: !!panel,
        pages: !!pages,
        tabs: !!tabs,
      });
      return false;
    }

    const tab = document.createXULElement("toolbarbutton");
    tab.id = "icon-hub-tab";
    tab.setAttribute("label", "More");
    tabs.appendChild(tab);

    const page = document.createXULElement("vbox");
    page.id = "icon-hub-page";

    // search, and where the icons come from
    const bar = document.createElementNS(XHTML_NS, "div");
    bar.id = "icon-hub-searchbar";
    const box = document.createElementNS(XHTML_NS, "input");
    box.id = "icon-hub-search";
    box.setAttribute("type", "text");
    const sourceSwitch = document.createElementNS(XHTML_NS, "div");
    sourceSwitch.id = "icon-hub-sources";
    sourceSwitch.className = "icon-hub-switch";
    const sourceButtons = {};
    for (const source of SOURCES) {
      const button = document.createElementNS(XHTML_NS, "button");
      button.className = "icon-hub-switch-option";
      button.textContent = source.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setPref(SOURCE_PREF, source.id);
        render();
        box.focus({ preventScroll: true });
      });
      sourceButtons[source.id] = button;
      sourceSwitch.appendChild(button);
    }
    bar.append(box, sourceSwitch);

    // Iconify's sets
    const setRow = document.createElementNS(XHTML_NS, "div");
    setRow.id = "icon-hub-sets";
    const setButtons = {};
    for (const set of SETS) {
      const button = document.createElementNS(XHTML_NS, "button");
      button.className = "icon-hub-chip";
      button.textContent = set.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setPref(SET_PREF, set.id);
        render();
        box.focus({ preventScroll: true });
      });
      setButtons[set.id] = button;
      setRow.appendChild(button);
    }

    // your own icons: where they go
    const customRow = document.createElementNS(XHTML_NS, "div");
    customRow.id = "icon-hub-custom-bar";
    const customHint = document.createElementNS(XHTML_NS, "span");
    customHint.textContent = "SVG or PNG files in your icons folder";
    const openButton = document.createElementNS(XHTML_NS, "button");
    openButton.className = "icon-hub-chip";
    openButton.textContent = "Open folder";
    openButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openCustomFolder();
    });
    const reloadButton = document.createElementNS(XHTML_NS, "button");
    reloadButton.className = "icon-hub-chip";
    reloadButton.textContent = "Reload";
    reloadButton.addEventListener("click", (event) => {
      event.stopPropagation();
      render(true);
    });
    customRow.append(customHint, openButton, reloadButton);

    const grid = document.createElementNS(XHTML_NS, "div");
    grid.id = "icon-hub-grid";
    const message = document.createElementNS(XHTML_NS, "div");
    message.id = "icon-hub-message";
    message.hidden = true;
    page.append(bar, setRow, customRow, grid, message);
    pages.appendChild(page);

    const more = document.createElementNS(XHTML_NS, "div");
    more.id = "icon-hub-more";

    let options = null;
    let picked = false;
    let resolvePick = null;
    let busy = false;
    let results = [];
    let shown = 0;
    let lastKey = null;
    let renderId = 0;
    let searchTimer = null;

    const source = () => (SOURCES.some((s) => s.id === pref(SOURCE_PREF, "")) ? pref(SOURCE_PREF, "") : "iconify");
    const set = () => SETS.find((s) => s.id === pref(SET_PREF, "")) || SETS[0];

    function say(text) {
      message.textContent = text;
      message.hidden = !text;
    }

    // the colour one-colour previews are drawn in: the panel's text colour
    const inkColor = () => getComputedStyle(grid).color || (isDark() ? "#fff" : "#000");

    const previewWatcher = new IntersectionObserver(
      (entries) => {
        const ink = inkColor();
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const item = entry.target;
          previewWatcher.unobserve(item);
          item.iconHub
            .preview(ink)
            .then((url) => {
              item.style.listStyleImage = `url("${url}")`;
            })
            .catch(() => item.setAttribute("broken", "true"));
        }
      },
      { root: grid, rootMargin: "100px" }
    );

    const moreWatcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          addMore();
        }
      },
      { root: grid, rootMargin: "200px" }
    );
    moreWatcher.observe(more);

    function addMore() {
      if (shown >= results.length) {
        return;
      }
      const fragment = document.createDocumentFragment();
      for (const icon of results.slice(shown, shown + BATCH)) {
        const item = document.createXULElement("toolbarbutton");
        item.className = "toolbarbutton-1 icon-hub-item";
        item.setAttribute("tooltiptext", icon.title);
        item.iconHub = icon;
        // keep Zen's picker from treating this click as one of its own
        item.addEventListener("command", (event) => {
          event.stopPropagation();
          choose(item);
        });
        previewWatcher.observe(item);
        fragment.appendChild(item);
      }
      shown = Math.min(results.length, shown + BATCH);
      grid.insertBefore(fragment, more);
    }

    function showResults(items, emptyText) {
      results = items;
      shown = 0;
      grid.replaceChildren(more);
      grid.scrollTop = 0;
      say(items.length ? "" : emptyText);
      addMore();
    }

    function clearResults(text) {
      results = [];
      shown = 0;
      grid.replaceChildren(more);
      say(text);
    }

    // which controls show for the source chosen
    function showControls(current) {
      for (const [id, button] of Object.entries(sourceButtons)) {
        button.toggleAttribute("selected", id === current);
      }
      for (const [id, button] of Object.entries(setButtons)) {
        button.toggleAttribute("selected", id === set().id);
      }
      setRow.hidden = current !== "iconify";
      customRow.hidden = current !== "custom";
      box.setAttribute(
        "placeholder",
        current === "iconify" ? "Search icons" : current === "svgl" ? "Search logos" : "Search your icons"
      );
    }

    async function load(current, query) {
      if (current === "iconify") {
        const { prefixes } = set();
        if (query) {
          const ids = await iconifySearch(query, prefixes);
          return [ids.map(iconifyItem), "No icons found"];
        }
        if (!prefixes.length) {
          return [[], "Search over 200,000 icons, or pick a set to browse it"];
        }
        // browsing: the set's own icons (the first set's for a group)
        return [(await iconifySet(prefixes[0])).map(iconifyItem), "This set is empty"];
      }
      if (current === "svgl") {
        const list = await loadSvgl();
        const found = query ? list.filter((logo) => logo.search.includes(query)) : list;
        return [found.map(svglItem), "No logos found"];
      }
      const files = await customFiles();
      const found = query ? files.filter((file) => file.toLowerCase().includes(query)) : files;
      return [
        found.map(customItem),
        files.length ? "No icons found" : "No icons yet. Put SVG or PNG files in the folder, then Reload.",
      ];
    }

    async function render(force = false) {
      const current = source();
      showControls(current);
      const query = (box.value || "").trim().toLowerCase();
      const key = `${current}:${set().id}:${isDark()}:${query}`;
      if (key === lastKey && !force) {
        return;
      }
      lastKey = key;
      const id = ++renderId;
      if (current !== "custom") {
        say("Loading…");
      }
      try {
        const [items, emptyText] = await load(current, query);
        if (id === renderId) {
          showResults(items, emptyText);
        }
      } catch (err) {
        if (id !== renderId) {
          return;
        }
        console.warn("[Icon Hub] couldn't load icons:", err);
        lastKey = null;
        clearResults(
          current === "custom"
            ? "Couldn't read your icons folder."
            : `Couldn't reach ${current === "svgl" ? "svgl.app" : "Iconify"}. Check your connection and try again.`
        );
      }
    }

    // searching Iconify waits for a pause in typing; the rest is instant
    function onInput() {
      clearTimeout(searchTimer);
      if (source() === "iconify") {
        searchTimer = setTimeout(render, SEARCH_DELAY);
      } else {
        render();
      }
    }

    async function choose(item) {
      if (busy) {
        return;
      }
      busy = true;
      item.setAttribute("busy", "true");
      try {
        const url = await item.iconHub.pick();
        picked = true;
        // as Zen does after its own picks: the bin button can remove it again
        panel.removeAttribute("hide-none-option");
        options?.onSelect?.(url);
        resolvePick?.(url);
        if (options?.closeOnSelect !== false) {
          panel.hidePopup();
        }
      } catch (err) {
        console.warn("[Icon Hub] couldn't save the icon:", err);
        say("Couldn't download that icon. Try again.");
      } finally {
        busy = false;
        item.removeAttribute("busy");
      }
    }

    // the search box looks like Zen's own
    function matchZenSearch() {
      const zenBox = document.getElementById("PanelUI-zen-emojis-picker-search");
      if (!zenBox) {
        return;
      }
      const from = getComputedStyle(zenBox);
      for (const prop of [
        "appearance", "padding", "border", "borderRadius", "backgroundColor",
        "backgroundImage", "color", "font", "fontSize", "fontFamily",
        "boxShadow", "outline", "lineHeight",
      ]) {
        const value = from[prop];
        if (value && value !== "auto") {
          box.style[prop] = value;
        }
      }
      const rect = zenBox.getBoundingClientRect();
      if (rect.height > 0) {
        box.style.boxSizing = "border-box";
        box.style.height = `${rect.height}px`;
      }
      // and its row sits where Zen's does
      const header = document.getElementById("PanelUI-zen-emojis-picker-header");
      if (header) {
        const row = getComputedStyle(header);
        for (const prop of ["padding", "gap"]) {
          if (row[prop]) {
            bar.style[prop] = row[prop];
          }
        }
      }
    }

    function show() {
      page.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      for (const other of tabs.children) {
        other.classList.toggle("selected", other === tab);
      }
      matchZenSearch();
      // your folder may have changed since the tab was last open
      render(source() === "custom");
      box.focus({ preventScroll: true });
    }

    tab.addEventListener("command", show);
    box.addEventListener("input", onInput);

    // another tab chosen (Zen's, Zia's): ours isn't selected any more
    tabs.addEventListener("command", (event) => {
      if (event.target !== tab) {
        tab.classList.remove("selected");
      }
    });

    panel.addEventListener("popupshown", (event) => {
      if (event.target === panel) {
        tab.classList.remove("selected");
      }
    });

    // Zen's picker resolves only for its own picks, so race it with ours
    // (the same way Zia adds its tab; works whichever loads first)
    const openPicker = picker.open;
    picker.open = function (anchor, settings = {}) {
      const pending = openPicker.call(this, anchor, settings);
      if (!pending) {
        return pending;
      }
      options = settings;
      picked = false;
      const ours = new Promise((resolve) => {
        resolvePick = resolve;
      });
      return Promise.race([
        pending.catch((err) => {
          if (picked) {
            return ours;
          }
          throw err;
        }),
        ours,
      ]);
    };
    console.info("[Icon Hub] tab added to the icon picker");
    return true;
  }

  function start() {
    try {
      if (addTab()) {
        return;
      }
    } catch (err) {
      console.error("[Icon Hub] couldn't add the tab:", err);
      return;
    }
    // the picker isn't built yet: try again the first time a panel opens
    const retry = () => {
      try {
        if (addTab()) {
          window.removeEventListener("popupshowing", retry, true);
        }
      } catch (err) {
        window.removeEventListener("popupshowing", retry, true);
        console.error("[Icon Hub] couldn't add the tab:", err);
      }
    };
    window.addEventListener("popupshowing", retry, true);
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const observer = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        start();
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }
})();
