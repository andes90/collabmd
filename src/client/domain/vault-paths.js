import {
  isBaseFilePath,
  isDrawioFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
  isStructurizrFilePath,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';

const STARTER_DEFINITIONS = {
  base: {
    content: 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n',
    extension: '.base',
    matches: isBaseFilePath,
  },
  drawio: {
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
    extension: '.drawio',
    matches: isDrawioFilePath,
  },
  mermaid: {
    content: 'flowchart TD\n  A[Start] --> B{Decide}\n  B -->|Yes| C[Ship it]\n  B -->|No| D[Revise]\n',
    extension: '.mmd',
    matches: isMermaidFilePath,
  },
  plantuml: {
    content: '@startuml\nAlice -> Bob: Hello\n@enduml\n',
    extension: '.puml',
    matches: isPlantUmlFilePath,
  },
  structurizr: {
    content: [
      'workspace "CollabMD Example" "A small Structurizr workspace" {',
      '  model {',
      '    user = person "User" "Uses the system"',
      '    system = softwareSystem "Example System" "The system being documented" {',
      '      web = container "Web Application" "Serves the user interface" "JavaScript" {',
      '        home = component "Home Page" "Shows the landing page" "React"',
      '        editor = component "Editor" "Edits workspace content" "React"',
      '      }',
      '      api = container "API" "Handles requests" "Node.js"',
      '    }',
      '    user -> system "Uses"',
      '    web -> api "Calls" "HTTPS/JSON"',
      '    home -> editor "Links to"',
      '  }',
      '  views {',
      '    systemContext system "Context" {',
      '      include *',
      '      autoLayout',
      '    }',
      '    container system "Containers" {',
      '      include *',
      '      autoLayout',
      '    }',
      '    component web "Components" {',
      '      include *',
      '      autoLayout',
      '    }',
      '    styles {',
      '      element "Person" {',
      '        shape person',
      '      }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
    extension: '.dsl',
    matches: isStructurizrFilePath,
  },
};

export function normalizeVaultPathInput(value) {
  const normalized = String(value ?? '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/')) {
    return '';
  }

  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return '';
  }

  return segments.join('/');
}

export function composeVaultChildPath(parentDir, childPath) {
  const normalizedParent = normalizeVaultPathInput(parentDir);
  const normalizedChild = normalizeVaultPathInput(childPath);
  return [normalizedParent, normalizedChild].filter(Boolean).join('/');
}

export function getVaultPathLeaf(pathValue = '') {
  return String(pathValue ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

export function getVaultPathParent(pathValue = '') {
  const normalized = String(pathValue ?? '').replace(/\/+$/u, '');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : '';
}

export function ensureVaultExtension(pathValue, extension) {
  return pathValue.toLowerCase().endsWith(extension.toLowerCase())
    ? pathValue
    : `${pathValue}${extension}`;
}

export function createMarkdownStarter(filePath) {
  const title = stripVaultFileExtension(String(filePath ?? '').split('/').pop() || '') || 'Untitled';
  return `# ${title}\n\n`;
}

function createStarter(kind, filePath) {
  const { content, extension, matches } = STARTER_DEFINITIONS[kind];
  const normalizedPath = normalizeVaultPathInput(filePath);
  return {
    content,
    path: matches(normalizedPath) ? normalizedPath : `${normalizedPath}${extension}`,
  };
}

export const createBaseStarter = (filePath) => createStarter('base', filePath);
export const createMermaidStarter = (filePath) => createStarter('mermaid', filePath);
export const createDrawioStarter = (filePath) => createStarter('drawio', filePath);
export const createPlantUmlStarter = (filePath) => createStarter('plantuml', filePath);
export const createStructurizrStarter = (filePath) => createStarter('structurizr', filePath);
