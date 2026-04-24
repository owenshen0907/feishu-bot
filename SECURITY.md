# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for suspected credential leaks, authentication bypasses, or data exposure bugs.

Report security issues privately to the repository owner, or use GitHub private vulnerability reporting if it is enabled for this repository. Include:

- affected version or commit
- steps to reproduce
- expected and actual impact
- any relevant logs with secrets redacted

## Credential Handling

This project is local-first and intentionally does not commit runtime secrets. Keep these files local only:

- `.env`, `.env.*`
- `console-settings.json` when it contains machine-specific settings
- SQLite files under `data/`
- packaged app bundles and DMGs under `dist/` or `.native-macos-build/`

If a secret was committed or published, rotate it immediately before removing it from Git history.
