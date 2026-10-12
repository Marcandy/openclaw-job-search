function bodyText(part) {
  const own=part.mimeType==='text/plain'&&part.body?.data?Buffer.from(part.body.data,'base64url').toString('utf8'):'';
  return [own,...(part.parts??[]).map(bodyText)].join('\n');
}
export async function readGmail({token,labelId,maxResults=30,fetcher=fetch}) {
  if(!token||!labelId)throw new Error('GMAIL_ACCESS_TOKEN and a dedicated job-search label ID are required');
  const get=async path=>{
    const response=await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Gmail read failed (${response.status}); access tokens and bodies are not logged`);
    return response.json();
  };
  const listing=await get(`messages?labelIds=${encodeURIComponent(labelId)}&maxResults=${Math.min(100,maxResults)}&q=newer_than%3A30d`);
  const messages=[];
  for(const entry of listing.messages??[]){
    const m=await get(`messages/${encodeURIComponent(entry.id)}?format=full`);
    messages.push({id:m.id,subject:m.payload.headers?.find(h=>h.name.toLowerCase()==='subject')?.value??'',body:bodyText(m.payload),occurredAt:new Date(Number(m.internalDate)).toISOString()});
  }
  return {messages,nextPageToken:listing.nextPageToken??null};
}
