/**
 * 搜索智能纠偏（本地词典，无第三方依赖）。
 * 解决两类移动端/输入法常见痛点：
 *   1) 错别字 / 简写（如「复联」→「复仇者联盟」、「权游」→「权力的游戏」）
 *   2) 拼音首字母（如「fczl」→「复仇者联盟」、「lddq」→「流浪地球」）
 *
 * 设计要点：
 * - 错别字走 TYPO_DICT 精确映射；拼音走 COMMON_TITLES 首字母前缀/包含匹配。
 * - 仅覆盖常见影视词条（本地词典），未命中时原样返回（不强行改写，避免误伤）。
 * - pinyinInitials 提供「中文→首字母」能力（内置常用字表，best-effort），
 *   供后续扩展（如对搜索结果标题做首字母匹配）。
 */

/** 常见错别字 / 简写 → 正确片名（本地词典，按需扩充）。 */
export const TYPO_DICT: Record<string, string> = {
  复联: '复仇者联盟',
  复联3: '复仇者联盟3',
  复联4: '复仇者联盟4',
  复愁者: '复仇者联盟',
  复仇者: '复仇者联盟',
  钢1: '钢铁侠',
  钢铁: '钢铁侠',
  钢铁侠: '钢铁侠',
  美队: '美国队长',
  美队3: '美国队长3',
  美国队长: '美国队长',
  蜘1: '蜘蛛侠',
  蜘蛛: '蜘蛛侠',
  哈1: '哈利波特',
  哈利: '哈利波特',
  哈利波特: '哈利波特',
  权游: '权力的游戏',
  权力: '权力的游戏',
  速激: '速度与激情',
  速7: '速度与激情7',
  流浪: '流浪地球',
  哪吒: '哪吒之魔童降世',
  大圣: '大圣归来',
  白蛇: '白蛇缘起',
  鬼吹: '鬼吹灯',
  盗墓: '盗墓笔记',
  琅琊: '琅琊榜',
  甄嬛: '甄嬛传',
  知否: '知否知否应是绿肥红瘦',
  三体: '三体',
  狂飙: '狂飙',
  繁花: '繁花',
  漫季: '漫长的季节',
  漫长的: '漫长的季节',
  绝命: '绝命毒师',
  老友: '老友记',
  鱿鱼: '鱿鱼游戏',
  请回: '请回答1988',
  请回答: '请回答1988',
  肖申: '肖申克的救赎',
  霸王: '霸王别姬'
}

/** 热门片名 + 拼音首字母（本地词典，供拼音检索）。 */
export const COMMON_TITLES: { t: string; p: string }[] = [
  { t: '复仇者联盟', p: 'fczl' },
  { t: '复仇者联盟3', p: 'fczl3' },
  { t: '复仇者联盟4', p: 'fczl4' },
  { t: '流浪地球', p: 'lddq' },
  { t: '流浪地球2', p: 'lddq2' },
  { t: '速度与激情', p: 'sdyjq' },
  { t: '速度与激情7', p: 'sdyjq7' },
  { t: '钢铁侠', p: 'gtx' },
  { t: '钢铁侠3', p: 'gtx3' },
  { t: '美国队长', p: 'mgdd' },
  { t: '美国队长3', p: 'mgdd3' },
  { t: '蜘蛛侠', p: 'zzx' },
  { t: '蝙蝠侠', p: 'bfx' },
  { t: '哈利波特', p: 'hlbt' },
  { t: '哈利波特与魔法石', p: 'hlbtymfs' },
  { t: '指环王', p: 'zhww' },
  { t: '魔戒', p: 'mj' },
  { t: '千与千寻', p: 'qyqx' },
  { t: '龙猫', p: 'lm' },
  { t: '你的名字', p: 'nmdz' },
  { t: '疯狂动物城', p: 'fkdwc' },
  { t: '冰雪奇缘', p: 'bjqy' },
  { t: '寻梦环游记', p: 'xmhyy' },
  { t: '神偷奶爸', p: 'stnb' },
  { t: '小黄人', p: 'xhy' },
  { t: '功夫熊猫', p: 'kfxm' },
  { t: '阿凡达', p: 'afd' },
  { t: '阿凡达2', p: 'afd2' },
  { t: '泰坦尼克号', p: 'ttnkh' },
  { t: '肖申克的救赎', p: 'xsjds' },
  { t: '霸王别姬', p: 'wbjj' },
  { t: '活着', p: 'hz' },
  { t: '让子弹飞', p: 'rzf' },
  { t: '战狼', p: 'zl' },
  { t: '战狼2', p: 'zl2' },
  { t: '红海行动', p: 'hhxd' },
  { t: '哪吒之魔童降世', p: 'nzzmtjs' },
  { t: '哪吒闹海', p: 'nznh' },
  { t: '大圣归来', p: 'dsgl' },
  { t: '白蛇缘起', p: 'bsyq' },
  { t: '鬼吹灯', p: 'gcd' },
  { t: '盗墓笔记', p: 'dmbj' },
  { t: '庆余年', p: 'qyn' },
  { t: '琅琊榜', p: 'lyb' },
  { t: '甄嬛传', p: 'zhz' },
  { t: '知否知否应是绿肥红瘦', p: 'zfzfyslfhs' },
  { t: '长安十二时辰', p: 'csessc' },
  { t: '三体', p: 'st' },
  { t: '狂飙', p: 'kb' },
  { t: '繁花', p: 'fh' },
  { t: '漫长的季节', p: 'cdjj' },
  { t: '权力的游戏', p: 'qlddyx' },
  { t: '绝命毒师', p: 'jmds' },
  { t: '老友记', p: 'lyj' },
  { t: '生活大爆炸', p: 'shdbbz' },
  { t: '西部世界', p: 'xbsj' },
  { t: '行尸走肉', p: 'xszr' },
  { t: '怪奇物语', p: 'gqwy' },
  { t: '鱿鱼游戏', p: 'yyxy' },
  { t: '请回答1988', p: 'qhd1988' }
]

