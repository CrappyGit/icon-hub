// SVGL Icons: an "SVGL" tab in Zen's icon picker with brand logos from
// svgl.app, for spaces and folders. Works next to Zia's own tab.
(() => {
  if (window.__svglPickerLoaded) {
    return;
  }
  window.__svglPickerLoaded = true;

  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const API = "https://api.svgl.app";
  // A picked logo is saved into the profile, so it keeps working offline
  // and if svgl.app changes. Sine serves chrome/sine-mods/ as
  // chrome://sine/content/, so the folder sits there, outside this mod's
  // own folder (which Sine replaces on every update).
  const SAVE_DIR = PathUtils.join(PathUtils.profileDir, "chrome", "sine-mods", "svgl-icons");
  const SAVE_URL = "chrome://sine/content/svgl-icons";
  const BATCH = 120;

  let catalog = null;
  const previews = new Map();

  const isDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

  // svgl.app's list: a logo is one file, or a light and a dark one
  function loadCatalog() {
    catalog ||= fetch(API)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`svgl.app answered ${response.status}`);
        }
        return response.json();
      })
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
        catalog = null; // try again next time the tab opens
        throw err;
      });
    return catalog;
  }

  // previews are fetched as text and shown as data: URLs, only once
  // they scroll into view
  function preview(url) {
    if (!previews.has(url)) {
      previews.set(
        url,
        fetch(url)
          .then((response) => response.text())
          .then((text) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`)
          .catch((err) => {
            previews.delete(url);
            throw err;
          })
      );
    }
    return previews.get(url);
  }

  async function saveLocally(url) {
    const file = decodeURIComponent(new URL(url).pathname.split("/").pop()).replace(/[^\w.-]/g, "_");
    const path = PathUtils.join(SAVE_DIR, file);
    if (!(await IOUtils.exists(path))) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`svgl.app answered ${response.status}`);
      }
      await IOUtils.makeDirectory(SAVE_DIR, { ignoreExisting: true });
      await IOUtils.writeUTF8(path, await response.text());
    }
    return `${SAVE_URL}/${file}`;
  }

  function addTab() {
    const picker = window.gZenEmojiPicker;
    const panel = document.getElementById("PanelUI-zen-emojis-picker");
    const pages = document.getElementById("PanelUI-zen-emojis-picker-pages");
    const tabs = document.getElementById("PanelUI-zen-emojis-buttons-wrapper");
    if (!picker || !panel || !pages || !tabs) {
      return false;
    }

    const tab = document.createXULElement("toolbarbutton");
    tab.id = "svgl-icons-tab";
    tab.setAttribute("label", "SVGL");
    tabs.appendChild(tab);

    const page = document.createXULElement("vbox");
    page.id = "svgl-icons-page";
    const bar = document.createElementNS(XHTML_NS, "div");
    bar.id = "svgl-icons-searchbar";
    const box = document.createElementNS(XHTML_NS, "input");
    box.id = "svgl-icons-search";
    box.setAttribute("type", "text");
    box.setAttribute("placeholder", "Search logos");
    bar.append(box);
    const grid = document.createElementNS(XHTML_NS, "div");
    grid.id = "svgl-icons-grid";
    const message = document.createElementNS(XHTML_NS, "div");
    message.id = "svgl-icons-message";
    message.hidden = true;
    page.append(bar, grid, message);
    pages.appendChild(page);

    const more = document.createElementNS(XHTML_NS, "div");
    more.id = "svgl-icons-more";

    let options = null;
    let picked = false;
    let resolvePick = null;
    let busy = false;
    let results = [];
    let shown = 0;
    let lastQuery = null;

    function say(text) {
      message.textContent = text;
      message.hidden = !text;
    }

    const previewWatcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const item = entry.target;
          previewWatcher.unobserve(item);
          preview(item.dataset.url)
            .then((data) => {
              item.style.listStyleImage = `url("${data}")`;
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
      const dark = isDark();
      const fragment = document.createDocumentFragment();
      for (const logo of results.slice(shown, shown + BATCH)) {
        const item = document.createXULElement("toolbarbutton");
        item.className = "toolbarbutton-1 svgl-icon-item";
        item.setAttribute("tooltiptext", logo.name);
        item.dataset.url = dark ? logo.dark : logo.light;
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

    async function render() {
      const query = (box.value || "").trim().toLowerCase();
      const key = `${isDark()}:${query}`;
      if (key === lastQuery) {
        return;
      }
      let list;
      try {
        say(catalog ? "" : "Loading logos…");
        list = await loadCatalog();
      } catch (err) {
        console.warn("[SVGL Icons] couldn't load svgl.app:", err);
        say("Couldn't reach svgl.app. Check your connection and open the tab again.");
        grid.replaceChildren();
        lastQuery = null;
        return;
      }
      lastQuery = key;
      results = query ? list.filter((logo) => logo.search.includes(query)) : list;
      shown = 0;
      grid.replaceChildren(more);
      grid.scrollTop = 0;
      say(results.length ? "" : "No logos found");
      addMore();
    }

    async function choose(item) {
      if (busy) {
        return;
      }
      busy = true;
      item.setAttribute("busy", "true");
      try {
        const url = await saveLocally(item.dataset.url);
        picked = true;
        // as Zen does after its own picks: the bin button can remove it again
        panel.removeAttribute("hide-none-option");
        options?.onSelect?.(url);
        resolvePick?.(url);
        if (options?.closeOnSelect !== false) {
          panel.hidePopup();
        }
      } catch (err) {
        console.warn("[SVGL Icons] couldn't save the logo:", err);
        say("Couldn't download that logo. Try again.");
      } finally {
        busy = false;
        item.removeAttribute("busy");
      }
    }

    function show() {
      page.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      for (const other of tabs.children) {
        other.classList.toggle("selected", other === tab);
      }
      render();
      box.focus({ preventScroll: true });
    }

    tab.addEventListener("command", show);
    box.addEventListener("input", render);

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
    return true;
  }

  function start() {
    if (addTab()) {
      return;
    }
    // the picker isn't built yet: try again the first time a panel opens
    const retry = () => {
      if (addTab()) {
        window.removeEventListener("popupshowing", retry, true);
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
