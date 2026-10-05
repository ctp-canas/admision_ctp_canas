import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../public/login.js',import.meta.url),'utf8');
function page({hash='',search=''}={}){
 const ids=['loginForm','recoveryForm','resetForm','loginHeading','loginIntro','recoveryPanel','resetPanel','forgotPassword','backToLogin','resetBackToLogin','username','password','msg','recoveryUsername','recoveryEmail','recoveryMsg','newPassword','confirmPassword','resetMsg'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',hidden:false,textContent:'',className:'',events:{},addEventListener(name,fn){this.events[name]=fn;},focus(){this.focused=true;},button:{disabled:false},querySelector(){return this.button;},reset(){this.wasReset=true;}}]));
 let cleared=0;const requests=[],changes=[];
 const location={hash,search,pathname:'/admision_ctp_canas/admin-login.html',href:''};
 const context={document:{querySelector:s=>elements[s.slice(1)]},location,history:{replaceState(_state,_title,url){changes.push(url);location.hash='';location.search='';}},URLSearchParams,TextEncoder,admissionClearSession(){cleared++;},async admissionRequest(path,options){requests.push({path,options});return path==='/api/session'?{authenticated:false}:{message:'Operación completada'};}};
 runInNewContext(source,context);
 return {elements,requests,changes,location,cleared:()=>cleared,submit:id=>elements[id].events.submit({preventDefault(){}}),click:id=>elements[id].events.click()};
}
test('login recovery sends only username and email and returns to the original login form',async()=>{
 const p=page();p.elements.username.value='Admi2026';p.click('forgotPassword');
 assert.equal(p.elements.loginForm.hidden,true);assert.equal(p.elements.recoveryPanel.hidden,false);assert.equal(p.elements.recoveryUsername.value,'Admi2026');
 p.elements.recoveryEmail.value='admin@example.test';await p.submit('recoveryForm');
 const request=p.requests.find(x=>x.path==='/api/password/request');assert.equal(request.options.body.username,'Admi2026');assert.equal(request.options.body.email,'admin@example.test');assert.equal(request.options.body.password,undefined);
 p.click('backToLogin');assert.equal(p.elements.loginForm.hidden,false);
});
test('email callback removes the token from the URL, validates confirmation and clears recovery after saving',async()=>{
 const p=page({hash:'#access_token=PRIVATE_RECOVERY_PROOF&type=recovery',search:'?recover=1'});
 assert.deepEqual(p.changes,['/admision_ctp_canas/admin-login.html']);assert.equal(p.requests.length,0);assert.equal(p.cleared(),1);assert.equal(p.elements.resetPanel.hidden,false);
 p.elements.newPassword.value='ChangedSynthetic-2027';p.elements.confirmPassword.value='does-not-match';await p.submit('resetForm');assert.equal(p.requests.length,0);assert.match(p.elements.resetMsg.textContent,/no coinciden/);
 p.elements.confirmPassword.value='ChangedSynthetic-2027';await p.submit('resetForm');
 assert.equal(p.requests[0].path,'/api/password/reset');assert.equal(p.requests[0].options.body.recovery_token,'PRIVATE_RECOVERY_PROOF');assert.equal(p.elements.resetForm.wasReset,true);assert.equal(p.elements.loginForm.hidden,false);assert.equal(p.cleared(),2);
 const expired=page({hash:'#error=access_denied&error_code=otp_expired',search:'?recover=1'});assert.equal(expired.elements.recoveryPanel.hidden,false);assert.match(expired.elements.recoveryMsg.textContent,/venció/);
});
