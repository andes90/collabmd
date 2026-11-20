import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { MSG_AGENT_FLUSH, MSG_AGENT_FLUSH_ACK } from '../../domain/collaboration-protocol.js';

export function attachRoomFlushTransport(provider, {
  clientId,
  clearTimeoutFn = clearTimeout,
  setTimeoutFn = setTimeout,
} = {}) {
  const handlers = provider?.messageHandlers;
  const pending = new Map();
  const previousHandler = handlers?.[MSG_AGENT_FLUSH_ACK];
  let counter = 0;

  function acknowledge(_encoder, decoder) {
    let requestId;
    try {
      requestId = decoding.readVarString(decoder);
    } catch {
      return;
    }
    pending.get(requestId)?.('acknowledged');
  }
  if (handlers) handlers[MSG_AGENT_FLUSH_ACK] = acknowledge;

  return {
    flush(timeoutMs) {
      const socket = provider?.ws;
      if (!socket || socket.readyState !== (socket.OPEN ?? 1) || handlers?.[MSG_AGENT_FLUSH_ACK] !== acknowledge) {
        return Promise.resolve({ status: 'unavailable' });
      }
      const requestId = `room-flush-${clientId}-${++counter}`;
      return new Promise((resolve) => {
        const finish = (status) => {
          if (!pending.delete(requestId)) return;
          clearTimeoutFn(timer);
          resolve({ status });
        };
        const timer = setTimeoutFn(() => finish('timeout'), timeoutMs);
        pending.set(requestId, finish);

        try {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_AGENT_FLUSH);
          encoding.writeVarString(encoder, requestId);
          socket.send(encoding.toUint8Array(encoder));
        } catch {
          finish('unavailable');
        }
      });
    },
    dispose() {
      if (handlers?.[MSG_AGENT_FLUSH_ACK] === acknowledge) {
        if (previousHandler) handlers[MSG_AGENT_FLUSH_ACK] = previousHandler;
        else delete handlers[MSG_AGENT_FLUSH_ACK];
      }
      pending.forEach((finish) => finish('disconnected'));
    },
  };
}
