const getNotificationApi = () => (typeof globalThis.Notification === 'function' ? globalThis.Notification : null);

export class BrowserNotificationPort {
  getPermission() {
    return getNotificationApi()?.permission ?? 'unsupported';
  }

  async requestPermission() {
    const api = getNotificationApi();
    if (!api?.requestPermission) return 'unsupported';
    if (api.permission !== 'default') return api.permission;
    try { return await api.requestPermission(); } catch { return api.permission ?? 'default'; }
  }

  show({ body, onClick, tag, title } = {}) {
    const api = getNotificationApi();
    if (!api || api.permission !== 'granted' || !body) return null;
    try {
      const notification = new api(title, { body, renotify: true, tag });
      if (onClick) notification.onclick = onClick;
      return notification;
    } catch {
      return null;
    }
  }
}
