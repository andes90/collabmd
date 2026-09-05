# Installation options

> Operator docs. Start with the [README](../README.md) for the product overview.

### Requirements

- macOS, Linux, or Windows (via WSL2)
- Node.js 26 for `npx` and source installs
- ripgrep for global text search. Install with `brew install ripgrep` on macOS, `apk add ripgrep` on Alpine, or `apt install ripgrep` on Debian/Ubuntu. Docker images already include it.

### Run via npx (Node.js)

If you have Node.js installed, you can run CollabMD directly without installing it globally:

```bash
npx collabmd@latest ~/my-vault --no-tunnel
```

Open `http://localhost:1234`.

### Install with Homebrew

```bash
brew tap andes90/tap
brew install collabmd
collabmd ~/my-vault --no-tunnel
```

Or in a single command:

```bash
brew install andes90/tap/collabmd
collabmd ~/my-vault --no-tunnel
```

Open `http://localhost:1234`.

### Install from source

```bash
git clone https://github.com/andes90/collabmd.git
cd collabmd
npm install
npm run build
npm link       # optional: makes `collabmd` available globally
collabmd ~/my-vault --no-tunnel
```

Open `http://localhost:1234`.

For a safer first run, start local-only:

```bash
collabmd ~/my-vault --no-tunnel
```

If you want to share the session over the internet, protect it first:

```bash
collabmd ~/my-vault --auth password
```

If `cloudflared` is installed, CollabMD starts a quick tunnel by default unless you pass `--no-tunnel`.

