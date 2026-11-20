const STRING_ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function tokenizeExpression(source = '') {
  const tokens = [];
  const text = String(source ?? '');
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    const start = index;
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    const twoChar = text.slice(index, index + 2);
    const threeChar = text.slice(index, index + 3);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(twoChar)) {
      tokens.push({ end: index + 2, start, type: 'operator', value: twoChar });
      index += 2;
      continue;
    }
    if (threeChar === '...') {
      tokens.push({ end: index + 3, start, type: 'operator', value: threeChar });
      index += 3;
      continue;
    }
    if ('+-*/%!<>()[]{}.,:'.includes(character)) {
      tokens.push({
        end: index + 1,
        start,
        type: '()[]{}.,:'.includes(character) ? 'punctuation' : 'operator',
        value: character,
      });
      index += 1;
      continue;
    }
    if (character === '"' || character === '\'') {
      let value = '';
      let cursor = index + 1;
      while (cursor < text.length) {
        const nextCharacter = text[cursor];
        if (nextCharacter === '\\') {
          const escaped = text[cursor + 1] ?? '';
          const hex = text.slice(cursor + 2, cursor + 6);
          if (escaped === 'u' && /^[0-9a-f]{4}$/iu.test(hex)) {
            value += String.fromCharCode(Number.parseInt(hex, 16));
            cursor += 6;
            continue;
          }
          value += STRING_ESCAPES[escaped] ?? escaped;
          cursor += 2;
          continue;
        }
        if (nextCharacter === character) {
          break;
        }
        value += nextCharacter;
        cursor += 1;
      }
      if (text[cursor] !== character) {
        throw new Error(`Unterminated string in expression: ${source}`);
      }
      tokens.push({ end: cursor + 1, start, type: 'string', value });
      index = cursor + 1;
      continue;
    }
    if (/\d/u.test(character)) {
      const [value] = text.slice(index).match(/^\d+(?:\.\d*)?(?:e[+-]?\d+)?/iu);
      tokens.push({ end: index + value.length, start, type: 'number', value });
      index += value.length;
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      let cursor = index + 1;
      while (cursor < text.length && /[A-Za-z0-9_$]/u.test(text[cursor])) {
        cursor += 1;
      }
      tokens.push({ end: cursor, start, type: 'identifier', value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }

    throw new Error(`Unexpected token "${character}" in expression: ${source}`);
  }

  return tokens;
}

const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export function parseBaseExpression(source = '') {
  const tokens = tokenizeExpression(source);
  let index = 0;

  const peek = () => tokens[index] ?? null;
  const matches = (value) => peek()?.type === 'punctuation' && peek().value === value;
  const consume = (expectedValue = null) => {
    const token = tokens[index] ?? null;
    if (!token) {
      throw new Error(`Unexpected end of expression: ${source}`);
    }
    if (expectedValue !== null && !matches(expectedValue)) {
      throw new Error(`Expected "${expectedValue}" in expression: ${source}`);
    }
    index += 1;
    return token;
  };

  const parsePrimary = () => {
    const token = peek();
    if (!token) {
      throw new Error(`Unexpected end of expression: ${source}`);
    }

    if (token.type === 'number') {
      consume();
      return { type: 'Literal', value: Number(token.value) };
    }

    if (token.type === 'string') {
      consume();
      return { type: 'Literal', value: token.value };
    }

    if (token.type === 'identifier') {
      consume();
      if (token.value === 'true') return { type: 'Literal', value: true };
      if (token.value === 'false') return { type: 'Literal', value: false };
      if (token.value === 'null') return { type: 'Literal', value: null };
      return { name: token.value, type: 'Identifier' };
    }

    if (token.value === '(') {
      consume('(');
      const expression = parseBinaryExpression(0);
      consume(')');
      return expression;
    }

    if (token.value === '[') {
      consume('[');
      const elements = [];
      while (peek() && !matches(']')) {
        elements.push(parseBinaryExpression(0));
        if (matches(',')) {
          consume(',');
        }
      }
      consume(']');
      return { elements, type: 'ArrayExpression' };
    }

    if (token.value === '{') {
      consume('{');
      const properties = [];
      while (peek() && !matches('}')) {
        const keyToken = consume();
        const key = keyToken.type === 'identifier' ? keyToken.value : String(keyToken.value ?? '');
        consume(':');
        properties.push({ key, value: parseBinaryExpression(0) });
        if (matches(',')) {
          consume(',');
        }
      }
      consume('}');
      return { properties, type: 'ObjectExpression' };
    }

    throw new Error(`Unexpected token "${token.value}" in expression: ${source}`);
  };

  const parsePostfix = (baseNode) => {
    let node = baseNode;
    while (peek()) {
      if (matches('.')) {
        consume('.');
        const property = consume();
        if (property.type !== 'identifier') {
          throw new Error(`Expected property name in expression: ${source}`);
        }
        node = {
          computed: false,
          object: node,
          property: { name: property.value, type: 'Identifier' },
          type: 'MemberExpression',
        };
        continue;
      }

      if (matches('[')) {
        consume('[');
        const property = parseBinaryExpression(0);
        consume(']');
        node = {
          computed: true,
          object: node,
          property,
          type: 'MemberExpression',
        };
        continue;
      }

      if (matches('(')) {
        consume('(');
        const args = [];
        while (peek() && !matches(')')) {
          args.push(parseBinaryExpression(0));
          if (matches(',')) {
            consume(',');
          }
        }
        consume(')');
        node = {
          arguments: args,
          callee: node,
          type: 'CallExpression',
        };
        continue;
      }

      break;
    }
    return node;
  };

  const parseUnary = () => {
    const token = peek();
    let node;
    if (token?.type === 'operator' && ['!', '-'].includes(token.value)) {
      consume();
      node = { argument: parseUnary(), operator: token.value, type: 'UnaryExpression' };
    } else {
      node = parsePostfix(parsePrimary());
    }
    return { ...node, end: tokens[index - 1].end, start: token.start };
  };

  const parseBinaryExpression = (minimumPrecedence) => {
    let left = parseUnary();
    while (true) {
      const operator = peek();
      const precedence = operator?.type === 'operator' ? BINARY_PRECEDENCE[operator.value] : null;
      if (!precedence || precedence < minimumPrecedence) {
        break;
      }

      consume();
      const right = parseBinaryExpression(precedence + 1);
      left = {
        end: right.end,
        left,
        operator: operator.value,
        right,
        start: left.start,
        type: 'BinaryExpression',
      };
    }
    return left;
  };

  const ast = parseBinaryExpression(0);
  if (index < tokens.length) {
    throw new Error(`Unexpected token "${tokens[index].value}" in expression: ${source}`);
  }
  return ast;
}

