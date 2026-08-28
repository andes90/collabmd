export function createAgentSetup({ authRequired = true, clientKind, endpoint }) {
  const quotedEndpoint = `'${String(endpoint).replaceAll("'", "'\\''")}'`;
  if (clientKind === 'codex') {
    return [
      `codex mcp add collabmd --url ${quotedEndpoint}`,
      authRequired
        ? '# Configure bearer_token_env_var = "COLLABMD_ACCESS_TOKEN" and approval mode = "writes".'
        : '# No bearer token is required for this no-auth workspace.',
    ].join('\n');
  }
  if (clientKind === 'pi') {
    return [
      'pi install npm:collabmd',
      `export COLLABMD_MCP_URL=${quotedEndpoint}`,
      ...(authRequired ? ['# Set COLLABMD_ACCESS_TOKEN to the token from CollabMD.'] : []),
    ].join('\n');
  }
  return [
    `MCP endpoint: ${endpoint}`,
    'Transport: Streamable HTTP',
    `Authorization: ${authRequired ? 'Bearer $COLLABMD_ACCESS_TOKEN' : 'None'}`,
  ].join('\n');
}

export function createAgentTokenExport(token) {
  return `export COLLABMD_ACCESS_TOKEN='${String(token).replaceAll("'", "'\\''")}'`;
}

