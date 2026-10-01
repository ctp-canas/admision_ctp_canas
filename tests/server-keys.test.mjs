import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/admission/index.ts';

test('server RPC accepts current secret keys without treating them as JWTs',async()=>{
 const secret='sb_secret_synthetic-key';
 const settings={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:secret})};
 let calls=0;
 const handler=createHandler(name=>settings[name]||'',async(url,options)=>{
  calls++;
  assert.equal(url,settings.SUPABASE_URL+'/rest/v1/rpc/admission_api');
  assert.equal(options.headers.apikey,secret);
  assert.equal(options.headers.Authorization,undefined);
  return Response.json({cycle_year:'2027',available:false});
 });
 const response=await handler(new Request('https://synthetic.supabase.co/functions/v1/admission/api/public/status'));
 assert.equal(response.status,200);
 assert.equal(calls,1);
 assert.deepEqual(await response.json(),{cycle_year:'2027',available:false});
});

test('server RPC retains legacy compatibility and rejects missing server credentials',async()=>{
 const settings={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-legacy-key'};
 let calls=0;
 const handler=createHandler(name=>settings[name]||'',async(_url,options)=>{
  calls++;
  assert.equal(options.headers.Authorization,'Bearer synthetic-legacy-key');
  return Response.json({available:false});
 });
 const req=()=>new Request('https://synthetic.supabase.co/functions/v1/admission/api/public/status');
 assert.equal((await handler(req())).status,200);
 delete settings.SUPABASE_SERVICE_ROLE_KEY;
 assert.equal((await handler(req())).status,503);
 assert.equal(calls,1);
});
