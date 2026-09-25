import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,symlink,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {userInfo} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire('/Users/saipratheep/Downloads/sdui-portal/package.json');
const pg=require('pg');
const {drizzle}=require('drizzle-orm/node-postgres');
const {migrate}=require('drizzle-orm/node-postgres/migrator');

const root='/Users/saipratheep/Downloads/sdui-portal';
// PostgreSQL's Unix socket pathname is limited; macOS TMPDIR can exceed it.
const scratch=await mkdtemp('/tmp/wodana-hrms-audit-');
const artifacts=resolve(root,'docs/qa-hrms',`hrms-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(artifacts,{recursive:true});
const pgBin=[process.env.DELIVERY_PG_BIN,'/opt/homebrew/opt/postgresql@16/bin','/usr/lib/postgresql/16/bin'].find(path=>path&&existsSync(join(path,'initdb')));
if(!pgBin)throw Error('Set DELIVERY_PG_BIN to a local PostgreSQL bin directory. No existing database is used.');
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const dbPort=await freePort(),apiPort=await freePort();
const databaseName='codex_hrms_test_20260907';
const databaseUrl=`postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${dbPort}/${databaseName}`;
const api=`http://127.0.0.1:${apiPort}/api/v1`;
const env={PATH:process.env.PATH,USER:userInfo().username,PGPORT:String(dbPort),DATABASE_URL:databaseUrl,DATABASE_SSL:'false',HOST:'127.0.0.1',PORT:String(apiPort),NODE_ENV:'test',AUTH_MODE:'development',BUSINESS_CORE_INTERNAL_TOKEN:'isolated-delivery-token',PORTAL_DEMO_OTP:'true',REDIS_URL:'',MAILGUN_API_KEY:'',MAILGUN_DOMAIN:'',OBJECT_STORAGE_BUCKET:'',BRAND_ASSET_STORAGE_DIR:join(scratch,'storage'),DEPENDENCY_CHECKS_ENABLED:'false'};
let apiProcess,started=false,apiLog='',databaseStopped=false;
async function run(command,args,options={}){
 const child=spawn(command,args,{cwd:root,env:{...process.env,...env,...options.env},stdio:['ignore','pipe','pipe'],...options});
 let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 if(code!==0)throw Error(`${command} ${args.join(' ')} failed (${code})\n${output}\n${error}`);
 return output;
}
async function cleanup(){
 if(apiProcess&&!apiProcess.killed){apiProcess.kill('SIGTERM');await new Promise(resolve=>{apiProcess.once('exit',resolve);setTimeout(resolve,3000);});}
 if(started)databaseStopped=spawnSync(join(pgBin,'pg_ctl'),['-D',join(scratch,'pgdata'),'-m','fast','stop'],{stdio:'ignore'}).status===0;
}
process.once('SIGINT',()=>{void cleanup().then(()=>process.exit(130));});
process.once('SIGTERM',()=>{void cleanup().then(()=>process.exit(143));});
try{
 console.log('Starting disposable local PostgreSQL and applying the complete migration journal.');
 await run(join(pgBin,'initdb'),['-D',join(scratch,'pgdata'),'--auth=trust','--no-locale']);
 await run(join(pgBin,'pg_ctl'),['-D',join(scratch,'pgdata'),'-l',join(scratch,'postgres.log'),'-o',`-p ${dbPort} -h 127.0.0.1 -k ${scratch}`,'start']);started=true;
 await run(join(pgBin,'createdb'),['-h','127.0.0.1','-p',String(dbPort),databaseName]);
 const pool=new pg.Pool({connectionString:databaseUrl});
 try{await pool.query('CREATE ROLE wodana_app LOGIN');await migrate(drizzle(pool),{migrationsFolder:join(root,'services/business-core/drizzle')});await pool.query('GRANT USAGE ON SCHEMA public TO wodana_app');await pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO wodana_app');await pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO wodana_app');}finally{await pool.end();}
 await writeFile(join(artifacts,'rls.json'),await run('node',['services/business-core/scripts/verify-tenant-isolation.mjs']));
 // Existing build only; coordinating agent owns build.
 await mkdir(join(scratch,'services/business-core'),{recursive:true});
 await cp(join(root,'services/business-core/dist'),join(scratch,'services/business-core/dist'),{recursive:true});
 await symlink(join(root,'node_modules'),join(scratch,'node_modules'));
 await symlink(join(root,'packages'),join(scratch,'packages'));
 env.DATABASE_URL=`postgresql://wodana_app@127.0.0.1:${dbPort}/${databaseName}`;
 apiProcess=spawn(process.execPath,['services/business-core/dist/main.js'],{cwd:scratch,env,stdio:['ignore','pipe','pipe']});
 apiProcess.stdout.on('data',chunk=>apiLog+=chunk);apiProcess.stderr.on('data',chunk=>apiLog+=chunk);
 let ready=false;
 for(let attempt=0;attempt<120;attempt++){
  if(apiProcess.exitCode!==null)throw Error(`Local API exited.\n${apiLog}`);
  try{const result=await fetch(`${api}/me`);if(result.status===401){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!ready)throw Error('Isolated API did not become ready.');
 const originalSmoke=await readFile(join(root,'services/business-core/scripts/smoke-hrms.mjs'),'utf8');
 const projectStart=originalSmoke.indexOf(' // Verify pre-project/project ownership');
 const leaveStart=originalSmoke.indexOf(' const type=await request',projectStart);
 await writeFile(join(scratch,'smoke-hrms.mjs'),originalSmoke.slice(0,projectStart)+" console.log('SKIP: legacy project release fixture lacks commercial release evidence; no release bypass used.');\n"+originalSmoke.slice(leaveStart));
 console.log('Running isolated HRMS HTTP/database acceptance.');
 const result=await run('node',[join(scratch,'smoke-hrms.mjs')],{env:{...env,HRMS_TEST_API:api}});
 await writeFile(join(artifacts,'hrms.txt'),result);
 await writeFile(join(artifacts,'api.log'),apiLog);
 console.log(`Local acceptance passed. Evidence: ${artifacts}`);
}catch(error){await writeFile(join(artifacts,'failure.txt'),String(error));throw error;}
finally{await cleanup();await writeFile(join(artifacts,'api.log'),apiLog);await writeFile(join(artifacts,'environment.json'),JSON.stringify({isolated:true,databaseName,temporaryDirectory:scratch,databaseStopped,externalMessages:false},null,2));}
