const assert = require('node:assert/strict');
const M = require('./finance-model');
for (const [date,cut,pay,expected] of [
 ['2026-10-04',5,20,'2026-10-20'],['2026-10-05',5,20,'2026-10-20'],['2026-10-06',5,20,'2026-11-20'],
 ['2026-12-26',25,10,'2027-02-10'],['2026-12-25',25,10,'2027-01-10'],
 ['2026-02-28',31,15,'2026-03-15'],['2028-02-29',31,15,'2028-03-15'],
 ['2026-02-06',5,31,'2026-03-31'],['2026-02-05',5,31,'2026-02-28']
]) assert.equal(M.cardDueDate(date,cut,pay),expected);
for (const args of [['2026-10-01',null,20],['2026-02-30',5,20],['bad',5,20],['2026-10-01',5,32]]) assert.equal(M.cardDueDate(...args),null);
console.log('Card cycles passed: cutoff boundaries, short months, leap years, rollover and invalid dates.');
