'use strict';

/**
 * 초기 데이터 적재
 *  - 공급처 3곳과 위탁판매 계약 조건: 실제 체결(예정) 계약서의 조건을 그대로 반영
 *      보흥제유소  : 판매수수료 25%,        정산 익월 15일, 위탁배송 영업일 2일, 할인한도 20%
 *      다향농장    : 신선·가공 20% / 체험권 15%, 정산 익월 15일, 위탁배송 영업일 1일, 할인한도 20%
 *      주방철물    : 수수료율·할인한도가 계약서에 공란 → 미확정으로 표시(확정 후 입력)
 *  - 상품은 계약서 [별지 1] 품목명만 등록하고 공급가·권장판매가는 비워 둔다.
 *    (계약서 별지에 금액이 기재되어 있지 않으므로 임의 단가를 넣지 않는다)
 */

const { get, run, tx, setSetting } = require('./db');
const { hashPassword } = require('./lib/auth');

const RESET = process.argv.includes('--reset');

const CHANNELS = ['자사몰', '쿠팡', '쿠팡파트너스', '토스쇼핑'];

const SUPPLIERS = [
  {
    name: '보흥제유소', ceo: '정해필', biz_no: '413-02-03696', tax_type: '간이과세자',
    address: '전라남도 보성군 보성읍 현충로 83-7', phone: '061-852-3376 / 010-5126-3376',
    login_id: 'bohueng', password: 'bohueng2026',
    intro: '보성 현지에서 참깨·들깨를 직접 압착해 짜는 전통 제유소입니다.',
    contract: {
      commission_rate: 0.25,
      commission_note: '판매금액(VAT 제외)의 25%. 채널수수료·통상 광고비는 수탁자 부담.',
      settlement_cycle: '익월 15일', ship_days: 2, discount_limit_rate: 0.20,
      note: '유리병 제품 — 완충재·누출방지 포장 필수(공급처 책임). 소비기한 2/3 이상 남은 상품만 출고.',
    },
    products: [
      { name: '참기름', category: '가공식품', spec: '180ml / 300ml', origin: '국산(표시 확인 필요)' },
      { name: '들기름', category: '가공식품', spec: '180ml / 300ml', origin: '국산(표시 확인 필요)' },
      { name: '탈피 들깨가루', category: '가공식품', spec: '500g', origin: '국산(표시 확인 필요)' },
      { name: '선식(쑥·오곡 혼합)', category: '가공식품', spec: '500g', origin: '국산(표시 확인 필요)' },
      { name: '환류(울금·청국·함초 등)', category: '가공식품', spec: '계약서 별지 미기재', origin: '국산(표시 확인 필요)' },
    ],
  },
  {
    name: '다향농장', ceo: '한재윤', biz_no: '184-01-03826', tax_type: '일반과세자',
    address: '전라남도 보성군 득량면 공룡로 917', phone: '',
    login_id: 'dahyang', password: 'dahyang2026',
    intro: '보성에서 바나나·애플망고·파인애플을 키우는 아열대 과일 농장이자 치유농업 체험장입니다.',
    contract: {
      commission_rate: 0.20,
      commission_note: '신선 과일·가공·선물세트 20% / 농장체험·치유농업 이용권 15%.',
      settlement_cycle: '익월 15일 (체험 이용권은 체험 이행 월 기준)', ship_days: 1, discount_limit_rate: 0.20,
      note: '수확량 변동 시 출고 예정일 3일 전까지 통지. 체험 이용권 유효기간 6개월, 방문 3일 전까지 무료 취소.',
    },
    products: [
      { name: '바나나', category: '아열대과일', spec: '계약서 별지 미기재', origin: '전남 보성(다향농장)' },
      { name: '애플망고', category: '아열대과일', spec: '계약서 별지 미기재', origin: '전남 보성(다향농장)' },
      { name: '파인애플', category: '아열대과일', spec: '계약서 별지 미기재', origin: '전남 보성(다향농장)' },
      { name: '아열대 과일 혼합 선물세트', category: '선물세트', spec: '계약서 별지 미기재', origin: '전남 보성(다향농장)' },
      { name: '농장체험 이용권 (1인)', category: '체험·프로그램', spec: '유효기간 6개월', origin: '전남 보성(다향농장)', commissionRate: 0.15 },
      { name: '치유농업 프로그램 (단체)', category: '체험·프로그램', spec: '사전 예약제', origin: '전남 보성(다향농장)', commissionRate: 0.15 },
    ],
  },
  {
    name: '주방철물', ceo: '최영렬', biz_no: '602-20-45515', tax_type: '',
    address: '전라남도 보성군 보성읍 봉화로 53-204', phone: '',
    login_id: 'jubang', password: 'jubang2026',
    intro: '주방용 스테인리스 제품과 생활·건축 철물을 취급합니다.',
    contract: {
      commission_rate: null,
      commission_note: '계약서 제9조 판매수수료율이 공란 — 협의 확정 후 수수료 관리 화면에서 입력.',
      settlement_cycle: '익월 15일', ship_days: 2, discount_limit_rate: null,
      note: '계약서 제6조 할인 허용 한도도 공란. KC 인증 대상 품목은 인증서 사본·표시사항 확보 필요.',
    },
    products: [
      { name: '스테인리스 주방선반', category: '주방철물', spec: 'SUS304', origin: '' },
      { name: '싱크대 수전', category: '주방철물', spec: '계약서 별지 미기재', origin: '' },
      { name: '경첩·손잡이류', category: '생활철물', spec: '계약서 별지 미기재', origin: '' },
      { name: '공구·볼트·못류', category: '생활철물', spec: '계약서 별지 미기재', origin: '' },
    ],
  },
];

