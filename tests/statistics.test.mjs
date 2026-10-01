import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
test('result chart excludes unresolved records and handles zero or one category',async()=>{
 const context={};runInNewContext(await readFile(new URL('../public/statistics.js',import.meta.url),'utf8'),context);
 const mixed=context.admissionDistribution({admitted:3,not_admitted:5,pending:4,incomplete:2,resigned:1});
 assert.equal(mixed.total,8);assert.equal(mixed.admittedPercent,37.5);assert.equal(mixed.notAdmittedPercent,62.5);
 assert.equal(mixed.pending,4);assert.equal(mixed.incomplete,2);assert.equal(mixed.resigned,1);
 const empty=context.admissionDistribution({admitted:0,not_admitted:0,pending:8});
 assert.equal(empty.total,0);assert.equal(empty.admittedPercent,0);assert.equal(empty.notAdmittedPercent,0);
 assert.equal(context.admissionDistribution({admitted:8,not_admitted:0}).admittedPercent,100);
 assert.equal(context.admissionDistribution({admitted:0,not_admitted:8}).notAdmittedPercent,100);
});
