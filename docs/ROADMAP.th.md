# แผนพัฒนา AETHERIA

## เป้าหมายผลิตภัณฑ์

เกม single-player บนเบราว์เซอร์ที่ผู้เล่นเป็นเทพผู้พิทักษ์หมู่บ้านบนเกาะลอยฟ้า ช่วงกลางวันเตรียมเมือง ช่วงกลางคืนใช้พลังและแนวป้องกันรักษาชีวิตชาวบ้าน ให้ภาพเป็นแฟนตาซีที่แสง วัสดุ และพฤติกรรมมีความน่าเชื่อถือ

Milestone ต่อไปนี้เรียงตาม dependency ไม่ใช่การรับปากระยะเวลา ต้องประเมินจากทีมและอุปกรณ์เป้าหมายก่อนกำหนดวันส่ง

## M0 — ฐานพัฒนาและความถูกต้อง (รอบนี้)

- [x] เก็บต้นฉบับ byte-for-byte และ hash
- [x] แยก HTML, CSS, engine และเกม; ติดตั้ง/รัน/build ด้วย npm
- [x] แก้ pause/dilemma/time-base/touch/advance-button/save-validation
- [x] เพิ่ม browser smoke tests, unit tests และ workflow CI
- [x] จัดทำ audit, architecture และ roadmap
- [ ] บันทึก performance บนอุปกรณ์จริง 3 ระดับ และทดสอบระยะยาว

## M1 — Vertical slice ที่เล่นสนุก

ทำหนึ่งเกาะ หนึ่งยุค 3 คืน ศัตรูพื้นฐาน/วิ่งเร็ว/ทำลายป้อม พลังที่ใช้ตัดสินใจจริง 3–4 แบบ

งาน: เพิ่ม wave director พร้อม countdown/preview, วิหารมี shield จำกัด, defeat/victory/retry, placement preview ของบ้าน/ป้อม, ค่าใช้จ่ายและ cooldown ที่อ่านได้, tutorial ไม่เกิน 3 ขั้น และซ่อน debug controls หลัง dev mode

เกณฑ์รับ: ผู้เล่นใหม่เข้าใจเป้าหมายได้ภายใน 2 นาที จบหรือแพ้ได้โดยไม่ใช้เครื่องมือ debug ความยาว run 15–20 นาทีเป็นสมมติฐานที่ต้อง playtest ทุกการตายอธิบายได้ มีอย่างน้อยสองวิธีตั้งรับที่ใช้ได้จริง

การวัด: เวลาใช้พลังครั้งแรก อาหารขาดครั้งแรก อัตรารอดต่อคืน สาเหตุแพ้ และสิ่งที่ผู้เล่นไม่เข้าใจ เริ่มด้วย playtest ที่ยินยอม ไม่ต้องเพิ่ม analytics ส่งข้อมูลออกจากเครื่องโดยอัตโนมัติ

## M2 — Simulation และเซฟที่เชื่อถือได้

แยก world state/IDs ออกจาก mesh, ใช้ simulation fixed-step ที่ 30Hz พร้อมขีดจำกัด catch-up, RNG แยก terrain/simulation/visual และระบบคำสั่ง input ที่ทดสอบได้

Save V2 ต้องมี schema version, seed, terrain offsets, game mode, wave/timers, resources, structures/progress/hp, agents/roles/hunger/jobs, nature state และ RNG state ใช้ migration V1 แบบระบุว่าเป็น checkpoint สร้างโลกใหม่ มี validation ก่อน apply และ backup ก่อน overwrite

เกณฑ์รับ: save → reload ได้ตำแหน่ง/HP/เกาะ/คลื่นเดิม, invalid save ไม่ทำให้โลกปัจจุบันเสีย, pause คงทุกค่าที่กระทบการต่อสู้, เล่น 1x และ 5x ได้ผลเทียบกันภายใต้ seed/คำสั่งเดียวกันใน simulation test

## M3 — Three.js จริงและภาพหนึ่งมุมที่ได้มาตรฐาน

ติดตั้ง `three` แบบ pin version ใน branch แยก ย้าย geometry adapter, color space, raycast และ entity selection ก่อนย้ายทั้งโลก ดูรายละเอียดใน ARCHITECTURE.md

เริ่มจากกล้องหลัก หมู่บ้าน วิหาร แม่น้ำ และแสงกลางวัน/กลางคืน ใช้ glTF/GLB สำหรับชาวบ้านกับอาคารหลัก, PBR textures พร้อมสิทธิ์ชัดเจน, animation walk/work/attack/death มี instance/LOD ของพืชและ props

เกณฑ์รับ: ใช้ `THREE.REVISION` ของไลบรารีจริง ไม่มี shim เขียนทับ global, เลือกวัตถุและปั้นเกาะได้ตรงตำแหน่ง, ภาพ UI อ่านได้ทั้งกลางวัน/คืน, เปรียบเทียบภาพก่อน–หลังมุมเดียวกัน และไม่มีข้อผิดพลาด WebGL

## M4 — Performance และ UI บนอุปกรณ์เป้าหมาย

ตั้ง quality presets low/medium/high, จำกัด device pixel ratio, shadow distance/resolution, instance/LOD และ particle budget วัดด้วย browser profiler และ SpectorJS ก่อน/หลังทุกการปรับสำคัญ

เป้าหมายเริ่มต้นที่ต้องยืนยันด้วยเครื่องจริง: desktop กลาง 60fps ที่ 1080p, mobile กลาง 30fps ใน preset low, frame time p95 ไม่กระโดดระหว่างคลื่นตาม scenario ที่กำหนด ตัวเลขนี้เป็นเกณฑ์ออกแบบ ยังไม่ใช่ผลทดสอบ

HUD หลักแสดงศรัทธา อาหาร วิหาร และคลื่นเท่านั้น เปิดรายละเอียดเมืองตามต้องการ มือถือใช้ bottom sheet ทีละแผง ปุ่มสัมผัสประมาณ 44px ปรับ landscape/safe-area, keyboard focus และ reduced motion

เกณฑ์รับ: touch/pointer ไม่ใช้พลังซ้ำ, หมุนจอไม่ทำ UI สูญหาย, ทดสอบ session 30 นาทีและเปลี่ยนเกาะ/ยุคซ้ำโดย memory ไม่โตต่อเนื่องจาก resource ที่เลิกใช้

## M5 — เนื้อหาและความสมจริงของชุมชน

เพิ่มความสัมพันธ์ชาวบ้าน/เหตุการณ์ที่มีผลระยะยาว, งานและการขนส่งที่เห็นเหตุ–ผล, ศัตรูพิเศษ/บอส, biome และ meta progression หลัง M1 ยืนยันว่าสนุกแล้ว แยก art scene preview ออกจากเหตุการณ์จริงและจัดทำ asset attribution

เกณฑ์รับ: เนื้อหาใหม่สร้างการตัดสินใจเพิ่ม ไม่เพิ่มเพียงจำนวนสิ่งบนจอ มี playtest ซ้ำเพื่อประเมินความเข้าใจ สมดุล และความอยากเล่นต่อ

## งานแรกที่แนะนำหลังนำขึ้น GitHub

1. กำหนดชนะ/แพ้และเวฟ 3 คืนใน sandbox ปัจจุบัน เพื่อพิสูจน์ความสนุกเร็ว
2. แยก world schema และ full save ก่อนผูกข้อมูลเพิ่มกับ mesh
3. ทำ Three.js migration spike หนึ่งมุม พร้อมผล performance และภาพเปรียบเทียบ ก่อนอนุมัติให้ย้ายทั้งเกม
