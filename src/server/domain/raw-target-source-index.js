import { collectReferenceTargetKeysForFilePath } from './markdown-reference-extractor.js';

export class RawTargetSourceIndex {
  constructor() {
    this.keysBySource = new Map();
    this.sourcesByKey = new Map();
  }

  clear() {
    this.keysBySource.clear();
    this.sourcesByKey.clear();
  }

  set(sourcePath, rawTargetKeys = new Set()) {
    this.remove(sourcePath);
    if (!rawTargetKeys || rawTargetKeys.size === 0) {
      return;
    }

    const keys = new Set(rawTargetKeys);
    this.keysBySource.set(sourcePath, keys);
    for (const key of keys) {
      if (!key) continue;
      let sources = this.sourcesByKey.get(key);
      if (!sources) {
        sources = new Set();
        this.sourcesByKey.set(key, sources);
      }
      sources.add(sourcePath);
    }
  }

  remove(sourcePath) {
    const keys = this.keysBySource.get(sourcePath);
    if (!keys) return;
    for (const key of keys) {
      const sources = this.sourcesByKey.get(key);
      if (!sources) continue;
      sources.delete(sourcePath);
      if (sources.size === 0) {
        this.sourcesByKey.delete(key);
      }
    }
    this.keysBySource.delete(sourcePath);
  }

  rename(oldPath, newPath) {
    const keys = this.keysBySource.get(oldPath);
    if (!keys) return;
    this.keysBySource.delete(oldPath);
    this.keysBySource.set(newPath, keys);
    for (const key of keys) {
      const sources = this.sourcesByKey.get(key);
      if (!sources) continue;
      sources.delete(oldPath);
      sources.add(newPath);
    }
  }

  collectImpactedSources(pathValues = []) {
    const affectedTargetKeys = new Set();
    for (const pathValue of pathValues) {
      for (const targetKey of collectReferenceTargetKeysForFilePath(pathValue)) {
        affectedTargetKeys.add(targetKey);
      }
    }

    const impactedSources = new Set();
    for (const targetKey of affectedTargetKeys) {
      const sources = this.sourcesByKey.get(targetKey);
      if (!sources) continue;
      for (const sourcePath of sources) {
        impactedSources.add(sourcePath);
      }
    }
    return impactedSources;
  }
}
