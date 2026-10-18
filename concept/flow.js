/* Journey engine: one flow definition, rendered as the living map, the focus card, the side panel and the client lens.
   Built on the firm's process guide (lead to won + the 28 design-to-warranty steps, 16 Oct 2026). */
(function(){
  'use strict';

  const PK = {
    concept:{label:'Concept', rate:10000, unit:'space', renders:false, cd:false, lead:'Interior designer',
      incl:['Dedicated designer','Consultation','Site visits','Mood boards','2D concept design','Space planning'], off:['3D renders','Material selection']},
    bespoke:{label:'Bespoke interior design', short:'Bespoke', rate:40, unit:'sqft', renders:true, cd:false, lead:'Lead interior designer',
      incl:['Everything in Concept','3D renders by the visualiser'], off:['Material selection']},
    director:{label:'Designed by the creative director', short:'Creative director', rate:100, unit:'sqft', from:true, renders:true, cd:true, lead:'Creative director',
      incl:['Director-led, same as Bespoke','Creative director chooses the lead designer','Creative director reviews before the client sees anything'], off:['Material selection']}
  };
  const FLOWS = {fof:{label:'Full ID, Fit-Out & Furniture', short:'Full ID + fit-out'}, id:{label:'Full ID (design only)', short:'Full ID'}, fu:{label:'Furniture only', short:'Furniture'}};
  const ROLES = {client:'Client', sa:'Sales admin', am:'Account manager', des:'Interior designer', cd:'Creative director', vis:'Visualiser', mc:'Material coordinator', tech:'Technical', qs:'QS', fin:'Finance', own:'Owner', ops:'Operations'};
  const SHORT = {client:'CL', sa:'SA', am:'AM', des:'ID', cd:'CD', vis:'VI', mc:'MC', tech:'TE', qs:'QS', fin:'FI', own:'OW', ops:'OP'};
  const LANES = ['client','sa','am','des','cd','vis','mc','tech','qs','fin','own','ops'];
  const CH = [{id:'win',label:'Win'},{id:'design',label:'Design'},{id:'price',label:'Price'},{id:'make',label:'Make'},{id:'install',label:'Install'},{id:'care',label:'Care'}];
  const CLIENT_CH = c => ({win: c.flow === 'fu' ? 'Welcome' : 'Proposal', design:'Design', price: c.flow === 'fu' ? 'Quotation' : 'Estimate', make:'Production', install:'Installation', care: c.flow === 'id' || c.q2 === 'withdrawn' ? 'Complete' : 'Aftercare'});
  const ITEMS = [
    ['Living room sofa','Bespoke furniture',true,true], ['TV wall','Joinery',true,true], ['Kitchen cabinets','Joinery',true,true], ['Wardrobe M1','Joinery',true,true],
    ['Dining table','Core Collection',false,true], ['Pendant lights ×3','Supplier',false,false], ['Curtains','Supplier',false,false], ['Rug','Supplier',false,false]
  ]; /* name, type, needs drawings, made in factory */
  const STAGES = ['List','Drawing','Signed','Margin','Released','Ready','Insp. 2','Delivered'];

  const all = () => true;
  const design = c => c.flow !== 'fu';
  const prodFull = c => c.flow === 'fof' && c.q2 !== 'withdrawn';
  const prodAny = c => prodFull(c) || c.flow === 'fu';
  const designEnd = c => c.flow === 'id' || (c.flow === 'fof' && c.q2 === 'withdrawn');
  const renders = c => design(c) && PK[c.pkg].renders;
  const isCD = c => design(c) && PK[c.pkg].cd;

  /* A step: ch chapter · role lane · d usual days · auto runs by itself · opt only if needed · gate checklist that blocks · deal pill · per item stage · rev counts free revisions · kind = client card */
  const STEPS = [
    {id:'inq', ch:'win', role:'sa', d:0, auto:true, name:'Enquiry in', verb:'Enquiry created from the form', done:'Source and channel set by the form · T1 sent automatically · duplicate check passed', inc:all,
      ai:{t:'No open lead or past client with this mobile or email. Not spam. Source: WhatsApp → form.', src:['Duplicate check','Spam check'], c:'99%'}},
    {id:'assign', ch:'win', role:'am', d:0, auto:true, name:'Round-robin', verb:'Assigned to the next account manager', done:'Account manager notified · only they see it · 1 working hour starts', inc:all},
    {id:'contact', ch:'win', role:'am', d:0, name:'First contact', verb:'Log the first contact', done:'Activity logged within 1 working hour (Mon–Fri 9:00–18:00) with an outcome', outcomes:true, inc:all,
      ai:{t:'Reply drafted in the client’s language. If nobody logs activity by 10:42, the enquiry moves to the next account manager and both are told.', src:['Working hours','Round-robin'], c:''}},
    {id:'convert', ch:'win', role:'am', d:1, name:'Convert', verb:'Convert to opportunity', done:'Opportunity O-0231 created', cta:'Convert',
      gate:c => ({title:'Convert to opportunity', items:[
        ['Enquiry type set, no TBC', true],
        ['Client email', false, 'Found in the WhatsApp chat: n.***@mail.com'],
        ['Emirate, area and full address', true],
        c.flow === 'fu' ? ['Floor plan: not required (furniture)', true] : ['Floor plan or BUA estimate', false, 'Client said “3-bed villa, about 1,200 sq ft” → estimate + task to get the real plan before the site visit'],
        ['Project type and budget range', true]]}), inc:all},
    {id:'book', ch:'win', role:'am', d:1, name:'Book intro', verb:'Book “Intro” in the lead designer’s calendar', done:'In person or online · intro deck page 3 filled from the requirement fields', client:'Intro meeting booked', cta:'Book intro', inc:design,
      ai:{t:'Intro deck page 3 filled from the requirement fields and saved as PDF. Lead designer free Tue 11:00 or Wed 15:00.', src:['Requirement fields','Design calendar'], c:''}},
    {id:'intro', ch:'win', role:'am', d:2, name:'Intro meeting', verb:'Run the intro (designer attends)', done:'Actual BUA, number of spaces and chosen package logged → proposal 1 drafted · no timeline promised', cta:'Open Present mode', inc:design,
      ai:{t:c => 'From the meeting notes: BUA ' + nf.format(cur.sqft) + ' sq ft, ' + cur.spaces + ' spaces, ' + (PK[c.pkg].short || PK[c.pkg].label) + ' chosen. Proposal 1 drafted.', src:['Meeting notes','Present mode'], c:'91%'}},
    {id:'qual', ch:'win', role:'am', d:1, name:c => c.flow === 'fu' ? 'Qualified (auto)' : 'Qualified', verb:'Record the outcome', done:c => c.flow === 'fu' ? 'Auto-passed for stock, supplier and Core Collection items' : 'Outcome recorded: ' + FLOWS[c.flow].label, auto:c => c.flow === 'fu', cta:'Move to Proposal',
      gate:c => c.flow === 'fu' ? null : ({title:'Qualified → Proposal', items:[
        ['Outcome: ' + FLOWS[c.flow].label, true], ['Client type set, no TBC', true],
        ['Target completion date', false, 'Client said “before Ramadan” → 15 Feb 2027'], ['Consultation answers and exact figures', true]]}), inc:all},
    {id:'prop1', ch:'win', role:'am', d:1, name:'Proposal 1', verb:'Send proposal 1 · design fee', done:'Delivered and opened · valid 7 days · design fee skips QS', client:'Your design proposal is ready', cta:'Review and send', inc:design,
      ai:{t:c => 'Drafted from “Design fee proposal”: ' + feeText(c) + '. 100% before design starts.', src:['Package','BUA','Template'], c:''}},
    {id:'nego', ch:'win', role:'am', d:2, opt:true, name:'Negotiation', verb:'Negotiate, only if needed', done:'A clear yes or no · every value-engineering version kept', cta:'Agreed', inc:design,
      ai:{t:'Client asked for fewer spaces. Version 2 drafted. Value engineering: 2 rounds free, charged from the 3rd.', src:['Chat'], c:''}},
    {id:'acc1', ch:'win', role:'client', kind:'accept', d:2, name:'Accept proposal 1', verb:'Client accepts proposal 1', act:'Accept with code', done:'Accepted with a one-time code', inc:design},
    {id:'pay1', ch:'win', role:'client', kind:'pay', amt:c => fee(c), d:2, name:'Pay design fee', verb:'Client pays the design fee', act:'Pay or upload proof', done:'Payment proof attached → Won · deal file created automatically', inc:design},
    {id:'fin1', ch:'win', role:'fin', d:1, name:'Finance check', verb:'Add net, VAT, total, method and commission', done:'Net · VAT 5% · total · payment method · commission for up to 3 people', cta:'Submit to owner', inc:design,
      ai:{t:c => 'Proof read: ' + money(fee(c)) + ' · bank transfer · ref FT2410 · 14 Oct. Net and VAT 5% split. Commission suggested from the deal team.', src:['proof.pdf'], c:'98%'}},
    {id:'own1', ch:'win', role:'own', d:1, name:'Owner approval', verb:'Approve deal 1', done:'Deal approved · deal file locked', deal:'Deal 1 won', cta:'Approve', inc:design,
      ai:{t:'Deal file complete: proof, finance figures and commission present. Nothing missing.', src:['Deal file'], c:''}},

    {id:'team', ch:'design', role:'am', d:1, name:'Allocate team', verb:'Allocate the design team', done:c => (isCD(c) ? 'Creative director chose the lead designer · ' : '') + 'Lead/junior designer, sales admin' + (renders(c) ? ', visualiser' : '') + (prodFull(c) ? ', material coordinator' : '') + ' · client sees “Interior designer”', client:'Meet your interior designer', cta:'Save team', inc:design,
      ai:{t:'Least-loaded lead designer: 2 active jobs. Visualiser free from 28 Oct.', src:['Design workload'], c:''}},
    {id:'inspo', ch:'design', role:'des', d:7, name:'Inspiration week', verb:'Run the inspiration week in the portal', done:'1 week · all messages and minutes in the portal, no WhatsApp · weekly update by call or portal', client:'Inspiration week: share what you love', cta:'Close the week', inc:design},
    {id:'kick', ch:'design', role:'des', d:2, name:'Kick-off', verb:'Hold the kick-off meeting', done:'Brief confirmed · render sign-off agreed · minutes in the portal', client:'Kick-off minutes posted', cta:'Post minutes', inc:design,
      ai:{t:'Minutes drafted from the recording; 4 decisions and 2 open questions.', src:['Recording 38 min'], c:''}},
    {id:'measure', ch:'design', role:'des', d:3, name:'Site measure', verb:'Do the design site measure', done:'Within 3 days of kick-off · measurements and photos filled in · questions optional', cta:'Complete measure', inc:design,
      ai:{t:'From the voice note and 18 photos: 9 measurements and 14 of 22 answers drafted. 5 need a look.', src:['Voice note 4:12','18 photos'], c:'76%'}},
    {id:'mood', ch:'design', role:'des', d:5, rev:true, name:'Mood boards', verb:'Share 2 mood board options', done:'Client chose one in the portal', client:'Choose your mood board', kindC:'two', cta:'Share with client', inc:design,
      ai:{t:'Two options drafted from the inspiration images the client loved.', src:['Inspiration board'], c:''}},
    {id:'space', ch:'design', role:'des', d:4, name:'Space planning', verb:'Upload the space plan', done:'PDF on the Design tab · no client approval · needs the site measure', cta:'Upload plan', inc:design},
    {id:'c2d', ch:'design', role:'des', d:7, rev:true, name:'2D concept', verb:'Share the 2D concept', done:'Client approved in the portal', client:'Approve your 2D concept', cta:'Share with client', inc:design},
    {id:'render', ch:'design', role:'vis', d:14, rev:true, name:'3D renders', verb:'Produce the 3D renders', done:c => (isCD(c) ? 'Creative director' : 'Lead designer') + ' approved, then sent · client approved in the portal', client:'Your 3D renders are ready', cta:'Send for approval', inc:renders,
      ai:{t:'Found 23 items in the renders and listed them for the material selection.', src:['Renders v2'], c:'84%'}},
    {id:'cdr', ch:'design', role:'cd', d:2, name:'CD review', verb:'Creative director reviews concepts and renders', done:'Approved before anything reaches the client', cta:'Approve', inc:isCD},
    {id:'mats', ch:'design', role:'mc', d:3, name:'Material selection', verb:'Hold the samples meeting', done:'Chosen material saved per item · outsourced materials need creative director sign-off', client:'Confirm your materials', kindC:'swatch', cta:'Save selections', inc:prodFull,
      ai:{t:'7 of 8 choices matched to library codes. 1 outsourced fabric sent to the creative director.', src:['Meeting photos','Material library'], c:'90%'}},
    {id:'frender', ch:'design', role:'vis', d:5, opt:true, name:'Final render', verb:'Update the render to the chosen materials, if asked', done:'Only when the client asks', cta:'Share', inc:c => prodFull(c) && renders(c)},
    {id:'dapp', ch:'design', role:'client', kind:'sign', d:3, name:'Design approval', verb:'Client signs the design approval', act:'Sign with code', done:c => designEnd(c) ? 'Signed → job completes with a thank-you message' : 'Signed → the quotation can start', inc:design},
    {id:'done', ch:'care', role:'am', d:0, auto:true, name:'Completed', verb:'Complete and thank the client', done:'Completed at design handover · thank-you sent by portal and email · final files in the portal', deal:'Deal 1 closed', client:'Your design is complete', inc:designEnd},

    {id:'quote', ch:'price', role:'sa', d:3, name:'Quotation', verb:'Build the quotation', done:'Pricing request sheet format · L/H/D from the site measure (joinery) or Core Collection size', cta:'Send to QS', inc:prodAny,
      ai:{t:'46 lines drafted from the renders and chosen materials. 3 need a price.', src:['Renders','Material selection'], c:''}},
    {id:'est', ch:'price', role:'qs', d:2, name:'Estimate', verb:'Price every line', done:c => c.flow === 'fu' ? 'Only for bespoke or joinery; standard furniture skips QS' : 'Every line priced · value engineering with the lead designer if over budget', cta:'Priced', inc:prodAny,
      ai:{t:'Margin 31% against a 30% target. 2 lines below the cost floor.', src:['Cost book'], c:''}},
    {id:'mgr', ch:'price', role:c => c.flow === 'fu' ? 'am' : 'des', d:1, name:'Manager approval', verb:'Approve after pricing', done:'Nothing can be attached to the proposal before this', cta:'Approve', inc:prodAny},
    {id:'eprop', ch:'price', role:'am', d:1, name:'Estimate proposal', verb:'Send the estimate proposal', done:'Generated with its own ref linked to the quotation · valid 7 days', client:'Your estimate is ready', cta:'Send',
      gate:c => ({title:'Before it goes out', items:[['Manager approval', true], ['Discount approved by the creative director', false, '8% discount → sent to the creative director, approved'], ['Ref linked to the quotation (rev 1)', true]]}), inc:prodAny},
    {id:'sign2', ch:'price', role:'client', kind:'accept', d:3, name:'Sign estimate', verb:'Client signs the estimate proposal', act:'Sign with code', done:'Signed · changes loop back through quotation, estimate and approval · every version kept', q2:true, inc:prodAny},
    {id:'pay2', ch:'price', role:'client', kind:'pay', amt:() => 154600, d:3, name:'Pay + agreement', verb:'Client pays and signs the payment agreement', act:'Pay or upload proof', done:'Stages, amounts, due dates, method and signed proposal captured', q2:true, inc:prodAny},
    {id:'fin2', ch:'price', role:'fin', d:1, name:'Received', verb:'Mark Received / Approved', done:'Receipt issued · quotation locked · invoices and reminders follow the schedule', cta:'Received / Approved', inc:prodAny,
      ai:{t:'2 proofs read: card AED 100,000 and cheque AED 54,600. Together they settle stage 1.', src:['card-slip.jpg','cheque.jpg'], c:'97%'}},
    {id:'own2', ch:'price', role:'own', d:1, name:'Owner approval', verb:'Approve the deal', done:'Nothing moves to production before this', deal:c => c.flow === 'fu' ? 'Deal won' : 'Deal 2 won', cta:'Approve', inc:prodAny},

    {id:'mlist', ch:'make', role:'mc', d:3, item:0, name:'Material list', verb:'Fill the material list', done:'Material, brand, code, colour, size, finish, supplier and sample photo per item · QS builds the internal BOQ', cta:'List complete', inc:prodFull,
      ai:{t:'Codes and suppliers carried over from the material selection. Internal BOQ built from the estimate lines.', src:['Material selection','Estimate'], c:''}},
    {id:'tech', ch:'make', role:'tech', d:7, item:1, name:'Technical', verb:'Assign technical drawings per item', done:'Assigned from the names list (no login) with due dates · joinery cross-check visit first · technical never contacts the client', cta:'Drawings in', inc:prodFull,
      ai:{t:'Upload links sent to 2 outside draftsmen. Cross-check visit booked for 4 joinery items.', src:['Names list','Calendar'], c:''}},
    {id:'draw', ch:'make', role:'client', kind:'drawings', d:3, item:2, name:'Drawing sign-off', verb:'Client signs each drawing', act:'Sign drawings', done:'Lead designer checks, client signs, item locks · L/H/D and quantities update', inc:prodFull},
    {id:'margin', ch:'make', role:'qs', d:1, item:3, name:'Margin check', verb:'Check each item’s margin', done:'Below margin → held until resolved', cta:'Release held items', inc:prodFull,
      ai:{t:'2 items fell below margin after the final drawings. Held.', src:['Drawings','Cost book'], c:''}},
    {id:'release', ch:'make', role:'ops', d:3, item:4, name:'Release', verb:'Release items to procurement', done:'Ordered or taken from stock · supplies signed off · PM and factory lead told', cta:'Supplies signed off', inc:prodAny},
    {id:'factory', ch:'make', role:'ops', d:21, item:5, name:'Factory', verb:'Build, inspect, mark Ready', done:'Persons booked per item (no login) · Ready/Done · inspections 1 and 2 by the lead designer', cta:'Inspection 2 passed', inc:prodFull,
      ai:{t:'Veneer delayed 4 days by the supplier. Client message drafted for review.', src:['Supplier email'], c:''}},

    {id:'pre', ch:'install', role:'ops', d:2, name:'Pre-install check', verb:'Check before dispatch', done:'All items ready · design check · permit · crew and vehicles booked', cta:'Dispatch',
      gate:c => ({title:'Dispatch', items:[['All items Ready', true], c.flow === 'fu' ? ['Delivery slot confirmed', true] : ['Inspection 2 passed', true], ['Permit valid for the install date', false, 'Permit expires 3 Nov → renewal task for the tagged person, done'], ['Crew, driver and vehicle booked', true]]}), inc:prodAny},
    {id:'deliver', ch:'install', role:'ops', d:c => c.flow === 'fu' ? 2 : 10, item:7, name:c => c.flow === 'fu' ? 'Delivery' : 'Deliver + install', verb:'Deliver and install', done:'Per item: delivery only or delivery + installation · delivery photos are the proof · one person on site has a login', client:'Delivery photos', cta:'All delivered', inc:prodAny},
    {id:'site', ch:'install', role:'ops', d:5, name:'Site work', verb:'Run site work', done:'Daily reports reviewed by the PM · change requests priced by QS, approved and paid in the portal first', client:'Daily update from site', cta:'Site work done', inc:prodFull,
      ai:{t:'Walkthrough video → today’s report and 3 snags pinned to rooms.', src:['Video 2:40'], c:''}},
    {id:'snag', ch:'install', role:'ops', d:4, name:'Snags', verb:'Close the snags', done:'Anyone can raise one · closed with an after photo · open snags block handover', cta:'All closed', inc:prodFull,
      ai:{t:'5 of 6 snags look closed in the after photos. 1 needs a second look.', src:['After photos'], c:'85%'}},
    {id:'hand', ch:'install', role:'client', kind:'handover', d:2, name:'Handover', verb:'Client accepts the handover', act:'Accept handover', done:'Handover pack accepted per room · signed form · “On handover” invoice sent', deal:'Completed', inc:prodAny},
    {id:'warr', ch:'care', role:'ops', d:2, name:'Warranty', verb:'Run warranty and claims', done:'Per item, default 6 months from installation · claims decided by the PM: fix, call-out fee or reject', client:'Warranty: 6 months per item', cta:'Set up', inc:prodAny}
  ];

  /* helpers */
  const nf = new Intl.NumberFormat('en', {maximumFractionDigits:0});
  const money = n => 'AED ' + nf.format(n);
  const cur = {spaces:3, sqft:1200};
  const fee = c => PK[c.pkg].rate * (PK[c.pkg].unit === 'space' ? cur.spaces : cur.sqft);
  const feeText = c => (PK[c.pkg].unit === 'space' ? cur.spaces + ' spaces × ' : nf.format(cur.sqft) + ' sq ft × ') + money(PK[c.pkg].rate) + ' = ' + money(fee(c));
  const val = (x, c) => typeof x === 'function' ? x(c) : x;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const listFor = c => STEPS.filter(s => s.inc(c));
  const roleOf = (s, c) => val(s.role, c);
  const START = Date.UTC(2026, 9, 1);
  const dfmt = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', timeZone:'UTC'});
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const P = d => '<svg class="i" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const IC = {
    ok:P('<path class="ic-ok" d="M5 12.5l4.2 4.2L19 7"/>'),
    x:P('<path class="ic-x" d="M6 6l12 12M18 6L6 18"/>'),
    lock:P('<rect class="ic-lk" x="6" y="11" width="12" height="9" rx="2" stroke-width="2"/><path class="ic-lk" stroke-width="2" d="M9 11V8a3 3 0 016 0v3"/>'),
    auto:P('<path class="ic-auto" d="M13 3L5 14h6l-1 7 8-11h-6z" stroke-width="2"/>')
  };
  const SPARK = '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z"/></svg>';
  function ensureDefs(){
    if (document.getElementById('aigrad')) return;
    const d = document.createElement('div');
    d.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="aigrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--ai-1)"/><stop offset="1" stop-color="var(--ai-2)"/></linearGradient></defs></svg>';
    document.body.appendChild(d.firstChild);
  }
  let toastT;
  function toast(msg){
    let t = document.getElementById('j-toast');
    if (!t) { t = document.createElement('div'); t.id = 'j-toast'; t.className = 'j-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function wrap(t, n){ const w = String(t).split(' '); const lines = []; let c = ''; w.forEach(x => { const nx = (c + ' ' + x).trim(); if (nx.length > n && c) { lines.push(c); c = x; } else c = nx; }); if (c) lines.push(c); return lines.slice(0, 2); }

  /* per-item status at the current step: done · now · held · todo · na */
  function itemCell(L, idx, itemIdx, stage){
    const it = ITEMS[itemIdx];
    const span = s => s.item === 5 ? [5, 6] : [s.item];
    const inFlow = new Set(); L.forEach(s => { if (s.item != null) span(s).forEach(k => inFlow.add(k)); });
    if (!inFlow.has(stage)) return 'na';
    if ((stage === 1 || stage === 2) && !it[2]) return 'na';
    if ((stage === 5 || stage === 6) && !it[3]) return 'na';
    if (idx >= L.length) return 'done';
    let doneUpTo = -1, active = null;
    L.forEach((s, i) => { if (s.item == null) return; if (i < idx) doneUpTo = Math.max(doneUpTo, ...span(s)); else if (i === idx) active = span(s); });
    if (stage <= doneUpTo) return 'done';
    if (!active || !active.includes(stage)) return 'todo';
    const k = itemIdx % 3;
    if (stage === 3 && (itemIdx === 1 || itemIdx === 4)) return 'held';
    if (stage === 6) return k === 0 ? 'now' : 'todo';
    return k === 0 ? 'done' : (k === 1 ? 'now' : 'todo');
  }

  function mapSvg(L, st, opts){
    const c = st.ctx(); const live = !opts.small;
    const lanes = LANES.filter(r => L.some(s => roleOf(s, c) === r));
    const LW = opts.small ? 118 : 132, COL = opts.small ? 98 : 120, NW = opts.small ? 86 : 106, NH = opts.small ? 32 : 38, LH = opts.small ? 42 : 54, TOP = 30, PAD = 14;
    const W = LW + L.length * COL + PAD, H = TOP + lanes.length * LH + PAD;
    const nx = i => LW + i * COL + (COL - NW) / 2;
    const cy = r => TOP + lanes.indexOf(r) * LH + LH / 2 - (live ? 5 : 0);
    const D = live ? st.dates(L) : null;
    const chs = st.chapters(L);
    const mk = 'arr' + (opts.small ? 's' : '') + st.uid;
    let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Journey map: lanes are roles, bands are chapters">';
    s += '<defs><marker id="' + mk + '" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="m-arrow" d="M0,0 L8,4 L0,8 z"/></marker></defs>';
    chs.forEach((ch, k) => {
      const x = LW + ch.f * COL, w = (ch.l - ch.f + 1) * COL;
      s += '<rect class="m-band' + (k % 2 ? ' alt' : '') + '" x="' + x + '" y="0" width="' + w + '" height="' + H + '"/>';
      s += '<text class="m-ch' + (live && ch.st === 'now' ? ' now' : '') + '" x="' + (x + 8) + '" y="19">' + esc(ch.label) + (live && ch.st === 'done' ? ' ✓' : '') + '</text>';
    });
    lanes.forEach((r, k) => {
      const y = TOP + k * LH;
      if (k) s += '<line class="m-lane-line" x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="m-lane' + (r === 'client' ? ' client' : '') + '" x="10" y="' + (cy(r) + 4) + '">' + esc(ROLES[r]) + '</text>';
    });
    if (live && st.idx < L.length) {
      const tx = nx(st.idx) + NW / 2;
      s += '<line class="m-today" x1="' + tx + '" x2="' + tx + '" y1="24" y2="' + (H - 4) + '"/><text class="m-today-t" x="' + (tx + 4) + '" y="' + (H - 6) + '">NOW</text>';
    }
    for (let i = 0; i < L.length - 1; i++) {
      const x1 = nx(i) + NW, y1 = cy(roleOf(L[i], c)), x2 = nx(i + 1), y2 = cy(roleOf(L[i + 1], c)), mx = (x1 + x2) / 2;
      s += '<path class="m-edge' + (live && i + 1 <= st.idx ? ' done' : '') + '" d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + (x2 - 2) + ' ' + y2 + '" marker-end="url(#' + mk + ')"/>';
    }
    const slip = st.slip();
    L.forEach((stp, i) => {
      const r = roleOf(stp, c), x = nx(i), y = cy(r) - NH / 2, cxn = x + NW / 2;
      const ph = !live ? 'next' : (i < st.idx ? 'done' : i === st.idx ? 'now' : 'next');
      const cls = ph + (r === 'client' ? ' client' : '') + (val(stp.auto, c) ? ' auto' : '') + (stp.opt ? ' opt' : '') + (live && st.view === i ? ' sel' : '');
      s += '<g class="m-node ' + cls + '"' + (live ? ' data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc(val(stp.name, c)) + '"' : '') + '>';
      if (live && ph === 'now') s += '<rect class="m-ring" x="' + (x - 5) + '" y="' + (y - 5) + '" width="' + (NW + 10) + '" height="' + (NH + 10) + '" rx="12"/>';
      if (stp.item != null) s += '<rect class="stk" x="' + (x + 5) + '" y="' + (y - 5) + '" width="' + NW + '" height="' + NH + '" rx="9"/><rect class="stk" x="' + (x + 2.5) + '" y="' + (y - 2.5) + '" width="' + NW + '" height="' + NH + '" rx="9"/>';
      s += '<rect class="b" x="' + x + '" y="' + y + '" width="' + NW + '" height="' + NH + '" rx="9"/>';
      const nm = val(stp.name, c);
      if (live) {
        s += '<circle class="avc" cx="' + (x + 15) + '" cy="' + (y + NH / 2) + '" r="9"/><text class="ini" x="' + (x + 15) + '" y="' + (y + NH / 2 + 3) + '" text-anchor="middle">' + SHORT[r] + '</text>';
        const lines = wrap(nm, 11), tx = x + 29;
        if (lines.length === 1) s += '<text class="nm" x="' + tx + '" y="' + (y + NH / 2 + 4) + '">' + esc(lines[0]) + '</text>';
        else s += '<text class="nm" x="' + tx + '" y="' + (y + NH / 2 - 2) + '">' + esc(lines[0]) + '</text><text class="nm" x="' + tx + '" y="' + (y + NH / 2 + 10) + '">' + esc(lines[1]) + '</text>';
      } else {
        const lines = wrap(nm, 12);
        if (lines.length === 1) s += '<text class="nm" x="' + cxn + '" y="' + (y + NH / 2 + 4) + '" text-anchor="middle">' + esc(lines[0]) + '</text>';
        else s += '<text class="nm" x="' + cxn + '" y="' + (y + NH / 2 - 2) + '" text-anchor="middle">' + esc(lines[0]) + '</text><text class="nm" x="' + cxn + '" y="' + (y + NH / 2 + 10) + '" text-anchor="middle">' + esc(lines[1]) + '</text>';
      }
      s += '</g>';
      const g = stp.gate ? val(stp.gate, c) : null;
      if (g) { const blocked = live && i === st.idx && st.missing(stp).length > 0; s += '<rect class="m-gd' + (blocked ? ' blocked' : '') + '" x="' + (x - 6) + '" y="' + (y + NH / 2 - 5) + '" width="10" height="10" transform="rotate(45 ' + (x - 1) + ' ' + (y + NH / 2) + ')"/>'; }
      if (live) {
        const late = slip > 0 && i >= st.idx && st.delays.some(d => d.at <= i);
        s += '<text class="m-date' + (late ? ' slip' : '') + '" x="' + cxn + '" y="' + (y + NH + 12) + '" text-anchor="middle">' + (i < st.idx ? '✓ ' : '') + dfmt.format(D[i]) + '</text>';
        if (stp.ai && i >= st.idx) s += '<g class="m-spark" transform="translate(' + (x + NW - 7) + ',' + (y - 7) + ') scale(.6)"><path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z"/></g>';
      }
      if (stp.q2 && stp.id === 'sign2' && c.flow === 'fof' && c.q2 !== 'withdrawn') {
        s += '<line class="m-edge" x1="' + cxn + '" y1="' + (y + NH) + '" x2="' + cxn + '" y2="' + (y + NH + (live ? 26 : 14)) + '" stroke-dasharray="3 3"/>';
        if (live) s += '<text class="m-note" x="' + (cxn + 6) + '" y="' + (y + NH + 28) + '">Q2 withdrawn → completes at design</text>';
      }
      const dl = stp.deal ? val(stp.deal, c) : null;
      if (dl) { const gw = 16 + dl.length * 5.6; s += '<g class="m-deal"><rect x="' + (cxn - gw / 2) + '" y="' + (y - 24) + '" width="' + gw + '" height="16" rx="8"/><text x="' + cxn + '" y="' + (y - 13) + '" text-anchor="middle">' + esc(dl) + '</text></g>'; }
    });
    return {svg: s + '</svg>', x: nx, NW: NW, y: r => cy(r), lanes: lanes, LW: LW, W: W, H: H};
  }

  let UID = 0;
  function mount(root, opts){
    opts = opts || {};
    ensureDefs();
    const st = {uid: ++UID, flow: opts.flow || 'fof', pkg: opts.pkg || 'bespoke', q2:'active', idx:0, view:null, delays:[], flash:null, plan:false, fixed:new Set(), rev:{}, listeners:[]};
    st.ctx = () => ({flow:st.flow, pkg:st.pkg, q2:st.q2});
    st.list = () => listFor(st.ctx());
    st.slip = () => st.delays.reduce((a, d) => a + d.days, 0);
    st.dates = L => { let t = START; return L.map((s, i) => { t += val(s.d, st.ctx()) * 864e5; return t + st.delays.filter(d => d.at <= i).reduce((a, d) => a + d.days, 0) * 864e5; }); };
    st.chapters = L => CH.filter(ch => L.some(s => s.ch === ch.id)).map(ch => { const f = L.findIndex(s => s.ch === ch.id); let l = -1; L.forEach((s, i) => { if (s.ch === ch.id) l = i; }); return Object.assign({}, ch, {f, l, st: st.idx > l ? 'done' : (st.idx >= f ? 'now' : 'next')}); });
    st.missing = s => { const g = s.gate ? val(s.gate, st.ctx()) : null; if (!g) return []; return g.items.filter((it, k) => !it[1] && !st.fixed.has(s.id + ':' + k)); };
    const title = opts.title || 'JOB-0142 · Apartment 1204';

    root.innerHTML = '<div class="j-room"><div class="j-head"><div class="title"><b>' + esc(title) + '</b><span class="xs muted" data-r="sub"></span></div><div class="right"><span data-r="health"></span><div class="j-fc" data-r="fc"></div><div class="stack" data-r="team"></div></div></div>' +
      '<div class="j-map" data-r="map"></div><div class="j-main"><div class="j-focus" data-r="focus"></div><aside class="j-side" data-r="side"></aside></div>' +
      '<div class="j-intent"><div data-r="plan"></div><form data-r="intent" autocomplete="off">' + SPARK + '<input type="text" id="intent-' + st.uid + '" placeholder="Tell it what happened: “client loved the burgundy sofa, wants 3 more pendants”" aria-label="Tell it what happened"><button type="button" class="j-mic" aria-label="Voice note"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button><button type="submit" class="btn ai sm">Plan it</button></form></div></div>';
    const $ = r => root.querySelector('[data-r="' + r + '"]');
    if (opts.phone) opts.phone.innerHTML = '<div class="j-phone" aria-label="Client portal"><div class="j-screen"><div class="j-ptop"><div class="j-pbrand"><i></i>Firm brand</div><b class="h" data-p="h">Your home</b><div class="j-pline" data-p="line"></div><div class="j-plab" data-p="lab"></div></div><div class="j-pbody" data-p="body"></div><div class="j-ptabs"><div class="on">Home</div><div>Design</div><div>Money</div><div>Chat</div></div></div></div>';
    const $p = r => opts.phone && opts.phone.querySelector('[data-p="' + r + '"]');

    function startAt(id){
      const L = st.list(); const i = L.findIndex(s => s.id === id); if (i < 0) return;
      L.slice(0, i).forEach(s => { const g = s.gate ? val(s.gate, st.ctx()) : null; if (g) g.items.forEach((it, k) => st.fixed.add(s.id + ':' + k)); });
      st.idx = i;
    }
    if (opts.startAt) startAt(opts.startAt);

    function renderControls(L){
      if (!opts.controls) return;
      opts.controls.querySelectorAll('[data-flow]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.flow === st.flow)));
      opts.controls.querySelectorAll('[data-pkg]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.pkg === st.pkg)); b.disabled = st.flow === 'fu'; });
      const cnt = opts.controls.querySelector('[data-c="count"]'); if (cnt) cnt.textContent = st.idx >= L.length ? 'Complete' : 'Step ' + (st.idx + 1) + ' of ' + L.length;
    }
    function handoverIndex(L){ const ids = ['hand', 'done']; for (const id of ids) { const i = L.findIndex(s => s.id === id); if (i >= 0) return i; } return L.length - 1; }

    function renderHead(L, D){
      const c = st.ctx(); const s = L[st.idx];
      $('sub').textContent = FLOWS[st.flow].label + (st.flow === 'fu' ? '' : ' · ' + (PK[st.pkg].short || PK[st.pkg].label)) + (st.q2 === 'withdrawn' ? ' · Q2 withdrawn' : '');
      let h;
      if (st.idx >= L.length) h = '<span class="chip done">Completed</span>';
      else if (st.slip() > 0) h = '<span class="chip wait">Slipping +' + st.slip() + 'd</span>';
      else if (st.missing(s).length) h = '<span class="chip stop">Blocked at a gate</span>';
      else if (roleOf(s, c) === 'client') h = '<span class="chip client">Waiting on client</span>';
      else h = '<span class="chip done">On track</span>';
      $('health').innerHTML = h;
      const hi = handoverIndex(L);
      const label = L[hi].id === 'done' ? 'Design handover' : (st.flow === 'fu' ? 'Delivery' : 'Handover');
      $('fc').innerHTML = '<span>' + label + ' forecast</span><b>' + dfmt.format(D[hi]) + ' ' + new Date(D[hi]).getUTCFullYear() + (st.slip() ? ' <span class="slip">+' + st.slip() + 'd</span>' : '') + '</b>';
      const seats = []; L.slice(0, Math.min(st.idx + 1, L.length)).forEach(x => { const r = roleOf(x, c); if (r !== 'client' && !seats.includes(r)) seats.push(r); });
      $('team').innerHTML = seats.slice(-7).map(r => '<span class="av" title="' + esc(ROLES[r]) + '">' + SHORT[r] + '</span>').join('');
    }

    function renderMap(L){
      const m = mapSvg(L, st, {});
      const el = $('map');
      const lab = '<div class="j-lanes" style="width:' + m.LW + 'px;height:' + m.H + 'px">' + m.lanes.map(r => '<span class="' + (r === 'client' ? 'client' : '') + '" style="top:' + (m.y(r) - 8) + 'px">' + esc(ROLES[r]) + '</span>').join('') + '</div>';
      el.innerHTML = '<div class="j-mapin" style="width:' + m.W + 'px">' + lab + '<div style="margin-top:-' + m.H + 'px">' + m.svg + '</div></div>';
      const ci = Math.min(st.idx, L.length - 1);
      const target = Math.max(0, m.x(ci) - el.clientWidth / 2 + m.NW / 2);
      const top = Math.max(0, m.y(roleOf(L[ci], st.ctx())) - el.clientHeight / 2);
      try { el.scrollTo({left: target, top: top, behavior: reduce ? 'auto' : 'smooth'}); } catch (e) { el.scrollLeft = target; el.scrollTop = top; }
    }

    function aiBox(s, c, mode){
      if (!s.ai) return '';
      const head = mode === 'past' ? 'AI drafted · confirmed by ' + ROLES[roleOf(s, c)] : (mode === 'future' ? 'AI can prepare this now' : 'AI prepared');
      let h = '<div class="j-ai"><div class="h">' + SPARK + '<span class="ai-text">' + esc(head) + '</span>' + (s.ai.c ? '<span class="chip ai" style="margin-inline-start:auto">' + esc(s.ai.c) + ' sure</span>' : '') + '</div>';
      h += '<p>' + esc(val(s.ai.t, c)) + '</p><div class="src">' + s.ai.src.map(x => '<span class="chip">' + esc(x) + '</span>').join('');
      if (mode === 'now') h += '<span style="margin-inline-start:auto" class="j-actions"><button class="btn ghost sm" type="button" data-a="ai-edit">Edit</button><button class="btn ai sm" type="button" data-a="ai-ok">Accept</button></span>';
      if (mode === 'future') h += '<span style="margin-inline-start:auto"><button class="btn ai sm" type="button" data-a="ai-prep">Prepare now</button></span>';
      return h + '</div></div>';
    }
    function gateBox(s, c, mode){
      const g = s.gate ? val(s.gate, c) : null; if (!g) return '';
      const miss = st.missing(s); const blocked = mode === 'now' && miss.length > 0;
      let h = '<div class="j-gate' + (blocked ? ' blocked' : '') + '"><div class="gh">' + (blocked ? IC.x : IC.ok) + 'Gate · ' + esc(g.title) + (blocked ? ' · blocked: ' + miss.length + ' missing' : ' · passes') + '</div>';
      g.items.forEach((it, k) => {
        const ok = it[1] || st.fixed.has(s.id + ':' + k) || mode === 'past';
        h += '<div class="gi">' + (ok ? IC.ok : IC.x) + '<span>' + esc(it[0]) + '</span>';
        if (!ok && mode === 'now' && it[2]) h += '<span class="fix"><span class="fixt">' + SPARK + ' ' + esc(it[2]) + '</span><button class="btn ai sm" type="button" data-a="fix" data-k="' + k + '">Use this</button></span>';
        h += '</div>';
      });
      return h + '</div>';
    }
    function itemsBox(L){
      const curS = L[st.idx]; const cs = curS && curS.item != null ? curS.item : -1;
      let held = 0, through = 0;
      let h = '<div class="j-items"><table><thead><tr><th>Item</th>' + STAGES.map((sname, k) => '<th' + (k === cs || (cs === 5 && k === 6) ? ' class="cur"' : '') + '>' + sname + '</th>').join('') + '</tr></thead><tbody>';
      ITEMS.forEach((it, i) => {
        h += '<tr><td><b>' + esc(it[0]) + '</b><br><span class="faint">' + esc(it[1]) + '</span></td>';
        STAGES.forEach((sn, k) => {
          const v = itemCell(L, st.idx, i, k);
          if (k === cs) { if (v === 'held') held++; if (v === 'done' || v === 'na') through++; }
          const txt = {done:'✓', now:'●', held:'Held', todo:'○', na:'–'}[v];
          h += '<td class="c-' + v + (k === cs ? ' cur' : '') + '">' + txt + '</td>';
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>';
      const sum = cs >= 0 ? '<div class="xs muted">' + through + ' of ' + ITEMS.length + ' items through this gate' + (held ? ' · ' + held + ' held below margin' : '') + ' · supplier and Core Collection items skip drawings and the factory</div>' : '';
      return h + sum;
    }

    function renderFocus(L, D){
      const c = st.ctx(); const chs = st.chapters(L);
      let h = st.flash ? '<div class="j-flash">' + esc(st.flash) + '</div>' : '';
      const vi = st.view === null ? st.idx : st.view;
      if (vi >= L.length) {
        h += '<div class="j-card"><div class="j-meta"><span>Completed</span></div><h3>Nothing left on this job</h3><p class="small muted" style="margin:0">Every step has its evidence. History stays on the record.</p><div class="j-actions"><button class="btn primary" type="button" data-a="restart">Start again</button></div></div>';
        $('focus').innerHTML = h; return;
      }
      const s = L[vi]; const ch = chs.find(x => x.id === s.ch); const inCh = L.filter(x => x.ch === s.ch); const pos = inCh.indexOf(s) + 1;
      const r = roleOf(s, c); const isClient = r === 'client'; const isAuto = !!val(s.auto, c);
      const mode = vi < st.idx ? 'past' : (vi === st.idx ? 'now' : 'future');
      const right = mode === 'past' ? 'Done ' + dfmt.format(D[vi]) : (mode === 'now' ? (isClient ? 'Waiting on client' : (isAuto ? 'Automatic' : 'Due ' + dfmt.format(D[vi]))) : 'Planned ' + dfmt.format(D[vi]));
      h += '<div class="j-card' + (mode === 'now' && isClient ? ' client' : '') + (mode === 'now' && isAuto ? ' auto' : '') + (mode === 'past' ? ' past' : '') + (mode === 'future' ? ' future' : '') + '">';
      h += '<div class="j-meta"><span>' + esc(ch.label) + ' · ' + pos + ' of ' + inCh.length + (s.opt ? ' · only if needed' : '') + '</span><span>' + right + '</span></div>';
      h += '<h3>' + esc(val(s.verb, c)) + '</h3>';
      h += '<div class="j-dw"><b>' + (mode === 'past' ? 'Evidence' : 'Done when') + '</b>' + esc(val(s.done, c)) + '</div>';
      h += '<div class="j-owner"><span class="av' + (isClient ? ' client' : '') + '">' + SHORT[r] + '</span>' + esc(ROLES[r]) + (isAuto ? '<span class="chip auto">' + IC.auto + 'Automatic</span>' : '') + (isClient ? '<span class="chip client">Portal card: ' + esc(val(s.act, c)) + '</span>' : '') + (s.item != null ? '<span class="chip">Per item</span>' : '') + (mode === 'future' ? '<span class="chip">' + IC.lock + 'Unlocks after ' + esc(val(L[vi - 1].name, c)) + '</span>' : '') + '</div>';
      h += gateBox(s, c, mode);
      if (s.rev && mode === 'now') { const n = st.rev[s.id] || 0; h += '<div class="chips"><span class="chip' + (n >= 2 ? ' wait' : '') + '">Revisions used: ' + n + ' of 2 free</span>' + (n > 2 ? '<span class="chip stop">Revision ' + n + ' is chargeable → change request drafted</span>' : '') + '</div>'; }
      if (s.outcomes && mode === 'now') h += '<div class="chips"><span class="xs faint">Outcome:</span><button class="chip" type="button" data-a="oc" data-v="No answer">No answer</button><button class="chip" type="button" data-a="oc" data-v="WhatsApp sent, no reply">WhatsApp sent, no reply</button><button class="chip" type="button" data-a="oc" data-v="Come back to">Come back to</button><button class="chip stop" type="button" data-a="oc" data-v="Not interested">Not interested</button><button class="chip done" type="button" data-a="next">Willing to talk</button></div>';
      if (s.item != null) h += itemsBox(L);
      h += aiBox(s, c, mode);
      h += '<div class="j-actions">';
      if (mode === 'now') {
        const blocked = st.missing(s).length > 0;
        if (isAuto) h += '<button class="btn auto" type="button" data-a="next">' + IC.auto + 'Runs automatically</button>';
        else if (isClient) h += '<button class="btn client" type="button" data-a="next">Simulate client: ' + esc(val(s.act, c)) + '</button><button class="btn" type="button" data-a="wait">Client waits 3 days</button>';
        else if (s.outcomes) h += '<button class="btn primary" type="button" data-a="next">Willing to talk → convert</button>';
        else h += '<button class="btn primary" type="button" data-a="next"' + (blocked ? ' disabled' : '') + '>' + (blocked ? 'Blocked · ' + st.missing(s).length + ' missing' : esc(s.cta || 'Mark done')) + '</button>';
        if (s.rev) h += '<button class="btn" type="button" data-a="rev">Client asks for changes</button>';
        if (s.opt) h += '<button class="btn ghost" type="button" data-a="next">Not needed, skip</button>';
        if (s.q2 && st.flow === 'fof') h += '<button class="btn ghost danger" type="button" data-a="q2">Withdraw Q2</button>';
        if (!isAuto && !isClient) h += '<button class="btn ghost" type="button" data-a="reassign">Reassign</button>';
      } else {
        h += '<button class="btn" type="button" data-a="back">Back to now</button><button class="btn ghost" type="button" data-a="jump" data-i="' + vi + '">Jump here (demo)</button>';
      }
      h += '</div></div>';
      $('focus').innerHTML = h;
    }

    function renderSide(L, D){
      const c = st.ctx();
      let h = '<div><h4>Ahead</h4><div class="j-ahead">' + (L.slice(st.idx + 1, st.idx + 4).map((t, k) => '<div class="t">' + IC.lock + esc(val(t.name, c)) + '<span class="d">' + dfmt.format(D[st.idx + 1 + k]) + '</span></div>').join('') || '<div class="t">Nothing after this</div>') + '</div></div>';
      const done = id => { const i = L.findIndex(s => s.id === id); return i >= 0 && i < st.idx; };
      const status = ids => { const labels = ['Draft', 'Sent', 'Signed', 'Paid', 'Finance checked', 'Won']; let n = 0; ids.forEach(id => { if (done(id)) n++; }); return {n, label: labels[n]}; };
      h += '<div><h4>Deals</h4><div>';
      if (design(c)) { const s1 = status(['prop1', 'acc1', 'pay1', 'fin1', 'own1']); h += '<div class="j-mrow"><div class="top"><span>Proposal 1 · design fee</span><span class="amt">' + money(fee(c)) + '</span></div><span><span class="chip ' + (s1.n >= 5 ? 'done' : s1.n ? 'wait' : '') + '">' + s1.label + '</span></span></div>'; }
      if (prodAny(c)) { const s2 = status(['eprop', 'sign2', 'pay2', 'fin2', 'own2']); h += '<div class="j-mrow"><div class="top"><span>' + (c.flow === 'fu' ? 'Quotation' : 'Proposal 2 · estimate') + '</span><span class="amt">' + money(386500) + '</span></div><span><span class="chip ' + (s2.n >= 5 ? 'done' : s2.n ? 'wait' : '') + '">' + s2.label + '</span></span></div>'; }
      else if (c.q2 === 'withdrawn') h += '<div class="j-mrow"><div class="top"><span>Proposal 2</span><span class="amt">—</span></div><span><span class="chip stop">Withdrawn · owner confirmed</span></span></div>';
      h += '</div></div>';
      $('side').innerHTML = h;
    }

    function renderPlan(){
      if (!st.plan) { $('plan').innerHTML = ''; return; }
      const prod = prodFull(st.ctx());
      $('plan').innerHTML = '<div class="j-plan"><div class="j-ai" style="border:0;padding:0;background:transparent"><div class="h">' + SPARK + '<span class="ai-text">Plan from your note</span></div></div><ol>' +
        (prod ? '<li><b>Material selection</b> <span>· sofa fabric: velvet burgundy, FAB-221. Sent to the client to confirm.</span></li><li><b>Quotation</b> <span>· add 3 × pendant light LGT-014 at AED 1,450 each.</span></li><li><b>Change request</b> <span>· only if the estimate is already signed: + AED 4,350, QS priced, client approves and pays first.</span></li>'
          : '<li><b>Design notes</b> <span>· the client loves the burgundy sofa: added to the mood board brief.</span></li><li><b>Not in this package</b> <span>· material selection only happens when production follows; offer Full ID + fit-out.</span></li>') +
        '</ol><div class="j-actions"><button class="btn ai sm" type="button" data-a="plan-ok">Confirm</button><button class="btn ghost sm" type="button" data-a="plan-x">Dismiss</button><span class="xs muted">Source: your note</span></div></div>';
    }

    function clientCard(s, c){
      const k = s.kind; let body = ''; const t = val(s.name, c);
      if (k === 'accept') body = '<div class="j-doc"><i></i><div class="xs"><b>' + (s.id === 'acc1' ? 'Design proposal · ' + esc(PK[c.pkg].short || PK[c.pkg].label) : (c.flow === 'fu' ? 'Quotation' : 'Estimate proposal') + ' · rev 1') + '</b><br>' + (s.id === 'acc1' ? money(fee(c)) : money(386500)) + ' · valid 7 days</div></div>';
      else if (k === 'pay') body = '<div class="j-amt">' + money(val(s.amt, c)) + '</div><div class="chips"><span class="chip">Card</span><span class="chip">Transfer</span><span class="chip">Upload proof</span></div>';
      else if (k === 'sign') body = '<div class="j-mats"><div>' + IC.ok + 'Mood board chosen</div><div>' + IC.ok + '2D concept approved</div>' + (renders(c) ? '<div>' + IC.ok + '3D renders approved</div>' : '') + '</div>';
      else if (k === 'drawings') body = '<div class="j-mats"><div>' + IC.ok + 'TV wall · rev 2</div><div>' + IC.ok + 'Kitchen cabinets · rev 1</div><div>' + IC.ok + 'Wardrobe M1 · rev 1</div></div>';
      else if (k === 'handover') body = '<div class="j-mats"><div>' + IC.ok + 'Living room pack</div><div>' + IC.ok + 'Kitchen pack</div><div>' + IC.ok + 'Snags closed · 6 of 6</div></div>';
      return '<div class="j-wfy"><span class="tag">Waiting for you</span><b>' + esc(t) + '</b>' + body + '<div class="row"><button class="btn sm" type="button" data-a="ask">' + (k === 'pay' ? 'Upload proof' : 'Ask') + '</button><button class="btn client sm" type="button" data-a="next">' + esc(val(s.act, c)) + '</button></div></div>';
    }
    function renderPhone(L){
      if (!opts.phone) return;
      const c = st.ctx(); const chs = st.chapters(L); const lab = CLIENT_CH(c);
      $p('line').innerHTML = chs.map(ch => '<div class="' + (ch.st === 'next' ? '' : ch.st) + '"></div>').join('');
      const now = chs.find(ch => ch.st === 'now');
      $p('h').textContent = now ? lab[now.id] : 'Complete';
      $p('lab').innerHTML = '<span>Apartment 1204</span><span>' + chs.filter(x => x.st === 'done').length + ' of ' + chs.length + ' done</span>';
      const seen = L.slice(0, st.idx).filter(x => x.client || roleOf(x, c) === 'client');
      const line = x => roleOf(x, c) === 'client' ? 'You: ' + val(x.name, c).toLowerCase() : val(x.client, c);
      let h = '';
      if (seen.length) h += '<div class="j-since"><b class="ai-text">Since you last looked</b><span>' + esc(seen.slice(-2).map(line).join('. ')) + '.</span></div>';
      const s = L[st.idx];
      if (!s) h += '<div class="j-fi"><span><b>All done.</b> Files, warranty and support stay here.</span></div>';
      else if (roleOf(s, c) === 'client') h += clientCard(s, c);
      else if (s.kindC === 'two') h += '<div class="j-wfy"><span class="tag">Coming to you next</span><b>' + esc(val(s.client, c)) + '</b><div class="j-two"><div class="j-swatch" style="background:var(--sw-2)">Option A</div><div class="j-swatch" style="background:var(--sw-3)">Option B</div></div></div>';
      else if (s.kindC === 'swatch') h += '<div class="j-wfy"><span class="tag">Coming to you next</span><b>' + esc(val(s.client, c)) + '</b><div class="j-swatch" style="background:var(--sw-1)">Velvet · burgundy · FAB-221</div></div>';
      else if (s.client) h += '<div class="j-fi"><span>Coming up: <b>' + esc(val(s.client, c)) + '</b></span></div>';
      else h += '<div class="j-fi"><span>The team is working on your <b>' + esc(lab[s.ch].toLowerCase()) + '</b>. Nothing needed from you.</span></div>';
      const feed = seen.slice().reverse().slice(0, 3);
      if (feed.length) h += '<div class="j-feed">' + feed.map(x => '<div class="j-fi">' + IC.ok + '<span>' + esc(line(x)) + '</span></div>').join('') + '</div>';
      $p('body').innerHTML = h;
    }

    function render(){
      const L = st.list(); if (st.idx > L.length) st.idx = L.length; const D = st.dates(L);
      renderControls(L); renderHead(L, D); renderMap(L); renderFocus(L, D); renderSide(L, D); renderPlan(); renderPhone(L);
      st.listeners.forEach(f => f(api));
    }
    function advance(){
      const L = st.list(); const s = L[st.idx]; if (!s) return;
      if (st.missing(s).length) { toast('Blocked: ' + st.missing(s).map(m => m[0]).join(' · ')); return; }
      const dl = s.deal ? val(s.deal, st.ctx()) : null;
      st.flash = dl ? dl + ' · ' + val(s.done, st.ctx()) : null;
      st.idx = Math.min(st.idx + 1, L.length); st.view = null; st.plan = false; render();
    }
    function jump(i){ st.idx = i; st.view = null; st.flash = null; st.delays = st.delays.filter(d => d.at < i); if (st.q2 === 'withdrawn' && i < st.list().findIndex(s => s.id === 'done')) st.q2 = 'active'; render(); }
    function restart(){ st.idx = 0; st.view = null; st.flash = null; st.delays = []; st.plan = false; st.q2 = 'active'; st.fixed = new Set(); st.rev = {}; render(); }
    function act(el){
      const a = el.dataset.a; const L = st.list(); const s = L[st.idx];
      if (a === 'next') advance();
      else if (a === 'wait') { st.delays.push({at:st.idx, days:3}); render(); const L2 = st.list(); const D2 = st.dates(L2); toast('Reminder sent · forecast moves to ' + dfmt.format(D2[handoverIndex(L2)]) + ' (+' + st.slip() + ' days)'); }
      else if (a === 'fix') { st.fixed.add(s.id + ':' + el.dataset.k); render(); toast('Filled from the source · kept with its provenance'); }
      else if (a === 'rev') { st.rev[s.id] = (st.rev[s.id] || 0) + 1; render(); if (st.rev[s.id] > 2) toast('3rd revision is chargeable · change request drafted for the client'); else toast('Revision ' + st.rev[s.id] + ' of 2 free logged · resend date set'); }
      else if (a === 'oc') toast(el.dataset.v === 'Not interested' ? 'Not interested needs a reason · moves to Not interested' : 'Attempt logged: ' + el.dataset.v + ' · stays in the queue');
      else if (a === 'q2') { st.q2 = 'withdrawn'; const L2 = st.list(); st.idx = L2.findIndex(x => x.id === 'done'); st.view = null; st.flash = null; render(); toast('Q2 withdrawn with a reason · owner confirms · listed in Withdrawn Q2, not Lost or Won'); }
      else if (a === 'back') { st.view = null; render(); }
      else if (a === 'jump') jump(Number(el.dataset.i));
      else if (a === 'reassign') toast('Reassign to anyone holding this seat · history kept');
      else if (a === 'ai-ok') toast('Accepted · source and confidence kept on the record');
      else if (a === 'ai-edit') toast('Fields open; your edits replace the AI values');
      else if (a === 'ai-prep') toast('Draft prepared and parked on this step');
      else if (a === 'ask') toast('Question sent to the owner of this step');
      else if (a === 'plan-ok') { st.plan = false; renderPlan(); toast('Recorded on the right steps · source: your note'); }
      else if (a === 'plan-x') { st.plan = false; renderPlan(); }
      else if (a === 'restart') restart();
    }
    function onClick(e){
      const a = e.target.closest('[data-a]'); if (a) { act(a); return; }
      const n = e.target.closest('.m-node[data-i]'); if (n) { const i = Number(n.dataset.i); st.view = i === st.idx ? null : i; render(); }
    }
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.m-node[data-i]')) { e.preventDefault(); const i = Number(e.target.dataset.i); st.view = i === st.idx ? null : i; render(); } });
    $('intent').addEventListener('submit', e => { e.preventDefault(); st.plan = true; renderPlan(); });
    if (opts.phone) opts.phone.addEventListener('click', onClick);
    if (opts.controls) opts.controls.addEventListener('click', e => {
      const f = e.target.closest('[data-flow]'); if (f) { st.flow = f.dataset.flow; restart(); return; }
      const p = e.target.closest('[data-pkg]'); if (p && !p.disabled) { const curS = st.list()[st.idx]; st.pkg = p.dataset.pkg; const L = st.list(); let i = curS ? L.findIndex(s => s.id === curS.id) : st.idx; if (i < 0) i = Math.min(st.idx, L.length - 1); st.idx = i; st.view = null; st.delays = []; render(); return; }
      if (e.target.closest('[data-c="restart"]')) restart();
    });
    const api = {
      render, restart, state: st,
      set(o){ if (o.flow) { st.flow = o.flow; st.q2 = 'active'; } if (o.pkg) st.pkg = o.pkg; st.idx = 0; st.view = null; st.delays = []; st.fixed = new Set(); if (o.startAt) startAt(o.startAt); render(); },
      onChange(f){ st.listeners.push(f); }
    };
    render();
    return api;
  }

  function staticMap(container, flow, pkg){
    const st = {uid: ++UID, flow, pkg, q2:'active', idx:-1, view:null, delays:[]};
    st.ctx = () => ({flow:st.flow, pkg:st.pkg, q2:'active'});
    st.slip = () => 0; st.dates = () => []; st.missing = () => [];
    st.chapters = L => CH.filter(ch => L.some(s => s.ch === ch.id)).map(ch => { const f = L.findIndex(s => s.ch === ch.id); let l = -1; L.forEach((s, i) => { if (s.ch === ch.id) l = i; }); return Object.assign({}, ch, {f, l, st:'next'}); });
    ensureDefs();
    container.innerHTML = mapSvg(listFor(st.ctx()), st, {small:true}).svg;
  }

  window.Flow = {mount, staticMap, toast, ensureDefs, PK, FLOWS, ROLES, SHORT, STEPS, CH, ITEMS, STAGES, listFor, val, esc, money, nf, fee, measure: cur, roleOf, SPARK, IC};
})();
