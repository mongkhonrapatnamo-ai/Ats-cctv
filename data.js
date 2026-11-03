// Fixed setup for the ATS-CCTV Service Hub prototype, taken from www.ats-cctv.com (Nov 2569):
// company details, the three service lines, packages, prices, products and brands.
// Everything people enter (customers, tickets, assets, stock, contracts, PM) lives in the record store in app.js,
// which starts empty apart from `seed`.
window.ATS_DATA = {
  company: {
    name: 'บริษัท ออลเดอะไทม์ เซอร์วิส จำกัด', en: 'ALL THE TIME SERVICES CO.,LTD', brand: 'ATS CCTV & IT Service',
    tagline: 'รับออกแบบ · จำหน่าย · ติดตั้ง · บริการแบบรายปีครบวงจร',
    phone: '089-145-5099', email: 'teerawat@ats-cctv.com', line: 'atscctv',
    facebook: 'https://www.facebook.com/profile.php?id=100054640200549', web: 'https://www.ats-cctv.com/',
    portal: 'https://www.ats-cctv.com/itservice/login.php',
    addr: 'เลขที่ 141/36 หมู่ที่ 6 ต.นาเกลือ อ.บางละมุง จ.ชลบุรี 20150', tax: '0-2055-64020-49-7',
    hours: 'ทุกวัน 08:00 – 18:00 น.', onsite: 'On-site ภายใน 4 ชม. ในพื้นที่ชลบุรี',
    warranty: [['งานติดตั้ง', 'รับประกัน 1 ปี'], ['งานซ่อมคอม / แอร์', 'รับประกัน 3 เดือน'], ['ล้างแอร์', 'รับประกัน 30 วัน']],
    stats: [['500+', 'รายการสินค้า'], ['1,200+', 'ลูกค้าที่ไว้วางใจ'], ['10+', 'ปีประสบการณ์'], ['24/7', 'บริการหลังการขาย']],
    divisions: [
      { key: 'cctv', name: 'ATS CCTV & Security Service', icon: 'cctv', does: 'กล้องวงจรปิด · คีย์การ์ด · สัญญาณกันขโมย · ไม้กั้น · Intercom', stat: '1,000+ จุดที่ติดตั้ง · 500+ ลูกค้า' },
      { key: 'ac', name: 'ATS Air Service', icon: 'snowflake', does: 'ติดตั้ง · ล้าง · ซ่อม · เติมน้ำยา · ระบบแอร์สำนักงาน', stat: '2,000+ เครื่องที่ติดตั้ง · 800+ ลูกค้า' },
      { key: 'net', name: 'ATS IT Service', icon: 'network', does: 'ซ่อม / อัปเกรดคอม · LAN / WiFi · Server & NAS · Firewall', stat: '300+ ระบบที่ติดตั้ง · 1,000+ เครื่องที่ซ่อม' }
    ],
    // workplaces in the old repair system (www.ats-cctv.com/itservice)
    portalSites: ['ATSCCTV', 'HANYANG', 'KOTEC', 'SIAMOKAYA', 'SPACC', 'THAITES']
  },

  types: {
    cctv:   { label: 'กล้องวงจรปิด CCTV', short: 'CCTV',     icon: 'cctv',        hint: 'กล้อง AHD / IP / PTZ, NVR / DVR' },
    net:    { label: 'Network & WiFi',    short: 'Network',  icon: 'wifi',        hint: 'LAN, WiFi, Firewall, Server / NAS' },
    ac:     { label: 'แอร์',               short: 'แอร์',      icon: 'snowflake',   hint: 'ติดตั้ง, ล้าง, ซ่อม, เติมน้ำยา' },
    pc:     { label: 'คอมพิวเตอร์',         short: 'IT',       icon: 'monitor',     hint: 'ซ่อม, อัปเกรด, ประกอบเครื่อง' },
    access: { label: 'Security & Access',  short: 'Security', icon: 'fingerprint', hint: 'คีย์การ์ด, กันขโมย, ไม้กั้น' },
    other:  { label: 'งานติดตั้งทั่วไป',     short: 'ทั่วไป',    icon: 'wrench',      hint: 'สำรวจหน้างาน / งานอื่น ๆ' }
  },

  severities: {
    crit: { label: 'วิกฤต',   sla: 4,  slaText: 'On-site ภายใน 4 ชม. (ชลบุรี) · ระบบหยุดทำงาน' },
    high: { label: 'สูง',     sla: 8,  slaText: 'SLA ภายใน 8 ชม. · กระทบการใช้งานบางส่วน' },
    med:  { label: 'ปานกลาง', sla: 24, slaText: 'SLA ภายใน 24 ชม. · ยังใช้งานได้' },
    low:  { label: 'ต่ำ',      sla: 72, slaText: 'SLA ภายใน 72 ชม. · นัดตามสะดวก' }
  },

  // group = which list tab the status falls under
  statuses: {
    'รออนุมัติ':       { group: 'pending', tone: 'violet' },
    'รอมอบหมาย':      { group: 'pending', tone: 'med' },
    'รอนัดหมาย':       { group: 'pending', tone: 'low' },
    'กำลังดำเนินการ':  { group: 'doing',   tone: 'info' },
    'รอตรวจรับ':       { group: 'doing',   tone: 'violet' },
    'รออะไหล่':        { group: 'parts',   tone: 'high' },
    'เสร็จสิ้น':        { group: 'done',    tone: 'ok' }
  },

  // the starting record set: one technician, the owner, who covers every team
  seed: {
    techs: [{ id: 'teerawat', name: 'ธีรวัฒน์ ถาวร', short: 'ธีรวัฒน์ ถ.', initial: 'ธ', hue: 'blue', team: 'ทุกทีม', phone: '089-145-5099', leave: false }]
  },

  // from the website: service packages (price null = "ติดต่อเรา", 0 = free diagnosis) and brands per line
  packages: {
    cctv: [
      { name: 'แพ็กเกจบ้าน S', size: '2 กล้อง', price: 4900, unit: 'ชุด', items: ['กล้อง AHD 2MP 2 ตัว', 'เครื่องบันทึก DVR 4 ช่อง', 'HDD 1TB บันทึก 30 วัน', 'ดูผ่านมือถือฟรี', 'ติดตั้งพร้อมรับประกัน 1 ปี'] },
      { name: 'แพ็กเกจบ้าน M', size: '4 กล้อง', price: 7900, unit: 'ชุด', hot: true, items: ['กล้อง AHD 2MP 4 ตัว', 'เครื่องบันทึก DVR 4 ช่อง', 'HDD 2TB บันทึก 30 วัน', 'แจ้งเตือน Motion', 'ติดตั้งพร้อมรับประกัน 1 ปี'] },
      { name: 'แพ็กเกจออฟฟิศ L', size: '8 กล้อง', price: 14900, unit: 'ชุด', items: ['กล้อง IP 5MP 8 ตัว', 'เครื่องบันทึก NVR 8 ช่อง', 'HDD 4TB บันทึก 30 วัน', 'POE Switch ในตัว', 'แจ้งเตือน + AI Detection'] }
    ],
    access: [
      { name: 'แพ็กเกจบ้าน Security', size: 'บ้านพัก', price: 6900, unit: 'ชุด', items: ['ประตูคีย์การ์ด 1 จุด', 'สัญญาณกันขโมย 4 Zone', 'PIR Sensor 2 ตัว', 'แจ้งเตือนผ่านมือถือ', 'รับประกัน 1 ปี'] },
      { name: 'แพ็กเกจออฟฟิศ Security', size: 'สำนักงาน', price: 18900, unit: 'ชุด', hot: true, items: ['Access Control 3 จุด (ลายนิ้วมือ)', 'สัญญาณกันขโมย 8 Zone', 'Video Intercom 1 ชุด', 'บันทึกประวัติเข้า-ออก', 'รับประกัน 1 ปี + On-site Support'] },
      { name: 'แพ็กเกจลานจอดรถ', size: 'โรงงาน / หมู่บ้าน', price: null, unit: '', items: ['ไม้กั้นอัตโนมัติ RFID', 'กล้อง LPR อ่านทะเบียน', 'Access Control หลายจุด', 'ระบบ Intercom', 'ออกแบบตามหน้างาน'] }
    ],
    ac: [
      { name: 'แพ็กเกจล้างแอร์', size: 'ทุกขนาด', price: 600, unit: 'เครื่อง', items: ['ล้างคอยล์เย็น + ถาดน้ำทิ้ง', 'ฉีดล้างคอยล์ร้อน', 'ตรวจเช็กระบบไฟฟ้า', 'รับประกัน 30 วัน'] },
      { name: 'แพ็กเกจติดตั้งแอร์', size: 'ทุกยี่ห้อ', price: 3500, unit: 'เครื่อง', hot: true, items: ['เดินท่อน้ำยา 4 เมตร', 'เดินสายไฟ 4 เมตร', 'ทดสอบการทำงาน', 'ฟรีตรวจน้ำยาแอร์', 'รับประกัน 1 ปี'] },
      { name: 'แพ็กเกจซ่อมแอร์', size: 'ทุกอาการ', price: 0, unit: 'วินิจฉัย', items: ['วินิจฉัยปัญหาฟรี', 'อะไหล่แท้ 100%', 'ช่างประสบการณ์ 10+ ปี', 'รับประกันงานซ่อม 3 เดือน'] }
    ],
    net: [
      { name: 'แพ็กเกจ SME', size: 'ออฟฟิศเล็ก', price: 8900, unit: 'ชุด', items: ['Router / Firewall', 'Access Point 1 จุด (100 ตร.ม.)', 'Switch 8 Port PoE', 'เดินสาย CAT6 10 จุด', 'รับประกัน 1 ปี'] },
      { name: 'แพ็กเกจ Business', size: 'ออฟฟิศกลาง', price: 24900, unit: 'ชุด', hot: true, items: ['Firewall UTM ระดับองค์กร', 'Access Point 3 จุด (WiFi 6)', 'Managed Switch 24 Port PoE', 'เดินสาย CAT6 30 จุด', 'VPN + รับประกัน 2 ปี'] },
      { name: 'แพ็กเกจ Enterprise', size: 'โรงงาน / โรงแรม', price: null, unit: '', items: ['ออกแบบ Network เต็มรูปแบบ', 'Fiber Optic Backbone', 'Wireless Controller + AP หลายจุด', 'Server + NAS + Backup', 'NOC Monitoring 24 ชม.'] }
    ]
  },
  brands: {
    cctv: ['Hikvision', 'Dahua'],
    access: ['Yale', 'Xiaomi'],
    ac: ['Daikin', 'Mitsubishi Heavy', 'Samsung', 'Panasonic', 'Carrier', 'LG', 'Toshiba', 'Sharp'],
    net: ['Cisco', 'Ubiquiti', 'MikroTik', 'HP / HPE', 'Dell', 'Synology', 'Fortinet', 'TP-Link']
  },
  // products on sale on the website; was = price before the promotion
  products: [
    { slug: 'air-conditioner-installation-1', cat: 'ac',     name: 'บริการติดตั้งแอร์',            desc: 'แอร์ขนาด 9,000 – 18,000 BTU',                       price: 3800,  was: 4500 },
    { slug: 'daikin-inverter-12000-btu-2', cat: 'ac',     name: 'Daikin Inverter 12000 BTU',    desc: 'อินเวอร์เตอร์ประหยัดไฟเบอร์ 5 พร้อมติดตั้ง',          price: 22900, was: 25900 },
    { slug: 'mitsubishi-heavy-18000-btu-3', cat: 'ac',     name: 'Mitsubishi Heavy 18000 BTU',   desc: 'Heavy Duty ทนร้อน ทนฝุ่น เหมาะกับโรงงาน',             price: 38500 },
    { slug: 'hikvision-4k-8ch-nvr-kit-4', cat: 'cctv',   name: 'Hikvision 4K 8CH NVR Kit',     desc: 'ชุดกล้อง 4K NVR 8 ช่อง พร้อม HDD 2TB ติดตั้งฟรี',      price: 16500, was: 18900 },
    { slug: 'dahua-ip-camera-5mp-5', cat: 'cctv',   name: 'Dahua IP Camera 5MP',          desc: 'รองรับ ONVIF ดูภาพผ่านมือถือได้ 24 ชม.',               price: 4500 },
    { slug: 'cctv-installation-per-point-6', cat: 'cctv',   name: 'ติดตั้งกล้องวงจรปิด (ต่อจุด)',  desc: 'รวมค่าแรง + อุปกรณ์เดินสาย',                          price: 1500 },
    { slug: 'custom-gaming-pc-rtx-4070-7', cat: 'pc',     name: 'Custom Gaming PC RTX 4070',    desc: 'CPU i9 · RAM 32GB · SSD 1TB · RTX 4070',             price: 59900, was: 65000 },
    { slug: 'dell-inspiron-15-core-i5-8', cat: 'pc',     name: 'Dell Inspiron 15 Core i5',     desc: '15.6 นิ้ว Core i5 Gen13 · RAM 16GB · SSD 512GB',       price: 28900 },
    { slug: 'ubiquiti-unifi-ap-pro-9', cat: 'net',    name: 'Ubiquiti UniFi AP Pro',        desc: 'Access Point WiFi 6 ครอบคลุม 200 ตร.ม.',               price: 7500 },
    { slug: 'mikrotik-rb450gx4-router-10', cat: 'net',    name: 'MikroTik RB450Gx4 Router',     desc: 'Router Enterprise รองรับ BGP, OSPF, VPN',              price: 5500,  was: 6200 },
    { slug: 'xiaomi-smart-gateway-hub-11', cat: 'access', name: 'Xiaomi Smart Gateway Hub',     desc: 'ศูนย์กลาง Smart Home รองรับ Zigbee / BLE',             price: 2500,  was: 2990 },
    { slug: 'yale-smart-lock-ydm3109-12', cat: 'access', name: 'Yale Smart Lock YDM3109',      desc: 'ลายนิ้วมือ + PIN + แอป · กันน้ำ IP55',                 price: 8900 },
    { slug: 'ac-repair-cleaning-with-refrigerant-13', cat: 'ac',     name: 'ซ่อม / ล้างแอร์ พร้อมน้ำยา',     desc: 'ล้างแอร์ เติมน้ำยา ตรวจเช็กระบบ พร้อมใบรับประกัน',      price: 600,   was: 800 }
  ]
};
