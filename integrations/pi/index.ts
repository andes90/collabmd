import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;

async function getClient() {
  if (client) return client;
  const endpoint = process.env.COLLABMD_MCP_URL?.trim();
  const token = process.env.COLLABMD_ACCESS_TOKEN?.trim();
  if (!endpoint) {
    throw new Error('Set COLLABMD_MCP_URL from CollabMD Connect AI Agent.');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Remote CollabMD MCP endpoints must use HTTPS.');
  }
  client = new Client({ name: 'collabmd-pi', version: '1.0.0' });
  transport = new StreamableHTTPClientTransport(url, token
    ? { authProvider: { token: async () => token } }
    : {});
  await client.connect(transport);
  return client;
}

async function callTool(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const connected = await getClient();
  const result = await connected.callTool({ arguments: args, name }, { signal });
  return { content: result.content, details: result.structuredContent ?? result };
}

export default function collabMdExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'collabmd_list_documents',
    label: 'List CollabMD documents',
    description: 'List readable documents in the connected CollabMD vault.',
    parameters: Type.Object({
      kinds: Type.Optional(Type.Array(Type.String())),
      limit: Type.Optional(Type.Integer({ maximum: 200, minimum: 1 })),
      prefix: Type.Optional(Type.String()),
    }),
    execute: (_id, params, signal) => callTool('list_documents', params, signal),
  });
  pi.registerTool({
    name: 'collabmd_search_vault',
    label: 'Search CollabMD vault',
    description: 'Search current CollabMD Vault Content and return path/line evidence.',
    parameters: Type.Object({ query: Type.String({ minLength: 2 }) }),
    execute: (_id, params, signal) => callTool('search_vault', params, signal),
  });
  pi.registerTool({
    name: 'collabmd_read_document',
    label: 'Read CollabMD document',
    description: 'Read current document content and revision before answering or editing.',
    parameters: Type.Object({
      lineCount: Type.Optional(Type.Integer({ maximum: 500, minimum: 1 })),
      path: Type.String(),
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    execute: (_id, params, signal) => callTool('read_document', params, signal),
  });
  pi.registerTool({
    name: 'collabmd_apply_text_edits',
    label: 'Edit CollabMD document',
    description: 'Apply exact replacements using current CollabMD document revision.',
    parameters: Type.Object({
      path: Type.String(),
      replacements: Type.Array(Type.Object({ newText: Type.String(), oldText: Type.String() })),
      revision: Type.String(),
    }),
    execute: (_id, params, signal) => callTool('apply_text_edits', params, signal),
  });
  pi.registerTool({
    name: 'collabmd_create_document',
    label: 'Create CollabMD document',
    description: 'Create a new supported CollabMD text document.',
    parameters: Type.Object({ content: Type.String(), path: Type.String() }),
    execute: (_id, params, signal) => callTool('create_document', params, signal),
  });
  pi.registerTool({
    name: 'collabmd_get_supported_syntax',
    label: 'Get CollabMD syntax',
    description: 'Describe CollabMD-supported formats and syntax before creating files.',
    parameters: Type.Object({ kind: Type.Optional(Type.String()) }),
    execute: (_id, params, signal) => callTool('get_collabmd_syntax', params, signal),
  });

  pi.on('session_shutdown', async () => {
    await transport?.close().catch(() => {});
    transport = null;
    client = null;
  });
}
