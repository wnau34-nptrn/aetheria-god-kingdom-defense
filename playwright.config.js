import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', timeout: 180000, workers: 1,
  // Software WebGL can occupy a browser turn longer than the default 5s.
  expect: { timeout:30000 },
  maxFailures: process.env.CI ? 1 : 0,
  use: { baseURL:'http://127.0.0.1:5173', viewport:{width:1280,height:800},
    launchOptions:{...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']} },
  webServer: {command:'npm run dev -- --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
});
