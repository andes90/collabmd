const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_KEYBOARD_STEP = 16;

function initializeSidebarResizer() {
  const sidebar = this.elements.sidebar;
  const resizer = this.elements.sidebarResizer;
  if (!sidebar || !resizer) return;

  let sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
  let pointerId = null;
  let startX = 0;
  let startWidth = SIDEBAR_DEFAULT_WIDTH;

  const clampWidth = (width) => Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width)));
  const applyWidth = (width) => {
    sidebarWidth = clampWidth(width);
    sidebar.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
    resizer.setAttribute('aria-valuenow', String(sidebarWidth));
  };
  const finishResize = (event) => {
    if (event?.pointerId != null && event.pointerId !== pointerId) return;
    if (pointerId === null) return;

    pointerId = null;
    sidebar.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  applyWidth(SIDEBAR_DEFAULT_WIDTH);

  resizer.addEventListener('pointerdown', (event) => {
    if (this.sidebarDrawerQuery.matches || sidebar.classList.contains('collapsed')) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = sidebar.getBoundingClientRect().width || sidebarWidth;
    sidebar.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    resizer.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  resizer.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    applyWidth(startWidth + event.clientX - startX);
  });

  resizer.addEventListener('pointerup', finishResize);
  resizer.addEventListener('pointercancel', finishResize);
  resizer.addEventListener('lostpointercapture', finishResize);

  resizer.addEventListener('keydown', (event) => {
    if (this.sidebarDrawerQuery.matches || sidebar.classList.contains('collapsed')) return;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      applyWidth(sidebarWidth + (event.key === 'ArrowRight' ? SIDEBAR_KEYBOARD_STEP : -SIDEBAR_KEYBOARD_STEP));
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      applyWidth(event.key === 'Home' ? SIDEBAR_MIN_WIDTH : SIDEBAR_MAX_WIDTH);
    }
  });
}

function closeSidebarOnMobile() {
  const sidebar = this.elements.sidebar;
  if (!sidebar || !this.sidebarDrawerQuery.matches) return;
  if (sidebar.classList.contains('collapsed')) return;

  this.setSidebarVisibility(false);
}

function toggleSidebar() {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;
  const isHidden = sidebar.classList.contains('collapsed');
  this.setSidebarVisibility(isHidden);
}

function restoreSidebarState() {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;

  this.applySidebarVisibility(!this.sidebarDrawerQuery.matches && this.preferences.getSidebarVisible() !== 'false');
}

function setSidebarVisibility(showSidebar) {
  if (!this.sidebarDrawerQuery.matches) {
    this.preferences.setSidebarVisible(showSidebar);
  }
  this.applySidebarVisibility(showSidebar);
}

function applySidebarVisibility(showSidebar) {
  const { sidebar, sidebarBackdrop, sidebarClose, sidebarToggle, mainContent, skipToEditor } = this.elements;
  if (!sidebar) return;

  const compact = this.sidebarDrawerQuery.matches;
  const drawerOpen = compact && showSidebar;
  const wasDrawer = sidebar.getAttribute('aria-modal') === 'true';
  const hadFocus = sidebar.contains(document.activeElement) || document.activeElement === sidebarBackdrop;

  sidebar.classList.toggle('collapsed', !showSidebar);
  sidebar.toggleAttribute('hidden', compact && !showSidebar);
  sidebar.inert = !showSidebar;
  sidebar.setAttribute('aria-hidden', String(!showSidebar));
  sidebarToggle?.setAttribute('aria-expanded', String(showSidebar));
  sidebar.setAttribute('role', drawerOpen ? 'dialog' : 'complementary');
  if (drawerOpen) sidebar.setAttribute('aria-modal', 'true');
  else sidebar.removeAttribute('aria-modal');

  sidebarBackdrop?.toggleAttribute('hidden', !drawerOpen);
  sidebarBackdrop?.setAttribute('aria-hidden', String(!drawerOpen));
  mainContent?.toggleAttribute('inert', drawerOpen);
  skipToEditor?.toggleAttribute('inert', drawerOpen);

  if (drawerOpen && !wasDrawer) {
    sidebarClose?.focus();
  } else if (!showSidebar && (wasDrawer || hadFocus)) {
    sidebarToggle?.focus();
  } else if (wasDrawer && document.activeElement === sidebarClose) {
    sidebarToggle?.focus();
  }
}

function handleSidebarDrawerKeydown(event) {
  const sidebar = this.elements.sidebar;
  if (!this.sidebarDrawerQuery.matches || event.defaultPrevented) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    this.closeSidebarOnMobile();
    return;
  }

  if (event.key !== 'Tab') return;
  const controls = Array.from(sidebar.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]'));
  const isTabStop = (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.checkVisibility();
  const first = controls.find(isTabStop);
  const last = controls.findLast(isTabStop);
  if (event.target === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}

function handleSidebarTabsKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

  const tabs = [
    this.elements.filesSidebarTab,
    this.elements.commentsSidebarTab,
    this.elements.gitSidebarTab,
  ].filter((tab) => tab && !tab.classList.contains('hidden'));
  const currentIndex = Math.max(0, tabs.indexOf(event.target));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[nextIndex]?.click();
  tabs[nextIndex]?.focus();
}

function setSidebarTab(tab) {
  const nextTab = tab === 'git' && this.gitRepoAvailable
    ? 'git'
    : tab === 'comments'
      ? 'comments'
      : 'files';
  this.activeSidebarTab = nextTab;

  [
    [this.elements.filesSidebarTab, 'files'],
    [this.elements.commentsSidebarTab, 'comments'],
    [this.elements.gitSidebarTab, 'git'],
  ].forEach(([button, buttonTab]) => {
    const selected = nextTab === buttonTab;
    button?.classList.toggle('active', selected);
    button?.setAttribute('aria-selected', String(selected));
    button?.setAttribute('tabindex', selected ? '0' : '-1');
  });
  const filePanel = document.getElementById('fileTree');
  const commentPanel = this.elements.commentOverviewPanel;
  const gitPanelElement = document.getElementById('gitPanel');
  [
    [filePanel, nextTab === 'files'],
    [commentPanel, nextTab === 'comments'],
    [gitPanelElement, nextTab === 'git'],
  ].forEach(([panel, selected]) => {
    panel?.classList.toggle('hidden', !selected);
    panel?.setAttribute('aria-hidden', String(!selected));
  });
  this.elements.fileSearch?.classList.toggle('hidden', nextTab !== 'files');
  this.elements.gitSearch?.classList.toggle('hidden', nextTab !== 'git');
  gitPanelElement?.classList.toggle('active', nextTab === 'git');
  this.gitPanel.setActive(nextTab === 'git');
  if (nextTab === 'comments') {
    this.refreshCommentOverviewForSidebarOpen?.();
  }
}

export const uiFeatureSidebarMethods = {
  applySidebarVisibility,
  closeSidebarOnMobile,
  handleSidebarDrawerKeydown,
  handleSidebarTabsKeydown,
  initializeSidebarResizer,
  restoreSidebarState,
  setSidebarTab,
  setSidebarVisibility,
  toggleSidebar,
};
