#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntime } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { projectJobs } from '../lib/jobsync-projection.mjs';
const {config}=loadRuntime();const store=new EventStore(config.paths.database);let client;
try{
  const apply=process.argv.includes('--apply');
  if(apply){
    if(!process.env.JOBSYNC_MCP_TOKEN)throw new Error('JOBSYNC_MCP_TOKEN is required; generate scoped jobs:write access in JobSync');
    const url=new URL(process.env.JOBSYNC_MCP_URL??'http://127.0.0.1:3737/api/mcp');
    if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Remote JobSync requires HTTPS');
    client=new Client({name:'openclaw-job-search',version:'1.0.0'});
    await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${process.env.JOBSYNC_MCP_TOKEN}`}}}));
    const {tools}=await client.listTools();
    if(!tools.some(t=>t.name==='add_job'))throw new Error('Connected JobSync does not expose add_job');
  }
  console.log(JSON.stringify(await projectJobs(store,(name,args)=>client.callTool({name,arguments:args}),{apply}),null,2));
}finally{await client?.close();store.close();}
