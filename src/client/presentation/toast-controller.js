export class ToastController {
  constructor(container) {
    this.container = container;
  }

  show(message, options = 3000) {
    if (!this.container) {
      return null;
    }

    const normalizedOptions = typeof options === 'number'
      ? { duration: options }
      : { ...(options ?? {}) };
    const duration = Number(normalizedOptions.duration) > 0
      ? Number(normalizedOptions.duration)
      : 0;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const content = document.createElement('span');
    content.className = 'toast__message';
    content.textContent = message;
    toast.appendChild(content);

    const dismiss = () => {
      if (!toast.isConnected || toast.classList.contains('leaving')) {
        return;
      }
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    if (normalizedOptions.actionLabel && typeof normalizedOptions.onAction === 'function') {
      const actionButton = document.createElement('button');
      actionButton.className = 'toast__action';
      actionButton.type = 'button';
      actionButton.textContent = normalizedOptions.actionLabel;
      actionButton.addEventListener('click', () => {
        normalizedOptions.onAction();
        if (normalizedOptions.closeOnAction !== false) {
          dismiss();
        }
      });
      toast.appendChild(actionButton);
    }

    if (normalizedOptions.dismissible) {
      const dismissButton = document.createElement('button');
      dismissButton.className = 'toast__dismiss';
      dismissButton.type = 'button';
      dismissButton.setAttribute('aria-label', 'Dismiss notification');
      dismissButton.textContent = 'Close';
      dismissButton.addEventListener('click', dismiss);
      toast.appendChild(dismissButton);
    }

    this.container.appendChild(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }

    return toast;
  }
}
