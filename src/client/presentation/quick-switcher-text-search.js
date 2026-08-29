export const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const TEXT_RESULT_LIMIT = 50;

export function formatMatchCount(count = 0, { truncated = false } = {}) {
  const normalized = Number(count) || 0;
  return `${normalized}${truncated ? '+' : ''} ${normalized === 1 ? 'match' : 'matches'}`;
}

export function flattenTextResults(payload = {}) {
  return (payload.files ?? []).flatMap((fileGroup) => (
    (fileGroup.snippets ?? []).map((snippet) => ({
      column: snippet.column,
      file: fileGroup.file,
      kind: fileGroup.kind,
      line: snippet.line,
      matchLength: Math.max((snippet.matchEnd ?? 0) - (snippet.matchStart ?? 0), 0),
      snippet,
    }))
  ));
}

export class QuickSwitcherTextSearchRunner {
  constructor({
    debounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
    resultLimit = TEXT_RESULT_LIMIT,
  } = {}) {
    this.debounceMs = debounceMs;
    this.resultLimit = resultLimit;
    this.controller = null;
    this.timer = null;
    this.token = 0;
  }

  abort({ invalidate = true } = {}) {
    clearTimeout(this.timer);
    this.timer = null;
    if (invalidate) {
      this.token += 1;
    }
    this.controller?.abort();
    this.controller = null;
  }

  schedule({
    isActive = () => true,
    onResults,
    onState,
    query = '',
    searchConfig = {},
    searchText = null,
  } = {}) {
    const minQueryLength = Math.max(Number(searchConfig.minQueryLength) || 2, 1);

    this.abort();

    if (!searchConfig.available) {
      onState?.('Global text search requires ripgrep on the server.');
      return;
    }

    if (!searchText) {
      onState?.('Global text search is unavailable.');
      return;
    }

    if (query.length < minQueryLength) {
      onState?.(`Type at least ${minQueryLength} characters to search file text.`);
      return;
    }

    onState?.('Searching...');
    this.timer = setTimeout(() => {
      void this.run({
        isActive,
        onResults,
        onState,
        query,
        searchText,
      });
    }, this.debounceMs);
  }

  async run({
    isActive = () => true,
    onResults,
    onState,
    query = '',
    searchText,
  } = {}) {
    const token = this.token + 1;
    this.token = token;
    const controller = new AbortController();
    this.controller = controller;
    const isCurrent = () => (
      isActive()
      && token === this.token
      && this.controller === controller
    );

    try {
      const result = await searchText({
        limit: this.resultLimit,
        query,
        signal: controller.signal,
      });
      if (isCurrent()) {
        onResults?.(result, query);
      }
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrent()) {
        return;
      }

      onState?.(error?.body?.error || error?.message || 'Failed to search file text.');
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
    }
  }
}
