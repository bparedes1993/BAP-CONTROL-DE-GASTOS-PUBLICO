'use strict';
(function(root){
const n=v=>Number(v)||0, round=v=>Math.round((v+Number.EPSILON)*100)/100;
const month=date=>String(date||'').slice(0,7);
function balance(debt,rows,expenses){const base=debt.data;let amount=n(base.balance);for(const e of expenses.filter(e=>!e.deleted&&e.credit_id===debt.id&&e.date>=base.date))amount+=n(e.amount);for(const r of rows.filter(r=>!r.deleted&&r.data.debt_id===debt.id&&r.data.date>=base.date)){if(r.kind==='disbursement'||r.kind==='charge')amount+=n(r.data.amount);if(r.kind==='payment')amount-=n(r.data.principal)}return round(Math.max(0,amount))}
function analyze(rows,expenses,period,day){rows=rows.filter(r=>!r.deleted&&(r.kind==='settings'||!r.data.date||r.data.date<=day));expenses=expenses.filter(e=>!e.deleted&&e.date<=day);const settings=rows.find(r=>r.kind==='settings')?.data||{};
const inMonth=rows.filter(r=>month(r.data.date)===period),directEarned=round(inMonth.filter(r=>r.kind==='income').reduce((a,r)=>a+n(r.data.amount),0));
const purchases=round(expenses.filter(e=>month(e.date)===period).reduce((a,e)=>a+n(e.amount),0));
const cashExpenses=round(expenses.filter(e=>month(e.date)===period&&!e.credit_id).reduce((a,e)=>a+n(e.amount),0));
const debts=rows.filter(r=>r.kind==='debt').map(r=>{const paid=inMonth.filter(x=>x.kind==='payment'&&x.data.debt_id===r.id).reduce((a,x)=>a+n(x.data.amount),0);const b=balance(r,rows,expenses);const required=Math.max(0,n(r.data.minimum));return {...r,balance:b,paid:round(paid),remaining:round(Math.min(b,Math.max(0,required-paid))),overdue:!!r.data.due&&r.data.due<day&&paid<required&&b>0}});
const receivables=rows.filter(r=>r.kind==='receivable').map(r=>({...r,balance:balance(r,rows,expenses)}));
const payments=round(inMonth.filter(r=>r.kind==='payment'&&debts.some(d=>d.id===r.data.debt_id)).reduce((a,r)=>a+n(r.data.amount),0));
const borrowed=round(inMonth.filter(r=>r.kind==='disbursement'&&debts.some(d=>d.id===r.data.debt_id)).reduce((a,r)=>a+n(r.data.amount),0));
const lent=round(inMonth.filter(r=>r.kind==='disbursement'&&receivables.some(d=>d.id===r.data.debt_id)).reduce((a,r)=>a+n(r.data.amount),0));
const recovered=round(inMonth.filter(r=>r.kind==='payment'&&receivables.some(d=>d.id===r.data.debt_id)).reduce((a,r)=>a+n(r.data.amount),0));
const interestEarned=round(inMonth.filter(r=>r.kind==='payment'&&r.data.principal!=null&&receivables.some(d=>d.id===r.data.debt_id)).reduce((a,r)=>a+Math.max(0,n(r.data.amount)-n(r.data.principal)),0));const earned=round(directEarned+interestEarned);
const pending=round(debts.reduce((a,d)=>a+d.remaining,0)),totalDebt=round(debts.reduce((a,d)=>a+d.balance,0));
const incomeBase=settings.income==null?earned:n(settings.income),cashBudget=Math.max(cashExpenses,n(settings.expenses));
const beforeReserve=round(incomeBase-cashBudget-payments-pending-lent),deficit=Math.max(0,-beforeReserve);
const reserve=round(Math.min(Math.max(0,beforeReserve),n(settings.reserve))),surplus=round(Math.max(0,beforeReserve-reserve));
const active=debts.filter(d=>d.balance>0);const missingRates=active.some(d=>d.data.tea==null),missingMinimums=active.some(d=>d.data.minimum==null),missingDates=active.some(d=>!d.data.due);
const strategy=settings.strategy||'avalanche';const ordered=[...active].sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(strategy==='snowball'?a.balance-b.balance:((b.data.tea??-1)-(a.data.tea??-1)))||a.balance-b.balance);
// A missing rate prevents claiming the cheapest order. A missing installment prevents a safe surplus estimate.
const planReady=!missingMinimums;let extra=planReady?round(surplus*(active.length?Math.min(100,Math.max(0,n(settings.debtPercent??80)))/100:0)):0;
const allocations=[];let unassigned=extra;for(const d of ordered){const payment=Math.min(unassigned,Math.max(0,d.balance-d.remaining));if(payment>0)allocations.push({id:d.id,name:d.data.name,extra:round(payment)});unassigned=round(unassigned-payment)}extra=round(extra-unassigned);
const savings=planReady?round(surplus-extra):0;
const warnings=[];if(settings.income==null&&earned===0)warnings.push('Registra ingresos cobrados o define un ingreso mensual para el escenario.');if(!settings.expenses)warnings.push('Completa tu presupuesto de gastos por efectivo/débito para no sobreestimar el excedente.');if(deficit>0)warnings.push('El presupuesto no cubre todos los gastos y pagos obligatorios. Reduce gastos revisables y consulta a tus acreedores antes de incumplir; no hay excedente para invertir.');if(missingMinimums)warnings.push('Faltan cuotas o pagos mínimos. Completa esos importes antes de distribuir dinero adicional.');if(missingRates&&strategy==='avalanche')warnings.push('Faltan tasas TEA: el orden por costo es provisional y no demuestra cuál deuda es más cara.');if(missingDates)warnings.push('Faltan próximos vencimientos. No se pueden revisar todos los atrasos.');if(debts.some(d=>d.overdue))warnings.push('Hay vencimientos pendientes: confirma el monto vencido y posibles cargos con la entidad antes de aplicar abonos adicionales.');if(debts.some(d=>d.data.type==='card'&&d.data.limit>0&&d.balance>d.data.limit))warnings.push('Una tarjeta supera el límite registrado; revisa saldo, cargos y línea de crédito.');
if(rows.some(r=>r.kind==='payment'&&r.data.principal==null))warnings.push('Hay pagos sin desglose de capital. El efectivo sale o entra, pero el saldo no baja hasta registrar el capital o actualizar la fecha base.');
const totalRequired=debts.reduce((a,d)=>a+Math.min(d.balance,n(d.data.minimum)),0);
return {settings,earned,purchases,cashExpenses,payments,borrowed,lent,recovered,directEarned,interestEarned,cashFlow:round(directEarned+borrowed+recovered-cashExpenses-payments-lent),debts,receivables,totalDebt,pending,incomeBase,cashBudget,reserve,surplus,deficit,extra,savings,allocations,ordered,warnings,planReady,missingRates,ratio:incomeBase>0?totalRequired/incomeBase:null};}
function project(debt,extra){if(debt.data.tea==null||debt.data.minimum==null)return {status:'missing'};const rate=Math.pow(1+n(debt.data.tea)/100,1/12)-1,payment=n(debt.data.minimum)+n(extra);let amount=debt.balance,totalInterest=0;if(amount<=0)return {status:'paid',months:0,interest:0};if(payment<=amount*rate||payment<=0)return {status:'insufficient'};for(let i=1;i<=600;i++){const interest=amount*rate;totalInterest+=interest;amount=Math.max(0,amount+interest-payment);if(amount<.005)return {status:'estimated',months:i,interest:round(totalInterest)}}return {status:'long'}}
function validRecord(r){
const kinds=['income','debt','receivable','payment','disbursement','charge','settings'];
if(!r||!kinds.includes(r.kind)||!r.data||typeof r.data!=='object'||Array.isArray(r.data)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(r.id)||JSON.stringify(r.data).length>16000)return false;
const d=r.data,goodDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
if(r.kind!=='settings'&&!goodDate(d.date))return false;
if(d.due&&!goodDate(d.due))return false;
if(['income','debt','receivable'].includes(r.kind)&&(typeof d.name!=='string'||!d.name.trim()||d.name.length>100))return false;
for(const key of ['amount','principal','balance','minimum','tea','limit','cut','income','expenses','reserve','emergency','targetMonths','debtPercent'])if(d[key]!=null&&(!Number.isFinite(d[key])||d[key]<0||d[key]>999999999))return false;
if(['income','payment','disbursement','charge'].includes(r.kind)&&!(d.amount>0))return false;
if(['debt','receivable'].includes(r.kind)&&d.balance==null)return false;
if(d.principal!=null&&d.principal>d.amount)return false;
if(d.tea!=null&&d.tea>2000)return false;if(d.debtPercent!=null&&d.debtPercent>100)return false;
if(d.cut!=null&&(!Number.isInteger(d.cut)||d.cut<1||d.cut>31))return false;
if(d.targetMonths!=null&&(!Number.isInteger(d.targetMonths)||d.targetMonths>24))return false;
if(d.note!=null&&(typeof d.note!=='string'||d.note.length>200))return false;
if(['payment','disbursement','charge'].includes(r.kind)&&!(/^[0-9a-f-]{36}$/i).test(d.debt_id||''))return false;
return true;}
const api={analyze,balance,project,round,validRecord};root.BAP_FINANCE_MODEL=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
