# Archive

Source of contracts that are still deployed on X Layer but are no longer part of Fengce. They are kept here only so the
deployed bytecode can be matched to its source; nothing in the build, the tests or the app uses them.

| Contract | Address (X Layer, chain 196) | Record |
|---|---|---|
| Verdict | `0xb2589D3153411c5dcedFA83692AcaAC3d93A7c55` | [deployments/verdict-xlayer-196.json](../../deployments/verdict-xlayer-196.json) |

Verdict was an earlier experiment (an attestation of policy decisions). Its imports point at `../core/` as they did when
it sat in `src/verdict/`; to rebuild it, copy it back there.
