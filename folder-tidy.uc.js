// Collapsed folders: Zen keeps showing the tab last used in a collapsed
// folder until its "−" is pressed. Once a tab outside the folder is
// selected, this does what that "−" does (the tab stays open, it just
// goes back into the folder), the same way Zia does it for pinned tabs.
(() => {
  if (window.__folderTidyLoaded) {
    return;
  }
  window.__folderTidyLoaded = true;

  const SHOWN = 'zen-folder[collapsed][has-active] .tabbrowser-tab[folder-active="true"]';

  // the folder a tab sits in (a split view's folder for a tab in a split view)
  const folderOf = (tab) =>
    tab.group?.hasAttribute("split-view-group") ? tab.group.group : tab.group;

  // the outermost collapsed folder showing this tab
  function outermostShowing(tab) {
    let outer = null;
    for (let el = tab.closest("zen-folder"); el; el = el.parentElement?.closest("zen-folder")) {
      if (el.hasAttribute("collapsed") && el.hasAttribute("has-active")) {
        outer = el;
      }
    }
    return outer;
  }

  async function onSelect(event) {
    const zen = window.gZenFolders;
    const selected = window.gZenGlanceManager?.getTabOrGlanceParent?.(event.target) ?? event.target;
    if (!zen?.animateUnload || !selected) {
      return;
    }
    const space = window.gZenWorkspaces?.activeWorkspaceElement ?? document;
    const shown = [...space.querySelectorAll(SHOWN)].filter((tab) => {
      if (tab === selected || tab.selected) {
        return false;
      }
      // still in use: the newly selected tab is in the same collapsed folder
      const outer = outermostShowing(tab);
      return outer && !outer.contains(selected);
    });
    if (!shown.length) {
      return;
    }
    try {
      await Promise.all(shown.map((tab) => zen.animateUnload(folderOf(tab), tab)));
    } catch (err) {
      console.warn("[Folder tidy] couldn't hide the tab:", err);
    }
  }

  function start() {
    gBrowser.tabContainer.addEventListener("TabSelect", onSelect);
    console.info("[Folder tidy] loaded");
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
