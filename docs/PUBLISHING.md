# Publishing Markda

## One-time setup

1. Create or confirm the `tetsuji16` publisher in the [Visual Studio Marketplace publisher management page](https://marketplace.visualstudio.com/manage).
2. Make <https://github.com/tetsuji16/Markda> public before release so Marketplace users can open the Repository, Issues, and Homepage links declared in `package.json`.
3. Confirm that both the extension name `markda` and display name `Markda` are available.
4. Authenticate `vsce` using the publishing method configured for the publisher. Never commit credentials or tokens.

## Release checklist

1. Update the version in `package.json` and `package-lock.json` together with `npm version <version> --no-git-tag-version`.
2. Add the release notes to `CHANGELOG.md`.
3. Run `npm run package`.
4. Install the generated VSIX in a clean VS Code profile and complete the checklist in `docs/DEMO.md`.
5. Publish with `npm run publish:marketplace`, or upload the verified VSIX in the publisher management page.
6. Remove `"preview": true` from `package.json` when the extension is ready to be presented as stable.

For an early-access build, use `npm run package:pre-release` and `npm run publish:pre-release` instead. VS Code extension versions must remain in `major.minor.patch` form; the pre-release channel is selected by the publish flag.

## Local VSIX installation

Use **Extensions → Views and More Actions… → Install from VSIX…**, or run:

```text
code --install-extension markda-0.1.0.vsix
```
