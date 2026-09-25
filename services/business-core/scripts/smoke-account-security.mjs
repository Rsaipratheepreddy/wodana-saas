import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';

const api=process.env.BUSINESS_CORE_URL,databaseUrl=process.env.DATABASE_URL;
assert(api&&databaseUrl,'Use scripts/smoke-account-security-isolated.mjs');
for(const url of [api,databaseUrl])assert(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Loopback only');
assert(new URL(databaseUrl).pathname.startsWith('/wodana_account_test_'),'Disposable account database required');
const id=randomUUID(),email=`account-${id}@wodana.invalid`,slug=`account-${id}`,password=`Local#${randomUUID()}`;
const db=new pg.Client({connectionString:databaseUrl});await db.connect();
const checks=[];
async function request(path,body,token,expected=200){
 const response=await fetch(`${api}${path}`,{method:body?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`}:{'x-wodana-internal-token':process.env.BUSINESS_CORE_INTERNAL_TOKEN,'idempotency-key':id}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 const payload=await response.json().catch(()=>null);
 // Never print tokens, MFA secrets or recovery codes, including on failure.
 assert.equal(response.status,expected,`${path}: ${response.status}; ${typeof payload?.message==='string'?payload.message:'Unexpected response'}`);
 return payload;
}
function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
 for(const char of secret)bits+=alphabet.indexOf(char).toString(2).padStart(5,'0');
 const bytes=[];for(let offset=0;offset+8<=bits.length;offset+=8)bytes.push(parseInt(bits.slice(offset,offset+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
try{
 const tenant=await request('/internal/tenants',{externalTenantId:id,owner:{email,displayName:'Synthetic Account Owner'},name:'Isolated account security',slug,defaultCurrency:'AED',defaultLocale:'en-AE',defaultTimezone:'Asia/Dubai',unitSystem:'metric',weekStartsOn:1,firstLegalEntity:{code:`A${id.slice(0,7)}`,displayName:'Isolated account',registeredName:'Isolated account LLC',countryCode:'AE',baseCurrency:'AED',locale:'en-AE',timezone:'Asia/Dubai'}},undefined,201);
 const activated=await request('/auth/invitations/activate',{invitationToken:tenant.ownerInvitation.invitationToken,password},undefined,201);
 await request('/auth/logout',{refreshToken:activated.refreshToken},undefined,201);
 const login=await request('/auth/login',{email,password,tenantSlug:slug},undefined,201);
 const workspaceId=login.selectedWorkspaceId,sessionBody={refreshToken:login.refreshToken,workspaceId};
 const setup=await request('/security/mfa/totp/setup',sessionBody,login.accessToken);
 const confirmation=await request('/security/mfa/totp/confirm',{...sessionBody,code:totp(setup.secret)},login.accessToken);
 assert.equal(confirmation.enabled,true);assert.equal(confirmation.recoveryCodes.length,10);
 await request('/security/mfa/status?workspaceId='+workspaceId,undefined,login.accessToken,401);
 checks.push('Synthetic password account enrolls MFA; prior access token is invalidated');
 const challenge=await request('/auth/login',{email,password,tenantSlug:slug},undefined,201);
 assert.equal(challenge.mfaRequired,true);
 const second=await request('/auth/mfa/verify',{challengeToken:challenge.challengeToken,code:confirmation.recoveryCodes[0]},undefined,201);
 const before=await request('/security/sessions/query',sessionBody,confirmation.accessToken,201);
 assert(before.sessions.some(s=>s.current));assert(before.sessions.some(s=>!s.current));
 const current=before.sessions.find(s=>s.current);
 await request(`/security/sessions/${current.familyId}/revoke`,sessionBody,confirmation.accessToken,409);
 checks.push('Security API marks the current session, lists other devices and rejects self-revocation');
 await request('/security/mfa/disable',sessionBody,confirmation.accessToken,409);
 checks.push('Required administrator MFA cannot be disabled');
 // The isolated fixture explicitly makes MFA optional; never run against an existing DB.
 const changed=await db.query(`UPDATE customer_accounts SET security_policy=security_policy || '{"requireMfaForAdmins":false,"requireMfaForAllUsers":false}'::jsonb WHERE id IN (SELECT account_id FROM customer_account_organizations WHERE workspace_id=$1)`,[workspaceId]);
 assert.equal(changed.rowCount,1);
 const disabled=await request('/security/mfa/disable',sessionBody,confirmation.accessToken);
 assert(disabled.accessToken);
 const after=await request('/security/sessions/query',sessionBody,disabled.accessToken,201);
 assert.equal(after.mfa.enabled,false);assert.equal(after.sessions.length,1);assert.equal(after.sessions[0].current,true);assert.equal(after.sessions[0].familyId,current.familyId);
 await request('/auth/refresh',{refreshToken:second.refreshToken},undefined,401);
 await request('/security/mfa/status?workspaceId='+workspaceId,undefined,second.accessToken,401);
 const refreshed=await request('/auth/refresh',{refreshToken:login.refreshToken},undefined,201);
 assert(refreshed.accessToken);
 checks.push('Optional MFA disable preserves current session, removes other devices and rejects their refresh and access tokens');
 const events=await db.query(`SELECT event_type FROM mfa_security_events WHERE user_id=(SELECT id FROM users WHERE primary_email=$1)`,[email]);
 assert(events.rows.some(row=>row.event_type==='mfa.disabled'));
 checks.push('MFA disable leaves a persisted security audit event');
 console.log(JSON.stringify({ok:true,isolated:true,externalMessages:false,checks},null,2));
}finally{await db.end();}
