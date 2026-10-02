# Security policy

## Supported versions

Security fixes are provided for the latest published minor release. Upgrade to the current version before reporting behavior that might already be resolved.

## Reporting a vulnerability

Do not open a public issue. Use [GitHub private vulnerability reporting](https://github.com/display-design-studio/vite-plugin-shopify-theme/security/advisories/new) and include:

- the affected package version and environment;
- a minimal reproduction or precise sequence of events;
- the expected and observed impact;
- whether credentials, generated snippets, ownership state, or theme assets are involved;
- any suggested mitigation, if known.

Do not include active Shopify credentials or customer data. Revoke any credential that might have been exposed before submitting the report.

Maintainers will acknowledge the report through the private advisory, investigate it without public disclosure, and coordinate remediation and publication there. Public disclosure should wait until a fixed release and migration guidance are available.

## Security boundaries

The plugin reads and writes inside the configured theme root, temporarily replaces its configured development snippet, and removes only flat asset files recorded in its ownership state. Shopify credentials are used only by separately invoked Shopify tooling and are not plugin configuration.