export function tryParseBaseExpression(source) {
  try {
    return parseBaseExpression(source);
  } catch {
    return null;
  }
}

function getPropertyId(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' && !node.computed) {
    const parent = getPropertyId(node.object);
    return parent ? `${parent}.${node.property.name}` : '';
  }
  return '';
}

function getLiteral(node) {
  if (node?.type === 'Literal' && (typeof node.value !== 'number' || Number.isFinite(node.value))) {
    return node.value;
  }
  if (node?.type === 'UnaryExpression' && node.operator === '-' && Number.isFinite(node.argument?.value)) {
    return -node.argument.value;
  }
  return undefined;
}

export function getBaseFilterPredicate(ast) {
  const negated = ast?.type === 'UnaryExpression' && ast.operator === '!';
  const node = negated ? ast.argument : ast;
  if (!negated && node?.type === 'BinaryExpression' && ['==', '!=', '>=', '<=', '>', '<'].includes(node.operator)) {
    const propertyId = getPropertyId(node.left);
    const value = getLiteral(node.right);
    return propertyId && value !== undefined ? { negated, operator: node.operator, propertyId, value } : null;
  }
  if (node?.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || node.callee.computed) {
    return null;
  }

  const operator = node.callee.property.name;
  const propertyId = getPropertyId(node.callee.object);
  const argCount = operator === 'isEmpty' ? 0 : 1;
  if (!propertyId || !['contains', 'startsWith', 'endsWith', 'isEmpty'].includes(operator) || node.arguments.length !== argCount) {
    return null;
  }
  const value = argCount === 0 ? '' : getLiteral(node.arguments[0]);
  return value !== undefined ? { negated, operator, propertyId, value } : null;
}

function normalizeFilterPropertyId(propertyId) {
  return propertyId.includes('.') ? propertyId : `note.${propertyId}`;
}

export function pruneBaseFilterExpression(source, propertyId) {
  const ast = tryParseBaseExpression(source);
  if (!ast) return source;
  const normalizedPropertyId = normalizeFilterPropertyId(propertyId);

  function prune(node) {
    const predicate = getBaseFilterPredicate(node);
    if (predicate && normalizeFilterPropertyId(predicate.propertyId) === normalizedPropertyId) {
      return null;
    }
    if (node.type === 'BinaryExpression' && ['&&', '||'].includes(node.operator)) {
      const left = prune(node.left);
      const right = prune(node.right);
      if (left === null || right === null) return left ?? right;
      if (left !== source.slice(node.left.start, node.left.end) || right !== source.slice(node.right.start, node.right.end)) {
        return `(${left}) ${node.operator} (${right})`;
      }
    } else if (node.type === 'UnaryExpression' && node.operator === '!') {
      const argument = prune(node.argument);
      if (argument === null) return null;
      if (argument !== source.slice(node.argument.start, node.argument.end)) return `!(${argument})`;
    }
    return source.slice(node.start, node.end);
  }

  return prune(ast);
}
