function computeTextReplacement(currentContent, nextContent) {
  const currentText = String(currentContent ?? '');
  const nextText = String(nextContent ?? '');
  if (currentText === nextText) {
    return null;
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(currentText.length, nextText.length);
  while (prefixLength < maxPrefix && currentText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1;
  }

  let currentSuffixLength = currentText.length;
  let nextSuffixLength = nextText.length;
  while (
    currentSuffixLength > prefixLength
    && nextSuffixLength > prefixLength
    && currentText[currentSuffixLength - 1] === nextText[nextSuffixLength - 1]
  ) {
    currentSuffixLength -= 1;
    nextSuffixLength -= 1;
  }

  return {
    deleteCount: currentSuffixLength - prefixLength,
    insertText: nextText.slice(prefixLength, nextSuffixLength),
    start: prefixLength,
  };
}

const TEXT_CONFLICT_META = 'text-conflict';
const LOCAL_MARKER = '<<<<<<< CollabMD editor';
const EXTERNAL_MARKER = '>>>>>>> File on disk';

function markTextConflict(local, external) {
  return [LOCAL_MARKER, local, '=======', external, EXTERNAL_MARKER].join('\n');
}

function reconcileTextContent(baselineContent, currentContent, externalContent) {
  if (currentContent === externalContent) return { content: externalContent, preservesPendingChanges: false };
  const localReplacement = computeTextReplacement(baselineContent, currentContent);
  const externalReplacement = computeTextReplacement(baselineContent, externalContent);
  if (!externalReplacement) {
    return { content: currentContent, preservesPendingChanges: true };
  }

  const localEnd = localReplacement.start + localReplacement.deleteCount;
  const externalEnd = externalReplacement.start + externalReplacement.deleteCount;
  let externalStart;
  if (localEnd <= externalReplacement.start) {
    externalStart = externalReplacement.start
      + localReplacement.insertText.length
      - localReplacement.deleteCount;
  } else if (externalEnd <= localReplacement.start) {
    externalStart = externalReplacement.start;
  } else {
    return { content: markTextConflict(currentContent, externalContent), conflict: true, preservesPendingChanges: true };
  }

  return {
    content: currentContent.slice(0, externalStart)
      + externalReplacement.insertText
      + currentContent.slice(externalStart + externalReplacement.deleteCount),
    preservesPendingChanges: true,
  };
}

export function getTextConflictBaseline(doc) {
  return doc.getMap(TEXT_CONFLICT_META).get('disk');
}

export function hasUnresolvedTextConflict(doc, content) {
  const conflict = doc.getMap(TEXT_CONFLICT_META);
  if (!conflict.has('disk')) return false;
  if (content.split('\n').some((line) => line === LOCAL_MARKER || line === EXTERNAL_MARKER)) return true;
  doc.transact(() => conflict.delete('disk'), 'workspace-reconcile');
  return false;
}

// A conflict stays in the collaborative snapshot. The Vault file keeps its
// external bytes until the editor removes the conflict markers.
export function reconcileRoomText(doc, diskText, baseline, origin) {
  const ytext = doc.getText('codemirror');
  const current = ytext.toString();
  const reconciliation = typeof baseline === 'string' && current !== baseline
    ? reconcileTextContent(baseline, current, diskText)
    : { content: diskText, preservesPendingChanges: false };
  const replacement = computeTextReplacement(current, reconciliation.content);
  const conflict = doc.getMap(TEXT_CONFLICT_META);
  doc.transact(() => {
    if ((reconciliation.conflict || conflict.has('disk')) && conflict.get('disk') !== diskText) {
      conflict.set('disk', diskText);
    }
    if (replacement?.deleteCount) ytext.delete(replacement.start, replacement.deleteCount);
    if (replacement?.insertText) ytext.insert(replacement.start, replacement.insertText);
  }, origin);
  return { replacement, preservesPendingChanges: reconciliation.preservesPendingChanges };
}
