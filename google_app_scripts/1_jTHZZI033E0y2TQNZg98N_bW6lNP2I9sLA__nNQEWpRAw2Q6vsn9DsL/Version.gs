/**
 * Apps Script editor:
 * https://script.google.com/home/projects/1_jTHZZI033E0y2TQNZg98N_bW6lNP2I9sLA__nNQEWpRAw2Q6vsn9DsL/edit
 * @fileoverview Deploy metadata for iChing advisory bridge web app.
 */

var CLASP_MIRROR_LAST_CLASP_PUSH_UTC = '2026-04-17T00:00:00Z';

var CLASP_MIRROR_CHANGELOG =
  '2026-04-17 — Added doGet iChing advisory bridge (Grok + advisory raw GitHub context) and runOneSetup.\n';

function getClaspMirrorDeployInfo() {
  return {
    lastClaspPushUtc: CLASP_MIRROR_LAST_CLASP_PUSH_UTC,
    changelog: CLASP_MIRROR_CHANGELOG
  };
}
