import katex from 'katex';
import katexPluginModule from '@vscode/markdown-it-katex';

const katexPlugin = katexPluginModule?.default ?? katexPluginModule;

const RENDERED_MATH_PATTERN = /class="katex(?:-block|-error)?"/u;

export function enableMarkdownMath(markdown) {
  markdown.use(katexPlugin, { katex, strict: false, throwOnError: false, trust: false });
}

export function hasRenderedMath(html = '') {
  return RENDERED_MATH_PATTERN.test(String(html ?? ''));
}