function seed() {
  tx(() => {
    if (RESET) {
      for (const t of ['channel_listings', 'product_images', 'products', 'supplier_contracts', 'suppliers']) {
        run(`DELETE FROM ${t}`);
        run('DELETE FROM sqlite_sequence WHERE name = ?', t);
      }
    }

    if (get('SELECT COUNT(*) AS c FROM suppliers').c === 0) {
      for (const s of SUPPLIERS) {
        const { hash, salt } = hashPassword(s.password);
        const ins = run(
          `INSERT INTO suppliers(name, ceo, biz_no, tax_type, address, phone, login_id, password_hash, password_salt, intro, status)
           VALUES(?,?,?,?,?,?,?,?,?,?,'계약중')`,
          s.name, s.ceo, s.biz_no, s.tax_type, s.address, s.phone, s.login_id, hash, salt, s.intro
        );
        const sid = Number(ins.lastInsertRowid);

        const c = s.contract;
        run(
          `INSERT INTO supplier_contracts(supplier_id, commission_rate, commission_note, settlement_cycle,
                                          shipping_method, ship_days, discount_limit_rate, note)
           VALUES(?,?,?,?,?,?,?,?)`,
          sid, c.commission_rate, c.commission_note, c.settlement_cycle,
          '위탁배송(공급처 직발송)', c.ship_days, c.discount_limit_rate, c.note
        );

        for (const p of s.products) {
          const pi = run(
            `INSERT INTO products(supplier_id, name, category, spec, origin, supply_price, suggested_price, stock,
                                  commission_rate, status, description)
             VALUES(?,?,?,?,?,0,0,0,?,'승인대기',?)`,
            sid, p.name, p.category, p.spec, p.origin, p.commissionRate ?? null,
            '계약서 [별지 1] 기준 품목입니다. 공급가·권장판매가·규격이 계약서에 기재되어 있지 않으므로 공급처 화면에서 입력한 뒤 승인 요청해 주세요.'
          );
          const pid = Number(pi.lastInsertRowid);
          for (const ch of CHANNELS) {
            run('INSERT INTO channel_listings(product_id, channel, listed) VALUES(?,?,0)', pid, ch);
          }
        }
      }
      console.log(`  · 공급처 ${SUPPLIERS.length}곳 · 계약조건 · 품목 ${SUPPLIERS.reduce((a, s) => a + s.products.length, 0)}건 적재`);
    }

    setSetting('mall_name', 'BMCTVda 보성 직거래장터');
    setSetting('org_name', '농업회사법인 히스메이커스 주식회사');
    setSetting('org_biz_no', '541-86-02177');
    setSetting('org_address', '전라남도 보성군 보성읍 현충로 72-1');
    setSetting('org_phone', '010-6704-9810');
    setSetting('channels', JSON.stringify(CHANNELS));
    setSetting('bank_account', '입금 계좌: (은행/계좌번호/예금주를 설정 화면에서 입력하세요)');
    setSetting('default_shipping_fee', '3500');
    setSetting('free_ship_over', '50000');
    setSetting('order_forward_sla', '영업일 기준 1일 이내 공급처 전달');
  });
  console.log('초기 데이터 적재 완료');
}

if (require.main === module) seed();

module.exports = { seed, CHANNELS };
