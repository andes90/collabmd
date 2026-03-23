import {
  getHashRoute,
  navigateToGitCommit,
  navigateToFile,
  navigateToGitDiff,
  navigateToGitFileHistory,
  navigateToGitFilePreview,
  navigateToGitHistory,
} from './runtime-config.js';

export class BrowserNavigationPort {
  getHashRoute() {
    return getHashRoute();
  }

  navigateToFile(filePath, options) {
    navigateToFile(filePath, options);
  }

  navigateToGitDiff(payload) {
    navigateToGitDiff(payload);
  }

  navigateToGitCommit(payload) {
    navigateToGitCommit(payload);
  }

  navigateToGitHistory() {
    navigateToGitHistory();
  }

  navigateToGitFileHistory(payload) {
    navigateToGitFileHistory(payload);
  }

  navigateToGitFilePreview(payload) {
    navigateToGitFilePreview(payload);
  }
}
