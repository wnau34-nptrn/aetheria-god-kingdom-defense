# หลักฐาน production / Pages

`local/` เป็น production build จากโค้ดเกมที่รวม PR #1 แล้ว ใช้ HTTP server เสิร์ฟเฉพาะไฟล์ `dist/` ใต้เส้นทาง project ของ GitHub Pages

ตรวจ desktop 1280×800 และมือถือ 390×844: ไฟล์ HTML/CSS/JavaScript ตอบสำเร็จ, ไม่พบ page error หรือ request ล้มเหลว, 1x/5x เดินจริง, pause หยุด simulation, เลือกพรสร้างหอคอยแล้วเห็นคำแนะนำ, แตะฝนมือถือเสียศรัทธา 15 ครั้งเดียว และแถบข้อมูลอยู่ในจอ ใช้ UI input จริงและอ่าน API เพื่อยืนยันผล

นี่เป็นหลักฐาน local ไม่ใช่การยืนยันว่า GitHub Pages เปิดใช้งานแล้ว ดู [คู่มือเผยแพร่](../PAGES.th.md) และ artifact `deployed-game-evidence` จาก job `verify-pages` สำหรับการตรวจ URL ออนไลน์จริง
