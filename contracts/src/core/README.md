# core

Shared, wallet-agnostic parts: Pin registry, Schema library, PolicyEngine.

Rule: nothing in this folder may import Safe code (`@safe/`) or anything from `src/safe/`.
Other projects import it through the `@fengce/core/` remapping.
