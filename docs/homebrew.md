# Homebrew publishing

This repository contains the files needed to publish CollabMD through a dedicated Homebrew tap.

## Files

- `packaging/homebrew-tap/README.md`: tap repository README
- `packaging/homebrew-tap/Formula/collabmd.rb`: bootstrap formula template that the release workflow overwrites
- `scripts/render-homebrew-formula.mjs`: deterministic formula generator
- `.github/workflows/homebrew-tap-release.yml`: workflow that pushes the tap update after each release

## One-time setup

1. Create the tap repository on GitHub as `andes90/homebrew-tap`.
2. Copy `packaging/homebrew-tap/README.md` into that repository if you want the repo initialized before the first release.
3. Add a GitHub Actions secret named `HOMEBREW_TAP_GITHUB_TOKEN` in `andes90/collabmd`.
4. Grant that token `Contents: Read and write` access to the `andes90/homebrew-tap` repository.

## Release flow

1. Bump the version in `package.json`.
2. Commit and push the version change.
3. Create and push a matching git tag, for example `vX.Y.Z`.
4. Publish a GitHub release for that tag.
5. The workflow downloads `https://github.com/andes90/collabmd/archive/refs/tags/<tag>.tar.gz`, computes the checksum, regenerates the formula, and commits the result into `andes90/homebrew-tap`.

## Manual run

If you need to republish the formula for an existing tag:

1. Open the `Homebrew Tap Release` workflow in GitHub Actions.
2. Run it manually with `tag=vX.Y.Z`.

## Local formula generation

To render the formula locally once you already know the tarball checksum:

```bash
node scripts/render-homebrew-formula.mjs \
  --version "$(node -p "require('./package.json').version")" \
  --sha256 <sha256> \
  --owner andes90 \
  --repo collabmd \
  --output packaging/homebrew-tap/Formula/collabmd.rb
```

The script fails if the version does not match `package.json`, which prevents publishing a formula for the wrong source tag.
