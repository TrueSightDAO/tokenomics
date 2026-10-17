/**
 * Triggers.template.gs - canonical scheduled-trigger module (TrueSight DAO convention).
 * ---------------------------------------------------------------------------------
 * Google Apps Script time-driven triggers CANNOT be created over the Sheets /
 * Drive API - they must be created either in the editor UI or by the script
 * itself via ScriptApp. Hand-adding them in the UI is fragile (the "Minutes
 * timer" defaults to HOURLY, not 30-min; the event source is easy to leave as
 * "From spreadsheet"; and the trigger is lost whenever a project is
 * copied/restored). So EVERY project that needs a schedule should ship this
 * module, DECLARE its triggers in TRIGGER_SPECS, and have an operator run
 * installTriggers() once after authorizing.
 *
 * Convention
 * ----------
 *   1. Copy this file into the GAS project as `Triggers.gs`.
 *   2. Fill TRIGGER_SPECS - one entry per handler that should run on a schedule.
 *      Supported kinds: 'minutes' | 'hours' | 'days'.
 *   3. Run installTriggers() once (grants OAuth if prompted). It is idempotent.
 *   4. To pause the schedule: uninstallTriggers(). To inspect: listTriggers().
 *
 * Triggers are owned by the identity that created them and
 * ScriptApp.getProjectTriggers() returns only the CALLING identity's triggers -
 * run installTriggers() / uninstallTriggers() as the same account.
 *
 * Precedent: go_to_market/google_app_scripts/seo_monitoring_gsc/Triggers.gs
 */

/**
 * DECLARE YOUR SCHEDULES HERE.
 *   handler : the function name in THIS project to run
 *   kind    : 'minutes' | 'hours' | 'days'
 *   every   : numeric interval (e.g. 30, 6, 1)
 *   atHour  : 0-23, only used when kind === 'days'
 *
 * Example:
 *   var TRIGGER_SPECS = [
 *     { handler: 'publishTreasuryCacheCron', kind: 'minutes', every: 30 },
 *     { handler: 'weeklyGscSnapshot',       kind: 'days',    every: 7, atHour: 8 }
 *   ];
 */
var TRIGGER_SPECS = [
  // { handler: 'myScheduledFunction', kind: 'minutes', every: 30 },
];

/**
 * Create every trigger declared in TRIGGER_SPECS. Run ONCE after authorizing.
 * Idempotent: deletes an existing trigger for a declared handler before
 * (re)creating it, so re-running never stacks duplicates.
 */
function installTriggers() {
  var wanted = {};
  TRIGGER_SPECS.forEach(function (spec) { wanted[spec.handler] = true; });

  // Delete first -> idempotent reconciliation.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (wanted[t.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(t);
    }
  });

  TRIGGER_SPECS.forEach(function (spec) {
    var builder = ScriptApp.newTrigger(spec.handler).timeBased();
    if (spec.kind === 'minutes') {
      builder = builder.everyMinutes(spec.every);
    } else if (spec.kind === 'hours') {
      builder = builder.everyHours(spec.every);
    } else if (spec.kind === 'days') {
      builder = builder.everyDays(spec.every);
      if (spec.atHour !== undefined) {
        builder = builder.atHour(spec.atHour);
      }
    } else {
      throw new Error('installTriggers: unknown kind "' + spec.kind + '" for ' + spec.handler);
    }
    builder.create();
    Logger.log('installTriggers: created ' + spec.kind + '(' + spec.every + ') -> ' + spec.handler);
  });

  return listTriggers();
}

/**
 * Remove the triggers for declared handlers (symmetric with installTriggers) -
 * the "pause the schedule" button. Only touches handlers in TRIGGER_SPECS, so
 * any hand-added UI triggers for OTHER functions are left alone.
 */
function uninstallTriggers() {
  var wanted = {};
  TRIGGER_SPECS.forEach(function (spec) { wanted[spec.handler] = true; });

  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (wanted[t.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  var msg = 'uninstallTriggers: removed ' + removed + ' trigger(s)';
  Logger.log(msg);
  return msg;
}

/**
 * Log + return the project's current triggers. Handy for verification after
 * installTriggers() / uninstallTriggers().
 */
function listTriggers() {
  var rows = ScriptApp.getProjectTriggers().map(function (t) {
    return {
      handler: t.getHandlerFunction(),
      eventType: String(t.getEventType()),
      uniqueId: t.getUniqueId()
    };
  });
  Logger.log(JSON.stringify(rows, null, 2));
  return rows;
}
