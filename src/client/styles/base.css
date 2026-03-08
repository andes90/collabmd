/* base.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  -moz-text-size-adjust: none;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  scroll-behavior: smooth;
  hanging-punctuation: first last;
  scroll-padding-top: var(--space-16);
}

body {
  min-height: 100dvh;
  line-height: 1.6;
  font-family: var(--font-body, sans-serif);
  font-size: var(--text-sm);
  color: var(--color-text);
  background-color: var(--color-bg);
}

img, picture, video, canvas, svg { display: block; max-width: 100%; height: auto; }
ul[role="list"], ol[role="list"] { list-style: none; }
input, button, textarea, select { font: inherit; color: inherit; }

h1, h2, h3, h4, h5, h6 { text-wrap: balance; line-height: 1.15; }
p, li, figcaption { text-wrap: pretty; max-width: 72ch; }

::selection {
  background: oklch(from var(--color-primary) l c h / 0.25);
  color: var(--color-text);
}

:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
  border-radius: var(--radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

button { cursor: pointer; background: none; border: none; }
table { border-collapse: collapse; width: 100%; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;
}
