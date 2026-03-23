import {
  isDrawioFilePath,
  isExcalidrawFilePath,
  isMarkdownFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';

export class VaultContentAdapter {
  constructor({
    invalidPathError,
    kind,
    matches,
  }) {
    this.invalidPathError = invalidPathError;
    this.kind = kind;
    this.matches = matches;
  }

  supports(filePath) {
    return this.matches(filePath);
  }
}

const adapters = [
  new VaultContentAdapter({
    invalidPathError: 'Invalid file path',
    kind: 'markdown',
    matches: isMarkdownFilePath,
  }),
  new VaultContentAdapter({
    invalidPathError: 'Invalid file path — must end in .excalidraw',
    kind: 'excalidraw',
    matches: isExcalidrawFilePath,
  }),
  new VaultContentAdapter({
    invalidPathError: 'Invalid file path — must end in .drawio',
    kind: 'drawio',
    matches: isDrawioFilePath,
  }),
  new VaultContentAdapter({
    invalidPathError: 'Invalid file path — must end in .mmd or .mermaid',
    kind: 'mermaid',
    matches: isMermaidFilePath,
  }),
  new VaultContentAdapter({
    invalidPathError: 'Invalid file path — must end in .puml or .plantuml',
    kind: 'plantuml',
    matches: isPlantUmlFilePath,
  }),
];

export function getVaultContentAdapter(filePath) {
  return adapters.find((adapter) => adapter.supports(filePath)) ?? null;
}
