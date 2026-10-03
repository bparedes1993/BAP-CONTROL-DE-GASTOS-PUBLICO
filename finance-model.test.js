const assert=require('node:assert/strict');const {analyze,balance,project}=require('./finance-model');
const entry=(id,kind,data)=>({id,kind,data,deleted:false});const date='2026-10-01',period='2026-10';
const card=entry('card','debt',{name:'Tarjeta A',type:'card',balance:1000,date,minimum:100,tea:30,due:'2026-10-15',limit:2000});
const loan=entry('loan','receivable',{name:'Por cobrar',balance:200,date,minimum:50});
const income=entry('i','income',{amount:3000,date});const settings=entry('s','settings',{expenses:1500,reserve:200,debtPercent:80,strategy:'avalanche'});
const payment=entry('p','payment',{debt_id:'card',date,amount:120,principal:100});const disb=entry('b','disbursement',{debt_id:'card',date,amount:500});const recover=entry('r','payment',{debt_id:'loan',date,amount:50,principal:40});
const expenses=[{date,amount:100,credit_id:'card'},{date,amount:300}];let rs=[card,loan,income,settings,payment,disb,recover];let a=analyze(rs,expenses,period,'2026-10-03');
assert.equal(a.earned,3010);assert.equal(a.totalDebt,1500);assert.equal(a.purchases,400);assert.equal(a.cashExpenses,300);assert.equal(a.cashFlow,3130);assert.equal(a.receivables[0].balance,160);assert.equal(a.pending,0);assert.equal(a.extra,952);assert.equal(a.savings,238);
assert.equal(balance(card,rs,expenses),1500);assert.equal(balance(card,[...rs,{...payment,deleted:true}],expenses),1500);
// Loan proceeds do not increase the income base or debt-repayment allocation.
assert.equal(analyze(rs.filter(r=>r.id!=='b'),expenses,period,'2026-10-03').incomeBase,a.incomeBase);
let deficit=analyze([card,entry('i','income',{amount:100,date}),settings],[],period,'2026-10-03');assert.equal(deficit.extra,0);assert.equal(deficit.savings,0);assert.ok(deficit.deficit>0);
let missing=analyze([{...card,data:{...card.data,minimum:null}},income,settings],[],period,'2026-10-03');assert.equal(missing.planReady,false);assert.equal(missing.extra,0);assert.equal(missing.savings,0);
assert.equal(analyze([{...card,data:{...card.data,tea:null}},income,settings],[],period,'2026-10-03').missingRates,true);
assert.equal(project({...card,balance:1000,data:{...card.data,tea:0,minimum:100}},0).months,10);
assert.equal(project({...card,balance:1000,data:{...card.data,tea:120,minimum:1}},0).status,'insufficient');
assert.equal(project({...card,balance:1000,data:{...card.data,tea:null}},0).status,'missing');
assert.equal(analyze(rs,expenses,'2026-11','2026-11-03').earned,0);
assert.equal(analyze([card,entry('p','payment',{date,amount:100,principal:null,debt_id:'card'})],[],period,'2026-10-03').totalDebt,1000);
// Allocation never exceeds remaining principal or the available surplus.
for(const amount of [0,500,1000,3000,10000]){const r=analyze([card,entry('i','income',{date,amount}),settings],[],period,'2026-10-03');assert.ok(r.extra<=r.surplus);assert.ok(r.extra<=Math.max(0,r.totalDebt-r.pending));assert.ok(r.savings>=0)}
console.log('Financial scenarios: passed');

assert.equal(analyze([entry('future','income',{date:'2026-10-20',amount:9000})],[],period,'2026-10-03').earned,0);
assert.equal(analyze([card],[{date:'2026-10-20',amount:100,credit_id:'card'}],period,'2026-10-03').totalDebt,1000);
const uuid='00000000-0000-4000-8000-000000000001';const {validRecord}=require('./finance-model');assert.equal(validRecord(entry(uuid,'income',{name:'Sueldo',date,amount:3000})),true);assert.equal(validRecord(entry(uuid,'income',{name:'Error',date:'2026-02-30',amount:3000})),false);assert.equal(validRecord(entry(uuid,'payment',{date,amount:100,principal:101,debt_id:uuid})),false);
