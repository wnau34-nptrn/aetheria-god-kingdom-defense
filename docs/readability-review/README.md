# หลักฐานการอ่านสถานการณ์

- `desktop-ready.png`, `desktop-blocked.png`: ใช้เมาส์เล็งพื้นที่ใน WebGL จริงผ่าน `placement-readout.spec.js`
- `hud-*.png`: พับแผงข้าง ตรวจแถบทรัพยากรและปุ่มกล้องที่ขนาดจอระบุในชื่อไฟล์
- `placement-compatibility.json`: เปรียบเทียบกฎวางอาคารกับ `2790b18` รวม 26,244 จุดในสี่ยุค ใช้ geometry จริงและ seed 1234 ใน jsdom ไม่ได้วัดภาพ
- `natural/`: การเล่นผ่าน UI ต่อเนื่อง **หนึ่งรอบแบบผสมความเร็ว** เร่งช่วงเช้าด้วย 5x แล้วใช้ 1x ตอนข้าม 18:00 และ 20:00 มี checkpoint ตรวจคำเตือน/การบุกที่ทั้ง 1x และ 5x พร้อมพักเกมเพื่อยืนยันว่าตัวนับเวลาไม่เดิน ไม่มีการข้ามเวลา เปลี่ยนยุค บังคับ RNG หรือเขียนสถานะโลกผ่าน API ไม่ใช่การเล่นเต็มรอบสองความเร็วหรือการเปรียบเทียบสมดุล

ใน `natural/metadata.json` มี hash ของเกม HTML และ CSS; `timeline.jsonl` เป็นข้อมูลอ่านจากเกมกับข้อความบน HUD; `summary.json` รวมการเปลี่ยนความเร็วและ checkpoint ภาพ 400px ใช้ขนาดจอที่รันจริง ภาพ 800px ขยาย viewport ตอนพักเกมเพื่อให้อ่านรายละเอียดได้ ไม่ใช้เปรียบเทียบ FPS

## ทำซ้ำ

เปิด dev server ก่อน ติดตั้ง Chromium ของ Playwright ด้วย `npx playwright install chromium` หรือระบุ `CHROMIUM_PATH` ไปยัง Chromium ที่ติดตั้งแล้ว คำสั่งต่อไปนี้เขียนหลักฐานลงโฟลเดอร์ใหม่ใน `/tmp` โดยปริยาย:

```sh
GAME_URL=http://127.0.0.1:5173 node tests/readability-playthrough.mjs
```

กำหนด `READABILITY_EVIDENCE` เพื่อเลือกโฟลเดอร์ปลายทางเอง สคริปต์ปฏิเสธการเขียนทับ metadata เดิม

เทียบกฎตำแหน่งซ้ำ:

```sh
git show 2790b18:src/legacy/game.js > /tmp/aetheria-placement-baseline.js
PLACEMENT_BASELINE_SOURCE=/tmp/aetheria-placement-baseline.js node tests/compare-placement.mjs
```

อ่านผลและข้อจำกัดใน [READABILITY_REVIEW.th.md](../READABILITY_REVIEW.th.md) การทดสอบอัตโนมัติไม่ใช่ผลจากผู้เล่นมนุษย์หรืออุปกรณ์มือถือจริง
