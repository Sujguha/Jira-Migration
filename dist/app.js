const categories = [
 ['projects','Projects','Choose which destination project receives each source project.'],
 ['issueTypes','Issue types','Match source work types to destination work types.'],
 ['workflows','Workflows','Map workflow definitions and schemes. Review transition rules and validators before execution.'],
 ['statuses','Statuses','Map every source status to an equivalent destination status.'],
 ['fields','Fields','Match compatible fields or append a source field’s value to the destination issue description.'],
 ['screens','Screens','Map screens and screen schemes. Check required fields on create and edit screens.'],
 ['permissionSchemes','Permissions','Map permission schemes. Review the destination grants and role membership before migration.'],
 ['identities','Users & groups','Resolve users, groups, and project roles before assigning access or ownership.'],
 ['other','Other configuration','Map notification and issue security schemes, boards, filters, and other captured objects.']
];
const steps = [['setup','Instances'], ...categories, ['review','Review & export']];
const labels = Object.fromEntries(steps);
const hosts = ['Cloud','Data Center','Server'];
const blank = hosting => ({hosting,url:'',inventory:null});
const initial = () => ({source:blank('Data Center'),target:blank('Data Center'),mapping:{}});
let state = initial();
try { const saved=JSON.parse(localStorage.getItem('jira-migration-studio-v1')); if(saved?.source && saved?.target && saved?.mapping) state=saved; } catch {}
// Credentials live only in page memory and never enter the saved draft or export.
const credentials = {source:'',target:''};
const authPreview = {source:'',target:''};
let step=0;
const by = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inventory = (side,key) => state[side].inventory?.objects[key] || [];
const slot = (key,id) => JSON.stringify([key,id]);
const compatible = (a,b) => !a.kind || !b.kind || a.kind.toLowerCase()===b.kind.toLowerCase();
const rows = key => inventory('source',key).map(source => {
 const value=state.mapping[slot(key,source.id)];
 if(key==='fields' && value?.action==='appendToDescription') {
  return {source,status:'In description',action:'appendToDescription',label:source.name};
 }
 const target=inventory('target',key).find(item => item.id===value && compatible(source,item));
 return {source,target,status:value===null?'Skipped':target?'Mapped':'Unresolved'};
});
const all = () => categories.flatMap(([key])=> rows(key));
const hasPair = () => Boolean(state.source.inventory && state.target.inventory);
function save() {
 try {localStorage.setItem('jira-migration-studio-v1',JSON.stringify(state));}
 catch {by('notice').textContent='Browser storage is unavailable or full. Export your plan before closing.'; }
}
function download(data,name) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const sample = {
 projects:['PAY · Payments','OPS · Operations'], issueTypes:['Epic','Story','Bug','Task'],
 workflows:['Software Delivery','Incident Management'], statuses:['To Do','In Progress','In Review','Done'],
 fields:['Story Points','Business Owner','Release Risk','Legacy Reference'],
 screens:['Software Create Screen','Defect Edit Screen'], permissionSchemes:['Engineering Permissions','Restricted Operations'],
 identities:['jira-developers','Project Administrators','Release Managers'],other:['Default Notification Scheme','Internal Issue Security','Payments Board']
};
function example(side) {
 const objects=Object.fromEntries(categories.map(([key])=>[key,sample[key].map((name,i)=>({
  id:(side==='source'?'s':'t')+'-'+key+'-'+(i+1),name,
  ...(key==='fields'?{kind:['number','user','select','text'][i]}:{})
 })).filter((_,i)=> side==='source' || key!=='fields' || i!==3)]));
 if(side==='target'){objects.statuses[2].name='Peer Review';objects.workflows[1].name='Operations Workflow';objects.permissionSchemes[1].name='Operations Restricted';}
 return {schemaVersion:1,objects};
}
function normalize(input) {
 if(input?.schemaVersion!==1 || !input.objects || typeof input.objects!=='object' || Array.isArray(input.objects)) throw Error('Expected a Jira Migration Studio inventory with schemaVersion 1. Download the inventory template for the format.');
 const objects={};
 for(const [key,label] of categories){
  const items=input.objects[key] ?? [];
  if(!Array.isArray(items)) throw Error(label+' must be an array.');
  const seen=new Set();
  objects[key]=items.map(item=>{
   if(!item || typeof item.id!=='string' || !item.id.trim() || typeof item.name!=='string' || !item.name.trim() || (item.kind!==undefined && typeof item.kind!=='string')) throw Error(label+' requires a string id and name for each item. The optional kind must be a string.');
   if(seen.has(item.id)) throw Error('Duplicate ID in '+label+': '+item.id);
   seen.add(item.id);
   return {id:item.id,name:item.name,...(item.kind?{kind:item.kind}:{})};
  });
 }
 if(!Object.values(objects).some(list=>list.length)) throw Error('The inventory has no supported configuration objects.');
 const discoveryWarnings=Array.isArray(input.discoveryWarnings)
  ? input.discoveryWarnings.filter(message=>typeof message==='string') : [];
 return {schemaVersion:1,objects,discoveryWarnings};
}
function endpoint(side,title){
 const d=state[side];
 return `<section class="card"><h2>${title}</h2><label for="${side}-host">Hosting</label><select id="${side}-host" data-host="${side}">${hosts.map(h=>`<option ${h===d.hosting?'selected':''}>${h}</option>`).join('')}</select><label for="${side}-url">Jira base URL (optional)</label><input id="${side}-url" type="url" placeholder="https://jira.example.com" value="${esc(d.url)}" data-url="${side}">${d.hosting==='Data Center'?`<div class="auth-block"><label for="${side}-token">Personal access token (PAT)</label><div class="token-control"><input id="${side}-token" type="password" autocomplete="off" spellcheck="false" placeholder="Enter a token to preview authentication" data-token="${side}" aria-describedby="${side}-auth-help"><button type="button" data-reveal="${side}" aria-label="Show ${side} token" aria-pressed="false">Show</button></div><p id="${side}-auth-help" class="auth-help">Prototype · kept in page memory until refresh. Use a placeholder token to explore.</p><div class="toolbar"><button type="button" data-auth="${side}">Check authentication setup</button><button type="button" data-clear-token="${side}">Clear token</button></div><p id="${side}-auth-status" class="auth-status" role="status">${esc(authPreview[side] || 'Awaiting token · Jira access unverified')}</p></div>`:`<p class="info">PAT connection setup is available for Jira Data Center.</p>`}<label class="file" for="${side}-file">Configuration inventory (.json)</label><input id="${side}-file" type="file" accept=".json,application/json" data-file="${side}"><p>${d.inventory?esc(d.filename)+' · '+Object.values(d.inventory.objects).flat().length+' objects':'No inventory loaded'}</p>${d.inventory?.discoveryWarnings?.length?`<details><summary>${d.inventory.discoveryWarnings.length} discovery warnings</summary><ul>${d.inventory.discoveryWarnings.map(message=>`<li>${esc(message)}</li>`).join('')}</ul></details>`:''}</section>`;
}
function render(){
 by('mode').textContent=state.source.demo||state.target.demo?'Sample data':'Planning mode';
 by('steps').innerHTML=steps.map(([key,label],i)=>`<button data-step="${i}" ${i===step?'class="active" aria-current="step"':''}><span class="num">${i+1}</span>${label}</button>`).join('');
 const [key,label,desc]=steps[step];
 let html=`<div class="top"><div class="eyebrow">JIRA MIGRATION PLAN</div><h1>${key==='setup'?'Source & destination':key==='review'?'Review your migration plan':label}</h1><p>${desc || (key==='setup'?'Set up your Jira pair and load the configuration inventories to compare.':'Review mapping coverage and download the plan for implementation.')}</p></div>`;
 if(key==='setup') html+=`<div class="cards">${endpoint('source','Source Jira')}${endpoint('target','Destination Jira')}</div><div class="panel"><div class="toolbar"><div><h2>Configuration inventories</h2><p>Import JSON in the template format or explore with sample inventories.</p></div><button data-action="template">Download inventory template</button><button data-action="sample">Load sample inventories</button></div><div class="info">The connector reads Jira from a computer that can reach it. Tokens are entered locally. This workspace uses the resulting inventories for mapping and export.</div></div><div class="panel"><h2>Jira Data Center connector</h2><p>Download the Python 3 connector and run discovery once per instance. Import each generated JSON in the matching card above.</p><a class="button" href="jira-dc-connector.py" download>Download Data Center connector</a><pre>python3 jira-dc-connector.py discover --url https://jira.example.com --project PAY --output source.json</pre><details><summary>Preview a sample of issues</summary><p>Export the mapping plan, then run the preview against the source. The report shows mapping gaps and the proposed description for each issue. Destination permissions, required fields and transitions still need validation.</p><pre>python3 jira-dc-connector.py preview --url https://jira.example.com --plan jira-migration-plan.json --jql "project = PAY" --limit 10 --output preview.json</pre></details></div>`;
 else if(!hasPair()) html+=`<div class="panel"><p>Load both inventories to work on this step.</p><button class="primary" data-step="0">Set up instances</button></div>`;
 else if(key==='review'){
  const data=all();
  html+=`<div class="metrics">${['Mapped','In description','Unresolved','Skipped','Total'].map(status=>`<div class="metric"><b>${status==='Total'?data.length:data.filter(r=>r.status===status).length}</b>${status}</div>`).join('')}</div><div class="panel table"><h2>Coverage by configuration area</h2><table><thead><tr><th>Configuration</th><th>Mapped</th><th>In description</th><th>Unresolved</th><th>Skipped</th></tr></thead><tbody>${categories.map(([k,l],i)=>`<tr><td><button data-step="${i+1}">${l}</button></td>${['Mapped','In description','Unresolved','Skipped'].map(s=>`<td>${rows(k).filter(r=>r.status===s).length}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="info">Coverage checks apply to the uploaded objects. Review target permissions, dependencies, field contexts, and workflow transitions before applying a migration.</p><div class="toolbar"><button class="primary" data-action="dry-run" aria-controls="dry-run-panel" aria-expanded="false">Run dry run</button><button data-action="export">Export plan JSON</button></div></div>
  <section class="panel" id="dry-run-panel" hidden aria-labelledby="dry-run-title"><h2 id="dry-run-title" tabindex="-1">Run a read-only dry run</h2>
  ${state.source.demo||state.target.demo||state.source.hosting!=='Data Center'||state.target.hosting!=='Data Center'
   ?'<p>The connector needs real Jira Data Center inventories for both instances. <button data-step="0">Set up instances</button></p>'
   :`<p>Download the plan and the connector. Run the command from their folder on a machine that can reach the source Jira. Replace the example URL and project key with your own.</p>
   <div class="toolbar"><button data-action="export">Download migration plan</button><a class="button" href="jira-dc-connector.py" download>Download Data Center connector</a></div>
   <pre>python3 jira-dc-connector.py preview --url https://jira.example.com --plan jira-migration-plan.json --jql "project = PAY" --limit 10 --output preview.json</pre>
   <p>Enter your source PAT when prompted. Open <code>preview.json</code> to review mapping gaps and proposed descriptions. The dry run reads source issues only.</p>`}
  </section>`;
 } else {
  const list=rows(key);
  html+=`<div class="panel"><div class="toolbar"><p>${list.filter(r=>['Mapped','In description'].includes(r.status)).length} assigned of ${list.length} source objects</p><button data-action="match" ${list.length?'':'disabled'}>Match identical names</button></div>${list.length?`<div class="table"><table><thead><tr><th>Source object</th><th>Destination object</th><th>Status</th></tr></thead><tbody>${list.map(({source,target,status},i)=>`<tr><td>${esc(source.name)}<small>${esc(source.kind||source.id)}</small></td><td><select aria-label="Destination for ${esc(source.name)}" data-map="${i}"><option value="">Select destination</option>${key==='fields'?`<option value="description" ${status==='In description'?'selected':''}>Append to issue description</option>`:''}<option value="skip" ${status==='Skipped'?'selected':''}>Skip this object</option>${inventory('target',key).map((item,j)=> compatible(source,item)?`<option value="target-${j}" ${target?.id===item.id?'selected':''}>${esc(item.name)} (${esc(item.id)})</option>`:'').join('')}</select></td><td><span class="pill ${['Mapped','In description'].includes(status)?'ok':''}">${status}</span></td></tr>`).join('')}</tbody></table></div>`:'<p>No source objects were supplied for this area.</p>'}</div>`;
 }
 by('view').innerHTML=html+`<div class="bottom">${step>0?`<button data-step="${step-1}">Previous step</button>`:'<span></span>'}${step<steps.length-1?`<button class="primary" data-step="${step+1}">Continue</button>`:''}</div>`;
 for(const side of ['source','target']){
  const input=by(side+'-token');
  if(input)input.value=credentials[side];
 }
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 const {step:next,action,auth,reveal,clearToken}=button.dataset;
 if(reveal){
  const input=by(reveal+'-token');
  const visible=input.type==='password';
  input.type=visible?'text':'password';
  button.textContent=visible?'Hide':'Show';
  button.setAttribute('aria-label',(visible?'Hide ':'Show ')+reveal+' token');
  button.setAttribute('aria-pressed',String(visible));
  return;
 }
 if(clearToken){
  credentials[clearToken]='';
  authPreview[clearToken]='Token cleared · Jira access unverified';
  by(clearToken+'-token').value='';
  by(clearToken+'-token').type='password';
  const toggle=document.querySelector('[data-reveal="'+clearToken+'"]');
  toggle.textContent='Show';
  toggle.setAttribute('aria-pressed','false');
  toggle.setAttribute('aria-label','Show '+clearToken+' token');
  by(clearToken+'-auth-status').textContent=authPreview[clearToken];
  return;
 }
 if(auth){
  let validUrl=false;
  try {
   const url=new URL(state[auth].url);
   validUrl=url.protocol==='https:' && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {}
  authPreview[auth]=!validUrl?'Enter an HTTPS Jira base URL without credentials, query or fragment.'
   :!credentials[auth].trim()?'Enter a personal access token.'
   :'Setup complete · live Jira verification requires the local connector. Enter the PAT again when prompted by the connector.';
  by(auth+'-auth-status').textContent=authPreview[auth];
  return;
 }
 by('notice').textContent='';
 if(next!==undefined){step=Number(next);render();by('view').querySelector('h1').tabIndex=-1;by('view').querySelector('h1').focus();return;}
 const key=steps[step][0];
 if(action==='sample'){
  if(hasPair() || state.source.inventory || state.target.inventory) if(!confirm('Replace the current inventories and mappings with sample data?')) return;
  credentials.source='';credentials.target='';authPreview.source='';authPreview.target='';
  state={source:{...blank('Data Center'),inventory:example('source'),demo:true,filename:'Sample source'},target:{...blank('Cloud'),inventory:example('target'),demo:true,filename:'Sample destination'},mapping:{}};
 } else if(action==='template') {
  download(example('source'),'jira-inventory-template.json');return;
 } else if(action==='match'){
  for(const {source,status} of rows(key)){
   if(status!=='Unresolved')continue;
   const matches=inventory('target',key).filter(item=>compatible(source,item)&&item.name.trim().toLowerCase()===source.name.trim().toLowerCase());
   if(matches.length===1)state.mapping[slot(key,source.id)]=matches[0].id;
  }
 } else if(action==='dry-run'){
  const panel=by('dry-run-panel');
  panel.hidden=!panel.hidden;
  button.setAttribute('aria-expanded',String(!panel.hidden));
  if(!panel.hidden)by('dry-run-title').focus();
  return;
 } else if(action==='export'){
  const endpoints=Object.fromEntries(['source','target'].map(side=>[side,{hosting:state[side].hosting,url:state[side].url,inventory:state[side].filename,sample:Boolean(state[side].demo)}]));
  const mappings=Object.fromEntries(categories.map(([k])=>[k,rows(k).map(row=>({...row,target:row.target??null}))]));
  download({schemaVersion:1,mode:'plan',...endpoints,mappings},'jira-migration-plan.json');return;
 } else return;
 render();save();
});
document.addEventListener('input',event=>{
 const {url,token}=event.target.dataset;
 if(token){
  credentials[token]=event.target.value;
  authPreview[token]='Token entered · Jira access unverified';
  by(token+'-auth-status').textContent=authPreview[token];
 }
 if(url){
  state[url].url=event.target.value;
  authPreview[url]='URL changed · Jira access unverified';
  const status=by(url+'-auth-status');
  if(status)status.textContent=authPreview[url];
  save();
 }
});
document.addEventListener('change',async event=>{
 const el=event.target;
 const {host,file,map}=el.dataset;
 if(host){state[host].hosting=el.value;credentials[host]='';authPreview[host]='';render();save();return;}
 if(file && el.files[0]){
  const selected=el.files[0];
  try {
   const snapshot=normalize(JSON.parse(await selected.text()));
   if(Object.keys(state.mapping).length && !confirm('Load this inventory and clear the current mappings?')){el.value='';return;}
   state[file]={...state[file],inventory:snapshot,demo:false,filename:selected.name};state.mapping={};render();save();by('notice').textContent='Inventory loaded.';
  } catch(error){by('notice').textContent=error.message;el.value='';}
 }
 if(map!==undefined){
  const key=steps[step][0];
  const id=slot(key,inventory('source',key)[Number(map)].id);
  if(!el.value)delete state.mapping[id];
  else if(key==='fields' && el.value==='description')state.mapping[id]={action:'appendToDescription'};
  else state.mapping[id]=el.value==='skip'?null:inventory('target',key)[Number(el.value.slice(7))].id;
  render();save();document.querySelector('[data-map="'+map+'"]')?.focus();
 }
});
render();
