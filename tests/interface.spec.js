import { test, expect } from '@playwright/test';

for (const viewport of [{width:1280,height:800},{width:390,height:844}]) {
  test(`progressive UI protects playfield and keeps tools accessible at ${viewport.width}`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);await page.goto('/');await page.waitForFunction(()=>window.AETHERIA_API);
    await page.click('[data-speed="0"]');
    await expect(page.locator('#left-panel')).toBeHidden();await expect(page.locator('#right-panel')).toBeHidden();await expect(page.locator('#game-menu')).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/bubbles-hidden/);
    const faith=await page.locator('#quick-faith').textContent();
    await page.click('[data-power="lightning"]');
    await expect(page.locator('[data-power="lightning"]')).toHaveAttribute('aria-pressed','true');
    await page.click('#btn-toggle-left-hud');
    await expect(page.locator('#left-panel')).toBeVisible();
    await expect(page.locator('#btn-toggle-left-hud')).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Digit4');
    expect(await page.evaluate(()=>AETHERIA_API.state.activePower)).toBe('lightning');
    await page.click('#btn-toggle-right-hud');
    await expect(page.locator('#left-panel')).toBeHidden();await expect(page.locator('#right-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#right-panel')).toBeHidden();await expect(page.locator('#btn-toggle-right-hud')).toBeFocused();
    await page.keyboard.down('KeyW');
    await page.click('#btn-menu');
    expect(await page.evaluate(()=>Object.values(AETHERIA_API.camCtrl.keys).some(Boolean))).toBe(false);
    await page.keyboard.up('KeyW');
    await expect(page.locator('#game-menu')).toBeVisible();
    await page.click('[data-speed="0"]');
    expect(await page.evaluate(()=>AETHERIA_API.state.timeScale)).toBe(0);
    await page.click('#btn-toggle-audio');
    await expect(page.locator('#btn-toggle-audio')).toHaveText('🔇 เสียง: ปิด');
    await page.click('#btn-toggle-audio');
    await expect(page.locator('#btn-toggle-audio')).toHaveText('🔊 เสียง: เปิด');
    await page.getByText('การแสดงผล',{exact:true}).click();await page.click('#btn-toggle-bubbles');
    await expect(page.locator('body')).not.toHaveClass(/bubbles-hidden/);
    await page.getByText('เครื่องมือโลกและยุค',{exact:true}).click();
    await expect(page.locator('[data-era="4"]')).toBeVisible();
    await page.locator('#game-menu [data-close-drawer]').click();
    await page.click('#btn-toggle-left-hud');
    // A world tap dismisses the drawer and must not cast the selected lightning.
    await page.locator('#drawer-scrim').click({position:{x:viewport.width>600?600:5,y:viewport.height>500?420:180}});
    await expect(page.locator('#left-panel')).toBeHidden();await expect(page.locator('#quick-faith')).toHaveText(faith);
    await page.keyboard.press('KeyH');await expect(page.locator('#god-dock-wrapper')).toHaveCSS('pointer-events','none');
    await page.click('#btn-menu');
    await page.click('#btn-toggle-all-hud');
    await expect(page.locator('body')).not.toHaveClass(/hud-hidden/);
    await expect(page.locator('#game-menu')).toBeHidden();
    await page.click('[data-power="observe"]');
    await page.screenshot({path:`test-results/interface-${viewport.width}.png`,animations:'disabled',timeout:90000});
    expect(errors).toEqual([]);
  });
}
