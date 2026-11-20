import { USER_NAME_MAX_LENGTH, normalizeUserName } from '../../domain/room.js';

function isIdentityManagedByAuth() {
  return this.runtimeConfig?.auth?.strategy === 'oidc'
    && this.runtimeConfig?.auth?.provider === 'google';
}

function openDisplayNameDialog({ mode = 'edit' } = {}) {
  if (this.isIdentityManagedByAuth()) {
    return;
  }

  if (!this.isTabActive) {
    return;
  }

  const dialog = this.elements.displayNameDialog;
  const input = this.elements.displayNameInput;
  const title = this.elements.displayNameTitle;
  const copy = this.elements.displayNameCopy;
  const cancel = this.elements.displayNameCancel;
  const submit = this.elements.displayNameSubmit;
  if (!dialog || !input) return;

  const isOnboarding = mode === 'onboarding';
  this._displayNameDialogMode = mode;
  if (title) {
    title.textContent = isOnboarding ? 'Choose your display name' : 'Update display name';
  }
  if (copy) {
    copy.textContent = isOnboarding
      ? 'Pick a name collaborators will see. You can skip for now and continue as a guest.'
      : 'Your name will be visible to everyone editing this vault.';
  }
  if (cancel) {
    cancel.textContent = isOnboarding ? 'Skip for now' : 'Cancel';
  }
  if (submit) {
    submit.textContent = isOnboarding ? 'Continue' : 'Save name';
  }

  input.value = isOnboarding ? '' : this.getCurrentUserName();
  if (dialog.open) {
    return;
  }
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
  }
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function promptForDisplayNameIfNeeded() {
  if (
    !this.isTabActive
    || this._hasPromptedForDisplayName
    || this.getStoredUserName()
    || this.isIdentityManagedByAuth()
  ) {
    return;
  }

  this._hasPromptedForDisplayName = true;
  requestAnimationFrame(() => {
    this.openDisplayNameDialog({ mode: 'onboarding' });
  });
}

function handleDisplayNameCancel() {
  if (this._displayNameDialogMode === 'onboarding' && !this.getStoredUserName()) {
    const guestName = this.getCurrentUserName();
    if (guestName) {
      this.preferences.setUserName(guestName);
    }
  }
  this.elements.displayNameDialog?.close();
}

function handleDisplayNameSubmit() {
  if (this.isIdentityManagedByAuth()) {
    return;
  }

  const input = this.elements.displayNameInput;
  const dialog = this.elements.displayNameDialog;
  if (!input || !dialog) return;

  const normalizedName = this.session
    ? this.session.setUserName(input.value)
    : normalizeUserName(input.value);
  if (!normalizedName) {
    input.focus();
    this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
    return;
  }

  this.preferences.setUserName(normalizedName);
  this.lobby.setUserName(normalizedName);
  const localUser = this.lobby.getLocalUser();
  this.drawioEmbed?.updateLocalUser(localUser);
  this.excalidrawEmbed?.updateLocalUser(localUser);
  this.canvasEmbed?.updateLocalUser(localUser);
  this.syncCurrentUserName();
  this.renderChat();
  dialog.close();
}

function getCurrentUser() {
  return this.globalUsers.find((u) => u.isLocal)
    ?? this.session?.getLocalUser()
    ?? this.lobby?.getLocalUser()
    ?? null;
}

function getCurrentUserName() {
  return this.getCurrentUser()?.name ?? this.getStoredUserName() ?? '';
}

function getStoredUserName() {
  return this.preferences.getUserName();
}

function syncCurrentUserName() {
  const el = this.elements.currentUserName;
  if (!el) return;
  const name = this.getCurrentUserName();
  el.textContent = name || 'Set name';
  el.classList.toggle('has-name', Boolean(name));
  if (!this.isIdentityManagedByAuth()) {
    this.elements.editNameButton?.setAttribute(
      'aria-label',
      `${name || 'Set name'}. Change display name`,
    );
  }
}

function syncIdentityManagementUi() {
  const isManaged = this.isIdentityManagedByAuth();
  this.elements.editNameButton?.classList.toggle('hidden', isManaged);
  this.elements.editNameButton?.toggleAttribute('disabled', isManaged);
  if (isManaged && this.elements.displayNameDialog?.open) {
    this.elements.displayNameDialog.close();
  }
}

export const uiFeatureIdentityMethods = {
  getCurrentUser,
  getCurrentUserName,
  getStoredUserName,
  handleDisplayNameCancel,
  handleDisplayNameSubmit,
  isIdentityManagedByAuth,
  openDisplayNameDialog,
  promptForDisplayNameIfNeeded,
  syncCurrentUserName,
  syncIdentityManagementUi,
};
