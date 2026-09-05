/**
 * Shared utilities for vault file operations and HTML escaping.
 */

/**
 * Escapes HTML special characters to prevent XSS when inserting user-supplied
 * text into the DOM via innerHTML.
 *
 * @param {string} text — raw text to escape
 * @returns {string} HTML-safe string
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds a document fragment from an HTML string for a single
 * replaceChildren() call. Escape untrusted parts before calling.
 *
 * @param {string} markup — trusted HTML markup
 * @returns {DocumentFragment} parsed fragment
 */
export function createFragment(markup) {
  return document.createRange().createContextualFragment(markup);
}

/**
 * Clamps a numeric value between a minimum and maximum bound.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
