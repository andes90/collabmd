import { resolveAppUrl } from '../infrastructure/runtime-config.js';

const EXPORT_PAGE_SOURCE = 'collabmd-export-page';
const EXPORT_HOST_SOURCE = 'collabmd-export-host';
const EXPORT_JOB_CLOSE_POLL_MS = 500;
const EXPORT_JOB_TIMEOUT_MS = 300_000;
const pendingJobs = new Map();
let exportBridgeErrorHandler = null;

function createJobId() {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `export-${id}`;
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
  theme = 'light',
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
    theme: theme === 'dark' ? 'dark' : 'light',
    title: String(title ?? ''),
    type: 'bootstrap',
  };
}

function clearPendingJobTimers(pendingJob) {
  if (!pendingJob) {
    return;
  }

  if (pendingJob.closePollId) {
    window.clearInterval(pendingJob.closePollId);
  }

  if (pendingJob.timeoutId) {
    window.clearTimeout(pendingJob.timeoutId);
  }
}

function finishPendingJob(jobId, {
  notifyError = false,
  message = '',
} = {}) {
  const pendingJob = pendingJobs.get(jobId);
  if (!pendingJob) {
    return;
  }

  clearPendingJobTimers(pendingJob);
  pendingJobs.delete(jobId);

  if (notifyError && message) {
    exportBridgeErrorHandler?.(message);
  }
}

export function initializeExportBridge({
  onError = null,
} = {}) {
  exportBridgeErrorHandler = typeof onError === 'function' ? onError : null;

  if (window.__collabmdExportBridgeInitialized) {
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
    if (!pendingJob) {
      return;
    }

    if (payload.type === 'ready') {
      if (pendingJob.window?.closed) {
        finishPendingJob(jobId, {
          message: 'Export window was closed before the export completed',
          notifyError: true,
        });
        return;
      }

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

  window.__collabmdExportBridgeInitialized = true;
}

async function startExport(payload) {
  const jobId = createJobId();
  const exportWindow = globalThis.open('', jobId);
  if (!exportWindow) {
    throw new Error('Export popup was blocked');
  }

  pendingJobs.set(jobId, {
    closePollId: window.setInterval(() => {
      if (!exportWindow.closed) {
        return;
      }

      finishPendingJob(jobId, {
        message: 'Export window was closed before the export completed',
        notifyError: true,
      });
    }, EXPORT_JOB_CLOSE_POLL_MS),
    payload: createBootstrapPayload({
      ...payload,
      jobId,
      theme: document.documentElement.dataset.theme,
    }),
    timeoutId: window.setTimeout(() => {
      finishPendingJob(jobId, {
        message: 'Export timed out before it completed',
        notifyError: true,
      });
    }, EXPORT_JOB_TIMEOUT_MS),
    window: exportWindow,
  });

  exportWindow.location.replace(resolveAppUrl('/export-document.html'));
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
