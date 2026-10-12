import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
// Narrow pilot adapter. Unknown custom controls are blocks, not guessed answers.
export async function greenhouseDriver({headless=false,receiptDir,chromium}) {
  const browser=await chromium.launch({headless});let page;
  async function inspect() {
    const content=await page.locator('body').innerText();
    let blockedReason;
    if(await page.locator('iframe[src*="captcha"], [data-sitekey], .g-recaptcha, .h-captcha').count())blockedReason='CAPTCHA requires manual handling';
    if(/flagged as (?:possible )?spam|sign in to apply|create an account/i.test(content))blockedReason='Account or anti-bot block';
    const questions=await page.locator('input, textarea, select').evaluateAll(elements=>elements.filter(e=>!['hidden','submit','button','file'].includes(e.type)&&!e.disabled).map((e,i)=>{
      e.setAttribute('data-job-field',String(i));
      return {key:e.name||e.id||`unmapped_${i}`,selector:`[data-job-field="${i}"]`,required:e.required||e.getAttribute('aria-required')==='true',kind:e.type==='checkbox'?'consent':'fact',type:e.tagName.toLowerCase()==='select'?'select':e.type,employerSpecific:/previous.*employ|relative|relationship/i.test(e.name+' '+e.id)};
    }));
    if(await page.locator('[role="combobox"]:not(select)').count())blockedReason='Custom combobox requires an audited adapter';
    return {url:page.url(),title:await page.locator('h1').first().innerText().catch(()=>''),questions,blockedReason};
  }
  return {
    async preflight(destination){
      const u=new URL(destination.url);
      if(!['job-boards.greenhouse.io','boards.greenhouse.io'].includes(u.hostname))throw new Error('Pilot supports Greenhouse only');
      page=await browser.newPage();
      // No redirects to another employer and no non-ATS application POSTs.
      await page.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(request.isNavigationRequest()&&url.origin!==u.origin)return route.abort();
        if(!['GET','HEAD'].includes(request.method())&&!['greenhouse.io','boards-api.greenhouse.io','job-boards.greenhouse.io','boards.greenhouse.io'].some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))return route.abort();
        return route.continue();
      });
      await page.goto(destination.url,{waitUntil:'domcontentloaded',timeout:30000});
      return inspect();
    },
    async fill(destination,answers,resumeBytes){
      const form=await inspect();
      for(const q of form.questions){
        const control=page.locator(q.selector);
        if(q.kind==='consent'&&!Object.hasOwn(answers,q.key)){await control.uncheck();continue;}
        if(!Object.hasOwn(answers,q.key))continue;
        if(q.type==='select')await control.selectOption({label:String(answers[q.key])});
        else if(q.type==='checkbox')await control.setChecked(answers[q.key]===true);
        else if(!['text','email','tel','number','textarea','url'].includes(q.type))throw new Error(`Unsupported control ${q.type}`);
        else await control.fill(String(answers[q.key]));
      }
      const files=page.locator('input[type=file]');
      if(await files.count()>1)throw new Error('Additional document upload requires a separate audited plan');
      if(await files.count()===1){await files.setInputFiles({name:basename(destination.resumePath),mimeType:'application/pdf',buffer:resumeBytes});if(!await files.evaluate(e=>e.files?.length===1))throw new Error('Resume upload did not attach');}
      for(const q of form.questions)if(Object.hasOwn(answers,q.key)&&q.type!=='checkbox'&&q.type!=='select'){
        if(await page.locator(q.selector).inputValue()!==String(answers[q.key]))throw new Error(`Field ${q.key} did not retain approved value`);
      }
    },
    inspect,
    async submit(){
      const button=page.getByRole('button',{name:/submit application/i});
      if(await button.count()!==1)throw new Error('Unique final submit button unavailable');
      await button.click();
      await page.getByText(/thank you for applying|application (?:has been )?received|application submitted/i).first().waitFor({timeout:20000});
      const text=await page.getByText(/thank you for applying|application (?:has been )?received|application submitted/i).first().innerText();
      const receipt={url:page.url(),text,observedAt:new Date().toISOString()};
      if(receiptDir){mkdirSync(receiptDir,{recursive:true});receipt.path=join(receiptDir,`receipt-${createHash('sha256').update(receipt.url+receipt.observedAt).digest('hex').slice(0,16)}.png`);await page.screenshot({path:receipt.path,fullPage:true}).catch(()=>{delete receipt.path;});}
      return receipt;
    },
    async closePosting(){await page?.close();page=null;},
    async close(){await browser.close();},
  };
}
