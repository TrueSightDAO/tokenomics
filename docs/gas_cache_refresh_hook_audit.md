# GAS cache-refresh hook audit (mirror-grounded)

_Generated: 2026-05-28 by `scripts/crawl_gas_cache_refresh_hooks.py`._

Closes the cache-refresh-hooks pre-flight item in [`agentic_ai_context/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md` §4](https://github.com/TrueSightDAO/agentic_ai_context/blob/main/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md).

**Grounding shift (Gary, 2026-05-28):** earlier passes used `.gs` header-comment URLs in `google_app_scripts/<theme>/` as the source of which scriptId owns which file. That proxy missed real handlers (many `.gs` files don't carry the convention). This pass operates directly on `clasp_mirrors/<scriptId>/Code.js` — the bundled JS clasp actually pushes — which is authoritative.

Approach is conservative: every match below is a **candidate** hook, not an auto-promoted `post_push_hooks` entry. Operator confirms per project that firing the hook on every `clasp push` is the intended side effect, then moves the entry into `post_push_hooks` with a real URL + method + body shape.

## Candidates per scriptId

### `19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC`

_Source: `clasp_mirrors/19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC/Code.js`._

**Handler functions** (name contains both 'cache' and a refresh-class verb):

- `notifyTreasuryCachePublisher_`


### `1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl`

_Source: `clasp_mirrors/1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl/Code.js`._

**Handler functions** (name contains both 'cache' and a refresh-class verb):

- `notifyTreasuryCachePublisher_`


### `1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU`

_Source: `clasp_mirrors/1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU/Code.js`._

**Action-string literals** (dispatch values that mention both 'refresh' and 'cache'):

- `'refresh_dao_members_cache'`


### `1orWgdGckts55owiYOysR_y4sde52T_eUmrtDGAEkb4YV5DlUfJ0JZC5J`

_Source: `clasp_mirrors/1orWgdGckts55owiYOysR_y4sde52T_eUmrtDGAEkb4YV5DlUfJ0JZC5J/Code.js`._

**Handler functions** (name contains both 'cache' and a refresh-class verb):

- `notifyTreasuryCachePublisher_`


### `1wONDeDwZ_fXNapDKpstWrBION3aV3r7NXwq7PCdqbW1LvI5ceaykQNbR`

_Source: `clasp_mirrors/1wONDeDwZ_fXNapDKpstWrBION3aV3r7NXwq7PCdqbW1LvI5ceaykQNbR/Code.js`._

**Handler functions** (name contains both 'cache' and a refresh-class verb):

- `notifyTreasuryCachePublisher_`


### `1wmgYPwfRDxpiboa8OH-C6Ndovklf8HaJY305n7dhRzs7BmUBQg7fL_sZ`

_Source: `clasp_mirrors/1wmgYPwfRDxpiboa8OH-C6Ndovklf8HaJY305n7dhRzs7BmUBQg7fL_sZ/Code.js`._

**Handler functions** (name contains both 'cache' and a refresh-class verb):

- `notifyTreasuryCachePublisher_`


## Consumer callers using a refresh-style action but no resolvable scriptId binding

- `agentic_ai_context/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md` — action `refresh_dao_members_cache`
- `tokenomics/google_app_scripts/tdg_identity_management/dao_members_cache_publisher.gs` — action `refresh_dao_members_cache`
- `tokenomics/google_app_scripts/tdg_identity_management/edgar_send_email_verification.gs` — action `refresh_dao_members_cache`

## Summary

- scriptIds with at least one candidate hook: **6**
- distinct handler functions discovered: **5**
- distinct refresh+cache action strings: **1**
- consumer-side action references found: **3**

Operator promotion path: confirm the candidate in the GAS UI, then move it from `candidate_cache_refresh_hooks` into the manifest's `post_push_hooks[]` with the full URL + method + body.
