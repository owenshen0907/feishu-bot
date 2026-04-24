## Summary

-

## Validation

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm test:mac` if macOS UI or Swift code changed
- [ ] `pnpm pack:check` if package, build, or release files changed

## Safety

- [ ] No real Feishu credentials, model API keys, bridge tokens, user IDs, trace IDs, or private URLs are included.
- [ ] Generated files and local runtime data stay out of the commit unless intentionally documented.
