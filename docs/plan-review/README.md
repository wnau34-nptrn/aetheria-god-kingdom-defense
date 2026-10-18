# หลักฐานตรวจเพื่อปรับแผน — 18 ตุลาคม 2026

ฐานเกม: `7bd3f97beb381e4b24ca5550eb981727c1db5465` ตรวจ local HEAD ตรงกับ remote main ก่อนเปลี่ยนเอกสาร รอบนี้ไม่มีการแก้ source เกม

- [simulation.json](simulation.json): seeded integration harness เรียก runtime จริงและ stub renderer/audio ตรวจสี่ยุค การสูญเสีย object เดิมเมื่อขึ้นยุค งานกลางวัน–กลางคืนที่ไม่มีอสูร การกลับงานกลางวัน auto-advance 5x และ schema เซฟเก้าฟิลด์
- [browser.json](browser.json): WebGL จริง desktop 1366×900 และ touch viewport 390×844 จ้างทหารผ่าน HUD สองครั้ง ใช้ sandbox ข้ามกลางคืน เดิน AI จนปะทะจริง ตรวจ page errors และปุ่มหลักหกปุ่มทั้งสถานะเมือง/รบ
- [checks.json](checks.json): ผลชุดทดสอบเดิม/build และขอบเขตหลักฐานที่ตรวจ

Browser extension/CUA ไม่มี tool ที่เรียกได้ใน catalog รอบนี้ ใช้ Playwright ของ repository กับ `/usr/bin/chromium` และ SwiftShader ภาพที่ได้ไม่ใช่หลักฐาน FPS ของเครื่องจริง

การอ่าน `commands` ใน browser report ตรวจ selector `#command-bar button` ตาม DOM ปัจจุบัน ค่าทั้งหกมาจากปุ่มที่มีจริง `insideViewport` ตรวจกรอบจอและ `hittable` ตรวจ element ที่กึ่งกลางปุ่ม ค่าดังกล่าวไม่ได้แปลว่าฝึก/สร้างได้เมื่อทรัพยากรไม่พอ

ภาพที่ตรวจด้วยตาประกอบ: `desktop-city.png`, `desktop-combat.png`, `desktop-decision.png`, `mobile-city.png`, `mobile-combat.png` เก็บพร้อม runner และ log ฉบับเต็มที่ `/workspace/attachments/aetheria-plan-review/` ของงานนี้ ภาพขนาดใหญ่ไม่รวมใน git

ใช้ `npm test` และ `npm run build` ใน repository สำหรับ regression/build รอบนี้ไม่ได้รัน browser suite ทั้ง 28 สถานการณ์ซ้ำ และไม่ได้ทดลองทางเลือกเหตุการณ์ครบทั้ง 15 ข้อผ่านหน้าเกมในรอบนี้ หลักฐานนี้รวมการตรวจโค้ดกับชุด unit/integration เดิม จึงไม่อ้างว่าเล่นทุกเส้นทางด้วยมือหรือผ่านยุคทั้งหมดโดยการเล่นธรรมชาติ

อ่าน [ข้อค้นพบและผลต่อแผน](../CURRENT_REVIEW.th.md) และ [แผนฉบับปรับปรุง](../ROADMAP.th.md)
