import pg from 'pg';
import { readFile } from 'node:fs/promises';
const name='codex_hrms_test_20260907';
const admin=new pg.Client({host:'127.0.0.1',user:process.env.USER,database:'postgres'});await admin.connect();
if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query(`CREATE DATABASE ${name}`);
await admin.end();
const client=new pg.Client({host:'127.0.0.1',user:process.env.USER,database:name});await client.connect();
const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
await client.query('CREATE TABLE IF NOT EXISTS codex_applied_test_migrations(tag text PRIMARY KEY)');
for(const entry of journal.entries){if((await client.query('SELECT 1 FROM codex_applied_test_migrations WHERE tag=$1',[entry.tag])).rowCount)continue;const sql=await readFile(new URL(`../drizzle/${entry.tag}.sql`,import.meta.url),'utf8');try{await client.query('BEGIN');await client.query(sql);await client.query('INSERT INTO codex_applied_test_migrations VALUES($1)',[entry.tag]);await client.query('COMMIT');console.log('Applied',entry.tag);}catch(e){await client.query('ROLLBACK');throw e;}}
await client.query('GRANT USAGE ON SCHEMA public TO wodana_app');
await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO wodana_app');
await client.end();console.log('Isolated local HRMS database ready:',name);
