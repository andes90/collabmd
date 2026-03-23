/**
 * @typedef {object} UiSidebarContext
 * @property {string} activeSidebarTab
 * @property {{ sidebar?: HTMLElement | null, filesSidebarTab?: HTMLElement | null, gitSidebarTab?: HTMLElement | null, fileSearch?: HTMLElement | null, gitSearch?: HTMLElement | null }} elements
 * @property {{ setSidebarVisible(showSidebar: boolean): void, getSidebarVisible(): string | null | undefined }} preferences
 * @property {{ setActive(active: boolean): void }} gitPanel
 * @property {boolean} gitRepoAvailable
 * @property {() => boolean} isMobileViewport
 * @property {() => void} toggleSidebar
 * @property {(showSidebar: boolean) => void} applySidebarVisibility
 * @property {(showSidebar: boolean) => void} setSidebarVisibility
 */

/** @this {UiSidebarContext} */
function isMobileViewport() {
  return this.mobileBreakpointQuery.matches;
}

/** @this {UiSidebarContext} */
function closeSidebarOnMobile() {
  const sidebar = this.elements.sidebar;
  if (!sidebar || !this.isMobileViewport()) return;
  if (sidebar.classList.contains('collapsed')) return;

  this.setSidebarVisibility(false);
}

/** @this {UiSidebarContext} */
function toggleSidebar() {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;
  const isHidden = sidebar.classList.contains('collapsed');
  this.setSidebarVisibility(isHidden);
}

/** @this {UiSidebarContext} */
function restoreSidebarState() {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;

  const isMobile = this.isMobileViewport();
  const stored = this.preferences.getSidebarVisible();
  let showSidebar = true;
  if (stored === 'true') {
    showSidebar = true;
  } else if (stored === 'false') {
    showSidebar = false;
  } else if (isMobile) {
    showSidebar = false;
  }

  this.applySidebarVisibility(showSidebar);
}

/** @this {UiSidebarContext} */
function setSidebarVisibility(showSidebar) {
  this.applySidebarVisibility(showSidebar);
  this.preferences.setSidebarVisible(showSidebar);
}

/** @this {UiSidebarContext} */
function applySidebarVisibility(showSidebar) {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;

  const isCollapsed = !showSidebar;
  const hideForMobile = isCollapsed && this.isMobileViewport();

  sidebar.classList.toggle('collapsed', isCollapsed);
  sidebar.toggleAttribute('hidden', hideForMobile);
  sidebar.setAttribute('aria-hidden', hideForMobile ? 'true' : 'false');
  sidebar.inert = isCollapsed;
}

/** @this {UiSidebarContext} */
function setSidebarTab(tab) {
  const nextTab = tab === 'git' && this.gitRepoAvailable ? 'git' : 'files';
  this.activeSidebarTab = nextTab;

  this.elements.filesSidebarTab?.classList.toggle('active', nextTab === 'files');
  this.elements.gitSidebarTab?.classList.toggle('active', nextTab === 'git');
  document.getElementById('fileTree')?.classList.toggle('hidden', nextTab !== 'files');
  this.elements.fileSearch?.classList.toggle('hidden', nextTab !== 'files');
  this.elements.gitSearch?.classList.toggle('hidden', nextTab !== 'git');
  document.getElementById('gitPanel')?.classList.toggle('active', nextTab === 'git');
  document.getElementById('gitPanel')?.classList.toggle('hidden', nextTab !== 'git');
  this.gitPanel.setActive(nextTab === 'git');
}

export const uiFeatureSidebarMethods = {
  applySidebarVisibility,
  closeSidebarOnMobile,
  isMobileViewport,
  restoreSidebarState,
  setSidebarTab,
  setSidebarVisibility,
  toggleSidebar,
};
