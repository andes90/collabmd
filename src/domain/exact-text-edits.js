function createEditError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateExactTextReplacements(replacements, {
  maxCharacters = Infinity,
  maxReplacements = Infinity,
} = {}) {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw createEditError('EXACT_EDIT_REQUIRED', 'At least one text replacement is required');
  }
  if (replacements.length > maxReplacements) {
    throw createEditError('EXACT_EDIT_LIMIT', `At most ${maxReplacements} text replacements are allowed`);
  }

  let characterCount = 0;
  for (const replacement of replacements) {
    if (
      !replacement
      || typeof replacement.oldText !== 'string'
      || replacement.oldText.length === 0
      || typeof replacement.newText !== 'string'
    ) {
      throw createEditError('EXACT_EDIT_INVALID', 'Each replacement requires non-empty oldText and string newText');
    }
    if (replacement.oldText === replacement.newText) {
      throw createEditError('EXACT_EDIT_UNCHANGED', 'A replacement must change the document');
    }
    characterCount += replacement.oldText.length + replacement.newText.length;
  }

  if (characterCount > maxCharacters) {
    throw createEditError('EXACT_EDIT_LIMIT', `Text replacements may contain at most ${maxCharacters} characters`);
  }
  return replacements;
}

export function resolveExactTextChanges(content, replacements, limits = {}) {
  const text = String(content ?? '');
  const validated = validateExactTextReplacements(replacements, limits);
  const changes = validated.map(({ newText, oldText }) => {
    const from = text.indexOf(oldText);
    if (from < 0) {
      throw createEditError('EXACT_EDIT_MISMATCH', 'A requested text replacement no longer matches the document');
    }
    if (text.includes(oldText, from + 1)) {
      throw createEditError('EXACT_EDIT_NOT_UNIQUE', 'A requested text replacement is not unique in the document');
    }
    return { from, insert: newText, to: from + oldText.length };
  }).sort((left, right) => left.from - right.from);

  for (let index = 1; index < changes.length; index += 1) {
    if (changes[index].from < changes[index - 1].to) {
      throw createEditError('EXACT_EDIT_OVERLAP', 'Requested text replacements overlap');
    }
  }
  return changes;
}

export function applyExactTextChanges(content, changes) {
  let result = String(content ?? '');
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}
