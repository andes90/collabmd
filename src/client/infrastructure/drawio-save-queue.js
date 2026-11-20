export function createDrawioSaveQueue(write) {
  let pendingXml = null;
  let inFlight = null;

  async function drain() {
    while (pendingXml !== null) {
      const xml = pendingXml;
      pendingXml = null;
      try {
        await write(xml);
      } catch (error) {
        pendingXml ??= xml;
        throw error;
      }
    }
  }

  return {
    enqueue(xml) {
      pendingXml = xml;
    },
    flush() {
      inFlight ??= drain().finally(() => { inFlight = null; });
      return inFlight;
    },
    hasPendingWrites() {
      return pendingXml !== null || inFlight !== null;
    },
  };
}