/** 常用汉字 → 拼音首字母（best-effort 本地表，覆盖高频影视用字）。 */
const PINYIN_TABLE: Record<string, string> = {
  复: 'f', 仇: 'c', 者: 'z', 联: 'l', 盟: 'm', 流: 'l', 浪: 'l', 地: 'd', 球: 'q',
  速: 's', 度: 'd', 与: 'y', 激: 'j', 情: 'q', 钢: 'g', 铁: 't', 侠: 'x', 美: 'm',
  国: 'g', 队: 'd', 长: 'c', 蜘: 'z', 蛛: 'z', 蝙: 'b', 蝠: 'f', 哈: 'h', 利: 'l',
  波: 'b', 特: 't', 指: 'z', 环: 'h', 王: 'w', 魔: 'm', 戒: 'j', 千: 'q', 寻: 'x',
  龙: 'l', 猫: 'm', 你: 'n', 名: 'm', 字: 'z', 疯: 'f', 狂: 'k', 动: 'd', 物: 'w',
  城: 'c', 冰: 'b', 雪: 'x', 奇: 'q', 缘: 'y', 梦: 'm', 游: 'y', 记: 'j', 神: 's',
  偷: 't', 奶: 'n', 爸: 'b', 小: 'x', 黄: 'h', 人: 'r', 功: 'g', 夫: 'f', 熊: 'x',
  凡: 'f', 达: 'd', 泰: 't', 坦: 't', 尼: 'n', 克: 'k', 号: 'h', 肖: 'x',
  申: 's', 救: 'j', 赎: 's', 霸: 'b', 别: 'b', 姬: 'j', 活: 'h',
  着: 'z', 让: 'r', 子: 'z', 弹: 'd', 飞: 'f', 战: 'z', 狼: 'l', 红: 'h', 海: 'h',
  行: 'x', 哪: 'n', 吒: 'z', 之: 'z', 童: 't', 降: 'j', 世: 's', 闹: 'n',
  大: 'd', 圣: 's', 归: 'g', 来: 'l', 白: 'b', 蛇: 's', 起: 'q', 鬼: 'g',
  吹: 'c', 灯: 'd', 盗: 'd', 墓: 'm', 笔: 'b', 庆: 'q', 余: 'y', 年: 'n', 琅: 'l',
  琊: 'y', 榜: 'b', 甄: 'z', 嬛: 'h', 传: 'c', 知: 'z', 否: 'f', 应: 'y', 是: 's',
  绿: 'l', 肥: 'f', 瘦: 's', 安: 'a', 十: 's', 二: 'e', 时: 's', 辰: 'c', 三: 's',
  体: 't', 飙: 'b', 繁: 'f', 花: 'h', 漫: 'm', 季: 'j', 权: 'q', 戏: 'x', 绝: 'j',
  命: 'm', 毒: 'd', 师: 's', 老: 'l', 友: 'y', 生: 's', 爆: 'b', 炸: 'z', 西: 'x',
  部: 'b', 尸: 's', 走: 'z', 肉: 'r', 怪: 'g', 语: 'y', 鱿: 'y', 鱼: 'y', 请: 'q',
  回: 'h'
}

/** 将中文串转为拼音首字母（ASCII 字母/数字原样保留，未收录汉字跳过）。 */
export function pinyinInitials(text: string): string {
  if (!text) return ''
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 97 && code <= 122) out += ch // a-z
    else if (code >= 65 && code <= 90) out += ch.toLowerCase() // A-Z
    else if (code >= 48 && code <= 57) out += ch // 0-9
    else if (PINYIN_TABLE[ch]) out += PINYIN_TABLE[ch]
    // 其它（含未收录汉字 / 标点）跳过
  }
  return out
}

export interface CorrectResult {
  corrected: string
  confidence: number
  fromDict: boolean
}

/** 全角→半角（标点、空格），并转小写，便于词典匹配。 */
function normalize(raw: string): string {
  return raw
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .toLowerCase()
    .trim()
}

/**
 * 智能纠偏：错别字映射优先，其次拼音首字母匹配热门片名。
 * 均未命中则原样返回（不强行改写）。
 */
export function correctQuery(raw: string, dict?: Record<string, string>): CorrectResult {
  const q = (raw || '').trim()
  if (!q) return { corrected: q, confidence: 1, fromDict: false }
  const normalized = normalize(q)
  const map = dict || TYPO_DICT
  if (map[normalized]) {
    return { corrected: map[normalized], confidence: 0.95, fromDict: true }
  }
  // 纯拼音/数字查询：匹配本地热门片名首字母
  if (/^[a-z0-9]+$/.test(normalized)) {
    const matched = COMMON_TITLES.filter(
      (t) => t.p.startsWith(normalized) || t.p.includes(normalized)
    )
    if (matched.length) {
      return { corrected: matched[0].t, confidence: 0.85, fromDict: true }
    }
  }
  return { corrected: normalized, confidence: 0.5, fromDict: false }
}
