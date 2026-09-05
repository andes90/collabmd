/* CollabMD landing interactions */
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Navigation ---------- */
  const nav = document.querySelector('.nav');
  const menuToggle = document.querySelector('.nav-menu-toggle');
  const navLinks = Array.from(document.querySelectorAll('.nav-links a'));
  const navSections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const setMenuOpen = (open) => {
    nav.classList.toggle('is-menu-open', open);
    menuToggle?.setAttribute('aria-expanded', String(open));
    menuToggle?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  const setActiveNav = (activeId = '') => {
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${activeId}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  if ('IntersectionObserver' in window) {
    const visibleSections = new Set();
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visibleSections.add(entry.target);
        else visibleSections.delete(entry.target);
      });
      const activeSection = Array.from(visibleSections).sort((a, b) => a.offsetTop - b.offsetTop)[0];
      setActiveNav(activeSection?.id);
    }, { rootMargin: '-20% 0px -70% 0px' });
    navSections.forEach((section) => navObserver.observe(section));
  }
  menuToggle?.addEventListener('click', () => setMenuOpen(!nav.classList.contains('is-menu-open')));
  navLinks.forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('is-menu-open')) {
      setMenuOpen(false);
      menuToggle?.focus();
    }
  });

  /* ---------- Scroll reveals ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    document.documentElement.classList.add('reveal-ready');
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- Copy buttons ---------- */
  const copyButtons = document.querySelectorAll('.copy-btn');
  const flashLabel = (btn, text) => {
    const label = btn.querySelector('.copy-label');
    if (!label) return;
    const original = label.dataset.original || label.textContent;
    label.dataset.original = original;
    label.textContent = text;
    btn.classList.add('is-copied');
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      label.textContent = original;
      btn.classList.remove('is-copied');
    }, 1600);
  };

  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(text);
        flashLabel(btn, 'Copied');
      } catch {
        // Fallback for non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.className = 'clipboard-fallback';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        try {
          const copied = document.execCommand('copy');
          flashLabel(btn, copied ? 'Copied' : 'Copy failed');
        } catch {
          flashLabel(btn, 'Copy failed');
        }
        ta.remove();
      }
    });
  });
  document.documentElement.classList.add('copy-ready');

  /* ---------- Install tabs ---------- */
  const tabs = Array.from(document.querySelectorAll('.install-tab'));
  const panels = Array.from(document.querySelectorAll('.install-panel'));

  const activateTab = (tab, focus = true) => {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    });
    panels.forEach((p) => {
      const active = p.id === tab.getAttribute('aria-controls');
      p.classList.toggle('is-active', active);
      p.hidden = !active;
    });
    if (focus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        activateTab(next);
      }
    });
  });
  if (tabs.length && panels.length) {
    activateTab(tabs[0], false);
    document.documentElement.classList.add('tabs-ready');
  }

})();
