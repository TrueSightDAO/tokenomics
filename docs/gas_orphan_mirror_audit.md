# GAS clasp_mirrors orphan audit

_Generated: 2026-05-29 by `scripts/audit_orphan_clasp_mirrors.py`. Re-run any time `google_app_scripts/` or `clasp_mirrors/` change._

Resolves the 51-vs-36 delta noted in [`agentic_ai_context/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md` §2](https://github.com/TrueSightDAO/agentic_ai_context/blob/main/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md).

## Summary

- **37** distinct scriptIds referenced in `google_app_scripts/**/*.gs` source-comment URLs.
- **47** clasp_mirror folders.
- **34** healthy (in both).
- **13** orphan mirrors (mirror exists; no source references it).
- **3** unmirrored sources (source references; no mirror folder — `clasp push` would fail without one).

## Orphan mirrors (no source file references this scriptId)

These mirrors have no `.gs` source under `google_app_scripts/` carrying the standard `script.google.com/home/projects/<scriptId>` header URL. Most likely deprecated or historical clones. **Restructure roadmap PR-2…PR-N resolves case-by-case** — don't auto-delete; some may be live GAS projects that just never had the source-comment convention applied.

- `clasp_mirrors/1CpAVMPR2mAHlnt20oDhi-_-C8gRbiPbHiemHzlrlpiRgrL0r8MLTMYhi/`
- `clasp_mirrors/1DYSZKFYM-PsQuCMII7ki-T5H3D8q92yn-9GZ3lzUOLxpH8o3zyxLUFyO/`
- `clasp_mirrors/1E6XFs1X7GMqAEOJxoINHEYPazuYI7HYSyjqW2s9OhFXENm09ne0mUOER/`
- `clasp_mirrors/1EBoewfPK3hkHAhEGXD_E6lEIF_qFon6Vh5udnd_wJa_ZENf4APdL1_V2/`
- `clasp_mirrors/1K1wcXFAopSA0cI7oBpu5bl1sagrJ2Quv44B0ppjiIxtl3MKJ_PCsppCf/`
- `clasp_mirrors/1P0Mg33i_dD9x9IeoHYvtKrf0xFcmUznpqAswyC_KXR3VJZu-0C-UOP0v/`
- `clasp_mirrors/1Uq1EHReKpXtf3CnT94Rax9YD8oKxmvyFOBGqnI4heqiW_VTnRzurgido/`
- `clasp_mirrors/1XmwyzzauOoLUZAbm5jK1GBwWNIDLHBrlA465a3EE7bnNW3cvhqzIR8ml/`
- `clasp_mirrors/1YpJCLtmSEFLiY9bfvMB_-BToxcTPr9Pf9Wi7YKWzQ6ugkoR3gMVkBUmo/`
- `clasp_mirrors/1_jTHZZI033E0y2TQNZg98N_bW6lNP2I9sLA__nNQEWpRAw2Q6vsn9DsL/`
- `clasp_mirrors/1ovx-Hq5L5MgzF32qB_cPV_G5Hc6XshKMAYOmiJY8tZ355gzWUqvFCPvn/`
- `clasp_mirrors/1yDOuOZgfbzOllbbxHpMTNLZo3-7SNl1-wtq1oQzqiMPOoxiFpMrhzSOw/`
- `clasp_mirrors/1zAXSdLe_vigsygxqX41w_evQb3KfrtzUc4rFI3AxwdUjp8E-h3nIvgDG/`

## Unmirrored sources (source references scriptId; no mirror folder)

These would fail at `clasp push` time because there is no local clasp project to push to. Mint the mirror via `scripts/clone_clasp_mirrors.mjs` (or whatever the workspace convention is) **before** the restructure PR for that scriptId lands.

- `1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT` — referenced by:
    - `google_app_scripts/agroverse_qr_codes/process_donation_mint_telegram_logs.gs`
    - `google_app_scripts/agroverse_qr_codes/qr_code_web_service.gs`
- `1gi4YKh2ikLWmp6qEL1A6N3dfF6gQP-jwRPf_hc0N0EvaVU0-1tWu0nxo` — referenced by:
    - `google_app_scripts/seacoast_freight_quotation_ingest/Code.gs`
- `1zKgMwd6KJFjoWkRH6OobgFvtVzrXVuEKfxVbgixgnfcp4TZTjrsfNKq0` — referenced by:
    - `google_app_scripts/tdg_identity_management/register_member_digital_signatures_email.gs`

## Healthy

_34 scriptIds appear in both `google_app_scripts/` and `clasp_mirrors/`._

<details><summary>Show full list</summary>

- `1-ts0WTM8J4nOWdI29I9NJLzPQBGqph3ajSB8d8qrAHINJaZynwxLzPx8`
- `10NKp8uLMGyfgDv0ByakHVGioOYzvDV7NbHMSBigB2TCVcY7aqYXhbywv`
- `11fA8NXSOwKyddXDZmmx3BRCDU1Y38GVidENCj0mujH0pT-AqIoOyaetj`
- `14gKJ0VW49RsSn4S03pgxKXy0sp4Z7Z3Wm1Wj8jQiWW5dj1sFuPnp95sh`
- `15qbfLN3ZCk-Ee6YNQnLj2OryWN3bWGh4BkqBaADonGQSLGzRyIo5skDR`
- `177OJC0tVytZfSa6gMldKCqS5LxUZGnV_dT2NJ_FJE1uwvoGHzqC8HbyG`
- `19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC`
- `1BHAGZd_T1I5mQnqnAFqUJKX2x_N8Uv05n1O2OohRA908Ja8wVwVxaR7K`
- `1Dh_QQUn8hGGo75RsPpsN-GMn-uFgw-akwyv3uSZgO140J3NfQzsnuu9s`
- `1Dj3-m_ejxYJ4UQK2zNadnqNHJIvPQfj-VYvH9_Gnap6MYRmOJhK3B0VR`
- `1IBrXqW_uTsFkbKU-fiOTrkfBlxLnX8KHsKSw2qqF3NoOa36wU0OKEVGH`
- `1Jp8qNIBCZaRTlmOmbJoJmYnSFyXtQkUHP2Qv5uqKZpt0Ugo-e25nhASF`
- `1LxWu9hOs56JZ6Mbxra3eDv74xjpjgkJQW40xjpQBIHObsqiv1D5jr5fK`
- `1N6o00N9VtRK_L3e0NQXEsmC6QME1KObZdmdbJgo0Tbgj_7P-ElNL5THn`
- `1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2`
- `1Og2g8Q0_SdM9A5mJNO-tq_9r8XMQ00ybBmss4L3tItBAJ01-KdM-w40c`
- `1Q5HfGR_AcSYmrKCy5bs-Jo8pdtV-vZJ6Zhv2VCY0HGo2haVoeWMjOCGC`
- `1QKqUTyl3_pyDHfVMoRUkzvU75eV6UtizIw5bR5xeDMaLyZGUPzWTz8Et`
- `1QtK-InsHH6SBtxoxc33-y4vQvuNkbhlkUi_9S1X-AaEgIlSlygM1iZtP`
- `1UrBgqLnnQc6PV4-gMIDh2SYwWu62wTdSrV30xk9q_eVr2UdoxdzXN38v`
- `1XIz0hs7lH4DgjamUwQZeO4DwVTG8tqKjGElL9XB2StrkPXbHYeETOWBx`
- `1Y8sJ22lZuqQYS_kF_3ItMuyfiAzbJ4wRA1xGC_bGx7FPB7uLTvrUObly`
- `1ZQjgSZvAXL2PB3e3YW289xY7Ork4S5wV4uKTXJyw83xQT4R0lh_hwNWn`
- `1_3D4o2RdHdPuu5EHCUwkMQe8sFJBqXWqCiE-wpwME2Gdr6_oTt3VBAVC`
- `1dsWecVwbN0dOvilIz9r8DNt7LD3Ay13V8G9qliow4tZtF5LHsvQOFpF7`
- `1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl`
- `1m2sQONdMGw6HbxIVP0H0JJJ1aYrYLSRRlHb2MIplrDDsKhm8-IwKBntk`
- `1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU`
- `1orWgdGckts55owiYOysR_y4sde52T_eUmrtDGAEkb4YV5DlUfJ0JZC5J`
- `1rLl94jQ9tDYdRvudnP0prPY5SEjvM07R4gPs6-vRyZEpSJhUqbiE3CZY`
- `1vC3p_WfKQT-fl5tHZ9-E3aotYon3gQdOiFVLmyVElMqB-hi_FT3rcB8W`
- `1wONDeDwZ_fXNapDKpstWrBION3aV3r7NXwq7PCdqbW1LvI5ceaykQNbR`
- `1wmgYPwfRDxpiboa8OH-C6Ndovklf8HaJY305n7dhRzs7BmUBQg7fL_sZ`
- `1y6JVYwqdrFD4zHT4zyIfU762RRsW7GgZKPVuzorpwUS61mDnFQZ65Qsz`

</details>
