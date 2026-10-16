# หลักฐาน day/night UX

อ่าน [รายงาน](../DAY_NIGHT_UX_REVIEW.th.md) เพื่อดูวิธีเล่น ผล และขอบเขตการตีความ

- `before-ux.json`: การทำซ้ำปัญหาปิดเสียงและพลังที่จ่ายไม่ไหวก่อนแก้ ผ่าน UI จริงและการอ่าน GainNode
- `feedback-*.png`: ข้อความแจ้งหลังแก้บนคอมจอเตี้ยและมือถือ
- `recovery-mobile.png`: การตรวจหน้าจอเมืองว่างแบบ fixture แยกจากการเล่นตามธรรมชาติ
- `metadata.json`, `build-manifest.json`: ระบุ source และ build ที่ตรึงไว้สำหรับรอบต่อเนื่อง
- `desktop/`, `mobile/`: summary, timeline แบบ JSONL และภาพ warning/siege/dawn จากรอบที่จบจริง

Snapshots เป็นการอ่าน state; อินพุตอยู่ใน event/action/checkpoint ของ timeline การเปลี่ยน viewport/กล้องใช้การควบคุมเกมตามปกติ ค่า `wallSeconds` รวมการพัก เก็บภาพ และ overhead ของ software WebGL
