let runtimeConfigLoadPromise = null;

function getRuntimeConfigScriptUrl() {
  return new URL('./app-config.js', window.location.href).toString();
}

function createRuntimeConfigScript() {
  const script = document.createElement('script');
  script.src = getRuntimeConfigScriptUrl();
  script.dataset.collabmdRuntimeConfig = 'true';
  return script;
}

export function ensureRuntimeConfigLoaded() {
  if (window.__COLLABMD_CONFIG__) {
    return Promise.resolve(window.__COLLABMD_CONFIG__);
  }

  if (runtimeConfigLoadPromise) {
    return runtimeConfigLoadPromise;
  }

  runtimeConfigLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-collabmd-runtime-config]');
    const script = existingScript instanceof HTMLScriptElement
      ? existingScript
      : createRuntimeConfigScript();

    const cleanup = () => {
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
    };

    const handleError = () => {
      cleanup();
      runtimeConfigLoadPromise = null;
      reject(new Error('Failed to load runtime config'));
    };

    const handleLoad = () => {
      cleanup();
      resolve(window.__COLLABMD_CONFIG__ ?? {});
    };

    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });

    if (!existingScript) {
      document.head.append(script);
    } else if (window.__COLLABMD_CONFIG__) {
      handleLoad();
    }
  });

  return runtimeConfigLoadPromise;
}
