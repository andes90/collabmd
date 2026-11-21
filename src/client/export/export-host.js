import { createRandomUuid } from '../../domain/random-uuid.js';
import { resolveAppUrl } from '../infrastructure/runtime-config.js';

const EXPORT_PAGE_SOURCE = 'collabmd-export-page';
const EXPORT_HOST_SOURCE = 'collabmd-export-host';
const EXPORT_JOB_TIMEOUT_MS = 300_000;
const pendingJobs = new Map();
let exportBridgeErrorHandler = null;
let exportBridgeInitialized = false;

function createJobId() {
  return `export-${createRandomUuid()}`;
}

function normalizeFormat(format) {
  return ['html', 'pdf'].includes(format) ? format : 'docx';
}

function createBootstrapPayload({
  currentFilePath = '',
  currentMarkdownText = '',
  directoryPath = '',
  fileList = [],
  filePath,
  format,
  jobId,
  markdownText = '',
  title = '',
}) {
  return {
    action: normalizeFormat(format),
    currentFilePath: String(currentFilePath ?? ''),
    currentMarkdownText: String(currentMarkdownText ?? ''),
    directoryPath: String(directoryPath ?? ''),
    fileList: Array.isArray(fileList) ? fileList.slice() : [],
    filePath: String(filePath ?? ''),
    jobId,
    markdownText: String(markdownText ?? ''),
    source: EXPORT_HOST_SOURCE,
    // Exports always render light so HTML, DOCX, and PDF output stays consistent.
    theme: 'light',
    title: String(title ?? ''),
    type: 'bootstrap',
  };
}

function finishPendingJob(jobId, {
  notifyError = false,
  message = '',
} = {}) {
  const pendingJob = pendingJobs.get(jobId);
  if (!pendingJob) {
    return;
  }

  window.clearTimeout(pendingJob.timeoutId);
  pendingJobs.delete(jobId);

  if (notifyError && message) {
    exportBridgeErrorHandler?.(message);
  }
}

export function initializeExportBridge({
  onError = null,
} = {}) {
  exportBridgeErrorHandler = typeof onError === 'function' ? onError : null;

  if (exportBridgeInitialized) {
    return;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.source !== EXPORT_PAGE_SOURCE) {
      return;
    }

    const jobId = String(payload.jobId ?? '').trim();
    if (!jobId) {
      return;
    }

    const pendingJob = pendingJobs.get(jobId);
    if (!pendingJob || event.source !== pendingJob.window) {
      return;
    }

    if (payload.type === 'closed') {
      finishPendingJob(jobId, {
        message: 'Export window was closed before the export completed',
        notifyError: true,
      });
      return;
    }

    if (payload.type === 'ready') {
      try {
        pendingJob.window?.postMessage(pendingJob.payload, window.location.origin);
      } catch (error) {
        finishPendingJob(jobId, {
          message: error instanceof Error ? error.message : 'Failed to send export data',
          notifyError: true,
        });
      }
      return;
    }

    if (payload.type === 'complete' || payload.type === 'error') {
      finishPendingJob(jobId, {
        message: payload.type === 'error' && payload.message ? String(payload.message) : '',
        notifyError: payload.type === 'error' && Boolean(payload.message),
      });
    }
  });

  exportBridgeInitialized = true;
}

async function startExport(payload) {
  const jobId = createJobId();
  const url = new URL(resolveAppUrl('/export-document.html'));
  url.searchParams.set('job', jobId);
  const exportWindow = globalThis.open(url.href, '_blank');
  if (!exportWindow) {
    throw new Error('Export popup was blocked');
  }

  pendingJobs.set(jobId, {
    payload: createBootstrapPayload({ ...payload, jobId }),
    timeoutId: window.setTimeout(() => {
      finishPendingJob(jobId, {
        message: 'Export timed out before it completed',
        notifyError: true,
      });
    }, EXPORT_JOB_TIMEOUT_MS),
    window: exportWindow,
  });

  exportWindow.focus?.();
  return jobId;
}

export async function exportDirectory({
  currentFilePath = '',
  currentMarkdownText = '',
  directoryPath,
  fileList = [],
  format,
} = {}) {
  const normalizedDirectoryPath = String(directoryPath ?? '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '').trim();
  if (!normalizedDirectoryPath) {
    throw new Error('No folder was selected');
  }

  return startExport({
    currentFilePath,
    currentMarkdownText,
    directoryPath: normalizedDirectoryPath,
    fileList,
    format,
  });
}

export async function exportDocument({
  fileList = [],
  filePath,
  format,
  markdownText = '',
  title = '',
} = {}) {
  const normalizedFilePath = String(filePath ?? '').trim();
  if (!normalizedFilePath) {
    throw new Error('No markdown note is open');
  }

  return startExport({
    fileList,
    filePath: normalizedFilePath,
    format,
    markdownText,
    title,
  });
}
