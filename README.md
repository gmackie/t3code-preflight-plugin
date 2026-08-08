# T3 Code Preflight plugin

Read-only reference plugin for Preflight app readiness and release status. It uses the stable `/api/preflight/v1/apps` and `/api/preflight/v1/release-status` endpoints and exposes a configurable polling interval.

Requested access: explicit Preflight secret access, fixed Preflight network access, and project/thread UI panels. Build, deploy, and release mutations are intentionally not part of this proof of concept.
