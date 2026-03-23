import { uiFeatureIdentityMethods } from './ui-feature-identity.js';
import { uiFeatureShellMethods } from './ui-feature-shell.js';
import { uiFeatureSidebarMethods } from './ui-feature-sidebar.js';
import { uiFeatureTabActivityMethods } from './ui-feature-tab-activity.js';
import { uiFeatureToolbarMethods } from './ui-feature-toolbar.js';

export const uiFeature = {
  ...uiFeatureShellMethods,
  ...uiFeatureSidebarMethods,
  ...uiFeatureIdentityMethods,
  ...uiFeatureToolbarMethods,
  ...uiFeatureTabActivityMethods,
};
