import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:800,height:600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.AETHERIA_API);
const actions=await page.evaluate(()=>{
  const a=AETHERIA_API;a.state.timeScale=0;
  a.evolveToEra(3);const era3={population:a.agents.length,buildings:a.buildings.length};
  a.evolveToEra(4);const era4={population:a.agents.length,buildings:a.buildings.length};
  a.state.faith=200;a.castRainPower(6,6);a.state.faith=200;a.applyTerraforming(40,25,1,0.08);a.state.faith=200;a.castLightningStrike(6,6);a.state.faith=200;a.castMiracleBeam(35,20);
  a.camCtrl.target.x=20;a.camCtrl.reset();
  a.state.timeScale=1;a.state.timeOfDay=20.25;a.state.isNight=false;a.state.siegeTriggeredTonight=false;
  return {era3,era4,cameraReset:a.camCtrl.target.x===0};
});
await page.waitForFunction(()=>AETHERIA_API.monsters.length>0);
const night=await page.evaluate(()=>{AETHERIA_API.state.timeScale=0;return{monsters:AETHERIA_API.monsters.length,isNight:AETHERIA_API.state.isNight};});
await page.screenshot({path:'docs/screenshots/current-night.png'});
const result={actions,night,errors};await writeFile('docs/additional-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(result);
await browser.close();
