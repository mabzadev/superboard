import{env}from"cloudflare:workers";import{SELF}from"cloudflare:test";import{signProjectContext}from"@opengrow/contracts";import{describe,expect,it}from"vitest";const secret="dynamic-runtime-secret";
describe("Dynamic Links Worker with D1",()=>{
 it("runs campaigns, links, redirect, domains, previews and tracking",async()=>{
  const campaign=await data<{id:string}>(await mutate("POST","/internal/v1/campaigns",{name:"Launch",slug:"launch",status:"active",metadata:{channel:"social"}},"campaign"));
  const link=await data<{id:string;slug:string}>(await mutate("POST","/internal/v1/links",{slug:"welcome",name:"Welcome",destination_url:"https://example.com/default",destinations:{ios:"https://example.com/ios"},campaign_id:campaign.id,title:"Welcome",utm:{source:"social"}},"link"));
  await mutate("POST","/internal/v1/redirect-rules",{name:"Android",priority:1,rule:{platform:"android",destination_url:"https://example.com/android"}},"rule");
  const ios=await request("POST","/internal/v1/links/welcome/resolve",{platform:"ios"});await expect(ios.json()).resolves.toMatchObject({data:{link_id:link.id,destination_url:"https://example.com/ios"}});
  const android=await request("POST","/internal/v1/links/welcome/resolve",{platform:"android"});await expect(android.json()).resolves.toMatchObject({data:{destination_url:"https://example.com/android"}});
  const domain=await mutate("POST","/internal/v1/domains",{hostname:"links.example.com",is_default:true},"domain");expect(domain.status).toBe(201);
  await mutate("PUT","/internal/v1/social-preview",{title:"OpenGrow",description:"Growth",image_url:"https://example.com/cover.png"},"social");
  await mutate("PUT","/internal/v1/tracking",{enabled:true,provider:"opengrow",configuration:{consent:true}},"tracking");
  await mutate("POST","/internal/v1/tracking/events",{events:[
   {id:"event-1",link_id:link.id,campaign_id:campaign.id,type:"view",platform:"ios",occurred_at:"2026-08-07T10:00:00Z"},
   {id:"event-2",link_id:link.id,campaign_id:campaign.id,type:"open",platform:"ios",occurred_at:"2026-08-07T10:01:00Z"},
   {id:"event-3",link_id:link.id,campaign_id:campaign.id,type:"install",platform:"ios",occurred_at:"2026-08-07T10:02:00Z"},
   {id:"event-4",link_id:link.id,campaign_id:campaign.id,type:"reinstall",platform:"ios",occurred_at:"2026-08-07T10:03:00Z"},
   {id:"event-5",link_id:link.id,campaign_id:campaign.id,type:"reactivation",platform:"ios",occurred_at:"2026-08-07T10:04:00Z"},
   {id:"event-6",link_id:link.id,campaign_id:campaign.id,type:"app_open",platform:"ios",occurred_at:"2026-08-07T10:05:00Z"},
   {id:"event-7",link_id:link.id,campaign_id:campaign.id,type:"user_referred",platform:"ios",occurred_at:"2026-08-07T10:06:00Z"},
   {id:"event-8",link_id:link.id,campaign_id:campaign.id,type:"time_spent",platform:"ios",occurred_at:"2026-08-07T10:07:00Z",engagement_time:45},
   {id:"event-9",link_id:link.id,campaign_id:campaign.id,type:"conversion",platform:"ios",occurred_at:"2026-08-07T10:08:00Z",revenue_cents:1299},
  ]},"events");
  const stats=await request("GET",`/internal/v1/statistics?from=2026-08-07&to=2026-08-07&campaign_id=${campaign.id}`);await expect(stats.json()).resolves.toMatchObject({data:{totals:{views:1,opens:1,installs:1,reinstalls:1,reactivations:1,app_opens:1,user_referred:1,time_spent:45,revenue:1299}}});
  const links=await request("GET","/internal/v1/links?from=2026-08-07&to=2026-08-07&platform=ios");await expect(links.json()).resolves.toMatchObject({data:[{id:link.id,total_views:1,total_opens:1,total_installs:1,total_reinstalls:1,total_reactivations:1,total_app_opens:1,total_user_referred:1,total_time_spent:45,total_revenue:1299}]});
  await env.DB.prepare("INSERT INTO link_events (id,project_id,link_id,campaign_id,event_type,platform,occurred_at,metadata_json) VALUES ('legacy-time', '11', ?, ?, 'view', 'ios', '2026-08-07 11:00:00', '{}')").bind(link.id,campaign.id).run();
  const linkStats=await request("GET",`/internal/v1/statistics?from=2026-08-07&to=2026-08-07&link_id=${link.id}`);await expect(linkStats.json()).resolves.toMatchObject({data:{totals:{views:2}}});
  const audit=await env.DB.prepare("SELECT COUNT(*) count FROM audit_events WHERE project_id='11'").first<{count:number}>();expect(Number(audit?.count)).toBeGreaterThanOrEqual(7);
 });
 it("isolates projects",async()=>{const list=await request("GET","/internal/v1/links",undefined,12);await expect(list.json()).resolves.toMatchObject({data:[]});});
});
async function mutate(method:string,path:string,body:unknown,key:string,projectId=11){return request(method,path,body,projectId,key);}async function request(method:string,path:string,body?:unknown,projectId=11,key?:string){const pathname=new URL(path,"https://dynamic.internal").pathname;const issuedAt=Math.floor(Date.now()/1000);const requestId=crypto.randomUUID();const context={module:"dynamic-links"as const,method,pathname,projectId,projectRef:"10-test",instanceId:10,environment:"test"as const,actorId:2,role:"owner",requestId,issuedAt};const headers=new Headers({"x-internal-token":secret,"x-project-id":String(projectId),"x-project-ref":"10-test","x-instance-id":"10","x-environment":"test","x-actor-id":"2","x-role":"owner","x-request-id":requestId,"x-context-issued-at":String(issuedAt),"x-context-version":"1","x-context-signature":await signProjectContext(context,secret)});if(body!==undefined)headers.set("content-type","application/json");if(key)headers.set("idempotency-key",key);return SELF.fetch(`https://dynamic.internal${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}async function data<T>(response:Response):Promise<T>{return((await response.json())as{data:T}).data;}
