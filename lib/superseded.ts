// When is an open care occurrence "superseded"?
//
// A keeper can make up an overdue task only until that same task comes due
// again; after that, doing the care counts toward the new occurrence and the
// earlier one was simply missed. This module is the ONE definition of "that
// same task comes due again", shared by auto-miss, the put-back guard and the
// missed list's `superseded` flag so the three can never disagree.
//
// "The same task" is, for the same animal, either
//   - a later occurrence of the same schedule, or
//   - a later occurrence of another schedule with the same task type AND title.
//
// The second clause exists because one real-world task is sometimes split
// across several schedules that differ only in details — e.g. a dart-frog
// "Feed fruit flies" plan dusted with calcium on Mon/Thu and a separate "Feed
// fruit flies" plan dusted with multivitamin on Saturday. Saturday's feeding
// supersedes Thursday's even though they are different plans. Requiring the
// title as well as the type keeps genuinely different chores of one type (a
// "Clean water bowl" vs a "Spot clean") from overtaking each other.
//
// Ad-hoc tasks (no schedule) never supersede and are never superseded: they
// have no "next time".

/**
 * An SQL boolean expression, true when the care_tasks row aliased `self` has
 * been overtaken by a later scheduled occurrence of the same task that is due
 * on or before the single bound parameter (today, YYYY-MM-DD).
 *
 * `self` must be a trusted SQL identifier (a table alias written in code).
 */
export function supersededSql(self: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(self)) throw new Error(`Bad SQL alias: ${self}`);
  return (
    "EXISTS (SELECT 1 FROM care_tasks later" +
    ` WHERE later.animal_id = ${self}.animal_id` +
    " AND later.schedule_id IS NOT NULL" +
    ` AND ${self}.schedule_id IS NOT NULL` +
    ` AND later.due_date > ${self}.due_date` +
    " AND later.due_date <= ?" +
    ` AND (later.schedule_id = ${self}.schedule_id` +
    ` OR (later.task_type = ${self}.task_type AND later.title = ${self}.title)))`
  );
}
