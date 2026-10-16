# เผยแพร่เกมด้วย GitHub Pages

PR #1 รวมเข้า `main` แล้ว เกมใช้ Vite build และกำหนด `base: './'` เพื่อให้ JavaScript/CSS โหลดได้ภายใต้เส้นทาง `/aetheria-god-kingdom-defense/`

## เปิด Pages ครั้งแรก

เจ้าของ repository เปิด [Settings → Pages](https://github.com/wnau34-nptrn/aetheria-god-kingdom-defense/settings/pages) แล้วเลือก **Build and deployment → Source → GitHub Actions** เพียงครั้งเดียว หากหน้ายังมีปุ่ม Save ให้กด Save

GitHub metadata ที่ตรวจตอนเตรียมระบบยังระบุ `has_pages: false` เครื่องมือ GitHub ที่เชื่อมต่อในแชตไม่มีคำสั่งแก้การตั้งค่า Pages จึงต้องเปิดค่านี้จากหน้า Settings ไม่ต้องส่ง token หรือรหัสผ่านมาในแชต

หลังเปิดแล้วให้เข้า [Actions → Validate game](https://github.com/wnau34-nptrn/aetheria-god-kingdom-defense/actions/workflows/ci.yml) และเลือก **Re-run failed jobs** ของรอบล่าสุด หรือ **Run workflow → main**

URL ที่จะใช้หลัง deployment สำเร็จ:

https://wnau34-nptrn.github.io/aetheria-god-kingdom-defense/

## การเผยแพร่ครั้งต่อไป

เมื่อมีการ push เข้า `main` workflow จะตรวจการตั้งค่า Pages, รัน unit/browser/build, ทดสอบ production ใต้เส้นทาง project, แล้วส่งเฉพาะ `dist/` เป็น Pages artifact และ deploy เมื่อการตรวจผ่านทั้งหมด ส่วน pull request จะตรวจเกมและ production โดยไม่ deploy

job `verify-pages` เปิด URL ที่ deployment คืนมาด้วย Chromium ใช้ UI จริงตรวจ 1x/5x/pause, เลือกพลัง, แตะฝนครั้งเดียวบนมือถือ และตรวจไฟล์ `version.json` ให้ตรงกับ commit ที่เผยแพร่ เก็บภาพ desktop/mobile และผล JSON ไว้ใน artifact `deployed-game-evidence` ของ Actions

## ตรวจ production ในเครื่อง

```sh
npm ci
npm run build
npx playwright install chromium
npm run test:production
```

สคริปต์เปิด HTTP server ชั่วคราวและทดสอบไฟล์จาก `dist/` ใต้ `/aetheria-god-kingdom-defense/` โดยไม่ใช้ Vite dev server ปิด server/browser เมื่อจบ หากมี Chromium ในระบบให้ระบุ `CHROMIUM_PATH`

ผลตรวจ local เก็บใน [pages-review/local/summary.json](pages-review/local/summary.json) ภาพและผล local ไม่ใช่หลักฐานว่า URL บน Pages เปิดแล้ว สถานะเผยแพร่ให้ดู job `deploy-pages` และ `verify-pages`

## ข้อจำกัดการเล่น

เกมยังเป็น prototype/sandbox เซฟเก็บทรัพยากรและยุค ไม่ได้เก็บโลกทั้งใบ แนะนำให้ใช้โปรไฟล์เบราว์เซอร์ใหม่สำหรับการทดลองตั้งแต่ต้น อ่าน [แนวทางลองเล่น](PLAYTEST_GUIDE.th.md) เพื่อส่งผลที่ใช้ปรับจังหวะและความยากได้
