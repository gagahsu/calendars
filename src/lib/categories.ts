/** Expense categories. Keys are stored in the DB; labels are what the user sees. */
export const CATEGORIES = [
  { key: 'food', label: '餐飲', emoji: '🍜' },
  { key: 'grocery', label: '生活採買', emoji: '🛒' },
  { key: 'transport', label: '交通', emoji: '🚇' },
  { key: 'shopping', label: '購物', emoji: '🛍️' },
  { key: 'utility', label: '水電通訊', emoji: '💡' },
  { key: 'housing', label: '房租房貸', emoji: '🏠' },
  { key: 'subscription', label: '訂閱服務', emoji: '📺' },
  { key: 'entertainment', label: '娛樂', emoji: '🎬' },
  { key: 'health', label: '醫療健康', emoji: '🏥' },
  { key: 'pet', label: '寵物', emoji: '🐾' },
  { key: 'education', label: '學習進修', emoji: '📚' },
  { key: 'social', label: '人情紅包', emoji: '🎁' },
  { key: 'insurance', label: '保險稅務', emoji: '📄' },
  { key: 'investment', label: '投資', emoji: '📈' },
  { key: 'other', label: '其他', emoji: '💠' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key as string, c]));

export function categoryLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function categoryEmoji(key: string): string {
  return BY_KEY.get(key)?.emoji ?? '💠';
}

export function isCategoryKey(key: string): key is CategoryKey {
  return BY_KEY.has(key);
}

/**
 * Keyword → category guesses for text typed into LINE ("記 120 星巴克").
 * First match wins, so put specific words before generic ones.
 */
const KEYWORDS: Array<[CategoryKey, string[]]> = [
  ['food', ['早餐', '午餐', '晚餐', '宵夜', '午飯', '晚飯', '飲料', '咖啡', '星巴克', '便當', '小吃', '外送', 'ubereats', 'foodpanda', '拉麵', '火鍋', '吃飯', '餐廳', '手搖', '麥當勞', '超商美食', '鐵板燒', '雞蛋糕', '章魚燒']],
  ['grocery', ['全聯', '家樂福', '大潤發', '好市多', 'costco', '菜', '超市', '生鮮', '日用品', '衛生紙', '全家', '7-11', '711', '超商', 'ok超商', '萊爾富']],
  ['transport', ['捷運', '公車', '高鐵', '台鐵', '火車', '計程車', 'uber', '加油', '停車', '油錢', '悠遊卡', '機車', '客運', '停車費', 'youbike', 'parking']],
  ['shopping', ['蝦皮', 'momo', 'pchome', '衣服', '鞋', '包', '網購', '家具', '3c', '手機', '電腦', '耳機', '化妝品', '保養品']],
  ['utility', ['電費', '水費', '瓦斯', '網路費', '電話費', '手機費', '中華電信', '台電', '第四台', '寬頻']],
  ['housing', ['房租', '房貸', '管理費', '租金']],
  ['subscription', ['netflix', 'spotify', 'youtube', 'icloud', 'chatgpt', 'disney', 'kkbox', '會員', '訂閱', 'notion', 'adobe', 'dropbox', 'apple music', 'prime']],
  ['entertainment', ['電影', '遊戲', 'steam', 'ktv', '演唱會', '展覽', '旅遊', '住宿', '飯店', '門票', '球賽']],
  ['health', ['看診', '掛號', '藥', '牙醫', '醫院', '健檢', '診所', '中醫', '健身', '眼鏡', '隱形眼鏡']],
  ['pet', ['寵物', '貓狗', '獸醫', '飼料', '貓砂', '寵物美容', '寵物醫院']],
  ['education', ['書', '課程', '學費', '補習', '證照', '考試', '教材', 'udemy', '知島']],
  ['social', ['紅包', '禮物', '包禮', '婚禮', '孝親', '捐款', '白包']],
  ['insurance', ['保費', '保險', '稅', '牌照稅', '燃料費', '所得稅', '勞保', '健保']],
  ['investment', ['證券', '投顧', '投資', '股票', '基金', '期貨', '定期定額', 'etf']],
];

export function guessCategory(text: string): CategoryKey {
  const haystack = text.toLowerCase();
  for (const [category, words] of KEYWORDS) {
    if (words.some((word) => haystack.includes(word))) return category;
  }
  return 'other';
}
